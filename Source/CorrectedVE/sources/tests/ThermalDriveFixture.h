#pragma once
#include "ThermalNativeIntakeFixture.h"
#include "../Source/Engine/ThermalNativeControlFrame.h"
namespace OpenWAMNativeIntakeFixture {
struct DriveCylinder {std::array<double,5> angle,volume;};
struct DriveValve {int cylinder;bool exhaust;double bore;std::array<double,5> af,ar;};
struct DriveFrame {double start,target;std::map<int,DriveCylinder> cylinders;std::map<int,DriveValve> valves;};
struct Drive {double rpm,target;std::vector<DriveFrame> frames;double probeError=0.;};
inline Drive ReadDrive(const char* path,const Inputs& in,double maximumDuration=.002){
  std::ifstream f(path);std::string tag;Drive d;unsigned intervals;
  Check(bool(f>>tag>>d.rpm>>d.target>>intervals)&&tag=="THERMAL_DRIVE_V1","Malformed drive header");
  Positive(d.rpm);Positive(d.target);Check(std::isfinite(maximumDuration)&&maximumDuration>0.&&maximumDuration<=120./d.rpm&&intervals>0&&intervals<=100000&&d.target<=maximumDuration,"Unsupported drive extent");
  Check(d.rpm==in.ports.begin()->second.rpm,"Drive rpm mismatch");
  std::map<int,Sample> cylinders;for(const auto& p:in.ports)cylinders.emplace(p.second.cylinder,p.second);
  double time=0.;std::map<int,double> previousVolume;
  for(const auto& c:cylinders)previousVolume[c.first]=c.second.volume;
  while(f>>tag){DriveFrame a;Check(tag=="FRAME"&&bool(f>>a.start>>a.target),"Malformed drive frame");
    Check(a.start==time&&std::isfinite(a.target)&&a.target>a.start&&a.target<=d.target,"Discontinuous drive clock");
    bool ended=false;
    while(f>>tag){if(tag=="END"){ended=true;break;}int id;Check(bool(f>>id),"Missing drive identity");
      if(tag=="CYL"){DriveCylinder c{};for(unsigned j=0;j<5;++j){Check(bool(f>>c.angle[j]>>c.volume[j]),"Malformed cylinder drive sample");Positive(c.volume[j]);
          const double t=j==4?a.target:a.start+(a.target-a.start)*j/4.;
          Check(cylinders.count(id)>0,"Unknown driven cylinder");
          const double expected=ControlAngle({id,0.,cylinders.at(id).angle},t,d.rpm);
          Check(std::isfinite(c.angle[j])&&std::abs(c.angle[j]-expected)<1e-10,"Drive phase mismatch");}
        Check(bool(f)&&a.cylinders.emplace(id,c).second,"Duplicate or malformed cylinder drive");
        Check(std::abs(c.volume[0]/previousVolume.at(id)-1.)<1e-12,"Discontinuous cylinder volume");
      }else if(tag=="VALVE"){DriveValve v;int exhaust;f>>v.cylinder>>exhaust>>v.bore;
        Check(bool(f)&&in.ports.count(id)>0,"Unknown driven valve");const auto& p=in.ports.at(id);
        Check(v.cylinder==p.cylinder&&exhaust==p.exhaust&&v.bore==p.port.area,"Drive valve mapping mismatch");v.exhaust=exhaust!=0;
        for(unsigned j=0;j<5;++j){f>>v.af[j]>>v.ar[j];Check(bool(f)&&std::isfinite(v.af[j])&&std::isfinite(v.ar[j])&&
            v.af[j]>=0.&&v.ar[j]>=0.&&v.af[j]<=v.bore&&v.ar[j]<=v.bore,"Invalid driven opening");}
        for(unsigned j=1;j<3;++j)Check((v.af[j]>0.)==(v.af[j+1]>0.)&&(v.ar[j]>0.)==(v.ar[j+1]>0.),"Unsplit interior opening event");
        Check(a.valves.emplace(id,v).second,"Duplicate driven valve");
      }else throw std::runtime_error("Unknown drive record");
    }
    Check(ended&&a.cylinders.size()==6&&a.valves.size()==24,"Incomplete drive frame");
    for(const auto& c:a.cylinders)previousVolume[c.first]=c.second.volume[4];
    time=a.target;d.frames.push_back(a);
  }
  Check(f.eof()&&time==d.target&&d.frames.size()>=intervals,"Incomplete drive schedule");
  if(d.target==in.ports.begin()->second.target){Check(d.frames.size()==1,"Initial probe must have one segment");
    for(const auto& p:in.ports)for(unsigned j=0;j<5;++j){const auto& a=d.frames[0];const auto& s=p.second;const auto& v=a.valves.at(p.first);
      d.probeError=std::max({d.probeError,std::abs(a.cylinders.at(s.cylinder).volume[j]/s.v[j]-1.),
        std::abs(v.af[j]-s.af[j])/s.port.area,std::abs(v.ar[j]-s.ar[j])/s.port.area});}
    Check(d.probeError<1e-12,"Independent initial controls differ from native snapshot");
  }
  return d;
}
}
