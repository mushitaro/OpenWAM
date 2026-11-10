#pragma once
#include "checkpoint_v3.h"
#include <sstream>
#include <iterator>
using namespace OpenWAMThermalReference;
struct CylinderCycle {EngineCycleState charge{};int64_t ordinal=-1;double tdc=0.,nextIvc=0.;double totalFuel=0.,totalEnthalpy=0.,totalSensible=0.;};
struct CycleState {std::array<CylinderCycle,6> cylinders{};uint64_t frame=0,cycle=0;double shaftLoss=0.;};
inline void Dose(ThermalDuctNetwork& g,CycleState& cs,unsigned id,double absoluteAngle){
 auto c=cs.cylinders[id];auto v=g.volumes.at(7+id);auto s=g.sources.at(id);
 const double nextTdc=720.*std::ceil(absoluteAngle/720.);if(c.charge.fuelDelivered&&nextTdc<=c.tdc)throw std::domain_error("Duplicate or backwards fuel event");
 s.ivcVolume=v.volume;s.ivcPressure=RecoverCell(v.q,v.volume).gas.pressure;s.trappedAir=v.q[3]/.233;
 c.charge={};DeliverMepCharge(v.q,v.volume,MepFuelDose(s.trappedAir,1.),333.15,c.charge);++c.ordinal;
 c.tdc=nextTdc;c.totalFuel+=c.charge.dose;c.totalEnthalpy+=c.charge.fuelEnthalpy;c.totalSensible+=c.charge.fuelSensibleEnergy;
 cs.cylinders[id]=c;g.volumes[7+id]=v;g.sources[id]=s;
}
inline void SaveCycle(const std::string& path,const ThermalDuctNetwork& g,const CycleState& s){
 using namespace EngineCheckpoint;if(std::filesystem::exists(path))throw std::runtime_error("Refuse overwrite");
 const auto part=path+".graph";Save(part,g,0.,s.frame,{});std::ifstream input(part,std::ios::binary);std::string bytes((std::istreambuf_iterator<char>(input)),{});input.close();
 std::ofstream f(path+".pending",std::ios::binary);Put(f,uint64_t(0x4359434c45303031ULL));Put(f,uint64_t(bytes.size()));f.write(bytes.data(),bytes.size());Put(f,s.frame);Put(f,s.cycle);Put(f,s.shaftLoss);
 for(const auto& c:s.cylinders){Put(f,c.charge.fuelDelivered);Put(f,c.charge.dose);Put(f,c.charge.fuelSensibleEnergy);Put(f,c.charge.fuelEnthalpy);Put(f,c.charge.mechanicalLoss);Put(f,c.ordinal);Put(f,c.tdc);Put(f,c.nextIvc);Put(f,c.totalFuel);Put(f,c.totalEnthalpy);Put(f,c.totalSensible);}
 f.flush();if(!f)throw std::runtime_error("Cycle checkpoint flush failed");f.close();std::filesystem::rename(path+".pending",path);std::filesystem::remove(part);
}
inline ThermalDuctNetwork LoadCycle(const std::string& path,CycleState& s){
 using namespace EngineCheckpoint;std::ifstream f(path,std::ios::binary);uint64_t magic,n;Get(f,magic);if(magic!=0x4359434c45303031ULL)throw std::runtime_error("Invalid cycle format");Get(f,n);if(n>100000000)throw std::runtime_error("Invalid graph length");std::string bytes(n,'\0');f.read(&bytes[0],n);if(!f)throw std::runtime_error("Truncated cycle graph");
 // Unique parser staging file; no prior output is overwritten.
 auto part=path+".decode";if(std::filesystem::exists(part))throw std::runtime_error("Decode path exists");{std::ofstream o(part,std::ios::binary);o.write(bytes.data(),n);}
 double b;uint64_t frame;EngineCycleState ignored;ThermalDuctNetwork g;try{g=Load(part,b,frame,ignored);}catch(...){std::filesystem::remove(part);throw;}std::filesystem::remove(part);
 Get(f,s.frame);Get(f,s.cycle);Get(f,s.shaftLoss);for(auto& c:s.cylinders){Get(f,c.charge.fuelDelivered);Get(f,c.charge.dose);Get(f,c.charge.fuelSensibleEnergy);Get(f,c.charge.fuelEnthalpy);Get(f,c.charge.mechanicalLoss);Get(f,c.ordinal);Get(f,c.tdc);Get(f,c.nextIvc);Get(f,c.totalFuel);Get(f,c.totalEnthalpy);Get(f,c.totalSensible);}
 if(f.peek()!=std::char_traits<char>::eof()||s.frame!=frame)throw std::runtime_error("Cycle checkpoint mismatch");return g;
}
