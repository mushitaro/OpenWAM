#ifndef OPENWAM_THERMAL_CYLINDER_NETWORK_H
#define OPENWAM_THERMAL_CYLINDER_NETWORK_H
#include "ThermalEngineAdapter.h"
#include <vector>
#include <limits>

namespace OpenWAMThermalReference {
constexpr double ImportRoundoffLimit=512.*std::numeric_limits<double>::epsilon();
constexpr double ImportSumLimit=1e-12; // Existing complete-mixture validation contract.
struct SpeciesImport {
  Composition fractions;
  std::array<double,10> correction{};
};
// Only the legacy untransported fuel complement may be slightly negative.
// Transfer the explicitly recorded correction to/from N2, never scale all Y.
// This policy applies to imported legacy data, never to evolved new states.
inline SpeciesImport ImportLegacyRoundoff(const std::array<double,10>& input,double argonRatio) {
  auto y=input;double sum=0.;
  for(unsigned j=0;j<10;++j){
    if(!std::isfinite(y[j])||y[j]>1.||y[j]<(j==9?-ImportRoundoffLimit:0.))
      throw std::domain_error("Legacy species exceeds roundoff import bound");
    if(j>=3&&j<=7&&y[j]!=0.)throw std::domain_error("Unsupported reactive species in thermal import");
    sum+=y[j];
  }
  if(std::abs(sum-1.)>ImportSumLimit)throw std::domain_error("Legacy species sum exceeds roundoff import bound");
  if(y[9]<0.)y[9]=0.;
  double others=0.;for(unsigned j=0;j<10;++j)if(j!=8)others+=y[j];
  y[8]=1.-others;
  SpeciesImport out;for(unsigned j=0;j<10;++j){out.correction[j]=y[j]-input[j];if(std::abs(out.correction[j])>ImportSumLimit+ImportRoundoffLimit)throw std::domain_error("Excessive import species correction");}
  out.fractions=ImportSpecies(y,argonRatio);return out;
}
struct NativeThermalPort {
  int id=0,normal=0;double time=0.,stateTime=0.,area=0.,innerArea=0.,volume=0.,af=0.,ar=0.;
  NativePipeCell endpoint{},neighbor{};
};
struct ThermalPort {
  int id,normal;double area,innerArea,volume,af,ar;
  ThermalQ q;ThermalCell neighbor;Composition neighborCorrection{};
};
struct ThermalCylinderNetwork {
  std::vector<ThermalPort> ports;
  ThermalQ cylinder{},external{},initial{};
  double time=0.,volume=0.,work=0.,impulse=0.;
  unsigned long long steps=0,forward=0,reverse=0;
  double importedFractionCorrection=0.,importedSpeciesMassCorrection=0.;
  double importedTransportCorrection=0.;
  static constexpr double argonRatio=.012/.767;
  Composition Import(const std::array<double,10>& y,double mass) {
    const auto v=ImportLegacyRoundoff(y,argonRatio);
    for(double c:v.correction){importedFractionCorrection=std::max(importedFractionCorrection,std::abs(c));importedSpeciesMassCorrection+=mass*std::abs(c);}
    return v.fractions;
  }
  ThermalQ ImportNative(const NativePipeCell& c,double v,bool inventory=true) {
    Positive(c.rho);Positive(c.r);Positive(v);
    if(!std::isfinite(c.gamma)||c.gamma<=1.)throw std::domain_error("Invalid native gamma");
    const double u=c.momentum/c.rho,t=(c.energy/c.rho-.5*u*u)*(c.gamma-1.)/c.r;
    return ImportMassTemperature(c.rho*v,t,u,Import(c.fractions,inventory?c.rho*v:0.));
  }
  ThermalQ Total() const {
    auto q=cylinder;for(const auto& p:ports)for(unsigned j=0;j<9;++j)q[j]+=p.q[j];return q;
  }
  void Initialize(double start,double v,double mass,double temp,const std::array<double,10>& y,
                  const std::vector<NativeThermalPort>& native) {
    if(!ports.empty()||steps)throw std::domain_error("Thermal network already initialized");
    time=start;volume=v;Positive(v);
    cylinder=ImportMassTemperature(mass,temp,0.,Import(y,mass));
    for(const auto& n:native)ports.push_back({n.id,n.normal,n.area,n.innerArea,n.volume,n.af,n.ar,
        ImportNative(n.endpoint,n.volume),RecoverCell(ImportNative(n.neighbor,1.,false),1.)});
    initial=Total();
  }
  void SetInputs(const std::vector<NativeThermalPort>& native,double target) {
    if(native.size()!=ports.size())throw std::domain_error("Thermal network port count changed");
    for(unsigned i=0;i<ports.size();++i){const auto& n=native[i];auto& p=ports[i];
      if(n.id!=p.id||n.normal!=p.normal||n.area!=p.area||n.innerArea!=p.innerArea||n.volume!=p.volume||
          std::abs(n.stateTime-time)>1e-10||std::abs(n.time-target)>1e-10)
        throw std::domain_error("Thermal network input identity or time mismatch");
      p.af=n.af;p.ar=n.ar;
      // Reservoir input has unit volume only to construct a density state;
      // record fraction corrections but do not count it as network inventory.
      auto c=n.neighbor;const auto y=ImportLegacyRoundoff(c.fractions,argonRatio);
      for(double d:y.correction)importedFractionCorrection=std::max(importedFractionCorrection,std::abs(d));
      const double u=c.momentum/c.rho,t=(c.energy/c.rho-.5*u*u)*(c.gamma-1.)/c.r;
      p.neighbor=RecoverCell(ImportMassTemperature(c.rho,t,u,y.fractions),1.);
      const Composition original{{c.fractions[0],c.fractions[1],c.fractions[2],(1.-argonRatio)*c.fractions[8],argonRatio*c.fractions[8],c.fractions[9]}};
      for(unsigned j=0;j<6;++j)p.neighborCorrection[j]=y.fractions[j]-original[j];
    }
  }
  struct Rate {std::vector<ThermalQ> pipe;ThermalQ cyl{},ext{};double work=0.,impulse=0.,importTransport=0.;unsigned f=0,r=0;};
  Rate Rates(const std::vector<ThermalQ>& qp,const ThermalQ& qc,double v,double dv)const {
    const auto c=RecoverCell(qc,v).gas;Rate out;out.pipe.resize(ports.size());
    for(unsigned i=0;i<ports.size();++i){const auto& port=ports[i];const auto pc=RecoverCell(qp[i],port.volume);const auto& p=pc.gas;
      ThermalQ valve{};
      if(port.af==0.&&port.ar==0.){
        // Impermeable fixed wall: mirror the velocity for the HLLC pressure
        // force, while mass/species/energy transfer is identically zero.
        auto ghost=pc;ghost.gas.velocity=-p.velocity;ghost.density[1]=-pc.density[1];
        const auto wall=port.normal==1?ThermalHllc(pc,ghost,port.area):ThermalHllc(ghost,pc,port.area);
        valve[1]=port.normal*wall[1];
      }else{
        const auto f=ThermalPipeNozzle({{p.pressure,p.temperature,p.velocity},p.fractions},{c.pressure,c.temperature,c.fractions},port.area,port.af,port.ar,port.normal);
        valve[0]=f.flux.mass;valve[1]=f.flux.momentum;valve[2]=f.flux.energy;
        for(unsigned j=0;j<6;++j)valve[3+j]=f.flux.species[j];
      }
      const auto inner=port.normal==1?ThermalHllc(port.neighbor,pc,port.innerArea):ThermalHllc(pc,port.neighbor,port.innerArea);
      for(unsigned j=0;j<9;++j){const double supply=port.normal*inner[j];out.pipe[i][j]=supply-valve[j];out.ext[j]+=supply;if(j!=1)out.cyl[j]+=valve[j];}
      out.pipe[i][1]+=port.normal*p.pressure*(port.area-port.innerArea);out.impulse+=out.pipe[i][1];
      if(valve[0]>0)++out.f;if(valve[0]<0)++out.r;
      if(port.normal*inner[0]>0)for(double d:port.neighborCorrection)out.importTransport+=port.normal*inner[0]*std::abs(d);
    }
    out.work=-c.pressure*dv;out.cyl[2]+=out.work;return out;
  }
  // Inputs are held over one native time interval; evolved inventories persist.
  // Volume is linear within that interval. Every substep updates all ports and
  // the cylinder together; no sequential per-valve cylinder update is used.
  void Advance(double target,double endVolume,double cfl=.2) {
    Positive(endVolume);if(!(target>time)||!(cfl>0.&&cfl<=.2))throw std::domain_error("Invalid network interval");
    const double start=time,v0=volume,dv=(endVolume-v0)/(target-start);
    while(time<target){
      const double currentVolume=v0+dv*(time-start);const auto c=RecoverCell(cylinder,currentVolume).gas;
      double dt=target-time,totalArea=0.;std::vector<ThermalQ> qp;
      for(const auto& p:ports){const auto s=RecoverCell(p.q,p.volume).gas;dt=std::min(dt,cfl*p.volume/(std::max(p.area,p.innerArea)*(std::abs(s.velocity)+s.soundSpeed)));totalArea+=p.area;qp.push_back(p.q);}
      if(totalArea>0.)dt=std::min(dt,cfl*currentVolume/(totalArea*c.soundSpeed));
      if(dv!=0.)dt=std::min(dt,cfl*.1*currentVolume/std::abs(dv));
      if(!(dt>0.)||time+dt==time)throw std::domain_error("Thermal network timestep underflow");
      const double nextTime=dt>=target-time?target:time+dt,nextVolume=v0+dv*(nextTime-start);
      dt=nextTime-time;
      const auto a=Rates(qp,cylinder,currentVolume,dv);auto pred=qp;auto pc=cylinder;
      for(unsigned i=0;i<ports.size();++i)for(unsigned j=0;j<9;++j)pred[i][j]+=dt*a.pipe[i][j];
      for(unsigned j=0;j<9;++j)pc[j]+=dt*a.cyl[j];
      const auto b=Rates(pred,pc,nextVolume,dv);auto next=qp;auto nc=cylinder;
      for(unsigned i=0;i<ports.size();++i){for(unsigned j=0;j<9;++j)next[i][j]+=.5*dt*(a.pipe[i][j]+b.pipe[i][j]);RecoverCell(next[i],ports[i].volume);}
      for(unsigned j=0;j<9;++j)nc[j]+=.5*dt*(a.cyl[j]+b.cyl[j]);RecoverCell(nc,nextVolume);
      for(unsigned i=0;i<ports.size();++i)ports[i].q=next[i];cylinder=nc;
      for(unsigned j=0;j<9;++j)external[j]+=.5*dt*(a.ext[j]+b.ext[j]);
      work+=.5*dt*(a.work+b.work);impulse+=.5*dt*(a.impulse+b.impulse);forward+=a.f;reverse+=a.r;
      importedTransportCorrection+=.5*dt*(a.importTransport+b.importTransport);
      time=nextTime;volume=nextVolume;++steps;
    }
  }
  double BudgetResidual()const {const auto q=Total();double worst=0.;for(unsigned j=0;j<9;++j)if(j!=1){const double scale=j==2?initial[2]:initial[0];worst=std::max(worst,std::abs((q[j]-initial[j]-external[j]-(j==2?work:0.))/scale));}return worst;}
};
}
#endif
