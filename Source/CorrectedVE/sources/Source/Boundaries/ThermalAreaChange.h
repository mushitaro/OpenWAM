#ifndef OPENWAM_THERMAL_AREA_CHANGE_H
#define OPENWAM_THERMAL_AREA_CHANGE_H
#include "ThermalTwoPipeValve.h"
namespace OpenWAMThermalReference {
struct AreaChangeResult : TwoPipeValveResult {
  bool expanding=false;
  double momentumResidual=0.,pressureRecovery=0.,backplatePressure=0.;
};
// Compact separated expansion: backplate pressure equals the incoming face
// pressure. Mass and h0 are shared; Ar*(pr-pd)=m*(ud-ur).
// Reverse flow uses an ideal isentropic contraction, with no vena-contracta
// coefficient. This is a declared closure, not a measured bidirectional loss.
inline AreaChangeResult ThermalAreaChangeWithLaws(const JunctionPort& first,const JunctionPort& second,
                                                 const std::array<Law,2>& laws){
  const std::array<JunctionPort,2> ports{{first,second}};
  std::array<WallResult,2> wall;
  for(unsigned i=0;i<2;++i){Positive(ports[i].area);wall[i]=ThermalWall(laws[i],ports[i].pipe.gas,ports[i].area,ports[i].normal);}
  const double reference=std::log1p((second.pipe.gas.pressure-first.pipe.gas.pressure)/first.pipe.gas.pressure);
  const double drive=wall[0].wave.logPressureRatio-reference-wall[1].wave.logPressureRatio;
  const unsigned d=drive>=0.?0:1,r=1-d;const auto& donor=ports[d];const auto& receiver=ports[r];
  AreaChangeResult out;out.forward=d==0;out.expanding=donor.area<receiver.area;
  if(!out.expanding||drive==0.){
    static_cast<TwoPipeValveResult&>(out)=ThermalTwoPipeValveWithLaws(first,second,laws,std::min(first.area,second.area),std::min(first.area,second.area));
    return out;
  }
  const auto& dl=laws[d];const auto& rl=laws[r];
  const double base=std::log1p((receiver.pipe.gas.pressure-donor.pipe.gas.pressure)/donor.pipe.gas.pressure);
  const double dw=wall[d].wave.logPressureRatio,rw=base+wall[r].wave.logPressureRatio,span=dw-rw;
  const double scale=donor.area*donor.pipe.gas.pressure/(dl.r*donor.pipe.gas.temperature)*std::sqrt(SoundSquared(dl,donor.pipe.gas.temperature));
  const double massTol=scale*(2e-12*span+64*std::numeric_limits<double>::epsilon()*(std::abs(dw)+std::abs(rw)+std::abs(base)));
  auto donorWave=[&](double x){auto w=WaveAtLogPressure(dl,donor.pipe.gas,x,donor.normal);if(x==dw)w.state.velocity=0.;return w;};
  double lower=SupportedWavePressures(dl,donor.pipe.gas.temperature)[0];
  auto sonic=[&](double x){const auto w=donorWave(x);return (1.-1e-10)*w.soundSpeed-donor.normal*w.state.velocity;};
  if(sonic(lower)<0.)lower=ValveRoot(sonic,lower,dw,1e-10);
  struct State {WaveResult dwave,rwave;Stagnation total;double mass=0.,received=0.,temperature=0.,rho=0.,residual=0.;};
  auto evaluate=[&](double recovery){
    auto states=[&](double x){State c;c.dwave=donorWave(x);const double u=donor.normal*c.dwave.state.velocity;
      if(u<0.)throw std::domain_error("Reversed expansion donor");
      c.mass=donor.area*c.dwave.density*u;c.total=ToStagnation(dl,c.dwave.state.temperature,u);
      c.rwave=WaveAtLogPressure(rl,receiver.pipe.gas,x+recovery-base,receiver.normal);
      if(x==rw-recovery)c.rwave.state.velocity=0.;return c;};
    double lo=std::max(lower,rw-recovery),hi=std::min(dw,base+SupportedWavePressures(rl,receiver.pipe.gas.temperature)[1]-recovery);
    auto margin=[&](double x){const auto c=states(x);return ReceivingSpeedLimit(dl,c.total.temperature)*(1.-1e-10)+receiver.normal*c.rwave.state.velocity;};
    if(lo>hi||margin(lo)<0.)throw std::domain_error("Expansion outside subsonic envelope");
    if(margin(hi)<0.)hi=ValveRoot([&](double x){return -margin(x);},lo,hi,1e-10);
    auto complete=[&](double x){auto c=states(x);const double v=-receiver.normal*c.rwave.state.velocity;
      if(v<0.)throw std::domain_error("Reversed expansion receiver");
      c.temperature=StaticTemperature(dl,c.total.temperature,v);c.rho=c.rwave.state.pressure/(dl.r*c.temperature);
      c.received=receiver.area*c.rho*v;return c;};
    auto balance=[&](double x){const auto c=complete(x);return c.received-c.mass;};
    auto c=complete(ValveRoot(balance,lo,hi,massTol));
    // expm1 preserves pressure recovery of order velocity squared in tails.
    c.residual=std::expm1(recovery)-c.mass/(receiver.area*c.dwave.state.pressure)*
      (donor.normal*c.dwave.state.velocity+receiver.normal*c.rwave.state.velocity);
    return c;
  };
  double upper=span*span;
  if(!(upper>0.))throw std::domain_error("Expansion drive underflow");
  for(unsigned j=0;evaluate(upper).residual<0.;++j){if(j==60)throw std::domain_error("Expansion recovery not bracketed");upper*=2.;}
  const double recovery=ValveRoot([&](double x){return evaluate(x).residual;},0.,upper,2e-11*upper);
  const auto c=evaluate(recovery);const double ud=c.dwave.state.velocity,ur=c.rwave.state.velocity;
  if(std::abs(ud)>=c.dwave.soundSpeed||std::abs(ur)>=std::sqrt(SoundSquared(dl,c.temperature)))throw std::domain_error("Sonic area-change face");
  out.face[d]={c.dwave.state,donor.pipe.fractions};out.face[r]={{c.rwave.state.pressure,c.temperature,ur},donor.pipe.fractions};
  out.flux[d].mass=c.mass;out.flux[r].mass=-c.mass;
  out.flux[d].energy=c.mass*c.total.enthalpy;out.flux[r].energy=-out.flux[d].energy;
  for(unsigned j=0;j<6;++j){out.flux[d].species[j]=c.mass*donor.pipe.fractions[j];out.flux[r].species[j]=-out.flux[d].species[j];}
  out.flux[d].momentum=donor.normal*donor.area*(c.dwave.state.pressure+c.dwave.density*ud*ud);
  out.flux[r].momentum=receiver.normal*receiver.area*c.rwave.state.pressure-c.mass*ur;
  out.receiverMassResidual=c.received-c.mass;out.momentumResidual=c.residual*c.dwave.state.pressure*receiver.area;
  out.pressureRecovery=c.dwave.state.pressure*std::expm1(recovery);out.backplatePressure=c.dwave.state.pressure;
  out.donorStagnationPressure=c.dwave.state.pressure*std::exp(c.total.logPressureRise);out.donorStagnationTemperature=c.total.temperature;
  const double ds=Integral(dl,c.dwave.state.temperature,c.temperature,-1.)-dl.r*recovery;
  out.entropyProduction=c.mass*ds;
  if(ds < -1e-7||!std::isfinite(ds)||std::abs(out.receiverMassResidual)>massTol)throw std::domain_error("Expansion entropy or mass residual");
  return out;
}
inline AreaChangeResult ThermalAreaChange(const JunctionPort& first,const JunctionPort& second){
  return ThermalAreaChangeWithLaws(first,second,{{MixtureLaw(first.pipe.fractions),MixtureLaw(second.pipe.fractions)}});
}
}
#endif
