#pragma once
#include "ThermalInitialFixture.h"
#include "../Source/Engine/ThermalIntakeAdapter.h"
#include <fstream>
#include <map>
namespace OpenWAMNativeIntakeFixture {
using namespace OpenWAMThermalReference;
using OpenWAMInitialFixture::Sample;
inline void Check(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
struct NativePipe {double dx;std::vector<double> area;std::vector<NativePipeCell> cells;};
struct NativeVolume {double time,volume,mass,temp,pressure;std::array<double,10> y;};
struct Inputs {
  std::map<int,NativePipe> pipes;std::map<int,NativeVolume> volumes;
  std::map<int,std::array<double,2>> openings,throttles;
  std::map<int,Sample> ports;
};
inline Inputs Read(const char* portsPath,const char* networkPath){
  Inputs out;std::ifstream p(portsPath);Check(bool(p),"Missing port input");std::string line;
  while(std::getline(p,line)){if(line.empty())continue;const auto s=OpenWAMInitialFixture::Read(line);Check(out.ports.emplace(s.port.id,s).second,"Duplicate port");}
  Check(out.ports.size()==24,"Expected 24 ports");
  std::ifstream f(networkPath);std::string tag;Check(bool(f>>tag)&&tag=="THERMAL_NETWORK_INITIAL_V1","Invalid network header");
  while(f>>tag){int id;Check(bool(f>>id)&&id>0,"Invalid native identity");
    if(tag=="PIPE"){unsigned n;NativePipe pipe;Check(bool(f>>n>>pipe.dx)&&n>=2&&n<100000,"Invalid native pipe count");Positive(pipe.dx);
      for(unsigned i=0;i<n;++i){double a;NativePipeCell c;f>>a>>c.rho>>c.momentum>>c.energy>>c.gamma>>c.r>>c.pressure;for(double& y:c.fractions)f>>y;
        Check(bool(f),"Malformed pipe state");Positive(a);pipe.area.push_back(a);pipe.cells.push_back(c);}
      Check(out.pipes.emplace(id,pipe).second,"Duplicate native pipe");
    }else if(tag=="VOLUME"){NativeVolume v;f>>v.time>>v.volume>>v.mass>>v.temp>>v.pressure;for(double& y:v.y)f>>y;
      Check(bool(f)&&out.volumes.emplace(id,v).second,"Malformed or duplicate native volume");
    }else if(tag=="OPENING"||tag=="THROTTLE_CD"){std::array<double,2> a;f>>a[0]>>a[1];Check(bool(f),"Malformed static opening");
      Check((tag=="OPENING"?out.openings:out.throttles).emplace(id,a).second,"Duplicate static opening");
    }else throw std::runtime_error("Unknown network record");
  }
  Check(f.eof(),"Malformed network input");return out;
}
struct ImportMetrics {double uniformError=0.,nativeGeometryDifference=0.,pressureRebase=0.,energyRebase=0.,correction=0.;};
inline ThermalIntakeAdapter Build(const char* geometry,const Inputs& in,ImportMetrics& metrics,bool fullNetwork=false){
  const int pipeCount=fullNetwork?86:39,volumeCount=fullNetwork?9:4;
  if(fullNetwork)Check(in.pipes.size()==86&&in.volumes.size()==9,"Incomplete full-network initial state");
  ThermalCylinderNetwork importer;std::vector<ThermalIntakeAdapter::InitialCylinder> cylinders;
  std::map<int,Sample> source;std::map<int,ThermalQ> cq,vq;std::map<int,std::vector<ThermalQ>> pq;
  for(const auto& e:in.ports){const auto& a=e.second;auto inserted=source.emplace(a.cylinder,a);if(!inserted.second){const auto& b=inserted.first->second;
      Check(a.mass==b.mass&&a.temp==b.temp&&a.volume==b.volume&&a.y==b.y&&a.v==b.v&&a.target==b.target&&a.rpm==b.rpm,"Inconsistent shared cylinder");}}
  Check(source.size()==6,"Expected six cylinders");
  const double target=source.begin()->second.target,rpm=source.begin()->second.rpm;
  for(const auto& e:source){const auto& a=e.second;Check(a.target==target&&a.rpm==rpm,"Unsynchronized input frame");
    const auto q=ImportMassTemperature(a.mass,a.temp,0.,importer.Import(a.y,a.mass));const auto gas=RecoverCell(q,a.volume).gas;
    cq[e.first]=q;cylinders.push_back({e.first,a.volume,{gas.pressure,gas.temperature,gas.fractions}});}
  std::ifstream file(geometry);auto model=ThermalIntakeAdapter::Read(file,{100000.,400.,{{.233,0,0,.755,.012,0}}},cylinders);
  // At startup each native pipe is uniform. Reject nonuniform data instead of
  // inventing an unvalidated remapping of evolved nodal states onto FV cells.
  for(int id=1;id<=pipeCount;++id){const auto& n=in.pipes.at(id);const auto& pipe=model.Network().pipes[model.PipeIndex(id)];
    const auto reference=importer.ImportNative(n.cells.front(),1.,false);double nativeVolume=0.,volume=0.;
    Check(std::abs(n.area.front()/pipe.faceArea.front()-1.)<1e-12&&std::abs(n.area.back()/pipe.faceArea.back()-1.)<1e-12,"Pipe endpoint geometry mismatch");
    for(unsigned i=0;i<n.cells.size();++i){const auto q=importer.ImportNative(n.cells[i],1.,false);
      for(unsigned j=0;j<9;++j){const double scale=j==2?std::max(1.,std::abs(reference[2])):reference[0];metrics.uniformError=std::max(metrics.uniformError,std::abs(q[j]-reference[j])/scale);}
      nativeVolume+=n.dx*n.area[i]*(i==0||i+1==n.cells.size()?.5:1.);
    }
    Check(metrics.uniformError<1e-12,"Nonuniform native startup requires conservative remapping");
    for(double v:pipe.cellVolume){auto q=reference;for(auto& x:q)x*=v;pq[id].push_back(q);volume+=v;}
    const double length=3.*volume/(pipe.faceArea.front()+std::sqrt(pipe.faceArea.front()*pipe.faceArea.back())+pipe.faceArea.back());
    Check(std::abs(n.dx*(n.cells.size()-1)/length-1.)<1e-12,"Native pipe length mismatch");
    metrics.nativeGeometryDifference+=reference[0]*(volume-nativeVolume);
    metrics.energyRebase+=(reference[2]-n.cells.front().energy)*volume;
    metrics.pressureRebase=std::max(metrics.pressureRebase,std::abs(RecoverCell(reference,1.).gas.pressure/n.cells.front().pressure-1.));
  }
  for(int id=1;id<=volumeCount;++id){const auto& v=in.volumes.at(id);Check(v.time==0.&&std::abs(v.volume/model.Network().volumes[model.VolumeIndex(id)].volume-1.)<1e-12,"Native shared volume/time mismatch");
    vq[id]=ImportMassTemperature(v.mass,v.temp,0.,importer.Import(v.y,v.mass));}
  std::vector<ThermalIntakeAdapter::ExhaustPort> exhaust;std::map<int,int> count;
  for(const auto& entry:in.ports){const auto& a=entry.second;const auto& p=a.port;++count[a.cylinder];
    if(a.exhaust&&!fullNetwork)exhaust.push_back({p.id,a.cylinder,a.pipe,p.normal,p.volume,p.area,p.innerArea,importer.ImportNative(p.endpoint,p.volume),RecoverCell(importer.ImportNative(p.neighbor,1.,false),1.)});
    else{const auto& node=model.Nodes().at(p.id);Check(node.kind==(a.exhaust?8:7)&&node.target==a.cylinder&&node.ends[0].first==model.PipeIndex(a.pipe)&&int(node.ends[0].second?1:-1)==p.normal,"Cylinder port mapping mismatch");}
  }
  Check(exhaust.size()==(fullNetwork?0:12),"Unexpected external exhaust attachments");for(const auto& c:count)Check(c.second==4,"Expected four ports per cylinder");
  model.Initialize(pq,vq,cq,exhaust);metrics.correction=importer.importedFractionCorrection;
  Check(model.Network().pipes.size()==(fullNetwork?86:51)&&model.Network().reservoirs.size()==(fullNetwork?0:12),"Attached graph counts");return model;
}
inline void ApplyStaticControls(ThermalIntakeAdapter::Frame& frame,const ThermalIntakeAdapter& model,const Inputs& in){
  for(auto& opening:frame.openings){const auto& node=model.Nodes().at(opening.node);
      if(node.kind==11){const auto a=in.openings.at(opening.node);const auto e=node.ends[0];const auto& p=model.Network().pipes[e.first];
        // Preserve the native open-area ratio on the target bore. Different
        // pi/multiplication order can otherwise put an exactly open valve one
        // ULP above the reconstructed bore; do not clip over-unity ratios.
        const auto& native=in.pipes.at(static_cast<int>(e.first)+1);const double bore=e.second?p.faceArea.back():p.faceArea.front();
        const double nativeBore=e.second?native.area.back():native.area.front();
        Check(a[0]>=0.&&a[1]>=0.&&a[0]<=nativeBore&&a[1]<=nativeBore,"Native volume opening exceeds its bore");
        opening.forwardArea=(a[0]/nativeBore)*bore;opening.reverseArea=(a[1]/nativeBore)*bore;}
      else if(node.kind==10){const auto cd=in.throttles.at(opening.node);Check(cd[0]==cd[1],"Directional throttle mapping requires explicit orientation");const auto e=node.ends[0];const auto& p=model.Network().pipes[e.first];const double a=e.second?p.faceArea.back():p.faceArea.front();opening.forwardArea=cd[0]*a;opening.reverseArea=cd[1]*a;}
  }
}
}
