#ifndef OPENWAM_THERMAL_TWO_PIPE_VALVE_H
#define OPENWAM_THERMAL_TWO_PIPE_VALVE_H
#include "ThermalMixingJunction.h"

namespace OpenWAMThermalReference {
struct TwoPipeValveResult {
  std::array<OutwardTransfer,2> flux{};
  std::array<ThermalPipeState,2> face{};
  Expansion throat{};
  double receiverMassResidual=0.,nozzleMassResidual=0.,entropyProduction=0.;
  double donorStagnationPressure=0.,donorStagnationTemperature=0.;
  bool forward=true,closed=false;
};
// Monotone, sign-bracketed root, using secant steps with bisection safeguards.
// Tolerance is supplied in residual units, not absolute pressure units.
template<class F> inline double ValveRoot(F f,double lo,double hi,double tolerance){
  double fl=f(lo),fh=f(hi);
  if(!std::isfinite(fl)||!std::isfinite(fh)||fl>tolerance||fh < -tolerance)
    throw std::domain_error("Two-pipe valve root not bracketed");
  if(std::abs(fl)<=tolerance)return lo;if(std::abs(fh)<=tolerance)return hi;
  for(unsigned i=0;i<100;++i){
    double x=(lo*fh-hi*fl)/(fh-fl);
    if(i%2==1||!(x>lo+.025*(hi-lo)&&x<hi-.025*(hi-lo)))x=.5*(lo+hi);
    if(x==lo||x==hi)break;
    const double fx=f(x);if(!std::isfinite(fx))throw std::domain_error("Nonfinite valve residual");
    if(std::abs(fx)<=tolerance)return x;
    if(fx<0.){lo=x;fl=fx;}else{hi=x;fh=fx;}
  }
  std::ostringstream message;message.precision(17);message<<"Two-pipe valve root did not converge: lo="<<lo<<" hi="<<hi<<" fl="<<fl<<" fh="<<fh<<" tolerance="<<tolerance;
  throw std::domain_error(message.str());
}
// Quasi-steady effective orifice between two live pipe characteristics.
// One donor supplies species and total enthalpy. Receiving face temperature is
// recovered from that enthalpy, not from the receiving acoustic wave's gas.
// The throat may choke while both pipe faces must remain subsonic.
inline TwoPipeValveResult ThermalTwoPipeValveWithLaws(const JunctionPort& first,const JunctionPort& second,
    const std::array<Law,2>& law,double forwardArea,double reverseArea){
  const std::array<JunctionPort,2> p{{first,second}};
  std::array<WallResult,2> wall;
  for(unsigned i=0;i<2;++i){Positive(p[i].area);wall[i]=ThermalWall(law[i],p[i].pipe.gas,p[i].area,p[i].normal);}
  if(!std::isfinite(forwardArea)||!std::isfinite(reverseArea)||forwardArea<0.||reverseArea<0.||
      forwardArea>std::min(first.area,second.area)||reverseArea>std::min(first.area,second.area))
    throw std::domain_error("Invalid two-pipe valve effective area");
  const double secondBase=std::log1p((second.pipe.gas.pressure-first.pipe.gas.pressure)/first.pipe.gas.pressure);
  const double drive=wall[0].wave.logPressureRatio-secondBase-wall[1].wave.logPressureRatio;
  TwoPipeValveResult result;result.forward=drive>=0.;const unsigned d=result.forward?0:1,r=1-d;
  const double effective=result.forward?forwardArea:reverseArea;
  if(effective==0.||drive==0.){
    result.closed=effective==0.;for(unsigned i=0;i<2;++i){result.flux[i].momentum=wall[i].outwardMomentumFlux;result.face[i]={wall[i].wave.state,p[i].pipe.fractions};result.face[i].gas.velocity=0.;}return result;
  }
  const auto& donor=p[d];const auto& receiver=p[r];const auto& dl=law[d];const auto& rl=law[r];
  const double base=std::log1p((receiver.pipe.gas.pressure-donor.pipe.gas.pressure)/donor.pipe.gas.pressure);
  const double dw=wall[d].wave.logPressureRatio,rw=base+wall[r].wave.logPressureRatio;
  const double characteristic=donor.area*donor.pipe.gas.pressure/(dl.r*donor.pipe.gas.temperature)*std::sqrt(SoundSquared(dl,donor.pipe.gas.temperature));
  // Nearly opposing waves can cancel the wall-pressure drive to much less
  // than one ULP of either wave. Account for that subtraction's backward
  // error; a tolerance based only on their difference is then unattainable.
  // This term scales with the waves themselves and has no fixed flow floor.
  const double span=dw-rw,tolerance=characteristic*(2e-12*span+
      64.*std::numeric_limits<double>::epsilon()*(std::abs(dw)+std::abs(rw)+std::abs(base)));
  if(!(span>0.)||!(tolerance>0.))throw std::domain_error("Unresolved two-pipe pressure drive");
  auto donorWave=[&](double x){auto w=WaveAtLogPressure(dl,donor.pipe.gas,x,donor.normal);if(x==dw)w.state.velocity=0.;return w;};
  double lower=std::max(rw,SupportedWavePressures(dl,donor.pipe.gas.temperature)[0]);
  auto donorSonic=[&](double x){const auto w=donorWave(x);return (1.-1e-10)*w.soundSpeed-donor.normal*w.state.velocity;};
  if(donorSonic(lower)<0.)lower=ValveRoot(donorSonic,lower,dw,1e-10);
  struct Candidate {WaveResult donor,receiver;Stagnation stagnation;Expansion nozzle;
    double mass=0.,received=0.,temperature=0.,rho=0.,donorLog=0.,residual=0.;bool feasible=false;};
  // Keep log(p_d/p_r) as its own unknown. In an acoustic tail it is O(u^2),
  // while each pipe pressure perturbation is O(u); subtraction loses it.
  auto evaluate=[&](double loss){
    Candidate c;c.residual=-characteristic;
    double low=std::max(lower,rw+loss),high=std::min(dw,base+SupportedWavePressures(rl,receiver.pipe.gas.temperature)[1]+loss);
    auto states=[&](double x){
      Candidate s;s.donorLog=x;s.donor=donorWave(x);const double u=donor.normal*s.donor.state.velocity;
      if(u<0.)throw std::domain_error("Reversed donor valve face");
      s.mass=donor.area*s.donor.density*u;s.stagnation=ToStagnation(dl,s.donor.state.temperature,u);
      s.receiver=WaveAtLogPressure(rl,receiver.pipe.gas,x-loss-base,receiver.normal);
      if(x==rw+loss||loss==span)s.receiver.state.velocity=0.;return s;
    };
    auto margin=[&](double x){const auto s=states(x);return ReceivingSpeedLimit(dl,s.stagnation.temperature)*(1.-1e-10)+receiver.normal*s.receiver.state.velocity;};
    auto complete=[&](double x){auto s=states(x);const double v=-receiver.normal*s.receiver.state.velocity;
      if(v<0.)throw std::domain_error("Reversed receiving valve face");
      s.temperature=StaticTemperature(dl,s.stagnation.temperature,v);s.rho=s.receiver.state.pressure/(dl.r*s.temperature);
      s.received=receiver.area*s.rho*v;return s;
    };
    if(loss==span)c=complete(dw);
    else{
      if(low>high||margin(low)<0.)return c;
      if(margin(high)<0.)high=ValveRoot([&](double x){return -margin(x);},low,high,1e-10);
      auto balance=[&](double x){const auto s=complete(x);return s.received-s.mass;};
      if(balance(low)>tolerance*.1||balance(high)<-tolerance*.1)return c;
      c=complete(ValveRoot(balance,low,high,tolerance*.1));
    }
    c.nozzle=ExpandLog(dl,donor.pipe.gas.pressure*std::exp(c.donorLog+c.stagnation.logPressureRise),c.stagnation.temperature,loss+c.stagnation.logPressureRise);
    // Zero additional pressure loss is the identity on the donor trace.
    // Avoid an ill-conditioned stagnation/static roundtrip across Cp pieces.
    if(loss==0.){
      c.nozzle.temperature=c.donor.state.temperature;c.nozzle.pressure=c.donor.state.pressure;
      c.nozzle.velocity=donor.normal*c.donor.state.velocity;c.nozzle.mach=c.nozzle.velocity/c.donor.soundSpeed;
      c.nozzle.massFlux=c.donor.density*c.nozzle.velocity;c.nozzle.choked=false;
      c.residual=(effective/donor.area-1.)*c.mass;
    }else c.residual=effective*c.nozzle.massFlux-c.mass;
    c.feasible=true;return c;
  };
  const double ratio=effective/std::min(donor.area,receiver.area);
  double upper=std::min(span,span*span/(ratio*ratio));
  if(!(upper>0.))throw std::domain_error("Two-pipe pressure loss underflow");
  while(upper<span&&evaluate(upper).residual<0.)upper=std::min(span,2*upper);
  const double loss=ValveRoot([&](double z){return evaluate(z).residual;},0.,upper,tolerance);
  const auto c=evaluate(loss);if(!c.feasible)throw std::domain_error("No supported subsonic two-pipe valve solution");
  const double ud=c.donor.state.velocity,ur=c.receiver.state.velocity;
  if(std::abs(ud)>=c.donor.soundSpeed||std::abs(ur)>=std::sqrt(SoundSquared(dl,c.temperature)))throw std::domain_error("Sonic pipe face outside valve model");
  result.face[d]={c.donor.state,donor.pipe.fractions};result.face[r]={{c.receiver.state.pressure,c.temperature,ur},donor.pipe.fractions};
  result.throat=c.nozzle;result.donorStagnationPressure=donor.pipe.gas.pressure*std::exp(c.donorLog+c.stagnation.logPressureRise);result.donorStagnationTemperature=c.stagnation.temperature;
  result.flux[d].mass=c.mass;result.flux[r].mass=-c.mass;
  result.flux[d].energy=c.mass*c.stagnation.enthalpy;result.flux[r].energy=-result.flux[d].energy;
  for(unsigned j=0;j<6;++j){result.flux[d].species[j]=c.mass*donor.pipe.fractions[j];result.flux[r].species[j]=-result.flux[d].species[j];}
  result.flux[d].momentum=donor.normal*donor.area*(c.donor.state.pressure+c.donor.density*ud*ud);
  result.flux[r].momentum=receiver.normal*receiver.area*c.receiver.state.pressure-c.mass*ur;
  result.receiverMassResidual=c.received-c.mass;result.nozzleMassResidual=effective*c.nozzle.massFlux-c.mass;
  const double ds=Integral(dl,c.donor.state.temperature,c.temperature,-1.)+dl.r*loss;
  result.entropyProduction=c.mass*ds;
  if(!std::isfinite(ds)||ds < -1e-7||std::abs(result.receiverMassResidual)>tolerance||std::abs(result.nozzleMassResidual)>tolerance)
    throw std::domain_error("Two-pipe valve conservation or entropy residual");
  return result;
}
inline TwoPipeValveResult ThermalTwoPipeValve(const JunctionPort& first,const JunctionPort& second,
                                               double forwardArea,double reverseArea){
  return ThermalTwoPipeValveWithLaws(first,second,{{MixtureLaw(first.pipe.fractions),MixtureLaw(second.pipe.fractions)}},forwardArea,reverseArea);
}
}
#endif
