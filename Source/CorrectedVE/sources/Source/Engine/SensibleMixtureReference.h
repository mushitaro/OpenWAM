#ifndef OPENWAM_SENSIBLE_MIXTURE_REFERENCE_H
#define OPENWAM_SENSIBLE_MIXTURE_REFERENCE_H

#include "../../../LegacyMixture.h"
#include <array>
#include <cmath>
#include <stdexcept>

// Version 2 isolated NASA7 sensible thermodynamics; not production EOS.
// NASA gas database Cp at 200--6000 K. Fuel uses n-octane Cp proxy;
// C7.97H14.8 chemistry and 44 MJ/kg reference remain explicit model assumptions.
// No formation energies, dissociation, liquid fuel, or latent heat are modeled.
namespace OpenWAMThermalReference {
using Composition = std::array<double, 6>; // O2, CO2, H2O, N2, Ar, gasoline vapor
constexpr double Tmin = 200., Tmax = 6000., Tref = 300.;

inline void TemperatureRange(double t) {
  if (!std::isfinite(t) || t < Tmin || t > Tmax)
    throw std::domain_error("Reference temperature outside NASA 200--6000 K");
}
inline void Validate(const Composition& y) {
  double sum = 0.;
  for (double v : y) {
    if (!std::isfinite(v) || v < 0. || v > 1.)
      throw std::domain_error("Invalid mass fraction");
    sum += v;
  }
  if (std::abs(sum - 1.) > 1e-12)
    throw std::domain_error("Mass fractions do not sum to one");
}

struct Law {double r=0.;std::array<double,5> c{},high{};double e300=0.;};
inline const std::array<double,5>& Exponents(){static const std::array<double,5> e{{0,1,2,3,4}};return e;}
inline const std::array<Law,6>& Laws(){static const std::array<Law,6> result=[](){std::array<Law,6> x{};
x[0].r=259.825;x[0].c={{982.7767237369999,-0.7786264505237499,0.00255857524215,-2.5154424941609997e-06,8.428017211369999e-10}};x[0].high={{951.2091476547499,0.170540172013475,-3.6674164940124996e-05,5.347137648985e-09,-3.37547096616e-13}};
x[1].r=188.92069984094525;x[1].c={{445.24330276500797,1.6973763095770962,-0.0013457884487556465,4.645919374044081e-07,-2.7147819174987502e-11}};x[1].high={{875.9487590545785,0.5178920758851171,-0.0001881326229981004,3.029778147371961e-08,-1.73070908301277e-12}};
x[2].r=461.3984461709212;x[2].c={{1937.2462304142066,-0.9396075294694785,0.0030085034019635957,-2.5321411166996674e-06,8.175879742867925e-10}};x[2].high={{1235.1811135587125,1.3718221501873473,-0.00035701613266015536,4.3571548096679245e-08,-1.9697143915147617e-12}};
x[3].r=296.8368439842913;x[3].c={{1048.1324634070688,-0.03670713710506248,-0.00014930876540495536,7.228885827964298e-07,-4.1818741174009283e-10}};x[3].high={{876.4334186413423,0.4146515565586576,-0.0001462312364030846,2.3331683667921456e-08,-1.3676915533460907e-12}};
x[4].r=208.12015018773465;x[4].c={{520.3003754693366,0.0,0.0,0.0,0.0}};x[4].high={{520.3003754693366,0.0,0.0,0.0,0.0}};
x[5].r=75.12941897229273;x[5].c={{911.6062998312541,-0.7352712330041637,0.016157857412581463,-2.07339668178108e-05,8.18183533657612e-09}};x[5].high={{1614.0666257093962,3.089223892286256,-0.001085682470895971,1.7496031809874243e-07,-1.0507302026743721e-11}};
for(unsigned i=0;i<6;++i)x[i].e300=LegacyMixture::Energy(LegacyMixture::Laws()[i],300.);return x;}();return result;}
inline double Cp(const Law& l,double t){TemperatureRange(t);const auto& a=t<=1000?l.c:l.high;double cp=((((a[4]*t)+a[3])*t+a[2])*t+a[1])*t+a[0];if(!(cp>l.r))throw std::domain_error("NASA nonpositive Cv");return cp;}
inline double PolynomialIntegral(const std::array<double,5>& c,double a,double b,double shift){double sum=0.;for(unsigned j=0;j<5;++j){double k=j+shift+1;sum+=c[j]*(k==0?std::log(b/a):std::pow(a,k)*std::expm1(k*std::log(b/a))/k);}return sum;}
inline double Integral(const Law& l,double a,double b,double shift=0.){TemperatureRange(a);TemperatureRange(b);if(b<a)return -Integral(l,b,a,shift);if(a<1000&&b>1000)return PolynomialIntegral(l.c,a,1000,shift)+PolynomialIntegral(l.high,1000,b,shift);return PolynomialIntegral(b<=1000?l.c:l.high,a,b,shift);}
inline double Energy(const Law& l,double t){return l.e300+Integral(l,300.,t)-l.r*(t-300.);}
inline Law MixtureLaw(const Composition& y){Validate(y);Law l{};for(unsigned i=0;i<6;++i){const auto& a=Laws()[i];l.r+=y[i]*a.r;l.e300+=y[i]*a.e300;for(unsigned j=0;j<5;++j){l.c[j]+=y[i]*a.c[j];l.high[j]+=y[i]*a.high[j];}}return l;}
inline double Enthalpy(const Law& law, double t) { return Energy(law,t)+law.r*t; }
inline double Temperature(const Law& law, double e) {
  if (!std::isfinite(e) || e < Energy(law,Tmin) || e > Energy(law,Tmax))
    throw std::domain_error("Energy outside reference temperature envelope");
  double lo=Tmin, hi=Tmax;
  for (int j=0; j<64; ++j) {
    const double t=.5*(lo+hi);
    if (Energy(law,t) < e) lo=t; else hi=t;
  }
  return .5*(lo+hi);
}
// At fixed composition, ds = integral Cv/T dT + R log(v2/v1).
// This is an entropy CHANGE, not the full entropy of mixing.
inline double EntropyChange(const Law& law, double t1, double t2, double volumeRatio) {
  if (!(volumeRatio > 0.) || !std::isfinite(volumeRatio))
    throw std::domain_error("Invalid volume ratio");
  return Integral(law,t1,t2,-1.)-law.r*std::log(t2/t1)+law.r*std::log(volumeRatio);
}
struct Inventory {
  double mass, momentum, totalEnergy; // kg, kg m/s, J (including kinetic energy)
  Composition speciesMass;
};
struct Primitive {
  double rho, velocity, temperature, pressure, soundSpeed;
  Composition fractions;
};
inline void Positive(double value) {
  if (!std::isfinite(value) || !(value>0.)) throw std::domain_error("Invalid positive state value");
}
inline Inventory Conserved(double rho, double velocity, double t, double volume, const Composition& y) {
  Positive(rho); Positive(volume); TemperatureRange(t); Validate(y);
  if (!std::isfinite(velocity)) throw std::domain_error("Invalid velocity");
  Inventory q{rho*volume,rho*volume*velocity,
              rho*volume*(Energy(MixtureLaw(y),t)+.5*velocity*velocity),{}};
  for(unsigned i=0;i<6;++i) q.speciesMass[i]=q.mass*y[i];
  if (!std::isfinite(q.mass) || !std::isfinite(q.momentum) || !std::isfinite(q.totalEnergy))
    throw std::domain_error("Inventory overflow");
  return q;
}
inline Primitive Recover(const Inventory& q, double volume) {
  Positive(q.mass); Positive(volume);
  if (!std::isfinite(q.momentum) || !std::isfinite(q.totalEnergy))
    throw std::domain_error("Invalid conserved state");
  Primitive s{};
  for(unsigned i=0;i<6;++i) s.fractions[i]=q.speciesMass[i]/q.mass;
  const Law law=MixtureLaw(s.fractions);
  s.rho=q.mass/volume; s.velocity=q.momentum/q.mass;
  s.temperature=Temperature(law,q.totalEnergy/q.mass-.5*s.velocity*s.velocity);
  s.pressure=s.rho*law.r*s.temperature;
  s.soundSpeed=std::sqrt(Cp(law,s.temperature)/(Cp(law,s.temperature)-law.r)*law.r*s.temperature);
  Positive(s.rho); Positive(s.pressure); Positive(s.soundSpeed);
  return s;
}
// The legacy 11-species convention stores ten chemical fractions. It does not
// separately track Ar. Caller must explicitly state the Ar fraction contained
// in its N2 slot. Never infer Ar from a constant or silently relabel radicals.
inline Composition FromComplete11(const std::array<double,10>& y, double argon) {
  double sum=0.;
  for (double v:y) {
    if (!std::isfinite(v) || v<0. || v>1.) throw std::domain_error("Invalid complete fraction");
    sum+=v;
  }
  if (std::abs(sum-1.)>1e-12 || !std::isfinite(argon) || argon<0. || argon>y[8])
    throw std::domain_error("Invalid complete composition or explicit Ar split");
  for (unsigned i=3; i<8; ++i)
    if (y[i]!=0.) throw std::domain_error("CO/H2/NO/OH/O thermodynamics unsupported");
  Composition result{{y[0],y[1],y[2],y[8]-argon,argon,y[9]}};
  Validate(result);
  return result;
}
} // namespace OpenWAMThermalReference
#endif
