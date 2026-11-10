// Dynamic Builder adapter. Historical cycle_run.cpp remains byte-for-byte intact.
#include "sources/Source/Engine/ThermalIntakeAdapter.h"
#include "cycle_state.h"
#include <iostream>
#include <iomanip>
#include <chrono>
#include <map>
using namespace OpenWAMThermalReference;
namespace {
constexpr double pi=3.14159265358979323846;
void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
double mod(double a){a=std::fmod(a,720.);return a<0?a+720.:a;}
// Same monotone Hermite construction as Source/Math_wam/Math_wam.cpp.
struct Table {
 std::vector<double> x,y,d;
 void init(){
  require(x.size()==y.size()&&x.size()>=2,"Invalid table");d.resize(x.size());
  for(unsigned i=1;i<x.size();++i)require(x[i]>x[i-1],"Unordered table");
  auto slope=[&](unsigned i){return (y[i+1]-y[i])/(x[i+1]-x[i]);};
  d.front()=slope(0);d.back()=slope(x.size()-2);
  for(unsigned i=1;i+1<x.size();++i)d[i]=.5*(slope(i-1)+slope(i));
  for(unsigned i=0;i+1<x.size();++i){double s=slope(i);if(s==0){d[i]=d[i+1]=0;}else{
   double a=d[i]/s,b=d[i+1]/s;if(a*a+b*b>9){double t=3/std::sqrt(a*a+b*b);d[i]=t*a*s;d[i+1]=t*b*s;}}}
 }
 double at(double v)const{
  if(v<=x.front())return y.front();if(v>=x.back())return y.back();
  auto i=std::upper_bound(x.begin(),x.end(),v)-x.begin()-1;
  double h=x[i+1]-x[i],t=(v-x[i])/h,t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*y[i]+h*(t3-2*t2+t)*d[i]+(-2*t3+3*t2)*y[i+1]+h*(t3-t2)*d[i+1];
 }
};
struct Valve {
 int kind=0; double diameter=0,open=0,duration=0,position=0,forward=0,reverse=0;Table lift,cd,rev;
 std::pair<double,double> areas(double angle,double bore)const{
  if(kind==0)return {forward*bore,reverse*bore};
  double a=position;
  if(kind==1){double t=mod(angle-open);if(t<=0||t>=duration)return {0,0};a=std::max(0.,lift.at(t));}
  double ref=pi*diameter*diameter/4;
  double f=cd.at(a)*ref,r=rev.at(a)*ref;
  require(std::isfinite(f)&&std::isfinite(r)&&f>=0&&r>=0&&f<=bore&&r<=bore,"Valve effective area exceeds connected bore");
  return {f,r};
 }
};
Table uniform(std::istream& in,unsigned n,double step){
 require(n>=2&&n<100000&&step>0,"Invalid table extent");Table t;
 for(unsigned i=0;i<n;++i){double y;in>>y;require(bool(in)&&std::isfinite(y)&&y>=0,"Invalid table value");t.x.push_back(i*step);t.y.push_back(y);}t.init();return t;
}
}
int main(int argc,char** argv){try{
 require(argc==6,"usage: corrected_ve_builder input_dir target_seconds output_prefix workers cfl");
 const std::string root=argv[1],prefix=argv[3];double target=std::stod(argv[2]),cfl=std::stod(argv[5]);
 unsigned workers=std::stoul(argv[4]);auto clock=std::chrono::steady_clock::now();
 std::ifstream input(root+"/controls.txt");std::string magic;input>>magic;require(magic=="BUILDER_FV_V1","Invalid Builder controls");
 double rpm,pressure,temp,bore,stroke,rod,cr,burnStart,burnDuration,shape,a,phi,efficiency;
 input>>rpm>>pressure>>temp>>bore>>stroke>>rod>>cr>>burnStart>>burnDuration>>shape>>a>>phi>>efficiency;
 require(input&&rpm>0&&rpm<=20000&&bore>0&&stroke>0&&rod>stroke/2&&cr>1&&cfl>0&&cfl<=.0375,"Invalid operating conditions");
 double period=120/rpm,speed=6*rpm,vd=pi*bore*bore*stroke/4,clearance=vd/(cr-1),pistonArea=pi*bore*bore/4;
 require(std::isfinite(target)&&target>=0&&target<=120*period,"Requested interval exceeds finite 120 cycle cap");
 require(efficiency>=0&&efficiency<=1&&phi>0,"Invalid fuel law");
 std::map<int,Valve> valves;unsigned nv;input>>nv;require(nv<10000,"Too many valves");
 for(unsigned i=0;i<nv;++i){int id;Valve v;input>>id>>v.kind;
  if(v.kind==0)input>>v.forward>>v.reverse;
  else if(v.kind==1){unsigned n,m;double step,ds;input>>v.diameter>>n>>step>>v.open;v.duration=(n-1)*step;
   v.lift=uniform(input,n,step);input>>m>>ds;v.cd=uniform(input,m,ds);v.rev=uniform(input,m,ds);
  }else if(v.kind==10){unsigned n;input>>n>>v.diameter;require(n>=2&&n<10000,"Invalid throttle table");
   for(unsigned j=0;j<n;++j){double x,f,r;input>>x>>f>>r;v.cd.x.push_back(x);v.cd.y.push_back(f);v.rev.x.push_back(x);v.rev.y.push_back(r);}v.cd.init();v.rev.init();input>>v.position;
  }else throw std::runtime_error("Unsupported valve");
  require(input&&valves.emplace(id,v).second,"Duplicate or malformed valve");
 }
 Composition air{{.233,0,0,.755,.012,0}};Reservoir ambient{pressure,temp,air};
 std::array<double,6> phase{{0,240,480,120,600,360}},closure{};std::array<bool,6> hasClosure{};
 auto volume=[&](double angle){double t=angle*pi/180,r=stroke/2;return clearance+pistonArea*(r*(1-std::cos(t))+rod-std::sqrt(rod*rod-r*r*std::sin(t)*std::sin(t)));};
 std::vector<ThermalIntakeAdapter::InitialCylinder> cylinders;
 for(unsigned i=0;i<6;++i)cylinders.push_back({int(i+1),volume(phase[i]),ambient});
 std::ifstream geometry(root+"/geometry.txt");auto adapter=ThermalIntakeAdapter::Read(geometry,ambient,cylinders);auto g=adapter.Network();
 std::array<unsigned,6> ci;for(unsigned i=0;i<6;++i)ci[i]=adapter.CylinderIndex(i+1);
 std::set<unsigned> removed;unsigned count;input>>count;
 for(unsigned i=0;i<count;++i){int id,isAmbient;double p,t;input>>id>>isAmbient>>p>>t;unsigned vi=adapter.VolumeIndex(id);auto& v=g.volumes[vi];v.q=InventoryQ(p,t,0,air,v.volume);
  if(isAmbient){ThermalQ density=InventoryQ(p,t,0,air,1.);unsigned ri=g.reservoirs.size();g.reservoirs.push_back(density);removed.insert(vi);
   for(auto& pipe:g.pipes)for(auto& end:pipe.ends)if(end.volume==int(vi)){end.volume=-1;end.reservoir=ri;}}
 }
 // Remove reservoir inventory, remapping all cylinder and boundary references.
 std::vector<int> remap(g.volumes.size(),-1);std::vector<ThermalDuctNetwork::Volume> volumes;
 for(unsigned i=0;i<g.volumes.size();++i)if(!removed.count(i)){remap[i]=volumes.size();volumes.push_back(g.volumes[i]);}
 for(auto& p:g.pipes)for(auto& e:p.ends)if(e.volume>=0)e.volume=remap.at(e.volume);
 for(auto& i:ci)i=remap.at(i);g.volumes=std::move(volumes);
 CycleState cs;g.workerCount=workers;
 for(unsigned i=0;i<6;++i){NetworkSource s;s.cell=ci[i];s.woschni=true;s.wallTemperature=333.15;s.rpm=rpm;s.bore=bore;s.stroke=stroke;s.clearance=clearance;s.pistonArea=pistonArea;s.headArea=1.1*pistonArea;
  s.ivcPressure=pressure;s.ivcVolume=g.volumes[ci[i]].volume;s.trappedAir=g.volumes[ci[i]].q[3]/air[0];g.sources.push_back(s);}
 input>>count;require(count==g.pipes.size(),"Incomplete pipe initialization");std::vector<double> roughness(6,0);
 for(unsigned i=0;i<count;++i){int id;double p,t,rug;input>>id>>p>>t>>rug;auto index=adapter.PipeIndex(id);auto& pipe=g.pipes[index];require(rug>=0,"Negative roughness");
  for(unsigned j=0;j<pipe.q.size();++j){pipe.q[j]=InventoryQ(p,t,0,air,pipe.cellVolume[j]);NetworkSource s;s.pipe=index;s.cell=j;s.diameter=std::sqrt(4*.5*(pipe.faceArea[j]+pipe.faceArea[j+1])/pi);g.sources.push_back(s);roughness.push_back(rug/1000);}
 }
 require(bool(input),"Truncated controls");std::string trailing;require(!(input>>trailing),"Trailing controls");
 for(const auto& entry:adapter.Nodes()){const auto& node=entry.second;if(node.kind==7){const auto& v=valves.at(node.valve);require(v.kind==1&&v.duration>0&&v.duration<720,"Missing intake timing");
   double close=mod(v.open+v.duration);unsigned i=node.target-1;require(!hasClosure[i]||closure[i]==close,"Asymmetric intake closures unsupported");closure[i]=close;hasClosure[i]=true;}}
 for(unsigned i=0;i<6;++i){require(hasClosure[i],"Missing IVC event");double next=mod(closure[i]-phase[i]);cs.cylinders[i].nextIvc=(next==0?720:next)/speed;
  // A uniform ambient TDC seed would expand below the NASA 200 K domain
  // before the first intake event. For closed cylinders use a declared
  // motored polytropic seed anchored at ambient IVC, never a 3900 rpm state.
  bool open=false;for(const auto& entry:adapter.Nodes()){const auto& n=entry.second;if((n.kind==7||n.kind==8)&&n.target==int(i+1)){
   const auto& valve=valves.at(n.valve);double th=mod(phase[i]-valve.open);open=open||(th>0&&th<valve.duration);}}
  if(!open){auto& v=g.volumes[ci[i]];double anchor=volume(closure[i]),ratio=anchor/v.volume;
   v.q=InventoryQ(pressure*std::pow(ratio,1.36),temp*std::pow(ratio,.36),0,air,v.volume);
   auto& s=g.sources[i];s.ivcPressure=pressure;s.ivcVolume=anchor;s.trappedAir=v.q[3]/air[0];
  }
 }
 auto controls=[&](double time){for(const auto& entry:adapter.Nodes()){const auto& n=entry.second;if(!n.valve)continue;
   double angle=n.kind==7||n.kind==8?mod(phase.at(n.target-1)+speed*time):0;
   auto e=n.ends.front();auto& pipe=g.pipes[e.first];double area=e.second?pipe.faceArea.back():pipe.faceArea.front();
   if(n.kind==10){auto e2=n.ends.at(1);const auto& p2=g.pipes[e2.first];area=std::min(area,e2.second?p2.faceArea.back():p2.faceArea.front());}
   auto ar=valves.at(n.valve).areas(angle,area);
   if(n.kind==10){g.junctions[n.junction].forwardArea=ar.first;g.junctions[n.junction].reverseArea=ar.second;}
   else {pipe.ends[e.second].forwardArea=ar.first;pipe.ends[e.second].reverseArea=ar.second;}
  }};
 // Validate the entire control cycle even for a short fluid regression.
 for(unsigned k=0;k<=2880;++k)controls(k*.25/speed);
 controls(0);g.stageAreaControl=controls;g.Validate();
 if(target==0){double throttleArea=0;for(const auto& n:adapter.Nodes())if(n.second.kind==10)throttleArea+=g.junctions[n.second.junction].forwardArea;
  std::cout<<std::setprecision(17)<<"{\"controls_pass\":true,\"sampled_crank_angles\":2881,\"pipes\":"<<g.pipes.size()<<",\"volumes\":"<<g.volumes.size()<<",\"throttle_area_m2\":"<<throttleArea<<",\"period_s\":"<<period<<"}\n";return 0;}
 const auto initial=g.Total();double massScale=initial[0],energyScale=std::abs(initial[2]),worst=0;
 const double reference=InventoryQ(pressure,temp,0,air,vd)[0];
 std::ofstream csv(prefix+".csv");csv<<std::setprecision(17)<<"time,budget";for(unsigned i=1;i<=6;++i)csv<<",p"<<i<<",T"<<i<<",V"<<i<<",ivc_air"<<i<<",ivc_count"<<i;csv<<'\n';
 auto row=[&](){csv<<g.time<<','<<worst;for(unsigned i=0;i<6;++i){const auto& v=g.volumes[ci[i]];auto gas=RecoverCell(v.q,v.volume).gas;csv<<','<<gas.pressure<<','<<gas.temperature<<','<<v.volume<<','<<g.sources[i].trappedAir<<','<<cs.cylinders[i].ordinal+1;}csv<<'\n';};
 row();SaveCycle(prefix+".initial.bin",g,cs);
 while(g.time<target){
  double end=std::min(target,g.time+std::min(2.5e-6,1./speed));
  for(unsigned i=0;i<6;++i){end=std::min(end,cs.cylinders[i].nextIvc);
   for(double angle:{180.,360.,540.,720.,burnStart,burnStart+burnDuration}){
    double event=(angle+720*std::floor((phase[i]+speed*g.time-angle)/720)-phase[i])/speed;
    if(event<=g.time)event+=period;if(event>g.time)end=std::min(end,event);
   }}
  double dt=end-g.time;require(dt>0,"Nonadvancing Builder frame");
  for(unsigned i=0;i<6;++i){auto& s=g.sources[i];auto& c=cs.cylinders[i];double aa=phase[i]+speed*g.time-c.tdc,bb=phase[i]+speed*end-c.tdc;
   s.fuelRate=c.charge.fuelDelivered?c.charge.dose*efficiency*(WiebeFraction(bb,burnStart,burnDuration,shape,a)-WiebeFraction(aa,burnStart,burnDuration,shape,a))/dt:0;
   g.volumes[ci[i]].dvolume=(volume(phase[i]+speed*end)-g.volumes[ci[i]].volume)/dt;
  }
  while(g.time<end){controls(g.time);
   for(unsigned j=6;j<g.sources.size();++j){auto& s=g.sources[j];const auto& p=g.pipes[s.pipe];auto gas=RecoverCell(p.q[s.cell],p.cellVolume[s.cell]).gas;
    double mu=1.716e-5*std::pow(gas.temperature/273.15,1.5)*(273.15+110.4)/(gas.temperature+110.4);
    double re=gas.rho*std::abs(gas.velocity)*s.diameter/mu;
    s.darcy=re<1e-8?0:(re<2300?64/re:1/std::pow(-1.8*std::log10(std::pow(roughness[j]/s.diameter/3.7,1.11)+6.9/re),2));
   }
   double proposed=std::min(g.StableDt(cfl),end-g.time),next=std::min(end,g.time+proposed);if(next-g.time>proposed)next=std::nextafter(next,g.time);
   require(next>g.time,"Unrepresentable CFL step");double step=next-g.time;
   for(unsigned i=0;i<6;++i){double th=mod(phase[i]+speed*(g.time+.5*step));g.sources[i].cw1=th>180&&th<540?6.18:2.28;g.sources[i].exhaustStroke=th>180&&th<360;}
   g.Step(step);
  }
  for(unsigned i=0;i<6;++i){auto& v=g.volumes[ci[i]];v.dvolume=0;require(std::abs(v.volume/volume(phase[i]+speed*end)-1)<1e-12,"Builder volume end mismatch");
   auto& c=cs.cylinders[i];if(g.time==c.nextIvc){auto& s=g.sources[i];s.ivcVolume=v.volume;s.ivcPressure=RecoverCell(v.q,v.volume).gas.pressure;s.trappedAir=v.q[3]/air[0];
    c.charge={};DeliverMepCharge(v.q,v.volume,MepFuelDose(s.trappedAir,phi),333.15,c.charge);++c.ordinal;c.tdc=phase[i]+speed*g.time+mod(-closure[i]);
    c.totalFuel+=c.charge.dose;c.totalSensible+=c.charge.fuelSensibleEnergy;c.totalEnthalpy+=c.charge.fuelEnthalpy;c.nextIvc+=period;
   }}
  ++cs.frame;cs.cycle=uint64_t(g.time/period);cs.shaftLoss+=MechanicalLossPower(rpm,6*vd)*dt;
  auto q=g.Total();double fuel=0,sensible=0;for(const auto& c:cs.cylinders){fuel+=c.totalFuel;sensible+=c.totalSensible;}
  for(unsigned j=0;j<9;++j)if(j!=1){long double delta=q[j]-initial[j]-g.external[j];if(j==0||j==8)delta-=fuel;
   if(j==2)delta-=g.work+g.sourceLedger.heat+g.sourceLedger.reactionEnergy+sensible;
   if(j>=3)delta-=g.sourceLedger.species[j-3];worst=std::max(worst,std::abs(double(delta))/(j==2?energyScale:massScale));}
  require(worst<=2e-8,"Builder conservation failed");row();if(cs.frame%100==0)csv.flush();
 }
 SaveCycle(prefix+".final.bin",g,cs);
 // Read back the complete state, not merely file existence.
 CycleState loaded;auto checked=LoadCycle(prefix+".final.bin",loaded);checked.Validate();require(checked.Total()==g.Total()&&loaded.frame==cs.frame,"Checkpoint readback mismatch");
 SaveCycle(prefix+".roundtrip.bin",checked,loaded);
 double fuelDelivered=0;for(const auto& c:cs.cylinders)fuelDelivered+=c.totalFuel;
 std::cout<<std::setprecision(17)<<"{\"time\":"<<g.time<<",\"rpm\":"<<rpm<<",\"frames\":"<<cs.frame<<",\"budget\":"<<worst<<",\"reference_air_mass_kg\":"<<reference<<",\"burned_fuel_kg\":"<<g.sourceLedger.burnedFuel<<",\"fuel_delivered_kg\":"<<fuelDelivered<<",\"source_heat_j\":"<<g.sourceLedger.heat<<",\"gas_work_j\":"<<g.work<<",\"elapsed_s\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-clock).count()<<",\"cylinders\":[";
 for(unsigned i=0;i<6;++i){if(i)std::cout<<',';auto gas=RecoverCell(g.volumes[ci[i]].q,g.volumes[ci[i]].volume).gas;bool refreshed=cs.cylinders[i].ordinal>=0;
  std::cout<<"{\"cylinder\":"<<i+1<<",\"ivc_refreshed\":"<<(refreshed?"true":"false")<<",\"ivc_count\":"<<cs.cylinders[i].ordinal+1<<",\"ivc_air_kg\":";
  if(refreshed)std::cout<<g.sources[i].trappedAir;else std::cout<<"null";
  std::cout<<",\"ve_oxygen_percent\":";if(refreshed)std::cout<<100*g.sources[i].trappedAir/reference;else std::cout<<"null";
  std::cout<<",\"pressure_pa\":"<<gas.pressure<<",\"temperature_k\":"<<gas.temperature<<'}';}
 std::cout<<"]}\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
