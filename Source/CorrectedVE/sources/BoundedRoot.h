#pragma once
#include <cmath>
#include <algorithm>
#include <limits>
#include <stdexcept>
namespace OpenWAMThermalReference {
template<class F>double AdjacentBracketRoot(F f,double lo,double hi){
 double fl=f(lo),fh=f(hi);if(!std::isfinite(fl)||!std::isfinite(fh)||fl>0||fh<0)throw std::domain_error("Invalid accelerated root bracket");
 if(fl==0)return lo;if(fh==0)return hi;double wl=fl,wh=fh;int previous=0;
 for(unsigned j=0;j<192;++j){
  if(std::nextafter(lo,hi)>=hi)return lo+.5*(hi-lo);
  const double scale=std::max(std::abs(wl),std::abs(wh));const double a=-wl/scale,b=wh/scale;
  double x=lo+(hi-lo)*(a/(a+b));if(j%4==3||!std::isfinite(x)||x<=lo||x>=hi)x=lo+.5*(hi-lo);
  if(x==lo||x==hi)return lo+.5*(hi-lo);double fx=f(x);if(!std::isfinite(fx))throw std::domain_error("Nonfinite accelerated root");if(fx==0)return x;
  if(fx<0){lo=x;fl=fx;wl=fx;wh=previous==-1?wh*.5:fh;previous=-1;}
  else{hi=x;fh=fx;wh=fx;wl=previous==1?wl*.5:fl;previous=1;}
 }
 for(unsigned j=0;j<70;++j){double x=lo+.5*(hi-lo);if(x==lo||x==hi)break;double fx=f(x);if(!std::isfinite(fx))throw std::domain_error("Nonfinite root fallback");if(fx==0)return x;if(fx<0)lo=x;else hi=x;}
 return lo+.5*(hi-lo);
}
}
