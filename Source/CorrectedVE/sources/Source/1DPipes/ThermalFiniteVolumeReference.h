#ifndef OPENWAM_THERMAL_FINITE_VOLUME_REFERENCE_H
#define OPENWAM_THERMAL_FINITE_VOLUME_REFERENCE_H
#include "../Engine/SensibleMixtureReference.h"
#include <algorithm>
#include "../Engine/ThermalCostProfile.h"

namespace OpenWAMThermalReference {
// Same Cp correlation and energy reference as stage 9, evaluated with explicit
// powers. Bracketed Newton avoids 64 expensive bisections for every pipe cell.
class ThermalEvaluator {
  Law law;
  double offset,highOffset;
  static double H(const std::array<double,5>& a,double t){return t*(a[0]+t*(a[1]/2+t*(a[2]/3+t*(a[3]/4+t*a[4]/5))));}
public:
  double minEnergy,maxEnergy;
  explicit ThermalEvaluator(const Law& l):law(l) {
    offset=law.e300-H(law.c,300.)+law.r*300.;highOffset=offset+H(law.c,1000.)-H(law.high,1000.);
    // Canonical bounds admit the exact stage-9 endpoint values even when the
    // equivalent polynomial evaluation differs by a few floating-point ULPs.
    minEnergy=Energy(law,Tmin);maxEnergy=Energy(law,Tmax);
  }
  double R()const{return law.r;}
  double CpAt(double t)const{return Cp(law,t);}
  double E(double t)const{return H(t<=1000?law.c:law.high,t)-law.r*t+(t<=1000?offset:highOffset);}
  double T(double e,double guess=500.)const{
    if(!std::isfinite(e)||e<minEnergy||e>maxEnergy)throw std::domain_error("Finite-volume energy outside temperature envelope");
    double lo=Tmin,hi=Tmax,t=std::min(hi,std::max(lo,guess));
    for(int j=0;j<60;++j){
      const double residual=E(t)-e;
      if(std::abs(residual)<1e-8+1e-13*std::abs(e))return t;
      if(residual<0)lo=t;else hi=t;
      const double cv=CpAt(t)-law.r;
      if(!(cv>0.))throw std::domain_error("Nonpositive finite-volume Cv");
      double candidate=t-residual/cv;
      if(!std::isfinite(candidate)||candidate<=lo||candidate>=hi)candidate=.5*(lo+hi);
      t=candidate;
    }
    throw std::domain_error("Finite-volume temperature inversion did not converge");
  }
};
using ThermalQ=std::array<double,9>; // mass, axial momentum, total energy, six species masses
struct ThermalCell { Primitive gas; ThermalQ density; };
inline ThermalQ InventoryQ(double pressure,double t,double u,const Composition& y,double volume){
  Positive(pressure);Positive(volume);TemperatureRange(t);
  const Law law=MixtureLaw(y);const double mass=pressure/(law.r*t)*volume;
  ThermalQ q{{mass,mass*u,mass*(Energy(law,t)+.5*u*u),0,0,0,0,0,0}};
  for(unsigned i=0;i<6;++i)q[3+i]=mass*y[i];return q;
}
inline ThermalCell RecoverCell(const ThermalQ& q,double volume,double guess=500.){
  THERMAL_COST_SCOPE(Recover);
  Positive(volume);Positive(q[0]);
  for(double v:q)if(!std::isfinite(v))throw std::domain_error("Nonfinite finite-volume inventory");
  ThermalCell cell{};auto& s=cell.gas;
  for(unsigned i=0;i<6;++i)s.fractions[i]=q[3+i]/q[0];
  const ThermalEvaluator thermo(MixtureLaw(s.fractions));
  s.rho=q[0]/volume;s.velocity=q[1]/q[0];
  s.temperature=thermo.T(q[2]/q[0]-.5*s.velocity*s.velocity,guess);
  s.pressure=s.rho*thermo.R()*s.temperature;
  const double cp=thermo.CpAt(s.temperature);
  s.soundSpeed=std::sqrt(cp/(cp-thermo.R())*thermo.R()*s.temperature);
  Positive(s.pressure);Positive(s.soundSpeed);
  for(unsigned j=0;j<9;++j)cell.density[j]=q[j]/volume;return cell;
}
inline ThermalQ ThermalEuler(const ThermalCell& c){
  const auto& s=c.gas;ThermalQ f{};
  f[0]=s.rho*s.velocity;f[1]=f[0]*s.velocity+s.pressure;f[2]=s.velocity*(c.density[2]+s.pressure);
  for(unsigned j=0;j<6;++j)f[3+j]=f[0]*s.fractions[j];return f;
}
// HLLC bulk flux uses the actual integrated internal energy and frozen sound
// speed, not p/(gamma-1). The exact same mass flux transports all six species.
inline ThermalQ ThermalHllc(const ThermalCell& left,const ThermalCell& right,double area){
  Positive(area);const auto& l=left.gas;const auto& r=right.gas;
  const auto fl=ThermalEuler(left),fr=ThermalEuler(right);
  const double sl=std::min(l.velocity-l.soundSpeed,r.velocity-r.soundSpeed),sr=std::max(l.velocity+l.soundSpeed,r.velocity+r.soundSpeed);
  ThermalQ f{};
  if(sl>=0.)f=fl;else if(sr<=0.)f=fr;else{
    const double sm=(r.pressure-l.pressure+l.rho*l.velocity*(sl-l.velocity)-r.rho*r.velocity*(sr-r.velocity))/(l.rho*(sl-l.velocity)-r.rho*(sr-r.velocity));
    const auto& c=sm>=0?left:right;const auto& s=c.gas;const auto& base=sm>=0?fl:fr;const double wave=sm>=0?sl:sr;
    const double density=s.rho*(wave-s.velocity)/(wave-sm);
    const double e=c.density[2]/s.rho+(sm-s.velocity)*(sm+s.pressure/(s.rho*(wave-s.velocity)));
    if(!std::isfinite(sm)||!(density>0.)||!std::isfinite(e))throw std::domain_error("Invalid thermal HLLC star state");
    const double star[3]={density,density*sm,density*e};
    for(unsigned j=0;j<3;++j)f[j]=base[j]+wave*(star[j]-c.density[j]);
  }
  const auto& y=f[0]>=0?l.fractions:r.fractions;
  for(unsigned j=0;j<6;++j)f[3+j]=f[0]*y[j];
  for(double& v:f){v*=area;if(!std::isfinite(v))throw std::domain_error("Nonfinite thermal HLLC flux");}return f;
}
} // namespace OpenWAMThermalReference
#endif
