#ifndef OPENWAM_THERMAL_WAVE_REFERENCE_H
#define OPENWAM_THERMAL_WAVE_REFERENCE_H
#include "ThermalNozzleReference.h"
#include <vector>

namespace OpenWAMThermalReference {
// One acoustic family connecting a pipe interior to a candidate star state.
// normal=+1: right end / left Riemann family; normal=-1: left end / right family.
// Velocity and shock speed use the global pipe x coordinate. Composition is
// frozen across this wave. An inflowing contact needs a separate donor state.
struct WaveState {
  double pressure, temperature, velocity;
};
struct WaveResult {
  WaveState state;
  double density=0., soundSpeed=0., drop=0., entropyChange=0.;
  double shockSpeed=0.; // Only meaningful when shock=true.
  double logPressureRatio=0.; // Preserve weak-wave pressure information.
  bool shock=false;
};
inline void ValidateWave(const Law& law,const WaveState& s,int normal) {
  Positive(s.pressure); TemperatureRange(s.temperature); Cp(law,s.temperature);
  if(!std::isfinite(s.velocity) || (normal!=1 && normal!=-1))
    throw std::domain_error("Invalid wave orientation or velocity");
}
template<class F> inline double WaveBracket(F f,double lo,double hi) {
  double fl=f(lo),fh=f(hi);
  if(!std::isfinite(fl)||!std::isfinite(fh)||fl>0.||fh<0.)
    throw std::domain_error("Thermal wave root outside supported temperature envelope");
  if(fl==0.)return lo;
  if(fh==0.)return hi;
  // Gaussian acoustic tails can put a physical root many decades from the
  // nonzero endpoint. Contract around zero before relative bisection; a fixed
  // 70 halvings of the original interval cannot resolve an O(u^2) head there.
  if(lo==0.&&hi>0.) {
    for(int j=0;j<1100;++j){
      const double p=.5*hi;if(p==0.)break;const double fmid=f(p);
      if(!std::isfinite(fmid))throw std::domain_error("Nonfinite contracted wave root");
      if(fmid==0.)return p;
      if(fmid>0.)hi=p;else{lo=p;break;}
    }
  } else if(hi==0.&&lo<0.) {
    for(int j=0;j<1100;++j){
      const double p=.5*lo;if(p==0.)break;const double fmid=f(p);
      if(!std::isfinite(fmid))throw std::domain_error("Nonfinite contracted wave root");
      if(fmid==0.)return p;
      if(fmid<0.)lo=p;else{hi=p;break;}
    }
  }
  return AdjacentBracketRoot(f,lo,hi);
}
inline double RarefactionDrop(const Law& law,double t0,double x) {
  // Integral Cp/a dT in log-temperature coordinates. Eight-point Gauss rule,
  // refined by doubling panels; disagreement rejects instead of hiding error.
  static const double nodes[]={.1834346424956498,.5255324099163290,.7966664774136267,.9602898564975363};
  static const double weights[]={.3626837833783620,.3137066458778873,.2223810344533745,.1012285362903763};
  std::vector<double> cuts{0.};const double split=std::log(t0/1000.);
  if(split>0.&&split<x)cuts.push_back(split);cuts.push_back(x);
  double previous=0.;
  for(int panels=1;panels<=64;panels*=2) {
    double total=0.;for(unsigned part=1;part<cuts.size();++part){const double half=(cuts[part]-cuts[part-1])/(2*panels);
    for(int panel=0;panel<panels;++panel) {
      const double center=cuts[part-1]+(2*panel+1)*half;
      for(int j=0;j<4;++j) for(int sign:{-1,1}) {
        const double t=t0*std::exp(-(center+sign*half*nodes[j]));
        const double cp=Cp(law,t);
        total+=half*weights[j]*cp*t/std::sqrt(cp/(cp-law.r)*law.r*t);
      }
    }
    }
    if(panels>1 && std::abs(total-previous)<1e-10+1e-11*std::abs(total))return -total;
    previous=total;
  }
  throw std::domain_error("Rarefaction quadrature did not converge");
}
// log(p_star/p_interior) preserves weak-wave pressure increments.
inline WaveResult WaveAtLogPressure(const Law& law,const WaveState& input,double logRatio,int normal=1) {
  THERMAL_COST_SCOPE(WaveSolve);
  ValidateWave(law,input,normal);
  if(!std::isfinite(logRatio))throw std::domain_error("Nonfinite wave pressure ratio");
  const double p0=input.pressure,t0=input.temperature,v0=law.r*t0/p0;
  WaveResult result; result.state=input;
  result.logPressureRatio=logRatio;
  result.state.pressure=p0*std::exp(logRatio);Positive(result.state.pressure);
  double x=0.; // log(T_star/T_interior), signed.
  if(logRatio<0.) {
    const double lower=Tmin*(1.+64.*std::numeric_limits<double>::epsilon());
    if(t0<=lower)throw std::domain_error("Rarefaction below temperature envelope");
    const double hi=std::log(t0/lower);
    const ExpansionCurve entropy(law,t0,-1.);
    auto pressureDrop=[&](double z){return entropy(z)/law.r;};
    if(-logRatio>pressureDrop(hi))throw std::domain_error("Rarefaction below temperature envelope");
    const double z=IncreasingRoot(pressureDrop,-logRatio,hi);
    x=-z; result.drop=RarefactionDrop(law,t0,z);
  } else if(logRatio>0.) {
    result.shock=true;
    // e*-e0 + (p*+p0)(v*-v0)/2 = 0, with v*/v0=exp(x-logRatio).
    const double upper=Tmax*(1.-64.*std::numeric_limits<double>::epsilon());
    if(t0>=upper)throw std::domain_error("Shock above temperature envelope");
    const double hi=std::min(logRatio,std::log(upper/t0));
    const ExpansionCurve enthalpy(law,t0,0.);
    auto hugoniot=[&](double z) {
      const double de=-enthalpy(-z)-law.r*t0*std::expm1(z);
      return de+.5*(result.state.pressure+p0)*v0*std::expm1(z-logRatio);
    };
    x=WaveBracket(hugoniot,0.,hi);
    const double dv=-v0*std::expm1(x-logRatio),dp=p0*std::expm1(logRatio);
    if(!(dv>0.)||!std::isfinite(dv))throw std::domain_error("Noncompressive shock state");
    result.drop=std::sqrt(dp*dv);
    result.shockSpeed=input.velocity-normal*std::sqrt(dp/dv)*v0;
  }
  result.state.temperature=t0*std::exp(x);
  TemperatureRange(result.state.temperature);
  result.state.velocity=input.velocity-normal*result.drop;
  result.density=result.state.pressure/(law.r*result.state.temperature);
  result.soundSpeed=std::sqrt(SoundSquared(law,result.state.temperature));
  result.entropyChange=-ExpansionIntegral(law,t0,-x,-1.)-law.r*logRatio;
  if(!std::isfinite(result.drop)||!std::isfinite(result.state.velocity)||!std::isfinite(result.entropyChange))
    throw std::domain_error("Nonfinite thermal wave state");
  Positive(result.density);
  return result;
}
inline WaveResult WaveAtPressure(const Law& law,const WaveState& s,double p,int normal=1) {
  Positive(p);Positive(s.pressure);
  return WaveAtLogPressure(law,s,std::log1p((p-s.pressure)/s.pressure),normal);
}
struct WallResult { WaveResult wave; double outwardMomentumFlux; };
inline WallResult ThermalWall(const Law& law,const WaveState& input,double area,int normal=1) {
  ValidateWave(law,input,normal);Positive(area);
  const double a=std::sqrt(SoundSquared(law,input.temperature));
  if(std::abs(input.velocity)>=a)throw std::domain_error("Wall reference requires subsonic pipe interior");
  const double t=input.temperature,desired=normal*input.velocity;
  double lo=0.,hi=0.;
  if(desired<0.) {
    const double lower=Tmin*(1.+128.*std::numeric_limits<double>::epsilon());
    if(t<=lower)throw std::domain_error("Wall rarefaction outside temperature envelope");
    lo=-ExpansionIntegral(law,t,std::log(t/lower),-1.)/law.r;
  } else if(desired>0.) {
    const double upper=Tmax*(1.-128.*std::numeric_limits<double>::epsilon());
    if(t>=upper)throw std::domain_error("Wall shock outside temperature envelope");
    const double theta=upper/t,de=Integral(law,t,upper)-law.r*(upper-t);
    const double b=2*de/(law.r*t)+theta-1.;
    hi=std::log(.5*(b+std::sqrt(b*b+4*theta)));
  }
  const double lr=desired==0.?0.:WaveBracket([&](double p){return WaveAtLogPressure(law,input,p,normal).drop-desired;},lo,hi);
  auto wave=WaveAtLogPressure(law,input,lr,normal);
  if(std::abs(wave.state.velocity)>1e-9*a)throw std::domain_error("Wall wave residual too large");
  // The wall is stationary: mass, energy and species fluxes are exactly zero.
  return {wave,normal*area*wave.state.pressure};
}
} // namespace OpenWAMThermalReference
#endif
