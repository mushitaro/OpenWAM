#pragma once
#include "../Source/Engine/ThermalCylinderNetwork.h"
#include <sstream>
namespace OpenWAMInitialFixture {
using namespace OpenWAMThermalReference;
inline void Check(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
struct Sample {
  int cylinder,exhaust,pipe;
  double target,rpm,angle,mass,volume,temp,pressure;
  std::array<double,10> y;
  NativeThermalPort port;
  std::array<double,5> v,af,ar;
};
inline Sample Read(const std::string& line) {
  std::istringstream in(line);std::vector<double> raw;double value;
  while(in>>value){Check(std::isfinite(value),"Nonfinite initial field");raw.push_back(value);}
  Check(in.eof()&&raw.size()==72,"Malformed initial snapshot");
  for(int k=0;k<5;++k)Check(raw[k]==std::floor(raw[k]),"Noninteger initial identity");
  std::istringstream s(line);Sample a;auto& p=a.port;double neighborArea,dx;
  s>>p.id>>a.cylinder>>a.exhaust>>p.normal>>a.pipe>>a.target>>a.rpm>>a.angle>>p.area>>neighborArea>>dx
    >>a.mass>>a.volume>>a.temp>>a.pressure;
  for(auto& y:a.y)s>>y;
  for(auto* c:{&p.endpoint,&p.neighbor}){s>>c->rho>>c->momentum>>c->energy>>c->gamma>>c->r>>c->pressure;for(auto& y:c->fractions)s>>y;}
  for(int k=0;k<5;++k)s>>a.v[k]>>a.af[k]>>a.ar[k];
  Check(bool(s),"Invalid initial field type");
  Check(p.id>0&&a.pipe>0&&a.cylinder>=1&&a.cylinder<=6&&(a.exhaust==0||a.exhaust==1)&&
    (p.normal==-1||p.normal==1),"Invalid initial identity");
  Positive(a.target);Positive(a.rpm);Positive(p.area);Positive(neighborArea);Positive(dx);Positive(a.pressure);
  Check(a.angle>=0.&&a.angle<=720.&&6.*a.rpm*a.target<1.,"Replay restricted to less than one crank degree");
  p.volume=.5*dx*p.area;p.innerArea=.5*(p.area+neighborArea);p.time=a.target;
  for(int k=0;k<5;++k){Positive(a.v[k]);Check(a.af[k]>=0.&&a.ar[k]>=0.&&a.af[k]<=p.area&&a.ar[k]<=p.area,"Invalid opening area");
    Check((a.af[k]>0.)==(a.af[0]>0.)&&(a.ar[k]>0.)==(a.ar[0]>0.),"Replay interval crosses an effective opening event");}
  Check(std::abs(a.v[0]/a.volume-1.)<1e-12,"Initial geometric volume mismatch");
  p.af=a.af[2];p.ar=a.ar[2];return a;
}
}
