#include "cycle_state.h"
#include <iostream>
#include <iomanip>
int main(int argc,char** argv) { try {
  if(argc!=2) throw std::runtime_error("checkpoint required");
  CycleState c; auto g=LoadCycle(argv[1],c); g.Validate();
  std::cout<<std::setprecision(17)<<"{\"time\":"<<g.time<<",\"workers\":"<<g.workerCount<<",\"cylinders\":[";
  for(unsigned i=0;i<6;++i) {
    if(i)std::cout<<',';
    const auto& s=g.sources.at(i); const auto& v=g.volumes.at(7+i);
    const auto gas=RecoverCell(v.q,v.volume).gas;
    std::cout<<"{\"ordinal\":"<<c.cylinders[i].ordinal<<",\"ivc_air_kg\":"<<s.trappedAir
      <<",\"mass_kg\":"<<v.q[0]<<",\"pressure_pa\":"<<gas.pressure<<",\"temperature_k\":"<<gas.temperature<<'}';
  }
  std::cout<<"]}"; return 0;
} catch(const std::exception& e) {std::cerr<<e.what();return 1;} }
