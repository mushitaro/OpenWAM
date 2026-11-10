#ifndef OPENWAM_THERMAL_COST_PROFILE_H
#define OPENWAM_THERMAL_COST_PROFILE_H
// Opt-in, thread-local inclusive timers for the standalone cost probe only.
#ifdef OPENWAM_THERMAL_COST_PROFILE
#include <chrono>
#include <array>
namespace OpenWAMThermalReference {
struct ThermalCostProfile {
  enum Category { Recover, Mixing, Valve, AreaChange, VolumePort, ExpansionSolve, WaveSolve, Count };
  struct Entry { unsigned long long calls=0; double seconds=0.; };
  static std::array<Entry,Count>& Entries(){static thread_local std::array<Entry,Count> entries{};return entries;}
  Category category;std::chrono::steady_clock::time_point start;
  explicit ThermalCostProfile(Category c):category(c),start(std::chrono::steady_clock::now()){}
  ~ThermalCostProfile(){auto& e=Entries()[category];++e.calls;e.seconds+=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();}
};
}
#define THERMAL_COST_SCOPE(category) ThermalCostProfile thermalCostScope(ThermalCostProfile::category)
#else
#define THERMAL_COST_SCOPE(category) ((void)0)
#endif
#endif
