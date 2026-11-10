#ifndef OPENWAM_THERMAL_INTAKE_ADAPTER_H
#define OPENWAM_THERMAL_INTAKE_ADAPTER_H
#include "ThermalDuctNetwork.h"
#include <istream>
#include <map>
#include <set>
namespace OpenWAMThermalReference {
// Geometry-only adapter. Initial states and simultaneous control frames must
// be supplied explicitly. This does not read native cylinder/valve schedules.
class ThermalIntakeAdapter {
public:
  struct InitialCylinder {int id;double volume;Reservoir gas;};
  struct Motion {int cylinder;double endVolume;};
  struct Opening {int node;double forwardArea,reverseArea;};
  struct Frame {double start=0.,target=0.;std::vector<Motion> cylinders;std::vector<Opening> openings;};
  struct Node {int kind=0,target=0,valve=0,junction=-1;std::vector<std::pair<unsigned,unsigned>> ends;};
  struct ExhaustPort {int node,cylinder,pipe,normal;double volume,area,innerArea;ThermalQ q;ThermalCell neighbor;};
private:
  ThermalDuctNetwork graph;
  std::map<int,Node> nodes;
  std::map<int,unsigned> cylinderIndex,volumeIndex,pipeIndex;
  static double Bore(const ThermalDuctNetwork::Pipe& p,unsigned side){return side?p.faceArea.back():p.faceArea.front();}
public:
  const ThermalDuctNetwork& Network()const{return graph;}
  void SetEngineFrameSources(const std::vector<NetworkSource>& sources){
    auto next=graph;next.sources=sources;next.Validate();graph.sources=sources;
  }
  const std::map<int,Node>& Nodes()const{return nodes;}
  unsigned CylinderIndex(int id)const{return cylinderIndex.at(id);}
  unsigned VolumeIndex(int id)const{return volumeIndex.at(id);}
  unsigned PipeIndex(int id)const{return pipeIndex.at(id);}
  // Configure independent junction solves before starting a replay. This does
  // not change the flow model or permit changing a running experiment.
  void SetJunctionWorkers(unsigned workers){
    if(graph.time!=0.||graph.steps)throw std::domain_error("Late worker configuration");
    ValidateThermalWorkers(workers);graph.workerCount=workers;
  }
  // Independent replay opt-in, before the first step only. Do not change
  // unselected volume/cylinder boundaries or expose unrestricted state edits.
  void SetExperimentalVolumeFaces(const std::vector<int>& ids){
    if(graph.time!=0.||graph.steps)throw std::domain_error("Late diagnostic face configuration");
    std::set<unsigned> selected;
    for(int id:ids)if(!volumeIndex.count(id)||!selected.insert(volumeIndex.at(id)).second)
      throw std::domain_error("Unknown or duplicate diagnostic volume");
    auto next=graph;
    for(auto& p:next.pipes)for(auto& e:p.ends)e.experimentalFaceReconstruction=e.volume>=0&&selected.count(static_cast<unsigned>(e.volume))>0;
    next.Validate();graph=std::move(next);
  }

  // Experimental topology conversion in an isolated test copy only.
  // Remove storage, preserve all other inventory and remap every reference.
  void RemoveDiagnosticHStorage(){
    if(graph.time!=0.||graph.steps)throw std::domain_error("Late H conversion");
    const auto original=*this;auto next=*this;
    std::set<unsigned> removed{volumeIndex.at(5),volumeIndex.at(6)};
    for(int id:{5,6}){
      const int old=static_cast<int>(volumeIndex.at(id));
      Node combined;combined.kind=12;combined.junction=static_cast<int>(next.graph.junctions.size());
      next.graph.junctions.push_back({});std::vector<int> names;
      for(const auto& entry:nodes)if(entry.second.kind==11&&entry.second.target==id){
        names.push_back(entry.first);for(auto e:entry.second.ends){combined.ends.push_back(e);
          auto& pipe=next.graph.pipes[e.first];auto& end=pipe.ends[e.second];
          if(end.volume!=old)throw std::domain_error("H endpoint mismatch");
          const double a=Bore(pipe,e.second);end={-1,a,a,combined.junction,-1};
        }
      }
      if(names.size()!=3||combined.ends.size()!=3)throw std::domain_error("Expected H tee");
      for(int name:names)next.nodes.erase(name);next.nodes[names.front()]=combined;
    }
    std::vector<int> remap(graph.volumes.size(),-1);next.graph.volumes.clear();
    for(unsigned i=0;i<graph.volumes.size();++i)if(!removed.count(i)){
      remap[i]=static_cast<int>(next.graph.volumes.size());next.graph.volumes.push_back(graph.volumes[i]);
    }
    next.volumeIndex.erase(5);next.volumeIndex.erase(6);
    for(auto& item:next.volumeIndex)item.second=remap.at(item.second);
    for(auto& item:next.cylinderIndex)item.second=remap.at(item.second);
    for(auto& pipe:next.graph.pipes)for(auto& end:pipe.ends)if(end.volume>=0){
      if(remap.at(end.volume)<0)throw std::domain_error("Dangling H storage reference");end.volume=remap.at(end.volume);
    }
    for(unsigned i=0;i<graph.pipes.size();++i)if(graph.pipes[i].q!=next.graph.pipes[i].q||graph.pipes[i].cellVolume!=next.graph.pipes[i].cellVolume||graph.pipes[i].faceArea!=next.graph.pipes[i].faceArea)
      throw std::domain_error("Non-H pipe inventory or geometry changed");
    next.graph.Validate();*this=std::move(next);
  }

  void RestoreDiagnosticSnapshot(const ThermalDuctNetwork& state){
    if(graph.time!=0.||graph.steps)throw std::domain_error("Late checkpoint restore");
    if(state.pipes.size()!=graph.pipes.size()||state.volumes.size()!=graph.volumes.size()||state.junctions.size()!=graph.junctions.size()||state.reservoirs.size()!=graph.reservoirs.size()||state.workerCount!=graph.workerCount||state.secondOrder!=graph.secondOrder||state.experimentalVolumeFaceReconstruction!=graph.experimentalVolumeFaceReconstruction)throw std::domain_error("Snapshot graph mismatch");
    for(unsigned i=0;i<graph.pipes.size();++i){const auto& a=graph.pipes[i];const auto& b=state.pipes[i];if(a.q.size()!=b.q.size()||a.cellVolume!=b.cellVolume||a.faceArea!=b.faceArea)throw std::domain_error("Snapshot geometry mismatch");
      for(unsigned side=0;side<2;++side)if(a.ends[side].volume!=b.ends[side].volume||a.ends[side].junction!=b.ends[side].junction||a.ends[side].reservoir!=b.ends[side].reservoir||a.ends[side].experimentalFaceReconstruction!=b.ends[side].experimentalFaceReconstruction)throw std::domain_error("Snapshot topology mismatch");}
    state.Validate();graph=state;
  }
  // Transactional, complete initialization. Inventories must already use the
  // thermal EOS and this adapter's mesh; initialization cannot reset a run.
  void Initialize(const std::map<int,std::vector<ThermalQ>>& pipeStates,
      const std::map<int,ThermalQ>& volumeStates,const std::map<int,ThermalQ>& cylinderStates,
      const std::vector<ExhaustPort>& exhaust){
    if(graph.steps||graph.time!=0.||pipeStates.size()!=pipeIndex.size()||volumeStates.size()!=volumeIndex.size()||cylinderStates.size()!=cylinderIndex.size())
      throw std::domain_error("Incomplete or late intake initialization");
    auto next=*this;
    for(const auto& p:pipeIndex){const auto& q=pipeStates.at(p.first);if(q.size()!=next.graph.pipes[p.second].q.size())throw std::domain_error("Initial pipe cell count mismatch");next.graph.pipes[p.second].q=q;}
    for(const auto& v:volumeIndex)next.graph.volumes[v.second].q=volumeStates.at(v.first);
    for(const auto& v:cylinderIndex)next.graph.volumes[v.second].q=cylinderStates.at(v.first);
    for(const auto& e:exhaust){
      if(e.node<=0||next.nodes.count(e.node)||e.pipe<=0||next.pipeIndex.count(e.pipe)||!cylinderIndex.count(e.cylinder)||(e.normal!=1&&e.normal!=-1))
        throw std::domain_error("Invalid exhaust attachment identity");
      Positive(e.volume);Positive(e.area);Positive(e.innerArea);
      ThermalDuctNetwork::Pipe p;p.q={e.q};p.cellVolume={e.volume};
      p.faceArea=e.normal==1?std::vector<double>{e.innerArea,e.area}:std::vector<double>{e.area,e.innerArea};
      const unsigned side=e.normal==1?1:0,index=static_cast<unsigned>(next.graph.pipes.size());
      p.ends[side]={static_cast<int>(cylinderIndex.at(e.cylinder)),0.,0.,-1};
      p.ends[1-side]={-1,e.innerArea,e.innerArea,-1,static_cast<int>(next.graph.reservoirs.size())};
      next.graph.reservoirs.push_back(e.neighbor.density);next.graph.pipes.push_back(p);next.pipeIndex[e.pipe]=index;
      Node node;node.kind=8;node.target=e.cylinder;node.valve=e.node;node.ends.push_back({index,side});next.nodes[e.node]=node;
    }
    next.graph.Validate();*this=std::move(next);
  }
  // All common volumes/pipes start from the explicit gas argument, not wall
  // temperatures or inferred preset pressures. No initial state is overwritten
  // by later frames, which carry geometry controls only.
  static ThermalIntakeAdapter Read(std::istream& input,const Reservoir& gas,const std::vector<InitialCylinder>& cylinders){
    Validate(gas);if(cylinders.empty()||cylinders.size()>10000)throw std::domain_error("Invalid cylinder count");
    ThermalIntakeAdapter out;std::string magic;unsigned np,nn,nv;
    if(!(input>>magic>>np>>nn>>nv)||magic!="THERMAL_INTAKE_V1"||!np||!nn||!nv||np>10000||nn>20000||nv>10000)
      throw std::domain_error("Invalid intake fixture header");
    std::vector<std::array<int,2>> links;
    for(unsigned k=0;k<np;++k){int id,left,right;unsigned cells;double length,d0,d1;
      if(!(input>>id>>length>>d0>>d1>>cells>>left>>right)||id<=0||!cells||cells>100000||out.pipeIndex.count(id))throw std::domain_error("Invalid intake pipe identity");
      Positive(length);Positive(d0);Positive(d1);ThermalDuctNetwork::Pipe p;
      const double pi=std::acos(-1.);
      for(unsigned i=0;i<=cells;++i){const double d=d0+(d1-d0)*i/cells;p.faceArea.push_back(pi*d*d/4);}
      for(unsigned i=0;i<cells;++i){const double a=p.faceArea[i],b=p.faceArea[i+1],v=length/cells*(a+std::sqrt(a*b)+b)/3;
        p.cellVolume.push_back(v);p.q.push_back(InventoryQ(gas.pressure,gas.temperature,0.,gas.fractions,v));}
      out.pipeIndex[id]=static_cast<unsigned>(out.graph.pipes.size());out.graph.pipes.push_back(p);links.push_back({{left,right}});
    }
    for(unsigned k=0;k<nn;++k){int id;Node n;if(!(input>>id>>n.kind>>n.target>>n.valve)||id<=0||out.nodes.count(id))throw std::domain_error("Invalid intake node identity");out.nodes[id]=n;}
    for(unsigned k=0;k<nv;++k){int id;double v;if(!(input>>id>>v)||id<=0||out.volumeIndex.count(id))throw std::domain_error("Invalid intake volume identity");Positive(v);
      out.volumeIndex[id]=static_cast<unsigned>(out.graph.volumes.size());out.graph.volumes.push_back({InventoryQ(gas.pressure,gas.temperature,0.,gas.fractions,v),v,0.});}
    std::string extra;if(input>>extra)throw std::domain_error("Trailing intake fixture data");
    for(const auto& c:cylinders){if(c.id<=0||out.cylinderIndex.count(c.id))throw std::domain_error("Invalid cylinder identity");Positive(c.volume);Validate(c.gas);
      out.cylinderIndex[c.id]=static_cast<unsigned>(out.graph.volumes.size());out.graph.volumes.push_back({InventoryQ(c.gas.pressure,c.gas.temperature,0.,c.gas.fractions,c.volume),c.volume,0.});}
    for(unsigned k=0;k<np;++k)for(unsigned side=0;side<2;++side){auto it=out.nodes.find(links[k][side]);if(it==out.nodes.end())throw std::domain_error("Unknown intake node");it->second.ends.push_back({k,side});}
    std::set<int> usedCylinders,usedVolumes;
    for(auto& entry:out.nodes){auto& n=entry.second;const auto degree=n.ends.size();
      if(n.kind==7||n.kind==8||n.kind==11){if(degree!=1||n.valve<=0)throw std::domain_error("Invalid volume connection");
        const auto& lookup=n.kind!=11?out.cylinderIndex:out.volumeIndex;if(!lookup.count(n.target))throw std::domain_error("Unknown volume or cylinder");
        (n.kind!=11?usedCylinders:usedVolumes).insert(n.target);const auto e=n.ends[0];auto& p=out.graph.pipes[e.first];const double a=Bore(p,e.second);
        p.ends[e.second]={static_cast<int>(lookup.at(n.target)),a,a,-1};
      }else{
        ThermalDuctNetwork::Junction j;
        if(n.target!=0)throw std::domain_error("Unexpected junction target");
        if(n.kind!=10&&n.valve!=0)throw std::domain_error("Unexpected valve on fixed junction");
        if(n.kind==6){if(degree!=2)throw std::domain_error("Invalid area-step degree");j.areaChange=true;}
        else if(n.kind==10){if(degree!=2||n.valve<=0)throw std::domain_error("Invalid throttle degree or identity");j.valve=true;j.forwardArea=j.reverseArea=std::min(Bore(out.graph.pipes[n.ends[0].first],n.ends[0].second),Bore(out.graph.pipes[n.ends[1].first],n.ends[1].second));}
        else if(n.kind!=12||degree<3)throw std::domain_error("Unsupported intake junction");
        n.junction=static_cast<int>(out.graph.junctions.size());out.graph.junctions.push_back(j);
        for(const auto e:n.ends){auto& p=out.graph.pipes[e.first];const double a=Bore(p,e.second);p.ends[e.second]={-1,a,a,n.junction};}
      }
    }
    if(usedCylinders.size()!=cylinders.size()||usedVolumes.size()!=nv)throw std::domain_error("Disconnected intake storage");
    out.graph.Validate();return out;
  }
  Frame Controls(double target)const{
    Frame f;f.start=graph.time;f.target=target;
    for(const auto c:cylinderIndex)f.cylinders.push_back({c.first,graph.volumes[c.second].volume});
    for(const auto& entry:nodes){const auto& n=entry.second;if(n.kind==10){const auto& j=graph.junctions[n.junction];f.openings.push_back({entry.first,j.forwardArea,j.reverseArea});}
      else if(n.kind==7||n.kind==8||n.kind==11){const auto e=n.ends[0];const auto& end=graph.pipes[e.first].ends[e.second];f.openings.push_back({entry.first,end.forwardArea,end.reverseArea});}}
    return f;
  }
  // Commit only a complete frame. Duplicate/missing/stale controls and failed
  // substeps cannot leave some cylinders at a newer time than the others.
  void Advance(const Frame& f,double cfl=.3){
    if(f.start!=graph.time||!std::isfinite(f.target)||!(f.target>f.start)||!std::isfinite(cfl)||cfl<=0.||cfl>.3)
      throw std::domain_error("Invalid shared intake frame time or CFL");
    auto next=graph;std::set<int> seen;
    for(const auto& c:f.cylinders){if(!cylinderIndex.count(c.cylinder)||!seen.insert(c.cylinder).second)throw std::domain_error("Unknown or duplicate cylinder frame");Positive(c.endVolume);
      auto& v=next.volumes[cylinderIndex.at(c.cylinder)];v.dvolume=(c.endVolume-v.volume)/(f.target-f.start);}
    if(seen.size()!=cylinderIndex.size())throw std::domain_error("Incomplete cylinder frame");seen.clear();unsigned expected=0;
    for(const auto& n:nodes)if(n.second.kind==7||n.second.kind==8||n.second.kind==10||n.second.kind==11)++expected;
    for(const auto& o:f.openings){if(!nodes.count(o.node)||!seen.insert(o.node).second)throw std::domain_error("Unknown or duplicate opening frame");const auto& n=nodes.at(o.node);
      if(n.kind==10){auto& j=next.junctions[n.junction];j.forwardArea=o.forwardArea;j.reverseArea=o.reverseArea;}
      else if(n.kind==7||n.kind==8||n.kind==11){const auto e=n.ends[0];auto& end=next.pipes[e.first].ends[e.second];end.forwardArea=o.forwardArea;end.reverseArea=o.reverseArea;}
      else throw std::domain_error("Opening supplied for fixed junction");}
    if(seen.size()!=expected)throw std::domain_error("Incomplete opening frame");next.Validate();
    while(next.time<f.target)next.Step(std::min(next.StableDt(cfl),f.target-next.time));
    for(const auto c:cylinderIndex)next.volumes[c.second].dvolume=0.;graph=std::move(next);
  }
};
}
#endif
