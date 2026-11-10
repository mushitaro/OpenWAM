#include "sources/tests/ThermalDriveFixture.h"
#include "checkpoint.h"
#include "cycle_state.h"
#include <iostream>
#include <iomanip>
#include <chrono>
using namespace OpenWAMNativeIntakeFixture;
int main(int argc,char** argv){try{
 Check(argc==8,"root E/F target cfl prefix resume_or_seed workers");std::string root=argv[1],cond=argv[2],prefix=argv[5],resume=argv[6];double target=std::stod(argv[3]),cfl=std::stod(argv[4]);unsigned workers=std::stoul(argv[7]);auto clock=std::chrono::steady_clock::now();
 const auto in=Read((root+"/inputs/ports.txt").c_str(),(root+"/inputs/network.txt").c_str());const double period=120./3900.;auto drive=ReadDrive((root+"/native_cycle/thermal_drive_cycle_"+(cond=="E"?"2_5":"1_25")+"us.txt").c_str(),in,period);
 // A full-cycle request and its saved input endpoint can differ by one ULP.
 // Resolve only exact nominal whole-cycle requests; no tolerance is widened.
 const double requestedTarget=target;
 const double requestedCycle=std::round(requestedTarget/period);
 if(requestedCycle>=1. && requestedTarget==requestedCycle*period && drive.frames.back().target==period)
   target=(requestedCycle-1.)*period+drive.frames.back().target;
 ImportMetrics metrics;auto adapter=Build((root+"/inputs/geometry.txt").c_str(),in,metrics,true);adapter.SetExperimentalVolumeFaces({5,6});adapter.RemoveDiagnosticHStorage();
 std::array<double,6> phase{},closure{};for(unsigned i=0;i<6;++i)phase[i]=drive.frames.front().cylinders.at(i+1).angle[0];
 for(const auto& a:drive.frames){std::array<bool,6> open0{},open1{};for(const auto& kv:a.valves)if(!kv.second.exhaust){unsigned i=kv.second.cylinder-1;open0[i]=open0[i]||kv.second.af[0]>0||kv.second.ar[0]>0;open1[i]=open1[i]||kv.second.af[4]>0||kv.second.ar[4]>0;}for(unsigned i=0;i<6;++i)if(open0[i]&&!open1[i]){Check(closure[i]==0,"Duplicate IVC");closure[i]=a.target;}}
 for(auto t:closure)Check(t>0,"Missing IVC");
 ThermalDuctNetwork g;CycleState cs;
 if(resume=="seed"||resume=="hot"){
 double b;uint64_t f;EngineCycleState hotCharge;
 if(resume=="seed")g=HCheckpoint::Load(root+"/../c_engine_laws_20261013/inputs/"+cond+"_0.000000.bin",b,f);
 else {g=EngineCheckpoint::Load(root+"/inputs/fired_C1_"+cond+".bin",b,f,hotCharge,true);cs.frame=f;}
 const auto oldSources=g.sources;g.workerCount=workers;
 for(unsigned j:{0u,6u}){const auto v=g.volumes[j];ThermalQ density=v.q;for(auto& x:density)x/=v.volume;unsigned ri=g.reservoirs.size();g.reservoirs.push_back(density);unsigned ends=0;for(auto& p:g.pipes)for(unsigned side=0;side<2;++side)if(p.ends[side].volume==int(j)){auto& e=p.ends[side];e.volume=-1;e.reservoir=ri;e.experimentalFaceReconstruction=false;e.forwardArea=e.reverseArea=side?p.faceArea.back():p.faceArea.front();++ends;}Check(ends>0,"Disconnected boundary conversion");}
 g.sources.clear();for(unsigned i=0;i<6;++i){auto& v=g.volumes[7+i];NetworkSource s;s.cell=7+i;s.woschni=true;s.wallTemperature=333.15;s.clearance=3.14159265358979323846*.087*.087*.091/4/10.5;s.ivcPressure=RecoverCell(v.q,v.volume).gas.pressure;s.ivcVolume=v.volume;s.trappedAir=v.q[3]/.233;g.sources.push_back(s);cs.cylinders[i].nextIvc=closure[i];while(cs.cylinders[i].nextIvc<=g.time)cs.cylinders[i].nextIvc+=period;}
 // Explicit startup charge only for C1, matching its closed initial state. Other cylinders wait for measured closure.
 if(resume=="seed")Dose(g,cs,0,phase[0]);else {g.sources[0]=oldSources.at(0);auto& c=cs.cylinders[0];c.charge=hotCharge;c.ordinal=0;c.tdc=720;c.totalFuel=hotCharge.dose;c.totalEnthalpy=hotCharge.fuelEnthalpy;c.totalSensible=hotCharge.fuelSensibleEnergy;}
 }else{g=LoadCycle(resume,cs);Check(g.workerCount==workers,"Worker mismatch on restart");}
 g.Validate();const auto base=g;const auto initial=g.Total();double fuel0=0,eh0=0,es0=0;for(auto c:cs.cylinders){fuel0+=c.totalFuel;eh0+=c.totalEnthalpy;es0+=c.totalSensible;}
 double massScale=0,energyScale=0;for(unsigned i=0;i<g.volumes.size();++i)if(i!=0&&i!=6){massScale+=g.volumes[i].q[0];energyScale+=std::abs(g.volumes[i].q[2]);}for(const auto& p:g.pipes)for(auto q:p.q){massScale+=q[0];energyScale+=std::abs(q[2]);}
 std::ofstream out(prefix+".csv");out<<std::setprecision(17)<<"time";for(int i=1;i<=6;++i)out<<",p"<<i<<",T"<<i;for(int id:{1,2,3,4,7,8,9})out<<",volume"<<id<<"_pa";for(const auto& kv:in.ports)out<<",port"<<kv.first<<"_pa";
 std::vector<std::pair<unsigned,unsigned>> hEnds;for(unsigned k=0;k<g.pipes.size();++k)for(unsigned side=0;side<2;++side){const auto& e=g.pipes[k].ends[side];if(e.junction>=int(g.junctions.size())-2)hEnds.push_back({k,side});}
 Check(hEnds.size()==6,"H endpoint mapping");for(auto e:hEnds)out<<",h_pipe"<<e.first+1<<"_"<<e.second<<"_pa";
 for(int i=0;i<6;++i)out<<",c"<<i+1<<"_fuel_mass,c"<<i+1<<"_burned,c"<<i+1<<"_heat";
 for(unsigned i=0;i<6;++i)out<<",c"<<i+1<<"_dose,c"<<i+1<<"_ordinal,c"<<i+1<<"_tdc";out<<",budget,external_mass,external_energy,heat,burned,work,fuel,shaft_loss\n";
 double worst=0.;auto row=[&](){out<<g.time;for(int i=0;i<6;++i){auto s=RecoverCell(g.volumes[7+i].q,g.volumes[7+i].volume).gas;out<<','<<s.pressure<<','<<s.temperature;}double fuel=0;for(auto c:cs.cylinders)fuel+=c.totalFuel;for(int id:{1,2,3,4,7,8,9}){const auto& v=g.volumes[adapter.VolumeIndex(id)];out<<','<<RecoverCell(v.q,v.volume).gas.pressure;}
 for(const auto& kv:in.ports){auto e=adapter.Nodes().at(kv.first).ends[0];const auto& pp=g.pipes[e.first];auto j=e.second?pp.q.size()-1:0;out<<','<<RecoverCell(pp.q[j],pp.cellVolume[j]).gas.pressure;}
 for(auto e:hEnds){const auto& pp=g.pipes[e.first];auto j=e.second?pp.q.size()-1:0;out<<','<<RecoverCell(pp.q[j],pp.cellVolume[j]).gas.pressure;}
 for(unsigned i=0;i<6;++i)out<<','<<g.volumes[7+i].q[8]<<','<<(g.cellSourceLedgers.empty()?0:g.cellSourceLedgers[i].burnedFuel)<<','<<(g.cellSourceLedgers.empty()?0:g.cellSourceLedgers[i].heat);
 for(const auto& c:cs.cylinders)out<<','<<c.charge.dose<<','<<c.ordinal<<','<<c.tdc;out<<','<<worst<<','<<g.external[0]<<','<<g.external[2]<<','<<g.sourceLedger.heat<<','<<g.sourceLedger.burnedFuel<<','<<g.work<<','<<fuel<<','<<cs.shaftLoss<<'\n';out.flush();};row();SaveCycle(prefix+".initial.bin",g,cs);
 while(g.time<target-1e-16){if(g.time==cs.cycle*period+drive.frames.back().target || std::abs(g.time-(cs.cycle+1)*period)<1e-16)++cs.cycle;bool advanced=false;for(const auto& a:drive.frames){const double start=(a.start==0. && cs.cycle>0 ? (cs.cycle-1)*period+drive.frames.back().target : cs.cycle*period+a.start),end=cs.cycle*period+a.target;if(end<=g.time)continue;if(end>target+1e-16)break;Check(std::abs(g.time-start)<1e-14,"Clock mismatch");double dt=end-start;
 for(unsigned i=0;i<6;++i){auto& s=g.sources[i];const double aa=phase[i]+23400*start,bb=phase[i]+23400*end;const double theta=std::fmod(.5*(aa+bb),720.);s.cw1=theta>180&&theta<540?6.18:2.28;s.exhaustStroke=theta>180&&theta<360;s.fuelRate=cs.cylinders[i].charge.fuelDelivered?WiebeFuelRate(aa-cs.cylinders[i].tdc,bb-cs.cylinders[i].tdc,dt,cs.cylinders[i].charge.dose):0.;g.volumes[7+i].dvolume=(a.cylinders.at(i+1).volume[4]-g.volumes[7+i].volume)/dt;}
 for(const auto& kv:a.valves){auto e=adapter.Nodes().at(kv.first).ends.at(0);g.pipes[e.first].ends[e.second].forwardArea=kv.second.af[2];g.pipes[e.first].ends[e.second].reverseArea=kv.second.ar[2];}
 g.stageAreaControl=[&](double t){const double x=(t-start)/dt;Check(x>=-1e-12&&x<=1+1e-12,"Stage control clock outside frame");
 for(const auto& kv:a.valves){const auto& valve=kv.second;auto e=adapter.Nodes().at(kv.first).ends.at(0);auto area=[&](const std::array<double,5>& z){double value=8.*(x-.5)*(x-.75)*z[1]-16.*(x-.25)*(x-.75)*z[2]+8.*(x-.25)*(x-.5)*z[3];Check(std::isfinite(value)&&value>=0.&&value<=valve.bore,"Interpolated valve area outside domain");return value;};g.pipes[e.first].ends[e.second].forwardArea=area(valve.af);g.pipes[e.first].ends[e.second].reverseArea=area(valve.ar);}};
 while(g.time<end){
   double stop=end;
   for(unsigned i=0;i<6;++i)for(double angle:{180.,360.,540.,720.}){
     const double n=std::floor((phase[i]+23400*g.time-angle)/720.);double event=(angle+720*n-phase[i])/23400.;
     if(event<=g.time)event=(angle+720*(n+1)-phase[i])/23400.;if(event>g.time&&event<stop)stop=event;
   }
   // Resolve prescribed burn support independently of native frame edges.
   for(unsigned i=0;i<6;++i){
     const auto& charge=cs.cylinders[i];
     const double begin=(charge.tdc-23.-phase[i])/23400.,finish=(charge.tdc+37.-phase[i])/23400.;
     if(charge.charge.fuelDelivered){for(double event:{begin,finish})if(event>g.time&&event<stop)stop=event;}
     const double left=std::max(start,begin),right=std::min(end,finish);
     const bool active=charge.charge.fuelDelivered&&right>left&&g.time>=begin&&g.time<finish;
     g.sources[i].fuelRate=active?WiebeFuelRate(phase[i]+23400*start-charge.tdc,phase[i]+23400*end-charge.tdc,dt,charge.charge.dose)*dt/(right-left):0.;
   }
   // Integrate exactly the representable clock interval. Do not round above CFL.
   const double proposed=std::min(g.StableDt(cfl),stop-g.time);
   double next=std::min(stop,g.time+proposed);
   if(next-g.time>proposed)next=std::nextafter(next,g.time);
   const double step=next-g.time;
   Check(step>0. && step<=proposed && next<=stop,"Representable step contract");
   for(unsigned i=0;i<6;++i){double theta=std::fmod(phase[i]+23400*(g.time+.5*step),720.);g.sources[i].cw1=theta>180&&theta<540?6.18:2.28;g.sources[i].exhaustStroke=theta>180&&theta<360;}
   g.Step(step);
 }g.time=end;for(unsigned i=0;i<6;++i){g.volumes[7+i].dvolume=0.;Check(std::abs(g.volumes[7+i].volume/a.cylinders.at(i+1).volume[4]-1.)<1e-12,"Volume end mismatch");if(std::abs(end-cs.cylinders[i].nextIvc)<1e-14){Dose(g,cs,i,phase[i]+23400*end);cs.cylinders[i].nextIvc+=period;}}
 cs.shaftLoss+=MechanicalLossPower(3900,6*3.14159265358979323846*.087*.087*.091/4)*dt;++cs.frame;
 const auto q=g.Total();double fu=0,es=0;for(auto c:cs.cylinders){fu+=c.totalFuel;es+=c.totalSensible;}
 for(unsigned j=0;j<9;++j)if(j!=1){long double d=q[j]-initial[j]-(g.external[j]-base.external[j]);if(j==0||j==8)d-=fu-fuel0;if(j==2)d-=g.work-base.work+g.sourceLedger.heat-base.sourceLedger.heat+g.sourceLedger.reactionEnergy-base.sourceLedger.reactionEnergy+es-es0;if(j>=3)d-=g.sourceLedger.species[j-3]-base.sourceLedger.species[j-3];worst=std::max(worst,std::abs(double(d))/(j==2?energyScale:massScale));}Check(worst<=2e-8,"Cycle conservation failed");row();
 if(cs.frame%10==0)SaveCycle(prefix+".frame_"+std::to_string(cs.frame)+".bin",g,cs);advanced=true;
 }if(g.time>=target-1e-16)break;Check(advanced,"Target is not a saved input endpoint");if(std::abs(g.time-(cs.cycle+1)*period)<1e-14)++cs.cycle;else throw std::runtime_error("Incomplete cycle controls");}
 Check(std::abs(g.time-target)<1e-14,"Target incomplete");SaveCycle(prefix+".final.bin",g,cs);std::cout<<std::setprecision(17)<<"{\"segment_pass\":true,\"time\":"<<g.time<<",\"frames\":"<<cs.frame<<",\"budget\":"<<worst<<",\"elapsed_s\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-clock).count()<<",\"periodic_pass\":false}\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
