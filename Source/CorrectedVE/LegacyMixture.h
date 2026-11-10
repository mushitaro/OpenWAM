#ifndef LEGACY_MIXTURE_H
#define LEGACY_MIXTURE_H

#include <array>
#include <cmath>
#include <stdexcept>

// Isolated, NONREACTING reference. Not a replacement for the production EOS.
// Cp correlations are copied from Globales.h (MEP gasoline); their experimental
// validity is not established here. 200--2000 K is a numerical test envelope.
// No formation energies, dissociation, liquid fuel, or latent heat are modeled.
namespace LegacyMixture {
using Composition = std::array<double, 6>; // O2, CO2, H2O, N2, Ar, gasoline vapor
constexpr double Tmin = 200., Tmax = 2000., Tref = 300.;

inline void TemperatureRange(double t) {
  if (!std::isfinite(t) || t < Tmin || t > Tmax)
    throw std::domain_error("Reference temperature outside 200--2000 K");
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

struct Law {
  double r;
  // Cp = sum c_j * T^exponent_j, in J/(kg K).
  std::array<double, 8> c;
};
inline const std::array<double, 8>& Exponents() {
  static const std::array<double, 8> p{{-1.5, -1., -.5, 0., .5, 1., 2., 3.}};
  return p;
}
inline const std::array<Law, 6>& Laws() {
  static const std::array<Law, 6> laws{{
    {259.825, {{32538*259.825, -4426.1*259.825, 195.42*259.825, -.112*259.825, .0479*259.825, 0, 0, 0}}},
    {188.9207, {{9470*188.9207, -163.7*188.9207, -142.34*188.9207, 12.019*188.9207, -.03566*188.9207, 0, 0, 0}}},
    {461.398, {{-82114*461.398, 13970.1*461.398, -826.53*461.398, 22.605*461.398, -.09067*461.398, 0, 0, 0}}},
    {296.837, {{-27358*296.837, 5279.1*296.837, -352.3*296.837, 12.531*296.837, -.05932*296.837, 0, 0, 0}}},
    {208.12, {{0, 0, 0, 520.32, 0, 0, 0, 0}}},
    {72.42, {{0, 0, 0, 189., 0, 5.834, -.002524, .000000420}}}
  }};
#ifdef OPENWAM_COMMON_ELEMENTAL_EOS
  // Consistent across every translation unit of an isolated reactive target.
  // Preserve dimensional Cp coefficients; only R, Cv and the energy/EOS change.
  static const auto elemental=[](std::array<Law,6> v){
    const std::array<double,6> mw{{32.,12.01+32.,2*1.01+16.,2*14.005,39.95,7.97*12.01+14.8*1.01}};
    for(unsigned i=0;i<6;++i)v[i].r=8314.4/mw[i];return v;
  }(laws);
  return elemental;
#else
  return laws;
#endif
}
inline double Cp(const Law& law, double t) {
  TemperatureRange(t);
  double cp = 0.;
  for (unsigned j=0; j<8; ++j) cp += law.c[j]*std::pow(t, Exponents()[j]);
  if (!std::isfinite(cp) || !(cp > law.r) || !(law.r > 0.))
    throw std::domain_error("Nonpositive Cv or gas constant");
  return cp;
}
// Integral of Cp*T^shift; logarithmic term handled analytically.
inline double Integral(const Law& law, double a, double b, double shift=0.) {
  TemperatureRange(a); TemperatureRange(b);
  double value = 0.;
  for (unsigned j=0; j<8; ++j) {
    const double p = Exponents()[j] + shift + 1.;
    value += law.c[j]*(p == 0. ? std::log(b/a) :
        std::pow(a,p)*std::expm1(p*std::log(b/a))/p);
  }
  return value;
}
inline double Energy(const Law& law, double t) {
  // Fixed species-specific offset shared by every component, NOT Cv(T)*T.
  return (Cp(law,Tref)-law.r)*Tref + Integral(law,Tref,t)-law.r*(t-Tref);
}
inline Law MixtureLaw(const Composition& y) {
  Validate(y);
  Law mix{};
  for (unsigned i=0; i<6; ++i) {
    mix.r += y[i]*Laws()[i].r;
    for (unsigned j=0; j<8; ++j) mix.c[j] += y[i]*Laws()[i].c[j];
  }
  return mix;
}
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
} // namespace LegacyMixture
#endif
