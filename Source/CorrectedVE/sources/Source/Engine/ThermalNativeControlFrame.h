#ifndef OPENWAM_THERMAL_NATIVE_CONTROL_FRAME_H
#define OPENWAM_THERMAL_NATIVE_CONTROL_FRAME_H
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>
#include <vector>
namespace OpenWAMThermalReference {
// Read-only, fixed-rpm 720-degree control sampling. No thermodynamic state is
// imported or advanced here. Areas remain assumptions of the native valve model.
struct NativeControlCylinder {int id;double time,angle;};
struct NativeControlValve {int id,cylinder;bool exhaust;double open,close,bore;};
struct NativeControlMotion {int cylinder;double angle0,angle1,volume0,volume1;};
struct NativeControlOpening {int node,cylinder;bool exhaust;double bore,open,close;
  std::array<std::array<double,2>,5> area{};std::array<double,2> staleArea{};};
struct NativeControlFrame {double start,target;std::vector<NativeControlMotion> motion;std::vector<NativeControlOpening> openings;};
inline double ControlTimeTolerance(double a,double b){return 64*std::numeric_limits<double>::epsilon()*std::max(1.,std::max(std::abs(a),std::abs(b)));}
inline double ControlAngle(const NativeControlCylinder& c,double t,double rpm){
  double a=c.angle+6.*rpm*(t-c.time);if(a>720.)a-=720.;return a;
}
template<class Volume,class Area>
std::vector<NativeControlFrame> SampleNativeControls(double start,double target,double rpm,
    const std::vector<NativeControlCylinder>& cylinders,const std::vector<NativeControlValve>& valves,Volume volume,Area area,const std::vector<double>& extraCuts={}){
  if(!std::isfinite(start)||!std::isfinite(target)||!std::isfinite(rpm)||start<0.||target<=start||rpm<=0.||6.*rpm*(target-start)>720.||cylinders.empty()||valves.empty())
    throw std::domain_error("Invalid native control interval");
  std::set<int> ids,nodes;std::vector<double> cuts{start,target};
  for(const auto& c:cylinders){
    if(c.id<=0||!ids.insert(c.id).second||!std::isfinite(c.time)||std::abs(c.time-start)>ControlTimeTolerance(c.time,start)||!std::isfinite(c.angle)||c.angle<0.||c.angle>720.)
      throw std::domain_error("Unsynchronized native cylinder controls");
    const double wrap=c.time+(720.-c.angle)/(6.*rpm);if(wrap>start&&wrap<target)cuts.push_back(wrap);
  }
  for(const auto& v:valves){
    if(v.id<=0||!nodes.insert(v.id).second||!ids.count(v.cylinder)||!std::isfinite(v.bore)||v.bore<=0.||!std::isfinite(v.open)||!std::isfinite(v.close)||v.open<0.||v.close>720.||v.open>=v.close)
      throw std::domain_error("Unsupported native valve identity or timing");
    const auto c=*std::find_if(cylinders.begin(),cylinders.end(),[&](const NativeControlCylinder& x){return x.id==v.cylinder;});
    for(double event:{v.open,v.close})for(int cycle=0;cycle<=1;++cycle){const double t=c.time+(event+720.*cycle-c.angle)/(6.*rpm);if(t>start&&t<target)cuts.push_back(t);}
  }
  auto checkedArea=[&](int id,double t,double angle){auto a=area(id,t,angle);for(double x:a)if(!std::isfinite(x)||x<0.)throw std::domain_error("Invalid sampled valve area");return a;};
  std::sort(cuts.begin(),cuts.end());cuts.erase(std::unique(cuts.begin(),cuts.end()),cuts.end());
  const auto nominal=cuts;
  // SnapshotCD applies a finite Cd cutoff inside the nominal lift interval.
  // Locate observed zero/nonzero transitions in each quarter of the native
  // step down to adjacent representable times. Do not smooth or clip Cd.
  for(unsigned k=1;k<nominal.size();++k)for(const auto& v:valves){
    const auto c=*std::find_if(cylinders.begin(),cylinders.end(),[&](const NativeControlCylinder& x){return x.id==v.cylinder;});
    std::array<double,5> times;std::array<std::array<double,2>,5> values;
    for(unsigned j=0;j<5;++j){times[j]=j==4?nominal[k]:nominal[k-1]+(nominal[k]-nominal[k-1])*j/4.;values[j]=checkedArea(v.id,times[j],ControlAngle(c,times[j],rpm));}
    for(unsigned j=1;j<5;++j)for(unsigned direction=0;direction<2;++direction){
      const bool lowOpen=values[j-1][direction]>0.;if(lowOpen==(values[j][direction]>0.))continue;
      double lo=times[j-1],hi=times[j];
      for(unsigned n=0;n<80;++n){const double mid=lo+.5*(hi-lo);if(mid==lo||mid==hi)break;
        if((checkedArea(v.id,mid,ControlAngle(c,mid,rpm))[direction]>0.)==lowOpen)lo=mid;else hi=mid;
      }
      if(hi>start&&hi<target)cuts.push_back(hi);
    }
  }
  std::sort(cuts.begin(),cuts.end());cuts.erase(std::unique(cuts.begin(),cuts.end()),cuts.end());
  // Paired interventions may share the union of their event times. Add these
  // after event detection so the original callback sampling remains unchanged.
  double previous=start;
  for(double t:extraCuts){if(!std::isfinite(t)||t<=previous||t>=target)throw std::domain_error("Invalid additional control cut");previous=t;cuts.push_back(t);}
  std::sort(cuts.begin(),cuts.end());cuts.erase(std::unique(cuts.begin(),cuts.end()),cuts.end());
  std::vector<NativeControlFrame> result;
  for(unsigned k=1;k<cuts.size();++k){NativeControlFrame f;f.start=cuts[k-1];f.target=cuts[k];
    for(const auto& c:cylinders){NativeControlMotion m{c.id,ControlAngle(c,f.start,rpm),ControlAngle(c,f.target,rpm),0.,0.};
      m.volume0=volume(c.id,m.angle0);m.volume1=volume(c.id,m.angle1);
      if(!std::isfinite(m.volume0)||!std::isfinite(m.volume1)||m.volume0<=0.||m.volume1<=0.)throw std::domain_error("Invalid sampled cylinder volume");
      f.motion.push_back(m);
    }
    for(const auto& v:valves){const auto c=*std::find_if(cylinders.begin(),cylinders.end(),[&](const NativeControlCylinder& x){return x.id==v.cylinder;});
      NativeControlOpening o;o.node=v.id;o.cylinder=v.cylinder;o.exhaust=v.exhaust;o.bore=v.bore;o.open=v.open;o.close=v.close;
      for(unsigned j=0;j<5;++j){const double t=j==4?f.target:f.start+(f.target-f.start)*j/4.;o.area[j]=checkedArea(v.id,t,ControlAngle(c,t,rpm));}
      // Diagnostic only: reproduce the error made by using the old angle with
      // the new midpoint time. It is never used as a control for integration.
      o.staleArea=checkedArea(v.id,.5*(f.start+f.target),c.angle);f.openings.push_back(o);
    }
    result.push_back(f);
  }
  return result;
}
}
#endif
