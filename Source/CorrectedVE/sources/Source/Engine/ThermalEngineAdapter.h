#ifndef OPENWAM_THERMAL_ENGINE_ADAPTER_H
#define OPENWAM_THERMAL_ENGINE_ADAPTER_H
#include "../1DPipes/ThermalFiniteVolumeReference.h"
#include "../Boundaries/ThermalPipeNozzleReference.h"

namespace OpenWAMThermalReference {
struct NativePipeCell {
  double rho,momentum,energy,gamma,r,pressure;
  std::array<double,10> fractions;
};
// Preserve mass, momentum, species and legacy temperature. Energy reference
// and pressure necessarily change when the EOS changes; expose those deltas.
inline Composition ImportSpecies(const std::array<double,10>& y,double argonInNitrogen) {
  if(!std::isfinite(argonInNitrogen)||argonInNitrogen<0.||argonInNitrogen>1.)
    throw std::domain_error("Invalid explicit Ar/N2-slot ratio");
  return FromComplete11(y,argonInNitrogen*y[8]);
}
inline ThermalQ ImportMassTemperature(double mass,double temperature,double velocity,
                                      const Composition& y) {
  Positive(mass);TemperatureRange(temperature);
  if(!std::isfinite(velocity))throw std::domain_error("Invalid imported velocity");
  ThermalQ q{{mass,mass*velocity,mass*(Energy(MixtureLaw(y),temperature)+.5*velocity*velocity)}};
  for(unsigned j=0;j<6;++j)q[j+3]=mass*y[j];return q;
}
inline ThermalQ ImportPipe(const NativePipeCell& c,double volume,double argonInNitrogen) {
  Positive(volume);Positive(c.rho);Positive(c.r);
  if(!std::isfinite(c.gamma)||c.gamma<=1.)throw std::domain_error("Invalid legacy gamma");
  const double u=c.momentum/c.rho;
  const double t=(c.energy/c.rho-.5*u*u)*(c.gamma-1.)/c.r;
  return ImportMassTemperature(c.rho*volume,t,u,ImportSpecies(c.fractions,argonInNitrogen));
}
struct AdapterStep {
  ThermalQ pipe,tank,external{};
  double impulse=0.,massRate=0.,energyRate=0.,dt=0.;
};
// Local, fixed-volume exchange replay. The neighboring pipe state is held
// fixed for this ONE step. It is an external supply, not a whole-engine solve.
inline AdapterStep AdvanceLocalPair(const ThermalQ& pipe,const ThermalQ& tank,
    const ThermalCell& neighbor,double vp,double vt,double area,double af,double ar,
    int normal,double requestedDt,double internalArea=0.) {
  if(normal!=1&&normal!=-1)throw std::domain_error("Invalid adapter normal");
  Positive(requestedDt);
  Positive(area);if(internalArea==0.)internalArea=area;Positive(internalArea);
  const auto p=RecoverCell(pipe,vp),t=RecoverCell(tank,vt);
  const double dt=std::min(requestedDt,.2*std::min(vp/(std::max(area,internalArea)*(std::abs(p.gas.velocity)+p.gas.soundSpeed)),vt/(area*t.gas.soundSpeed)));
  struct Rate { ThermalQ p{},t{},ext{};double momentum=0.,mass=0.,energy=0.; };
  auto rates=[&](const ThermalQ& qp,const ThermalQ& qt) {
    const auto pc=RecoverCell(qp,vp),tc=RecoverCell(qt,vt);const auto& a=pc.gas;const auto& b=tc.gas;
    const auto f=ThermalPipeNozzle({{a.pressure,a.temperature,a.velocity},a.fractions},{b.pressure,b.temperature,b.fractions},area,af,ar,normal);
    ThermalQ valve{{f.flux.mass,f.flux.momentum,f.flux.energy}};
    for(unsigned j=0;j<6;++j)valve[j+3]=f.flux.species[j];
    const auto internal=normal==1?ThermalHllc(neighbor,pc,internalArea):ThermalHllc(pc,neighbor,internalArea);
    Rate r;for(unsigned j=0;j<9;++j){r.ext[j]=normal*internal[j];r.p[j]=r.ext[j]-valve[j];if(j!=1)r.t[j]=valve[j];}
    // Quasi-1D pressure force on the tapered half-cell wall. This balances
    // the unequal face pressure forces for a uniform stationary state.
    r.p[1]+=normal*a.pressure*(area-internalArea);
    r.momentum=r.p[1];r.mass=f.flux.mass;r.energy=f.flux.energy;return r;
  };
  const auto a=rates(pipe,tank);auto pp=pipe,pt=tank;
  for(unsigned j=0;j<9;++j){pp[j]+=dt*a.p[j];pt[j]+=dt*a.t[j];}
  const auto b=rates(pp,pt);AdapterStep out;out.pipe=pipe;out.tank=tank;out.dt=dt;
  for(unsigned j=0;j<9;++j){out.pipe[j]+=.5*dt*(a.p[j]+b.p[j]);out.tank[j]+=.5*dt*(a.t[j]+b.t[j]);out.external[j]=.5*dt*(a.ext[j]+b.ext[j]);}
  RecoverCell(out.pipe,vp);RecoverCell(out.tank,vt);
  out.impulse=.5*dt*(a.momentum+b.momentum);out.massRate=a.mass;out.energyRate=a.energy;return out;
}
}
#endif
