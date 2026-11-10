#include "ThermalDriveFixture.h"
#include <iostream>
#include <iomanip>
#include <chrono>
using namespace OpenWAMNativeIntakeFixture;
#ifndef THERMAL_REPLAY_EXTRA_ARGUMENTS
#define THERMAL_REPLAY_EXTRA_ARGUMENTS 0
#endif
#ifndef THERMAL_REPLAY_MAX_DURATION
#define THERMAL_REPLAY_MAX_DURATION .002
#endif
int main(int argc,char** argv){try{
  Check(argc==8+THERMAL_REPLAY_EXTRA_ARGUMENTS||argc==9+THERMAL_REPLAY_EXTRA_ARGUMENTS,"Expected geometry, ports, network, drive, trace, CFL, exhaust pressure scale, and optional --full-network");
  const bool full=argc==9+THERMAL_REPLAY_EXTRA_ARGUMENTS,tracePorts=full&&std::string(argv[8])=="--full-network-ports";
  Check(!full||tracePorts||std::string(argv[8])=="--full-network","Unknown replay option");
  const auto started=std::chrono::steady_clock::now();auto in=Read(argv[2],argv[3]);const auto drive=ReadDrive(argv[4],in,THERMAL_REPLAY_MAX_DURATION);
  const double cfl=std::stod(argv[6]),scale=std::stod(argv[7]);Check(cfl>0.&&cfl<=.3&&scale>=.99&&scale<=1.01,"Invalid replay parameter");
  Check(!full||scale==1.,"Full network cannot perturb prescribed exhaust neighbors");
  // Pressure perturbation of prescribed neighbors only, at fixed T/u/Y.
  // This is a sensitivity test, not a measured exhaust uncertainty interval.
  for(auto& p:in.ports)if(p.second.exhaust){auto& n=p.second.port.neighbor;n.rho*=scale;n.momentum*=scale;n.energy*=scale;n.pressure*=scale;}
  ImportMetrics metrics;auto model=Build(argv[1],in,metrics,full);
#ifdef THERMAL_REPLAY_MODEL_SETUP
  THERMAL_REPLAY_MODEL_SETUP;
#endif
  const auto initial=model.Network().Total();
  const auto& ambient=model.Network().volumes[model.VolumeIndex(1)].q;
  const auto ambientExhaust=full?model.Network().volumes[model.VolumeIndex(9)].q:ThermalQ{};
  const double massScale=static_cast<double>(initial[0]-ambient[0]-ambientExhaust[0]),energyScale=std::abs(static_cast<double>(initial[2]-ambient[2]-ambientExhaust[2]));
  Check(massScale>0.&&energyScale>0.,"Invalid active inventory scale");
  const int volumeCount=full?9:4;
  std::ofstream trace(argv[5]);Check(bool(trace),"Cannot open drive trace");trace<<std::setprecision(17)<<"time_s";
  for(int id=1;id<=6;++id)trace<<",cylinder"<<id<<"_pa";
  for(int id=1;id<=6;++id)trace<<",cylinder"<<id<<"_mass_kg";
  for(int id=1;id<=volumeCount;++id)trace<<",volume"<<id<<"_pa";
  if(tracePorts)for(const auto& p:in.ports)trace<<",port"<<p.first<<"_cell_pa";
  trace<<",budget_relative,external_mass_kg,external_energy_j,work_j,steps\n";
  double budget=0.;
  auto row=[&](){const auto& g=model.Network();trace<<g.time;
    for(int id=1;id<=6;++id){const auto& v=g.volumes[model.CylinderIndex(id)];trace<<','<<RecoverCell(v.q,v.volume).gas.pressure;}
    for(int id=1;id<=6;++id)trace<<','<<g.volumes[model.CylinderIndex(id)].q[0];
    for(int id=1;id<=volumeCount;++id){const auto& v=g.volumes[model.VolumeIndex(id)];trace<<','<<RecoverCell(v.q,v.volume).gas.pressure;}
    if(tracePorts)for(const auto& entry:in.ports){const auto& node=model.Nodes().at(entry.first);const auto end=node.ends[0];const auto& p=g.pipes[end.first];const auto i=end.second?p.q.size()-1:0;trace<<','<<RecoverCell(p.q[i],p.cellVolume[i]).gas.pressure;}
    trace<<','<<budget<<','<<g.external[0]<<','<<g.external[2]<<','<<g.work<<','<<g.steps<<'\n';trace.flush();Check(bool(trace),"Drive trace write failed");};
  row();
  for(const auto& a:drive.frames){auto f=model.Controls(a.target);Check(f.start==a.start,"Replay frame clock mismatch");
    for(auto& c:f.cylinders){const auto& v=model.Network().volumes[model.CylinderIndex(c.cylinder)];
      Check(std::abs(v.volume/a.cylinders.at(c.cylinder).volume[0]-1.)<1e-12,"Replay cylinder volume mismatch");c.endVolume=a.cylinders.at(c.cylinder).volume[4];}
    for(auto& o:f.openings)if(drive.frames.front().valves.count(o.node)){const auto& v=a.valves.at(o.node);o.forwardArea=v.af[2];o.reverseArea=v.ar[2];}
    ApplyStaticControls(f,model,in);model.Advance(f,cfl);
    const auto& g=model.Network();const auto q=g.Total();
    if(full){Check(g.reservoirs.empty(),"Unexpected full-network reservoir");for(double x:g.external)Check(x==0.,"Unexpected full-network external flux");}
    for(unsigned j=0;j<9;++j)if(j!=1)budget=std::max(budget,std::abs(static_cast<double>(q[j]-initial[j]-g.external[j]-(j==2?g.work:0.)))/(j==2?energyScale:massScale));
    Check(budget<2e-8,"Driven intake budget failure");row();
  }
  const auto& g=model.Network();Check(g.time==drive.target,"Driven target mismatch");
  std::cout<<std::setprecision(17)<<"{\"passed\":true,\"target_s\":"<<g.time<<",\"steps\":"<<g.steps<<",\"frames\":"<<drive.frames.size()
    <<",\"max_budget_relative\":"<<budget<<",\"probe_control_error\":"<<drive.probeError<<",\"external_mass_kg\":"<<g.external[0]<<",\"external_energy_j\":"<<g.external[2]
    <<",\"pipe_count\":"<<g.pipes.size()<<",\"reservoir_count\":"<<g.reservoirs.size()<<",\"shared_volume_count\":"<<volumeCount
    <<",\"active_mass_kg\":"<<massScale<<",\"active_energy_j\":"<<energyScale
#ifdef THERMAL_REPLAY_RESULT_FIELDS
    THERMAL_REPLAY_RESULT_FIELDS
#endif
    <<",\"import_pressure_rebase\":"<<metrics.pressureRebase<<",\"import_energy_rebase_j\":"<<metrics.energyRebase<<",\"import_geometry_mass_difference_kg\":"<<metrics.nativeGeometryDifference
    <<",\"work_j\":"<<g.work<<",\"elapsed_s\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count()<<",\"pressure_pa\":[";
  for(int id=1;id<=6;++id){if(id>1)std::cout<<',';const auto& v=g.volumes[model.CylinderIndex(id)];std::cout<<RecoverCell(v.q,v.volume).gas.pressure;}std::cout<<"]}\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
