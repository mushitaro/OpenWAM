// Reuse the existing frame update and inventory ledger. H-only reconstruction
// is enabled explicitly for this independent diagnostic binary.
#include "ThermalDriveFixture.h"
#include <iostream>
#include <iomanip>
using namespace OpenWAMNativeIntakeFixture;
bool ConfigureH(ThermalIntakeAdapter& model,const Drive& drive,const std::string& mode){
  const bool inspect=mode=="inspect-off"||mode=="inspect-on";
  Check(inspect||mode=="off"||mode=="on","Expected off/on or inspect-off/inspect-on");
  const bool enabled=mode=="on"||mode=="inspect-on";
  if(enabled)model.SetExperimentalVolumeFaces({5,6});
  unsigned count=0,cells=0;for(const auto& p:model.Network().pipes){cells+=static_cast<unsigned>(p.q.size());for(const auto& e:p.ends)if(e.experimentalFaceReconstruction){
    Check(e.volume==static_cast<int>(model.VolumeIndex(5))||e.volume==static_cast<int>(model.VolumeIndex(6)),"Non-H face enabled");++count;}}
  Check(count==(enabled?6u:0u),"Wrong H face count");
  if(inspect){
    std::cout<<std::setprecision(17)<<"{\"inspected\":true,\"flow_calculated\":false,\"target_s\":"<<drive.target
      <<",\"frames\":"<<drive.frames.size()<<",\"pipe_count\":"<<model.Network().pipes.size()<<",\"cells\":"<<cells<<",\"h_faces\":"<<count
      <<",\"h_volume_m3\":"<<model.Network().volumes[model.VolumeIndex(5)].volume
#ifdef OPENWAM_H_PARALLEL_RUNNER
      <<",\"junction_workers_requested\":"<<model.Network().workerCount
#endif
      <<"}\n";
  }
  return inspect;
}
#ifdef OPENWAM_H_PARALLEL_RUNNER
unsigned ReadJunctionWorkers(const char* value){
  const std::string token(value);
  Check(!token.empty()&&token.find_first_not_of("0123456789")==std::string::npos,"Expected integer junction workers 1..64");
  const auto count=std::stoul(token);Check(count>=1&&count<=64,"Expected integer junction workers 1..64");
  return static_cast<unsigned>(count);
}
#define THERMAL_REPLAY_EXTRA_ARGUMENTS 2
#define THERMAL_REPLAY_WORKERS_SETUP model.SetJunctionWorkers(ReadJunctionWorkers(argv[10]));
#define THERMAL_REPLAY_RESULT_FIELDS <<",\"junction_workers_requested\":"<<g.workerCount
#else
#define THERMAL_REPLAY_EXTRA_ARGUMENTS 1
#define THERMAL_REPLAY_WORKERS_SETUP
#endif
#define THERMAL_REPLAY_MAX_DURATION .010
#define THERMAL_REPLAY_MODEL_SETUP \
  Check(full&&tracePorts,"H diagnostic requires full network and port traces"); \
  THERMAL_REPLAY_WORKERS_SETUP \
  if(ConfigureH(model,drive,argv[9]))return 0
#include "thermal_driven_intake_replay.cpp"
