#ifndef OPENWAM_THERMAL_MIXING_JUNCTION_H
#define OPENWAM_THERMAL_MIXING_JUNCTION_H
#include "ThermalPipeNozzleReference.h"
#include <vector>
#include <algorithm>
#include <sstream>
#include <iomanip>

namespace OpenWAMThermalReference {
struct JunctionPort {ThermalPipeState pipe;double area;int normal;};
struct MixingJunctionResult {
  std::vector<OutwardTransfer> flux;
  Reservoir mixture{};
  double rawMassResidual=0.,maxMassCorrection=0.,entropyProduction=0.;
  unsigned iterations=0;
};
// Ideal-gas mixture entropy, up to species constants which cancel in a
// species-conserving junction. Partial pressure uses mole, not mass, fraction.
inline double MixingEntropy(const Reservoir& s){
  Validate(s);const auto law=MixtureLaw(s.fractions);double value=0.;
  for(unsigned j=0;j<6;++j)if(s.fractions[j]>0.){
    const auto& l=Laws()[j];const double x=s.fractions[j]*l.r/law.r;
    value+=s.fractions[j]*(Integral(l,Tref,s.temperature,-1.)-l.r*std::log(x*s.pressure/100000.));
  }
  return value;
}
inline double JunctionTemperature(const Law& law,double h){
  if(!std::isfinite(h)||h<Enthalpy(law,Tmin)||h>Enthalpy(law,Tmax))throw std::domain_error("Junction enthalpy outside envelope");
  double lo=Tmin,hi=Tmax,t=.5*(lo+hi);
  for(int i=0;i<60;++i){const double r=Enthalpy(law,t)-h;
    if(std::abs(r)<1e-8+1e-13*std::abs(h))return t;
    if(r<0.)lo=t;else hi=t;const double next=t-r/Cp(law,t);t=next>lo&&next<hi?next:.5*(lo+hi);
  }
  throw std::domain_error("Junction enthalpy inversion failed");
}
// Zero-storage, perfectly mixed junction: incoming kinetic energy thermalizes,
// incoming mass/enthalpy/species mix, and outgoing streams expand isentropically
// from that mixture. This is a dissipative model assumption, NOT a lossless tee
// or a geometry/angle-resolved junction. Sonic incoming rarefaction traces
// are supported; arbitrary supersonic interior states remain unsupported.
// Use a shared Euler flux for a straight
// equal-area two-pipe union instead. Unsupported states fail.
// Boundary trace of a transonic rarefaction: at a fixed pipe end the
// trace is the u_n-c=0 state, not the supersonic downstream star state.
// Its pressure can exceed the mixed-node pressure. This is a new sonic
// boundary branch, not clipping velocity or accepting an invalid star state.
inline WaveResult JunctionIncomingTrace(const Law& law,const WaveState& state,double z,int normal){
  auto wave=WaveAtLogPressure(law,state,z,normal);
  if(normal*wave.state.velocity<wave.soundSpeed)return wave;
  if(wave.shock||normal*state.velocity>=std::sqrt(SoundSquared(law,state.temperature)))throw std::domain_error("Unsupported non-rarefaction sonic junction trace");
  double invalid=z,valid=0.;
  for(unsigned k=0;k<100;++k){double mid=invalid+.5*(valid-invalid);if(mid==invalid||mid==valid)break;const auto w=WaveAtLogPressure(law,state,mid,normal);if(normal*w.state.velocity>=w.soundSpeed)invalid=mid;else valid=mid;}
  auto result=WaveAtLogPressure(law,state,valid,normal);
  if(result.shock||!(normal*result.state.velocity>0.)||normal*result.state.velocity>=result.soundSpeed)throw std::domain_error("Invalid sonic trace bracket");return result;
}
inline MixingJunctionResult ThermalMixingJunction(const std::vector<JunctionPort>& ports){
  if(ports.size()<3)throw std::domain_error("Mixing junction requires at least three ports");
  const double reference=ports[0].pipe.gas.pressure;
  std::vector<Law> laws;std::vector<double> base,wall;
  std::vector<PipeNozzleContext> contexts;contexts.reserve(ports.size());
  double lo=1e99,hi=-1e99,scale=0.;
  for(const auto& p:ports){Positive(p.area);laws.push_back(MixtureLaw(p.pipe.fractions));
    contexts.emplace_back(p.pipe,laws.back(),p.area,p.normal);
    const auto& w=contexts.back().Wall();
    base.push_back(std::log1p((p.pipe.gas.pressure-reference)/reference));
    wall.push_back(base.back()+w.wave.logPressureRatio);lo=std::min(lo,wall.back());hi=std::max(hi,wall.back());
    scale+=p.area*p.pipe.gas.pressure/(laws.back().r*p.pipe.gas.temperature)*std::sqrt(SoundSquared(laws.back(),p.pipe.gas.temperature));
  }
  struct Candidate {MixingJunctionResult result;std::vector<double> faceVelocity;double incoming=0.,outgoing=0.,h=0.,entropyIn=0.;};
  auto evaluate=[&](double z){
    Candidate c;c.result.flux.resize(ports.size());c.faceVelocity.resize(ports.size());c.result.mixture.pressure=reference*std::exp(z);
    Composition species{};
    for(unsigned i=0;i<ports.size();++i)if(z<wall[i]){
      const auto& p=ports[i];const auto w=JunctionIncomingTrace(laws[i],p.pipe.gas,z-base[i],p.normal);
      const double u=p.normal*w.state.velocity;
      if(u<0.||u>=w.soundSpeed){
        std::ostringstream d;d<<std::setprecision(17)<<"Unsupported incoming junction wave; DIAGNOSTIC port_index="<<i
          <<" u="<<u<<" sound_speed="<<w.soundSpeed<<" z="<<z<<" lo="<<lo<<" hi="<<hi
          <<" wall="<<wall[i]<<" base="<<base[i]<<" log_ratio="<<z-base[i]<<" reference_pressure="<<reference
          <<" wave_pressure="<<w.state.pressure<<" wave_temperature="<<w.state.temperature;
        for(unsigned k=0;k<ports.size();++k){const auto& q=ports[k];d<<"\nPORT "<<k<<" normal "<<q.normal<<" area "<<q.area
          <<" pressure "<<q.pipe.gas.pressure<<" temperature "<<q.pipe.gas.temperature<<" velocity "<<q.pipe.gas.velocity<<" fractions";
          for(auto v:q.pipe.fractions)d<<' '<<v;d<<" wall "<<wall[k]<<" base "<<base[k];}
        throw std::domain_error(d.str());
      }
      const double mass=p.area*w.density*u,h=Enthalpy(laws[i],w.state.temperature)+.5*u*u;
      auto& f=c.result.flux[i];f.mass=mass;f.energy=mass*h;f.momentum=p.normal*p.area*(w.state.pressure+w.density*u*u);
      for(unsigned j=0;j<6;++j){f.species[j]=mass*p.pipe.fractions[j];species[j]+=f.species[j];}
      c.incoming+=mass;c.h+=f.energy;
      c.entropyIn+=mass*MixingEntropy({w.state.pressure,w.state.temperature,p.pipe.fractions});
    }
    // At the all-outgoing bracket endpoint no mixing state exists. Only its
    // negative sign is used for bracketing; it is never accepted as a solution.
    if(c.incoming==0.){c.outgoing=scale;return c;}
    c.h/=c.incoming;for(unsigned j=0;j<6;++j)c.result.mixture.fractions[j]=species[j]/c.incoming;
    c.result.mixture.temperature=JunctionTemperature(MixtureLaw(c.result.mixture.fractions),c.h);
    for(unsigned i=0;i<ports.size();++i)if(z>=wall[i]){
      const auto& p=ports[i];
      if(z==wall[i]){c.result.flux[i].momentum=contexts[i].Wall().outwardMomentumFlux;continue;}
      ThermalPipeNozzleResult f;
      try{f=contexts[i].Evaluate(c.result.mixture,MixtureLaw(c.result.mixture.fractions),p.area,p.area,base[i]-z);}
      catch(const std::domain_error& e){
        double edge=wall[i];for(unsigned k=0;k<16;++k)edge=std::nextafter(edge,hi);
        if(z>wall[i]&&z<=edge&&std::string(e.what())=="Thermal wave root outside supported temperature envelope")
          throw std::domain_error("Unrepresentable outgoing junction zero-flow trial");
        throw;
      }
      // A tiny sign discrepancy can occur only when the node pressure rounds
      // to the wall pressure; do not silently accept a different flow topology.
      if(f.flux.mass>0.)throw std::domain_error("Junction flow classification mismatch");
      c.result.flux[i]=f.flux;c.faceVelocity[i]=f.face.gas.velocity;c.outgoing-=f.flux.mass;
    }
    return c;
  };
  if(lo==hi){
    MixingJunctionResult out;out.flux.resize(ports.size());
    for(unsigned i=0;i<ports.size();++i)out.flux[i].momentum=contexts[i].Wall().outwardMomentumFlux;
    return out; // No throughflow; a mixture is intentionally undefined.
  }
  // Safeguarded secant brackets pressure. Pressure is a logarithmic increment,
  // preserving weak wave information rather than subtracting large pressures.
  // A floating point pressure at a zero-flow switch can have a rounded
  // wave sign inconsistent with the rounded wall pressure. Do not clip flux
  // or relax its admissibility: try only adjacent representable pressures.
  auto admissible=[&](double& z,double upper){
    for(unsigned retry=0;;++retry){
      try{return evaluate(z);}catch(const std::domain_error& e){
        if(retry>=16||(std::string(e.what()).find("Unsupported incoming junction wave")!=0&&std::string(e.what())!="Unrepresentable outgoing junction zero-flow trial"))throw;
        const double next=std::nextafter(z,upper);if(!(next>z&&next<upper))throw;z=next;
      }
    }
  };
  auto low=admissible(lo,hi);double fl=low.incoming-low.outgoing,fh=-scale;
  if(!(fl>0.))throw std::domain_error("Invalid junction pressure bracket");
  Candidate solution;bool converged=false;
  for(unsigned i=0;i<80;++i){
    double z=(lo*fh-hi*fl)/(fh-fl);
    if(!(z>lo+.05*(hi-lo)&&z<hi-.05*(hi-lo)))z=.5*(lo+hi);
#ifdef CYCLE_BISECTION_AUDIT
    z=.5*(lo+hi);
#endif
    auto c=admissible(z,hi);const double f=c.incoming-c.outgoing;
    if(c.incoming>0.&&c.outgoing>0.&&std::abs(f)<=2e-12*scale){solution=c;solution.result.iterations=i+1;converged=true;break;}
    if(z==lo||z==hi)break;
    if(f>0.){lo=z;fl=f;}else{hi=z;fh=f;}
  }
  if(!converged)throw std::domain_error("Mixing junction pressure solve failed");
  auto& out=solution.result;out.rawMassResidual=solution.incoming-solution.outgoing;
  // Close only the explicitly bounded nonlinear-solve residual. Record it;
  // no energy/species inventory is clipped or stored at the junction.
  for(unsigned i=0;i<out.flux.size();++i){auto& f=out.flux[i];if(f.mass>=0.)continue;
    const double corrected=f.mass*(solution.incoming/solution.outgoing);
    out.maxMassCorrection=std::max(out.maxMassCorrection,std::abs(corrected-f.mass));
    f.momentum+=(corrected-f.mass)*solution.faceVelocity[i];f.mass=corrected;
    f.energy=corrected*solution.h;for(unsigned j=0;j<6;++j)f.species[j]=corrected*out.mixture.fractions[j];
  }
  out.entropyProduction=solution.incoming*MixingEntropy(out.mixture)-solution.entropyIn;
  if(!std::isfinite(out.entropyProduction)||out.entropyProduction < -1e-8*solution.incoming)
    throw std::domain_error("Negative mixing-junction entropy production");
  return out;
}
}
#endif
