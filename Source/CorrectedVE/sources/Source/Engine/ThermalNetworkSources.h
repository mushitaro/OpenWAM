#ifndef OPENWAM_THERMAL_NETWORK_SOURCES_H
#define OPENWAM_THERMAL_NETWORK_SOURCES_H
#include "../1DPipes/ThermalFiniteVolumeReference.h"
#include "ThermalClosedReactionReference.h"

namespace OpenWAMThermalReference {
// Development-only prescribed sources. No injector, burn phasing, mechanical
// shaft friction, or finite-capacity wall model is implied by this interface.
struct NetworkSource {
  int pipe=-1; unsigned cell=0; // pipe=-1: cell is a volume index.
  double conductance=0.,wallTemperature=300.,fuelRate=0.,darcy=0.,diameter=1.;
  bool woschni=false;
  // Closed-valve, zero-swirl branch of TCilindro4T; values pinned from deck.
  double rpm=3900.,bore=.087,stroke=.091,clearance=0.,pistonArea=.005945,headArea=.006539;
  double ivcPressure=101325.,ivcVolume=0.,trappedAir=0.,cw1=2.28;
  bool exhaustStroke=false;
};
inline double SourceConductance(const ThermalQ& q,double volume,const NetworkSource& s){
  if(!s.woschni)return s.conductance;
  const auto g=RecoverCell(q,volume).gas;
  const double vd=3.14159265358979323846*s.bore*s.bore*s.stroke/4;
  const double dp=std::max(0.,g.pressure-s.ivcPressure*std::pow(s.ivcVolume/volume,1.36));
  const double velocity=s.cw1*(2*s.rpm*s.stroke/60)+(s.fuelRate>0.?.001:0.)*dp*vd/(s.trappedAir*(s.exhaustStroke?MixtureLaw(g.fractions).r:287.));
  const double h=.012*std::pow(g.pressure,.8)*std::pow(g.temperature,-.53)*std::pow(s.bore,-.2)*std::pow(velocity,.8);
  const double area=s.pistonArea+s.headArea+4*std::max(0.,volume-s.clearance)/s.bore;
  return h*area;
}
struct NetworkSourceLedger {
  double heat=0.,reactionEnergy=0.,burnedFuel=0.,frictionImpulse=0.;
  Composition species{};
};
inline const OpenWAMClosedReactionReference::Contract& NetworkReactionContract(){
  static const auto c=[](){
    OpenWAMClosedReactionReference::Contract x;
    x.atomicWeights={{12.01,1.01,16.,14.005,39.95}};x.universalR=8314.4;x.lhv=44e6;
    const std::array<OpenWAMClosedReactionReference::Elements,6> atoms{{
      {{0,0,2,0,0}},{{1,0,2,0,0}},{{0,2,1,0,0}},{{0,0,0,2,0}},{{0,0,0,0,1}},{{7.97,14.8,0,0,0}}}};
    for(unsigned i=0;i<6;++i){auto& s=x.species[i];s.atoms=atoms[i];
      for(unsigned j=0;j<5;++j)s.molecularWeight+=atoms[i][j]*x.atomicWeights[j];
      s.law=Laws()[i];s.law.r=x.universalR/s.molecularWeight;s.hf=i==5?x.lhv:0.;
    }
    OpenWAMClosedReactionReference::Validate(x);return x;
  }();return c;
}
inline void ValidateNetworkSource(const NetworkSource& s){
  if(s.pipe < -1 || !std::isfinite(s.conductance)||s.conductance<0.||
     !std::isfinite(s.fuelRate)||s.fuelRate<0.||!std::isfinite(s.darcy)||s.darcy<0.)
    throw std::domain_error("Invalid network source coefficient");
  TemperatureRange(s.wallTemperature);Positive(s.diameter);
  if(s.woschni){
    if(s.pipe>=0||s.conductance!=0.)throw std::domain_error("Woschni requires a cylinder and no duplicate hA");
    for(double x:{s.rpm,s.bore,s.stroke,s.clearance,s.pistonArea,s.headArea,s.ivcPressure,s.ivcVolume,s.trappedAir,s.cw1})Positive(x);
  }
  if(s.pipe<0&&s.darcy!=0.)throw std::domain_error("0D volume has no axial wall friction");
  if(s.pipe>=0&&s.fuelRate!=0.)throw std::domain_error("Reaction source requires a 0D volume");
  if(s.fuelRate>0.)for(unsigned i=0;i<6;++i)
    if(Laws()[i].r!=NetworkReactionContract().species[i].law.r)
      throw std::domain_error("Reaction requires the common elemental EOS build");
}
inline double NetworkSourceTimescale(const ThermalQ& q,double volume,const NetworkSource& s){
  const auto g=RecoverCell(q,volume).gas;const auto l=MixtureLaw(g.fractions);
  double dt=1e99;
  const double hA=SourceConductance(q,volume,s);
  if(hA>0.)dt=std::min(dt,q[0]*(Cp(l,g.temperature)-l.r)/hA);
  if(s.darcy>0.&&g.velocity!=0.)dt=std::min(dt,2*s.diameter/(s.darcy*std::abs(g.velocity)));
  if(s.fuelRate>0.){
    const auto nu=OpenWAMClosedReactionReference::StoichMass(NetworkReactionContract());
    dt=std::min(dt,std::min(q[8],q[3]/(-nu[0]))/s.fuelRate);
  }
  return dt;
}
inline ThermalQ NetworkSourceRate(const ThermalQ& q,double volume,const NetworkSource& s,double dt,NetworkSourceLedger& ledger){
  ValidateNetworkSource(s);
  if(dt>NetworkSourceTimescale(q,volume,s)*(1+1e-12))throw std::domain_error("Unsafe network source stage");
  ThermalQ rate{};const auto g=RecoverCell(q,volume).gas;
  const double heat=SourceConductance(q,volume,s)*(s.wallTemperature-g.temperature);
  rate[2]=heat;ledger.heat+=heat;
  if(s.fuelRate>0.){
    const auto nu=OpenWAMClosedReactionReference::StoichMass(NetworkReactionContract());
    const auto alpha=OpenWAMClosedReactionReference::Alpha(NetworkReactionContract());
    double energy=0.;for(unsigned i=0;i<6;++i){rate[3+i]=s.fuelRate*nu[i];ledger.species[i]+=rate[3+i];energy-=alpha[i]*rate[3+i];}
    rate[2]+=energy;ledger.reactionEnergy+=energy;ledger.burnedFuel+=s.fuelRate;
  }
  rate[1]=-s.darcy/(2*s.diameter)*q[0]*g.velocity*std::abs(g.velocity);
  // Adiabatic stationary wall: total energy stays fixed; kinetic loss heats gas.
  ledger.frictionImpulse+=rate[1];return rate;
}
inline void AccumulateSourceLedger(NetworkSourceLedger& total,const NetworkSourceLedger& a,const NetworkSourceLedger& b,double dt){
  total.heat+=.5*dt*(a.heat+b.heat);total.reactionEnergy+=.5*dt*(a.reactionEnergy+b.reactionEnergy);
  total.burnedFuel+=.5*dt*(a.burnedFuel+b.burnedFuel);total.frictionImpulse+=.5*dt*(a.frictionImpulse+b.frictionImpulse);
  for(unsigned i=0;i<6;++i)total.species[i]+=.5*dt*(a.species[i]+b.species[i]);
}
}
#endif
