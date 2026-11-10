#ifndef OPENWAM_THERMAL_PIPE_NOZZLE_REFERENCE_H
#define OPENWAM_THERMAL_PIPE_NOZZLE_REFERENCE_H
#include "ThermalWaveReference.h"
#include <sstream>
#include <memory>

namespace OpenWAMThermalReference {
struct ThermalPipeState { WaveState gas; Composition fractions; };
struct OutwardTransfer {
  double mass=0.,momentum=0.,energy=0.;
  Composition species{};
};
struct ThermalPipeNozzleResult {
  ThermalPipeState face;
  WaveResult pipeWave; // Pipe-side star state; distinct from reverse donor face.
  OutwardTransfer flux;
  double massResidual=0.,energyResidual=0.,pipeMach=0.,throatMach=0.;
  bool closed=false,choked=false,forward=true;
};
struct Stagnation { double temperature,logPressureRise,enthalpy; };
inline Stagnation ToStagnation(const Law& law,double t,double u) {
  TemperatureRange(t);
  const double kinetic=.5*u*u,hi=std::log(Tmax/t);
  const ExpansionCurve enthalpy(law,t,0.);
  auto heat=[&](double x){return -enthalpy(-x);};
  if(!std::isfinite(kinetic)||kinetic>heat(hi))throw std::domain_error("Stagnation temperature outside envelope");
  const double x=kinetic==0.?0.:IncreasingRoot(heat,kinetic,hi);
  return {t*std::exp(x),-ExpansionIntegral(law,t,-x,-1.)/law.r,Enthalpy(law,t)+kinetic};
}
inline double StaticTemperature(const Law& law,double t0,double u) {
  const double lower=Tmin*(1.+64.*std::numeric_limits<double>::epsilon());
  const double hi=t0>lower?std::log(t0/lower):0.,kinetic=.5*u*u;
  const ExpansionCurve heat(law,t0,0.);
  if(!std::isfinite(kinetic)||kinetic>heat(hi))throw std::domain_error("Donor static temperature outside envelope");
  return t0*std::exp(-(kinetic==0.?0.:IncreasingRoot(heat,kinetic,hi)));
}
inline double ReceivingSpeedLimit(const Law& law,double t0) {
  const double lower=Tmin*(1.+128.*std::numeric_limits<double>::epsilon());
  if(t0<=lower)return 0.;
  const double hi=std::log(t0/lower);
  const ExpansionCurve enthalpy(law,t0,0.);
  auto sonic=[&](double x){return 2*enthalpy(x)-SoundSquared(law,t0*std::exp(-x));};
  const double x=sonic(hi)>=0.?IncreasingRoot(sonic,0.,hi):hi;
  return std::sqrt(2*enthalpy(x));
}
inline std::array<double,2> SupportedWavePressures(const Law& law,double t) {
  const double margin=256.*std::numeric_limits<double>::epsilon();
  const double lower=Tmin*(1+margin),upper=Tmax*(1-margin);
  double lo=0.,hi=0.;
  if(t>lower)lo=-ExpansionIntegral(law,t,std::log(t/lower),-1.)/law.r;
  if(t<upper){
    const double theta=upper/t,de=Integral(law,t,upper)-law.r*(upper-t);
    const double b=2*de/(law.r*t)+theta-1.;
    hi=std::log(.5*(b+std::sqrt(b*b+4*theta)));
  }
  return {{lo,hi}};
}
// Explicit laws support the constant-Cp verification limit. Normal use must
// call ThermalPipeNozzle below so each law comes from its actual composition.
// Own the fixed pipe state so a surrounding junction pressure solve can reuse
// its wall solution. No reference to mutable graph state, rounded key, or
// cross-timestep cache is kept. Tank state and effective areas remain live.
class PipeNozzleContext {
  const ThermalPipeState pipe;
  const Law pipeLaw;
  const double area;
  const int normal;
  WallResult wall;
public:
  PipeNozzleContext(const ThermalPipeState& p,const Law& law,double a,int n):pipe(p),pipeLaw(law),area(a),normal(n){
    ValidateWave(pipeLaw,pipe.gas,normal);Validate(pipe.fractions);Positive(area);
    wall=ThermalWall(pipeLaw,pipe.gas,area,normal);
  }
  const WallResult& Wall()const{return wall;}
  ThermalPipeNozzleResult Evaluate(const Reservoir& tank,const Law& tankLaw,
    double forwardArea,double reverseArea,
    double preciseLogPressureRatio=std::numeric_limits<double>::quiet_NaN())const {
  ValidateWave(pipeLaw,pipe.gas,normal);Validate(pipe.fractions);Validate(tank);Positive(area);
  const double a=std::sqrt(SoundSquared(pipeLaw,pipe.gas.temperature));
  if(std::abs(pipe.gas.velocity)>=a||!std::isfinite(forwardArea)||!std::isfinite(reverseArea)||
     forwardArea<0.||reverseArea<0.||forwardArea>area||reverseArea>area)
    throw std::domain_error("Invalid subsonic pipe-nozzle area or state");
  const double roundedBase=std::log1p((pipe.gas.pressure-tank.pressure)/tank.pressure);
  // A network pressure solve can retain increments below an absolute-pressure
  // ULP. Accept that information only when consistent with the rounded states.
  const double base=std::isnan(preciseLogPressureRatio)?roundedBase:preciseLogPressureRatio;
  if(!std::isfinite(base)||std::abs(base-roundedBase)>128.*std::numeric_limits<double>::epsilon()*(1.+std::abs(roundedBase)))
    throw std::domain_error("Inconsistent precise pipe/nozzle pressure ratio");
  const double wallLog=base+wall.wave.logPressureRatio;
  ThermalPipeNozzleResult result;result.forward=wallLog>=0.;result.face=pipe;
  const double effective=result.forward?forwardArea:reverseArea;
  if(effective==0.||wallLog==0.) {
    result.pipeWave=wall.wave;result.face.gas=wall.wave.state;result.face.gas.velocity=0.;
    result.flux.momentum=wall.outwardMomentumFlux;result.closed=effective==0.;return result;
  }
  std::unique_ptr<ExpansionContext> reverseExpansion;
  if(!result.forward)reverseExpansion.reset(new ExpansionContext(tankLaw,tank.temperature));
  struct Candidate {WaveResult wave;ThermalPipeState face;Expansion nozzle;double mass,expectedMass,h0,rho;};
  auto waveAt=[&](double z){return WaveAtLogPressure(pipeLaw,pipe.gas,z-base,normal);};
  auto candidate=[&](double z) {
    Candidate c{};c.wave=waveAt(z);c.face={c.wave.state,pipe.fractions};
    const double u=normal*c.face.gas.velocity;
    if(result.forward) {
      const auto stagnation=ToStagnation(pipeLaw,c.face.gas.temperature,u);
      c.h0=stagnation.enthalpy;c.rho=c.wave.density;
      c.nozzle=ExpandLog(pipeLaw,tank.pressure*std::exp(z+stagnation.logPressureRise),stagnation.temperature,z+stagnation.logPressureRise);
    } else {
      c.face.fractions=tank.fractions;
      c.face.gas.temperature=StaticTemperature(tankLaw,tank.temperature,u);
      c.rho=c.face.gas.pressure/(tankLaw.r*c.face.gas.temperature);
      c.h0=Enthalpy(tankLaw,tank.temperature);
      c.nozzle=reverseExpansion->Evaluate(tank.pressure,-z);
    }
    c.mass=area*c.rho*u;
    c.expectedMass=(result.forward?1.:-1.)*effective*c.nozzle.massFlux;
    return c;
  };
  const auto bounds=SupportedWavePressures(pipeLaw,pipe.gas.temperature);
  double lo,hi;
  if(result.forward) {
    lo=std::max(0.,base+bounds[0]);hi=wallLog;
    auto sonic=[&](double z){const auto w=waveAt(z);return w.soundSpeed-normal*w.state.velocity;};
    if(sonic(lo)<0.)lo=WaveBracket(sonic,lo,hi);
  } else {
    lo=wallLog;hi=std::min(0.,base+bounds[1]);
    const double limit=ReceivingSpeedLimit(tankLaw,tank.temperature);
    auto sonic=[&](double z){return -normal*waveAt(z).state.velocity-limit;};
    if(sonic(hi)>0.)hi=WaveBracket(sonic,lo,hi);
  }
  if(lo>hi)throw std::domain_error("No supported pipe-nozzle pressure interval");
  auto residual=[&](double z){const auto c=candidate(z);return c.expectedMass-c.mass;};
  auto close=[&](double z){const auto c=candidate(z);return std::abs(c.mass-c.expectedMass)<=2e-12*std::max(std::abs(c.mass),std::abs(c.expectedMass));};
  const double z=close(lo)?lo:(close(hi)?hi:WaveBracket(residual,lo,hi));
  const auto c=candidate(z);result.pipeWave=c.wave;result.face=c.face;
  const Law& law=result.forward?pipeLaw:tankLaw;
  const double u=c.face.gas.velocity,hFace=Enthalpy(law,c.face.gas.temperature)+.5*u*u;
  result.flux.mass=c.mass;
  result.flux.momentum=normal*area*(c.rho*u*u+c.face.gas.pressure);
  result.flux.energy=c.mass*hFace;
  for(unsigned j=0;j<6;++j)result.flux.species[j]=c.mass*c.face.fractions[j];
  result.massResidual=c.mass-c.expectedMass;
  result.energyResidual=result.flux.energy-c.expectedMass*c.h0;
  result.pipeMach=std::abs(u)/std::sqrt(SoundSquared(law,c.face.gas.temperature));
  result.throatMach=c.nozzle.mach;result.choked=c.nozzle.choked;
  const double scale=area*pipe.gas.pressure/(pipeLaw.r*pipe.gas.temperature)*a;
  if(result.pipeMach>=1.||!std::isfinite(result.massResidual)||!std::isfinite(result.energyResidual)||
     std::abs(result.massResidual)>1e-11*scale||std::abs(result.energyResidual)>1e-10*scale*std::max(1.,std::abs(c.h0))||
     (result.forward&&c.mass<0.)||(!result.forward&&c.mass>0.)) {
    std::ostringstream msg;msg<<"Thermal pipe-nozzle mismatch: M="<<result.pipeMach<<" mass="<<result.massResidual<<" energy="<<result.energyResidual;
    throw std::domain_error(msg.str());
  }
  return result;
}
};
inline ThermalPipeNozzleResult ThermalPipeNozzleWithLaws(
    const ThermalPipeState& pipe,const Reservoir& tank,const Law& pipeLaw,const Law& tankLaw,
    double area,double forwardArea,double reverseArea,int normal=1,
    double preciseLogPressureRatio=std::numeric_limits<double>::quiet_NaN()) {
  return PipeNozzleContext(pipe,pipeLaw,area,normal).Evaluate(tank,tankLaw,forwardArea,reverseArea,preciseLogPressureRatio);
}
inline ThermalPipeNozzleResult ThermalPipeNozzle(const ThermalPipeState& pipe,const Reservoir& tank,
    double area,double forwardArea,double reverseArea,int normal=1) {
  return ThermalPipeNozzleWithLaws(pipe,tank,MixtureLaw(pipe.fractions),MixtureLaw(tank.fractions),area,forwardArea,reverseArea,normal);
}
} // namespace OpenWAMThermalReference
#endif
