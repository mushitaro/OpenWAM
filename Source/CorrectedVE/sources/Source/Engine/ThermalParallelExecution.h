#ifndef OPENWAM_THERMAL_PARALLEL_EXECUTION_H
#define OPENWAM_THERMAL_PARALLEL_EXECUTION_H
#include <vector>
#include <exception>
#include <stdexcept>
#ifdef _OPENMP
#include <omp.h>
#endif
namespace OpenWAMThermalReference {
inline void ValidateThermalWorkers(unsigned workers){
  if(workers<1||workers>64)throw std::domain_error("Thermal worker count outside 1..64");
#if !defined(_OPENMP) || defined(OPENWAM_THERMAL_COST_PROFILE)
  if(workers!=1)throw std::domain_error("Parallel thermal execution requires OpenMP without inclusive profiling");
#endif
}
// Each index owns its writes; inputs and topology remain immutable until join.
// Errors are rethrown on the calling thread in original serial index order.
template<class F> inline void ThermalIndependentFor(unsigned count,unsigned workers,F f){
  ValidateThermalWorkers(workers);
  if(workers==1){for(unsigned i=0;i<count;++i)f(i);return;}
#ifdef _OPENMP
  std::vector<std::exception_ptr> errors(count);
#pragma omp parallel for schedule(dynamic,1) num_threads(workers)
  for(long long i=0;i<static_cast<long long>(count);++i){
    try{f(static_cast<unsigned>(i));}catch(...){errors[static_cast<unsigned>(i)]=std::current_exception();}
  }
  for(const auto& error:errors)if(error)std::rethrow_exception(error);
#endif
}
}
#endif
