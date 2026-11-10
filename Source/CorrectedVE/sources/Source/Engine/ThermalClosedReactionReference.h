#ifndef OPENWAM_THERMAL_CLOSED_REACTION_REFERENCE_H
#define OPENWAM_THERMAL_CLOSED_REACTION_REFERENCE_H
#include "SensibleMixtureReference.h"
#include <algorithm>
#include <limits>

// Isolated synthetic complete-oxidation contract. No ThermalQ conversion and
// no kinetics, injector, phase change, radicals, or native species connection.
namespace OpenWAMClosedReactionReference {
using OpenWAMThermalReference::Law;
using Masses=std::array<double,6>; // O2 CO2 H2O N2 Ar Fuel
using Elements=std::array<double,5>; // C H O N Ar, in kmol of atoms
struct Species {Elements atoms{};double molecularWeight=0.;Law law{};double hf=0.;};
struct Contract {
  Elements atomicWeights{};
  std::array<Species,6> species{};
  double universalR=0.,tmin=200.,tmax=6000.,tref=300.,lhv=0.;
};
struct State {Masses mass{};double sensibleEnergy=0.,volume=0.;};
inline void Need(bool b,const char* why){if(!b)throw std::domain_error(why);}
inline bool Finite(double x){return std::isfinite(x);}
inline bool Relative(double a,double b,double floor){return std::abs(a-b)<=1e-12*std::max(floor,std::max(std::abs(a),std::abs(b)));}
inline double CpLower(const Law& l,double a,double b){
  const auto& c=b<=1000?l.c:l.high;const auto& e=OpenWAMThermalReference::Exponents();double lo=0.,scale=std::abs(l.r);
  for(unsigned j=0;j<5;++j){const double x=c[j]*std::pow(a,e[j]),y=c[j]*std::pow(b,e[j]);lo+=std::min(x,y);scale+=std::max(std::abs(x),std::abs(y));}
  // Conservative numerical margin; this is not directed-rounding interval arithmetic.
  return lo-64.*std::numeric_limits<double>::epsilon()*scale;
}
inline void PositiveCvInterval(const Law& l,double a,double b,unsigned depth=0){
  if(a<1000.&&b>1000.){PositiveCvInterval(l,a,1000.,depth);PositiveCvInterval(l,1000.,b,depth);return;}
  const double lo=CpLower(l,a,b);
  Need(Finite(lo),"Cp interval overflow");
  if(lo>l.r)return;
  Need(depth<16,"Cp/Cv positivity not established on contract interval");
  const double m=(a+b)*.5;
  PositiveCvInterval(l,a,m,depth+1);PositiveCvInterval(l,m,b,depth+1);
}
inline double OxygenMoles(const Contract& c){const auto& f=c.species[5].atoms;return f[0]+f[1]/4.-f[2]/2.;}
inline Masses StoichMass(const Contract& c){ // signed kg per kg consumed fuel
  const double mf=c.species[5].molecularWeight;
  return {{-OxygenMoles(c)*c.species[0].molecularWeight/mf,
    c.species[5].atoms[0]*c.species[1].molecularWeight/mf,
    c.species[5].atoms[1]*.5*c.species[2].molecularWeight/mf,0.,0.,-1.}};
}
inline Masses Alpha(const Contract& c){Masses a{};for(unsigned i=0;i<6;++i){a[i]=c.species[i].hf-OpenWAMThermalReference::Enthalpy(c.species[i].law,c.tref);Need(Finite(a[i]),"Reference offset overflow");}return a;}
inline void Validate(const Contract& c){
  Need(Finite(c.universalR)&&c.universalR>0.&&Finite(c.lhv)&&c.lhv>0.,"Invalid R or reaction heat");
  Need(Finite(c.tmin)&&Finite(c.tmax)&&c.tmin>=200.&&c.tmax<=6000.&&c.tmin<c.tmax&&c.tref==300.&&c.tmin<=c.tref&&c.tref<=c.tmax,"Unsupported temperature contract");
  for(double w:c.atomicWeights)Need(Finite(w)&&w>0.,"Invalid atomic weight");
  const std::array<Elements,5> identities{{{{0,0,2,0,0}},{{1,0,2,0,0}},{{0,2,1,0,0}},{{0,0,0,2,0}},{{0,0,0,0,1}}}};
  for(unsigned i=0;i<6;++i){const auto& s=c.species[i];double mw=0.;
    for(unsigned j=0;j<5;++j){Need(Finite(s.atoms[j])&&s.atoms[j]>=0.,"Invalid atom count");mw+=s.atoms[j]*c.atomicWeights[j];}
    Need(Finite(s.molecularWeight)&&s.molecularWeight>0.&&Finite(mw)&&Relative(mw,s.molecularWeight,1e-15),"Molecular weight/element mismatch");
    Need(Finite(s.law.r)&&s.law.r>0.&&Relative(c.universalR/s.molecularWeight,s.law.r,1e-15)&&Finite(s.hf),"Invalid species R or reference enthalpy");
    for(double v:s.law.c)Need(Finite(v),"Nonfinite Cp coefficient");for(double v:s.law.high)Need(Finite(v),"Nonfinite high Cp coefficient");
    if(i<5)Need(s.atoms==identities[i],"Species identity mismatch");
    PositiveCvInterval(s.law,c.tmin,c.tmax);
  }
  const auto& f=c.species[5].atoms;
  Need(f[0]>0.&&f[1]>0.&&f[3]==0.&&f[4]==0.&&Finite(OxygenMoles(c))&&OxygenMoles(c)>0.,"Unsupported fuel elemental formula");
  const auto dm=StoichMass(c);double heat=0.;for(unsigned i=0;i<6;++i)heat-=dm[i]*c.species[i].hf;
  Need(Finite(heat)&&Relative(heat,c.lhv,1e-9),"Reaction reference heat mismatch");
  Alpha(c);
}
inline double TotalMass(const State& s){double m=0.;for(double x:s.mass){Need(Finite(x)&&x>=0.,"Invalid species mass");m+=x;}Need(Finite(m)&&m>0.,"Invalid total mass");return m;}
inline double EnergyAt(const Contract& c,const State& s,double t){double e=0.;for(unsigned i=0;i<6;++i)e+=s.mass[i]*OpenWAMThermalReference::Energy(c.species[i].law,t);Need(Finite(e),"Energy overflow");return e;}
inline double Temperature(const Contract& c,const State& s){
  TotalMass(s);Need(Finite(s.volume)&&s.volume>0.&&Finite(s.sensibleEnergy),"Invalid closed state");
  Need(s.sensibleEnergy>=EnergyAt(c,s,c.tmin)&&s.sensibleEnergy<=EnergyAt(c,s,c.tmax),"Reaction state outside temperature contract");
  double a=c.tmin,b=c.tmax;for(unsigned j=0;j<64;++j){const double m=(a+b)*.5;if(EnergyAt(c,s,m)<s.sensibleEnergy)a=m;else b=m;}return .5*(a+b);
}
inline State Make(const Contract& c,const Masses& masses,double temperature,double volume){
  Validate(c);Need(Finite(temperature)&&temperature>=c.tmin&&temperature<=c.tmax,"Initial temperature outside contract");
  State s{masses,0.,volume};TotalMass(s);s.sensibleEnergy=EnergyAt(c,s,temperature);Temperature(c,s);return s;
}
inline Elements ElementInventory(const Contract& c,const State& s){Elements e{};for(unsigned i=0;i<6;++i)for(unsigned j=0;j<5;++j)e[j]+=s.mass[i]/c.species[i].molecularWeight*c.species[i].atoms[j];return e;}
inline double PhysicalEnergy(const Contract& c,const State& s){double e=s.sensibleEnergy;const auto a=Alpha(c);for(unsigned i=0;i<6;++i)e+=s.mass[i]*a[i];Need(Finite(e),"Physical energy overflow");return e;}
inline double EnergyScale(const Contract& c,const State& s){double e=std::abs(s.sensibleEnergy);const auto a=Alpha(c);for(unsigned i=0;i<6;++i)e+=std::abs(s.mass[i]*a[i]);Need(Finite(e),"Energy scale overflow");return std::max(1e-9,e);}
struct Result {State state;double burnedFuel=0.,temperature=0.,massResidual=0.,elementResidual=0.,energyResidual=0.;};
inline Result React(const Contract& c,const State& before,double requestedFuel){
  Validate(c);Temperature(c,before);Need(Finite(requestedFuel)&&requestedFuel>=0.,"Invalid requested fuel consumption");
  const auto nu=StoichMass(c),a=Alpha(c);const double oxygenLimit=before.mass[0]/(-nu[0]);
  const double burned=std::min(requestedFuel,std::min(before.mass[5],oxygenLimit));
  Result out;out.state=before;out.burnedFuel=burned;
  if(burned>0.){
    out.state.mass[0]=burned==oxygenLimit?0.:before.mass[0]+burned*nu[0];
    out.state.mass[5]=burned==before.mass[5]?0.:before.mass[5]-burned;
    out.state.mass[1]+=burned*nu[1];out.state.mass[2]+=burned*nu[2];
    for(unsigned i=0;i<6;++i)out.state.sensibleEnergy-=(out.state.mass[i]-before.mass[i])*a[i];
  }
  const double m0=TotalMass(before),m1=TotalMass(out.state);
  out.massResidual=std::abs(m1-m0)/std::max(1e-15,std::max(m0,m1));
  const auto e0=ElementInventory(c,before),e1=ElementInventory(c,out.state);
  for(unsigned j=0;j<5;++j)out.elementResidual=std::max(out.elementResidual,std::abs(e1[j]-e0[j])/std::max(1e-15,std::max(std::abs(e0[j]),std::abs(e1[j]))));
  out.energyResidual=std::abs(PhysicalEnergy(c,out.state)-PhysicalEnergy(c,before))/std::max(EnergyScale(c,before),EnergyScale(c,out.state));
  Need(out.massResidual<=1e-12&&out.elementResidual<=1e-12&&out.energyResidual<=1e-12,"Closed reaction conservation failure");
  out.temperature=Temperature(c,out.state);return out;
}
}
#endif
