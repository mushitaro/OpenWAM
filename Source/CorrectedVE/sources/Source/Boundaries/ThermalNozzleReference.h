#ifndef OPENWAM_THERMAL_NOZZLE_REFERENCE_H
#define OPENWAM_THERMAL_NOZZLE_REFERENCE_H
#include "../Engine/SensibleMixtureReference.h"
#include "../../BoundedRoot.h"
#include <algorithm>
#include <limits>
#include "../Engine/ThermalCostProfile.h"

namespace OpenWAMThermalReference {
// Frozen composition, quasi-steady adiabatic converging nozzle. This is a
// reservoir-to-reservoir reference, NOT a 1D momentum or wave boundary.
struct Expansion {
  double temperature=0., pressure=0., velocity=0., mach=0., massFlux=0.;
  double criticalPressure=0.; // Zero means the sonic state is outside the envelope.
  bool criticalAvailable=false, choked=false;
};
// Integral from T0*exp(-x) to T0, evaluated without subtracting nearby T/h.
// shift=0 gives enthalpy drop, shift=-1 gives integral Cp/T.
inline double ExpansionIntegral(const Law& law,double t0,double x,double shift){
 const double t=t0*std::exp(-x);double sum=0.;
 if(t<1000.&&t0>1000.)return PolynomialIntegral(law.c,t,1000.,shift)+PolynomialIntegral(law.high,1000.,t0,shift);
 if(t0<=1000.&&t>1000.)return PolynomialIntegral(law.high,t,1000.,shift)+PolynomialIntegral(law.c,1000.,t0,shift);
 const auto& c=t0<=1000?law.c:law.high;
 for(unsigned j=0;j<5;++j){double k=j+shift+1.;sum+=c[j]*(k==0?x:std::pow(t0,k)*(-std::expm1(-k*x))/k);}return sum;
}
struct ExpansionCurve {
 Law law;double t0,shift;std::array<double,5> exponent{},power{};
 ExpansionCurve(const Law& l,double t,double s):law(l),t0(t),shift(s){for(unsigned j=0;j<5;++j){exponent[j]=j+s+1.;if(exponent[j]!=0.)power[j]=std::pow(t,exponent[j]);}}
 double operator()(double x)const{const double t=t0*std::exp(-x);if((t<1000.&&t0>1000.)||(t0<=1000.&&t>1000.))return ExpansionIntegral(law,t0,x,shift);
 const auto& c=t0<=1000?law.c:law.high;double sum=0.;for(unsigned j=0;j<5;++j){double k=exponent[j];sum+=c[j]*(k==0?x:power[j]*(-std::expm1(-k*x))/k);}return sum;}
};
inline double SoundSquared(const Law& law, double t) {
  const double cp=Cp(law,t);
  return cp/(cp-law.r)*law.r*t;
}
template<class F> inline double IncreasingRoot(F f, double target, double hi) {
  double lo=0.;
  // Relative resolution is essential for very small pressure differences.
  while(hi>0. && f(.5*hi)>target) hi*=.5;
  return AdjacentBracketRoot([&](double x){return f(x)-target;},lo,hi);
}
// A fixed donor temperature/composition is reused throughout a reverse-flow
// pressure solve. Cache its sonic limit locally, without rounding state keys
// or reusing anything across timesteps. Arithmetic/root tolerances are unchanged.
class ExpansionContext {
  Law law;double t0;
  ExpansionCurve entropy,enthalpy;
  bool prepared=false,critical=false;
  double limit=0.,limitDrop=0.;
  double PressureDrop(double x)const{return entropy(x)/law.r;}
  void Prepare(){
    if(prepared)return;
    const double lower=Tmin*(1.+64.*std::numeric_limits<double>::epsilon());
    const double xmax=t0>lower?std::log(t0/lower):0.;
    auto sonicResidual=[&](double x){const double t=t0*std::exp(-x);return 2.*enthalpy(x)-SoundSquared(law,t);};
    limit=xmax;
    if(xmax>0.&&sonicResidual(xmax)>=0.){limit=IncreasingRoot(sonicResidual,0.,xmax);critical=true;}
    limitDrop=PressureDrop(limit);prepared=true;
  }
public:
  ExpansionContext(const Law& l,double t):law(l),t0(t),entropy(l,t,-1.),enthalpy(l,t,0.){
    TemperatureRange(t0);Cp(law,t0);
  }
  Expansion Evaluate(double p0,double requested){
    THERMAL_COST_SCOPE(ExpansionSolve);
    Positive(p0);
    if(!std::isfinite(requested)||requested<0.)throw std::domain_error("Invalid nozzle log pressure drop");
    Expansion result;result.temperature=t0;result.pressure=p0;
    if(requested==0.)return result;
    Prepare();result.criticalAvailable=critical;
    if(critical)result.criticalPressure=p0*std::exp(-limitDrop);
    double x;
    if(critical&&requested>=limitDrop){result.choked=true;x=limit;}
    else{
      if(!(limit>0.)||requested>limitDrop)throw std::domain_error("Required nozzle state below reference Tmin; no extrapolation");
      x=IncreasingRoot([&](double v){return PressureDrop(v);},requested,limit);
    }
    result.temperature=t0*std::exp(-x);result.pressure=p0*std::exp(-PressureDrop(x));
    const double dh=enthalpy(x);
    if(!(dh>=0.)||!std::isfinite(dh))throw std::domain_error("Invalid enthalpy drop");
    result.velocity=std::sqrt(2.*dh);result.mach=result.velocity/std::sqrt(SoundSquared(law,result.temperature));
    result.massFlux=result.pressure/(law.r*result.temperature)*result.velocity;
    if(!std::isfinite(result.massFlux))throw std::domain_error("Nonfinite nozzle mass flux");
    return result;
  }
};
// Direct log pressure drop also preserves O(u^2) head at tiny pipe velocities.
inline Expansion ExpandLog(const Law& law,double p0,double t0,double requested){
  Positive(p0);return ExpansionContext(law,t0).Evaluate(p0,requested);
}
inline Expansion Expand(const Law& law,double p0,double t0,double backPressure) {
  Positive(p0);Positive(backPressure);
  if(backPressure>p0)throw std::domain_error("Expansion requires upstream stagnation pressure");
  return ExpandLog(law,p0,t0,std::log1p((p0-backPressure)/backPressure));
}
struct Reservoir {
  double pressure, temperature;
  Composition fractions;
};
inline void Validate(const Reservoir& s) {
  Positive(s.pressure); TemperatureRange(s.temperature); Validate(s.fractions);
}
struct ThermalTransfer {
  double mass=0., energy=0.; // Signed left to right: kg/s, W.
  Composition species{};
  Expansion throat;
};
inline ThermalTransfer ThermalNozzleFlux(const Reservoir& left, const Reservoir& right,
                                         double forwardArea, double reverseArea) {
  Validate(left); Validate(right);
  if(!std::isfinite(forwardArea) || forwardArea<0. ||
     !std::isfinite(reverseArea) || reverseArea<0.)
    throw std::domain_error("Invalid effective nozzle area");
  ThermalTransfer result;
  if(left.pressure==right.pressure) return result;
  const bool forward=left.pressure>right.pressure;
  const Reservoir& up=forward ? left : right;
  const Reservoir& down=forward ? right : left;
  const double area=forward ? forwardArea : reverseArea;
  if(area==0.) return result;
  const Law law=MixtureLaw(up.fractions);
  result.throat=Expand(law,up.pressure,up.temperature,down.pressure);
  result.mass=(forward ? 1. : -1.)*area*result.throat.massFlux;
  result.energy=result.mass*Enthalpy(law,up.temperature);
  for(unsigned i=0;i<6;++i) result.species[i]=result.mass*up.fractions[i];
  if(!std::isfinite(result.mass) || !std::isfinite(result.energy))
    throw std::domain_error("Nonfinite thermal transfer");
  return result;
}
} // namespace OpenWAMThermalReference
#endif
