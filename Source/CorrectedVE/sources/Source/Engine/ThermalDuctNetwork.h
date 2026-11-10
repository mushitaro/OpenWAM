#ifndef OPENWAM_THERMAL_DUCT_NETWORK_H
#define OPENWAM_THERMAL_DUCT_NETWORK_H
#include "../1DPipes/ThermalFiniteVolumeReference.h"
#include "../Boundaries/ThermalPipeNozzleReference.h"
#include "../Boundaries/ThermalMixingJunction.h"
#include "../Boundaries/ThermalTwoPipeValve.h"
#include "../Boundaries/ThermalAreaChange.h"
#include "ThermalParallelExecution.h"
#include <vector>
#include <functional>
#include <set>
#include "ThermalNetworkSources.h"

namespace OpenWAMThermalReference {
// Experimental closed graph. Every volume and every pipe inventory advances
// together. A volume is a well-mixed 0D reservoir, not a spatial plenum model.
// Prescribed development sources are opt-in; production engine coupling is separate.
class ThermalDuctNetwork {
public:
  std::function<void(double)> stageAreaControl; // Pure fixed-frame control recipe; reconstructed after restart.
  struct Volume { ThermalQ q{}; double volume=0.,dvolume=0.; };
  struct End {
    int volume=-1; // No volume: wall unless junction is set; otherwise volume index.
    double forwardArea=0.,reverseArea=0.;
    int junction=-1; // Mutually exclusive with volume; no inventory is stored.
    int reservoir=-1; // Prescribed neighboring cell, HLLC exchange with a ledger.
    bool experimentalFaceReconstruction=false; // Selective independent diagnostic.
  };
  struct Pipe {
    std::vector<ThermalQ> q;
    std::vector<double> cellVolume,faceArea;
    End ends[2];
    double impulse=0.; // Axial force integral, in this pipe's own coordinates.
  };
  std::vector<Volume> volumes;
  std::vector<Pipe> pipes;
  std::vector<ThermalQ> reservoirs; // Conserved density; primitive state is recovered.
  std::vector<ThermalQ> boundaryLedgers;
  std::vector<NetworkSourceLedger> cellSourceLedgers;
  ThermalQ external{}; // Net inventory supplied across prescribed boundaries.
  struct Junction {
    bool straight=false; // Equal-area HLLC union, retained for comparisons.
    // Forward means gathered port 0 -> port 1 (pipe index, then end index).
    // An input adapter must map directional areas to that explicit ordering.
    bool valve=false;double forwardArea=0.,reverseArea=0.;
    bool areaChange=false; // Separated expansion / ideal contraction.
  };
  std::vector<Junction> junctions;
  double time=0.,work=0.;
  double maxJunctionMassResidual=0.,maxJunctionMassCorrection=0.,junctionEntropyIntegral=0.;
  double maxAreaChangeMomentumResidual=0.;
  unsigned long long steps=0;
  bool secondOrder=true;
  unsigned workerCount=1; // Opt-in junction solves; reductions keep serial order.
  // Diagnostic opt-in only. Keep the legacy center-state volume flux by
  // default; no native engine path enables this reconstruction.
  bool experimentalVolumeFaceReconstruction=false;

  std::vector<NetworkSource> sources; // Empty preserves the nonreacting path.
  NetworkSourceLedger sourceLedger{};
  void Validate() const {
    if((!boundaryLedgers.empty()&&boundaryLedgers.size()!=reservoirs.size())||(!cellSourceLedgers.empty()&&cellSourceLedgers.size()!=sources.size()))throw std::domain_error("Ledger topology mismatch");
    std::set<std::pair<int,unsigned>> sourceCells;
    for(const auto& s:sources){
      ValidateNetworkSource(s);
      if(!sourceCells.insert({s.pipe,s.cell}).second)throw std::domain_error("Duplicate source cell");
      if(s.pipe<0?s.cell>=volumes.size():(size_t(s.pipe)>=pipes.size()||s.cell>=pipes[s.pipe].q.size()))
        throw std::domain_error("Source cell outside graph");
    }
    ValidateThermalWorkers(workerCount);
    for(const auto& r:reservoirs)RecoverCell(r,1.);
    std::vector<unsigned> degree(junctions.size());std::vector<double> area(junctions.size());
    for(const auto& v:volumes){
      Positive(v.volume);if(!std::isfinite(v.dvolume)||v.q[1]!=0.)throw std::domain_error("Invalid 0D volume state");
      RecoverCell(v.q,v.volume);
    }
    for(const auto& p:pipes){
      if(p.q.empty()||p.cellVolume.size()!=p.q.size()||p.faceArea.size()!=p.q.size()+1)
        throw std::domain_error("Invalid duct mesh");
      for(const auto& e:p.ends){
        if(e.experimentalFaceReconstruction&&e.volume<0)throw std::domain_error("Face diagnostic requires a volume connection");
        if((experimentalVolumeFaceReconstruction||e.experimentalFaceReconstruction)&&e.volume>=0&&(e.forwardArea>0.||e.reverseArea>0.)){
          if(!secondOrder||p.q.size()<3)throw std::domain_error("Volume face diagnostic requires second order and three cells");
          for(double v:p.cellVolume)if(std::abs(v/p.cellVolume.front()-1.)>1e-12)throw std::domain_error("Volume face diagnostic requires uniform cells");
          for(double a:p.faceArea)if(std::abs(a/p.faceArea.front()-1.)>1e-12)throw std::domain_error("Volume face diagnostic requires a uniform bore");
        }
      }
      for(double a:p.faceArea)Positive(a);
      for(unsigned i=0;i<p.q.size();++i)RecoverCell(p.q[i],p.cellVolume[i]);
      for(unsigned side=0;side<2;++side){const auto& e=p.ends[side];const double a=side?p.faceArea.back():p.faceArea.front();
        if(e.reservoir<-1||e.reservoir>=static_cast<int>(reservoirs.size())||
            (e.reservoir>=0&&(e.volume>=0||e.junction>=0||e.forwardArea!=a||e.reverseArea!=a)))
          throw std::domain_error("Invalid prescribed reservoir connection");
        if(e.volume<-1||e.volume>=static_cast<int>(volumes.size())||!std::isfinite(e.forwardArea)||!std::isfinite(e.reverseArea)||
           e.forwardArea<0.||e.reverseArea<0.||e.forwardArea>a||e.reverseArea>a)
          throw std::domain_error("Invalid duct connection");
        if(e.junction<-1||e.junction>=static_cast<int>(junctions.size()))throw std::domain_error("Invalid junction index");
        if(e.junction>=0){
          if(e.volume>=0||e.forwardArea!=a||e.reverseArea!=a)throw std::domain_error("Ambiguous or restricted junction connection");
          if(junctions[e.junction].straight&&degree[e.junction]>0&&area[e.junction]!=a)throw std::domain_error("Straight union area mismatch");
          ++degree[e.junction];area[e.junction]=a;
        }
      }
    }
    for(unsigned j=0;j<junctions.size();++j){const auto& n=junctions[j];
      if(int(n.straight)+int(n.valve)+int(n.areaChange)>1||((n.straight||n.valve||n.areaChange)?degree[j]!=2:degree[j]<3))throw std::domain_error("Invalid junction degree");
      if(n.valve&&(!std::isfinite(n.forwardArea)||!std::isfinite(n.reverseArea)||n.forwardArea<0.||n.reverseArea<0.))throw std::domain_error("Invalid valve junction opening");
    }
    for(const auto& p:pipes)for(unsigned side=0;side<2;++side)if(p.ends[side].junction>=0){const auto& n=junctions[p.ends[side].junction];const double a=side?p.faceArea.back():p.faceArea.front();
      if(n.valve&&(n.forwardArea>a||n.reverseArea>a))throw std::domain_error("Valve opening exceeds pipe area");
    }
  }
  std::array<long double,9> Total() const {
    std::array<long double,9> total{};
    for(const auto& v:volumes)for(unsigned j=0;j<9;++j)total[j]+=v.q[j];
    for(const auto& p:pipes)for(const auto& q:p.q)for(unsigned j=0;j<9;++j)total[j]+=q[j];
    return total;
  }
  double StableDt(double cfl) const {
    if(!(cfl>0.&&cfl<=.3))throw std::domain_error("Invalid duct CFL");
    Validate();
    double dt=1e99;std::vector<double> area(volumes.size(),0.);
    for(const auto& p:pipes){
      for(unsigned i=0;i<p.q.size();++i){const auto s=RecoverCell(p.q[i],p.cellVolume[i]).gas;
        dt=std::min(dt,p.cellVolume[i]/(std::max(p.faceArea[i],p.faceArea[i+1])*(std::abs(s.velocity)+s.soundSpeed)));
      }
      for(unsigned side=0;side<2;++side)if(p.ends[side].volume>=0)
        area[p.ends[side].volume]+=side?p.faceArea.back():p.faceArea.front();
      for(unsigned side=0;side<2;++side)if(p.ends[side].reservoir>=0){
        const auto r=RecoverCell(reservoirs[p.ends[side].reservoir],1.).gas;
        const double a=side?p.faceArea.back():p.faceArea.front(),v=side?p.cellVolume.back():p.cellVolume.front();
        dt=std::min(dt,v/(a*(std::abs(r.velocity)+r.soundSpeed)));
      }
    }
    for(unsigned i=0;i<volumes.size();++i){const auto& v=volumes[i];const auto s=RecoverCell(v.q,v.volume).gas;
      if(area[i]>0.)dt=std::min(dt,v.volume/(area[i]*s.soundSpeed));
      if(v.dvolume!=0.)dt=std::min(dt,.1*v.volume/std::abs(v.dvolume));
    }
    double sourceDt=1e99;
    for(const auto& s:sources){const auto& q=s.pipe<0?volumes[s.cell].q:pipes[s.pipe].q[s.cell];
      const double v=s.pipe<0?volumes[s.cell].volume:pipes[s.pipe].cellVolume[s.cell];
      sourceDt=std::min(sourceDt,.25*NetworkSourceTimescale(q,v,s));
    }
    return sources.empty()?cfl*dt:std::min(cfl*dt,sourceDt);
  }
private:
  using PipeState=std::vector<std::vector<ThermalQ>>;
  struct Rate {std::vector<ThermalQ> boundary;std::vector<NetworkSourceLedger> cellSources;NetworkSourceLedger sources{};PipeState pipe;std::vector<ThermalQ> volume;std::vector<double> force;ThermalQ external{};double work=0.,massResidual=0.,massCorrection=0.,entropy=0.,areaMomentumResidual=0.;};
  static double Minmod(double a,double b,double c){
    if(a*b<=0.||a*c<=0.)return 0.;return (a>0?1.:-1.)*std::min(std::abs(a),std::min(std::abs(b),std::abs(c)));
  }
  Rate Rates(const PipeState& qs,const std::vector<ThermalQ>& qv,double elapsed,double dt)const {
    Rate rate;rate.boundary.resize(reservoirs.size());rate.cellSources.resize(sources.size());rate.pipe.resize(pipes.size());rate.force.resize(pipes.size());rate.volume.resize(volumes.size());
    std::vector<Primitive> gas;
    for(unsigned i=0;i<volumes.size();++i){const auto& v=volumes[i];gas.push_back(RecoverCell(qv[i],v.volume+elapsed*v.dvolume).gas);
      const double w=-gas.back().pressure*v.dvolume;rate.volume[i][2]=w;rate.work+=w;
    }
    std::vector<std::array<ThermalQ,2>> junctionFlux(pipes.size());
    struct JunctionDiagnostics {double massResidual=0.,massCorrection=0.,entropy=0.,areaMomentumResidual=0.;};
    std::vector<JunctionDiagnostics> diagnostics(junctions.size());
    ThermalIndependentFor(static_cast<unsigned>(junctions.size()),workerCount,[&](unsigned node){
#ifdef OPENWAM_THERMAL_PARALLEL_NODE_OBSERVER
      OPENWAM_THERMAL_PARALLEL_NODE_OBSERVER(node); // Test-only, no solver metadata.
#endif
      auto& nodeRate=diagnostics[node];
      std::vector<std::pair<unsigned,unsigned>> ends;std::vector<JunctionPort> ports;std::vector<ThermalCell> cells;
      for(unsigned k=0;k<pipes.size();++k)for(unsigned side=0;side<2;++side)if(pipes[k].ends[side].junction==static_cast<int>(node)){
        const auto i=side?qs[k].size()-1:0;const auto c=RecoverCell(qs[k][i],pipes[k].cellVolume[i]);
        ends.push_back({k,side});cells.push_back(c);const auto& s=c.gas;
        ports.push_back({{{s.pressure,s.temperature,s.velocity},s.fractions},side?pipes[k].faceArea.back():pipes[k].faceArea.front(),side?1:-1});
      }
      if(junctions[node].valve){
        THERMAL_COST_SCOPE(Valve);
        const auto& valve=junctions[node];const auto solved=ThermalTwoPipeValve(ports[0],ports[1],valve.forwardArea,valve.reverseArea);
        nodeRate.massResidual=std::max(std::abs(solved.receiverMassResidual),std::abs(solved.nozzleMassResidual));nodeRate.entropy=solved.entropyProduction;
        for(unsigned i=0;i<2;++i){const auto& f=solved.flux[i];auto& out=junctionFlux[ends[i].first][ends[i].second];
          out[0]=f.mass;out[1]=f.momentum;out[2]=f.energy;for(unsigned j=0;j<6;++j)out[j+3]=f.species[j];
        }
      }else if(junctions[node].areaChange){
        THERMAL_COST_SCOPE(AreaChange);
        const auto solved=ThermalAreaChange(ports[0],ports[1]);
        nodeRate.massResidual=std::max(std::abs(solved.receiverMassResidual),std::abs(solved.nozzleMassResidual));
        nodeRate.areaMomentumResidual=std::abs(solved.momentumResidual);nodeRate.entropy=solved.entropyProduction;
        for(unsigned i=0;i<2;++i){const auto& f=solved.flux[i];auto& out=junctionFlux[ends[i].first][ends[i].second];
          out[0]=f.mass;out[1]=f.momentum;out[2]=f.energy;for(unsigned j=0;j<6;++j)out[j+3]=f.species[j];
        }
      }else if(junctions[node].straight){
        auto l=cells[0],r=cells[1];l.gas.velocity*=ports[0].normal;l.density[1]*=ports[0].normal;
        r.gas.velocity*=-ports[1].normal;r.density[1]*=-ports[1].normal;
        const auto f=ThermalHllc(l,r,ports[0].area);
        for(unsigned side=0;side<2;++side){auto& out=junctionFlux[ends[side].first][ends[side].second];
          for(unsigned j=0;j<9;++j)out[j]=j==1?ports[side].normal*f[j]:(side?-1.:1.)*f[j];
        }
      }else{
        THERMAL_COST_SCOPE(Mixing);
        const auto solved=[&](){try{return ThermalMixingJunction(ports);}catch(const std::exception& error){
          std::ostringstream d;d<<std::setprecision(17)<<error.what()<<"\nNETWORK junction_index="<<node<<" step="<<steps<<" step_start_s="<<time<<" rk_elapsed_s="<<elapsed;
          for(unsigned k=0;k<ends.size();++k)d<<"\nEND "<<k<<" pipe_index="<<ends[k].first<<" side="<<ends[k].second;
          throw std::domain_error(d.str());}}();
        nodeRate.massResidual=std::abs(solved.rawMassResidual);nodeRate.massCorrection=solved.maxMassCorrection;nodeRate.entropy=solved.entropyProduction;
        for(unsigned i=0;i<ends.size();++i){const auto& f=solved.flux[i];auto& out=junctionFlux[ends[i].first][ends[i].second];
          out[0]=f.mass;out[1]=f.momentum;out[2]=f.energy;for(unsigned j=0;j<6;++j)out[j+3]=f.species[j];
        }
      }
    });
    // Retain exactly the original node order for all shared reductions.
    for(unsigned node=0;node<junctions.size();++node){
      const auto& d=diagnostics[node];const auto& j=junctions[node];
      if(!j.straight){rate.massResidual=std::max(rate.massResidual,d.massResidual);rate.entropy+=d.entropy;}
      if(j.areaChange)rate.areaMomentumResidual=std::max(rate.areaMomentumResidual,d.areaMomentumResidual);
      if(!j.straight&&!j.valve&&!j.areaChange)rate.massCorrection=std::max(rate.massCorrection,d.massCorrection);
    }
    for(unsigned k=0;k<pipes.size();++k){const auto& p=pipes[k];const auto& q=qs[k];const auto n=q.size();
      auto& change=rate.pipe[k];change.resize(n);
      std::vector<ThermalCell> center(n),left(n),right(n);
      for(unsigned i=0;i<n;++i)center[i]=RecoverCell(q[i],p.cellVolume[i]);
      for(unsigned i=0;i<n;++i){auto lo=center[i].density,hi=lo;ThermalQ slope{};
        // Reconstruction uses density, so a tapered pipe at rest remains at
        // rest. This limiter assumes equally spaced cell centers; callers of
        // nonuniform meshes must select first order until spacing is supplied.
        if(secondOrder&&i>0&&i+1<n){
          for(unsigned j=1;j<9;++j)slope[j]=Minmod(2*(lo[j]-center[i-1].density[j]),.5*(center[i+1].density[j]-center[i-1].density[j]),2*(center[i+1].density[j]-lo[j]));
          for(unsigned j=3;j<9;++j)slope[0]+=slope[j];
          for(unsigned j=0;j<9;++j){lo[j]-=.5*slope[j];hi[j]+=.5*slope[j];}
        }
        left[i]=RecoverCell(lo,1.,center[i].gas.temperature);right[i]=RecoverCell(hi,1.,center[i].gas.temperature);
      }
      for(unsigned i=1;i<n;++i){const auto f=ThermalHllc(right[i-1],left[i],p.faceArea[i]);
        for(unsigned j=0;j<9;++j){change[i-1][j]-=f[j];change[i][j]+=f[j];}
      }
      for(unsigned side=0;side<2;++side){const auto i=side?n-1:0;const int normal=side?1:-1;
        const double a=side?p.faceArea.back():p.faceArea.front();const auto& e=p.ends[side];const auto& pc=center[i];const auto& s=pc.gas;
        ThermalQ outward{};
        if(e.reservoir>=0){
          const auto reservoir=RecoverCell(reservoirs[e.reservoir],1.);
          const auto f=side?ThermalHllc(pc,reservoir,a):ThermalHllc(reservoir,pc,a);
          for(unsigned j=0;j<9;++j){outward[j]=normal*f[j];rate.external[j]-=outward[j];rate.boundary[e.reservoir][j]-=outward[j];}
        }
        else if(e.junction>=0)outward=junctionFlux[k][side];
        else if(e.volume<0||(e.forwardArea==0.&&e.reverseArea==0.)){
          auto ghost=pc;ghost.gas.velocity=-s.velocity;ghost.density[1]=-pc.density[1];
          const auto f=side?ThermalHllc(pc,ghost,a):ThermalHllc(ghost,pc,a);outward[1]=normal*f[1];
        }else{
          THERMAL_COST_SCOPE(VolumePort);
          const auto& v=gas[e.volume];
          auto face=pc;
          if(experimentalVolumeFaceReconstruction||e.experimentalFaceReconstruction){
            // Extrapolate conserved density toward the physical volume face.
            // Interior faces retain their previous reconstruction, isolating
            // this boundary-only change. Invalid states fail, not clip.
            const auto one=side?n-2:1,two=side?n-3:2;
            auto qface=pc.density;ThermalQ slope{};
            for(unsigned j=1;j<9;++j){
              const double d1=normal*(pc.density[j]-center[one].density[j]);
              const double d2=normal*(center[one].density[j]-center[two].density[j]);
              slope[j]=Minmod(d1,.5*(d1+d2),d2);
            }
            for(unsigned j=3;j<9;++j)slope[0]+=slope[j];
            for(unsigned j=0;j<9;++j)qface[j]+=.5*normal*slope[j];
            face=RecoverCell(qface,1.,s.temperature);
          }
          const auto& fs=face.gas;
          const auto f=ThermalPipeNozzle({{fs.pressure,fs.temperature,fs.velocity},fs.fractions},{v.pressure,v.temperature,v.fractions},a,e.forwardArea,e.reverseArea,normal);
          outward[0]=f.flux.mass;outward[1]=f.flux.momentum;outward[2]=f.flux.energy;
          for(unsigned j=0;j<6;++j)outward[3+j]=f.flux.species[j];
        }
        // One flux, used with opposite signs. All branches see the same
        // stage state of a volume; no sequential branch pressure overwrite.
        for(unsigned j=0;j<9;++j){change[i][j]-=outward[j];if(e.volume>=0&&j!=1)rate.volume[e.volume][j]+=outward[j];}
      }
      for(unsigned i=0;i<n;++i){change[i][1]+=center[i].gas.pressure*(p.faceArea[i+1]-p.faceArea[i]);rate.force[k]+=change[i][1];}
    }
    unsigned sourceIndex=0;for(const auto& s:sources){
      const auto beforeSource=rate.sources;const auto& q=s.pipe<0?qv[s.cell]:qs[s.pipe][s.cell];
      const double v=s.pipe<0?volumes[s.cell].volume+elapsed*volumes[s.cell].dvolume:pipes[s.pipe].cellVolume[s.cell];
      const auto change=NetworkSourceRate(q,v,s,dt,rate.sources);
      auto& cell=rate.cellSources[sourceIndex++];cell.heat=rate.sources.heat-beforeSource.heat;cell.reactionEnergy=rate.sources.reactionEnergy-beforeSource.reactionEnergy;cell.burnedFuel=rate.sources.burnedFuel-beforeSource.burnedFuel;cell.frictionImpulse=rate.sources.frictionImpulse-beforeSource.frictionImpulse;for(unsigned j=0;j<6;++j)cell.species[j]=rate.sources.species[j]-beforeSource.species[j];
      auto& target=s.pipe<0?rate.volume[s.cell]:rate.pipe[s.pipe][s.cell];
      for(unsigned i=0;i<9;++i)target[i]+=change[i];
      if(s.pipe>=0)rate.force[s.pipe]+=change[1];
    }
    return rate;
  }
public:
  // dV/dt and effective areas are held over this step. Validate configuration
  // before a run; Step validates predictor/corrector states before committing.
  void Step(double dt){
    if(!std::isfinite(dt)||!(dt>0.)||time+dt==time||dt>StableDt(.3)*(1+1e-12))throw std::domain_error("Unsafe duct timestep");
    PipeState qp;std::vector<ThermalQ> qv;
    for(const auto& p:pipes)qp.push_back(p.q);for(const auto& v:volumes)qv.push_back(v.q);
    if(stageAreaControl)stageAreaControl(time);
    const auto a=Rates(qp,qv,0.,dt);auto pred=qp;auto pv=qv;
    for(unsigned k=0;k<pipes.size();++k)for(unsigned i=0;i<qp[k].size();++i)for(unsigned j=0;j<9;++j)pred[k][i][j]+=dt*a.pipe[k][i][j];
    for(unsigned i=0;i<pv.size();++i)for(unsigned j=0;j<9;++j)pv[i][j]+=dt*a.volume[i][j];
    if(stageAreaControl)stageAreaControl(time+dt);
    const auto b=Rates(pred,pv,dt,dt);auto next=qp;auto nv=qv;
    for(unsigned k=0;k<pipes.size();++k)for(unsigned i=0;i<qp[k].size();++i){
      for(unsigned j=0;j<9;++j)next[k][i][j]+=.5*dt*(a.pipe[k][i][j]+b.pipe[k][i][j]);RecoverCell(next[k][i],pipes[k].cellVolume[i]);
    }
    for(unsigned i=0;i<nv.size();++i){for(unsigned j=0;j<9;++j)nv[i][j]+=.5*dt*(a.volume[i][j]+b.volume[i][j]);RecoverCell(nv[i],volumes[i].volume+dt*volumes[i].dvolume);}
    for(unsigned k=0;k<pipes.size();++k){pipes[k].q.swap(next[k]);pipes[k].impulse+=.5*dt*(a.force[k]+b.force[k]);}
    for(unsigned i=0;i<nv.size();++i){volumes[i].q=nv[i];volumes[i].volume+=dt*volumes[i].dvolume;}
    if(!sources.empty())AccumulateSourceLedger(sourceLedger,a.sources,b.sources,dt);
    if(boundaryLedgers.empty())boundaryLedgers.resize(reservoirs.size());if(cellSourceLedgers.empty())cellSourceLedgers.resize(sources.size());
    if(boundaryLedgers.size()!=reservoirs.size()||cellSourceLedgers.size()!=sources.size())throw std::domain_error("Diagnostic ledger topology changed");
    for(unsigned i=0;i<boundaryLedgers.size();++i)for(unsigned j=0;j<9;++j)boundaryLedgers[i][j]+=.5*dt*(a.boundary[i][j]+b.boundary[i][j]);
    for(unsigned i=0;i<cellSourceLedgers.size();++i)AccumulateSourceLedger(cellSourceLedgers[i],a.cellSources[i],b.cellSources[i],dt);
    work+=.5*dt*(a.work+b.work);time+=dt;++steps;
    for(unsigned j=0;j<9;++j)external[j]+=.5*dt*(a.external[j]+b.external[j]);
    maxJunctionMassResidual=std::max(maxJunctionMassResidual,std::max(a.massResidual,b.massResidual));
    maxAreaChangeMomentumResidual=std::max(maxAreaChangeMomentumResidual,std::max(a.areaMomentumResidual,b.areaMomentumResidual));
    maxJunctionMassCorrection=std::max(maxJunctionMassCorrection,std::max(a.massCorrection,b.massCorrection));
    junctionEntropyIntegral+=.5*dt*(a.entropy+b.entropy);
  }
};
}
#endif
