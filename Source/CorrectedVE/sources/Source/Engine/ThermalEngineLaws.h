#ifndef OPENWAM_THERMAL_ENGINE_LAWS_H
#define OPENWAM_THERMAL_ENGINE_LAWS_H
#include "ThermalNetworkSources.h"
namespace OpenWAMThermalReference {
// Opt-in gas-phase MEP charge contract. It does not model a liquid injector,
// wall film, evaporation, finite wall capacity, or measured combustion.
struct EngineCycleState {
  bool fuelDelivered=false;
  double dose=0.,fuelSensibleEnergy=0.,fuelEnthalpy=0.,mechanicalLoss=0.;
};
inline double MepFuelDose(double freshAir,double phi){
  if(!std::isfinite(freshAir)||freshAir<0.||!std::isfinite(phi)||phi<0.)throw std::domain_error("Invalid MEP charge");
  return freshAir*phi*(7.97*12.01+14.8*1.01)/((7.97+14.8/4)*32.)*.23136;
}
inline void DeliverMepCharge(ThermalQ& q,double volume,double mass,double inletTemperature,EngineCycleState& c){
  if(c.fuelDelivered)throw std::domain_error("Fuel event already applied");
  if(!std::isfinite(mass)||mass<0.||q[1]!=0.)throw std::domain_error("Invalid fuel event");
  TemperatureRange(inletTemperature);auto next=q;
  // Open-system enthalpy carried by a zero-velocity vapor inlet, once only.
  const double hs=Energy(Laws()[5],inletTemperature)+Laws()[5].r*inletTemperature;
  const double es=mass*hs;next[0]+=mass;next[8]+=mass;next[2]+=es;
  RecoverCell(next,volume);q=next;c.fuelDelivered=true;c.dose=mass;c.fuelSensibleEnergy=es;
  c.fuelEnthalpy=es+mass*OpenWAMClosedReactionReference::Alpha(NetworkReactionContract())[5];
}
inline double WiebeFraction(double angle,double start=-23.,double duration=60.,double shape=2.,double a=6.9){
  if(!std::isfinite(angle)||!std::isfinite(start)||!std::isfinite(duration)||duration<=0.||!std::isfinite(shape)||shape<0.||!std::isfinite(a)||a<=0.)throw std::domain_error("Invalid Wiebe law");
  if(angle<=start)return 0.;
  // Native fun_wiebe shape; outside duration, retain its terminal fraction.
  const double x=std::min((angle-start)/duration,1.);return -std::expm1(-a*std::pow(x,shape+1));
}
inline double WiebeFuelRate(double angle0,double angle1,double dt,double dose,double efficiency=.98){
  if(!std::isfinite(dt)||dt<=0.||angle1<angle0||!std::isfinite(dose)||dose<0.||!std::isfinite(efficiency)||efficiency<0.||efficiency>1.)throw std::domain_error("Invalid burn interval");
  return dose*efficiency*(WiebeFraction(angle1)-WiebeFraction(angle0))/dt;
}
inline double MechanicalLossPower(double rpm,double displacement,double c0=.1,double c1=0.,double c2=0.,double c3=0.,double imep=0.){
  for(double x:{rpm,displacement,c0,c1,c2,c3,imep})if(!std::isfinite(x))throw std::domain_error("Invalid FMEP input");
  if(rpm<0.||displacement<0.)throw std::domain_error("Invalid mechanical geometry");
  const double bar=c0+c1*rpm/60-c2*rpm*rpm/3600+c3*imep;
  if(bar<0.)throw std::domain_error("Negative mechanical loss");
  return bar*1e5*displacement*rpm/120.; // Four-stroke work per 720 degrees.
}
}
#endif
