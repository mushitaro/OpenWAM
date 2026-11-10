#pragma once
#include "sources/Source/Engine/ThermalDuctNetwork.h"
#include "sources/Source/Engine/ThermalEngineLaws.h"
#include <fstream>
#include <filesystem>
#include <cstdint>
#include <type_traits>
namespace EngineCheckpoint {
using namespace OpenWAMThermalReference;
template<class T>void Put(std::ostream& f,const T& x){static_assert(std::is_trivially_copyable<T>::value,"POD only");f.write(reinterpret_cast<const char*>(&x),sizeof(x));if(!f)throw std::runtime_error("Checkpoint write failed");}
template<class T>void Get(std::istream& f,T& x){static_assert(std::is_trivially_copyable<T>::value,"POD only");f.read(reinterpret_cast<char*>(&x),sizeof(x));if(!f)throw std::runtime_error("Incomplete checkpoint");}
template<class T>void PutVector(std::ostream& f,const std::vector<T>& a){Put(f,uint64_t(a.size()));for(const auto& x:a)Put(f,x);}
template<class T>void GetVector(std::istream& f,std::vector<T>& a){uint64_t n;Get(f,n);if(n>100000)throw std::runtime_error("Invalid checkpoint size");a.resize(size_t(n));for(auto& x:a)Get(f,x);}
inline void Save(const std::string& path,const ThermalDuctNetwork& g,double budget,uint64_t frames,const EngineCycleState& cycle){
 std::ifstream existing(path,std::ios::binary);if(existing.good())throw std::runtime_error("Refuse checkpoint overwrite");
 std::ofstream f(path+".tmp",std::ios::binary);Put(f,uint64_t(0x454e47494e453033ULL));Put(f,budget);Put(f,frames);
 Put(f,uint64_t(g.volumes.size()));for(const auto& v:g.volumes){Put(f,v.q);Put(f,v.volume);Put(f,v.dvolume);}
 Put(f,uint64_t(g.pipes.size()));for(const auto& p:g.pipes){PutVector(f,p.q);PutVector(f,p.cellVolume);PutVector(f,p.faceArea);for(const auto& e:p.ends){Put(f,e.volume);Put(f,e.forwardArea);Put(f,e.reverseArea);Put(f,e.junction);Put(f,e.reservoir);Put(f,e.experimentalFaceReconstruction);}Put(f,p.impulse);}
 PutVector(f,g.reservoirs);Put(f,g.external);Put(f,uint64_t(g.junctions.size()));for(const auto& j:g.junctions){Put(f,j.straight);Put(f,j.valve);Put(f,j.forwardArea);Put(f,j.reverseArea);Put(f,j.areaChange);}
 Put(f,g.time);Put(f,g.work);Put(f,g.maxJunctionMassResidual);Put(f,g.maxJunctionMassCorrection);Put(f,g.junctionEntropyIntegral);Put(f,g.maxAreaChangeMomentumResidual);Put(f,g.steps);Put(f,g.secondOrder);Put(f,g.workerCount);Put(f,g.experimentalVolumeFaceReconstruction);

 Put(f,uint32_t(4)); // Immutable common elemental EOS / 44 MJ/kg gauge ID.
 Put(f,uint64_t(g.sources.size()));for(const auto& s:g.sources){Put(f,s.pipe);Put(f,s.cell);Put(f,s.conductance);Put(f,s.wallTemperature);Put(f,s.fuelRate);Put(f,s.darcy);Put(f,s.diameter);Put(f,s.woschni);Put(f,s.rpm);Put(f,s.bore);Put(f,s.stroke);Put(f,s.clearance);Put(f,s.pistonArea);Put(f,s.headArea);Put(f,s.ivcPressure);Put(f,s.ivcVolume);Put(f,s.trappedAir);Put(f,s.cw1);Put(f,s.exhaustStroke);}
 Put(f,g.sourceLedger.heat);Put(f,g.sourceLedger.reactionEnergy);Put(f,g.sourceLedger.burnedFuel);Put(f,g.sourceLedger.frictionImpulse);Put(f,g.sourceLedger.species);
 PutVector(f,g.boundaryLedgers);Put(f,uint64_t(g.cellSourceLedgers.size()));for(const auto& s:g.cellSourceLedgers){Put(f,s.heat);Put(f,s.reactionEnergy);Put(f,s.burnedFuel);Put(f,s.frictionImpulse);Put(f,s.species);}
 Put(f,cycle.fuelDelivered);Put(f,cycle.dose);Put(f,cycle.fuelSensibleEnergy);Put(f,cycle.fuelEnthalpy);Put(f,cycle.mechanicalLoss);
 f.flush();if(!f)throw std::runtime_error("Checkpoint flush failed");f.close();std::filesystem::rename(path+".tmp",path);
}
inline ThermalDuctNetwork Load(const std::string& path,double& budget,uint64_t& frames,EngineCycleState& cycle,bool legacy=false){
 std::ifstream f(path,std::ios::binary);uint64_t magic,n;Get(f,magic);if(magic!=0x454e47494e453033ULL)throw std::runtime_error("Snapshot format mismatch");Get(f,budget);Get(f,frames);ThermalDuctNetwork g;
 Get(f,n);if(n>100000)throw std::runtime_error("Invalid volume count");g.volumes.resize(size_t(n));for(auto& v:g.volumes){Get(f,v.q);Get(f,v.volume);Get(f,v.dvolume);}
 Get(f,n);if(n>100000)throw std::runtime_error("Invalid pipe count");g.pipes.resize(size_t(n));for(auto& p:g.pipes){GetVector(f,p.q);GetVector(f,p.cellVolume);GetVector(f,p.faceArea);for(auto& e:p.ends){Get(f,e.volume);Get(f,e.forwardArea);Get(f,e.reverseArea);Get(f,e.junction);Get(f,e.reservoir);Get(f,e.experimentalFaceReconstruction);}Get(f,p.impulse);}
 GetVector(f,g.reservoirs);Get(f,g.external);Get(f,n);if(n>100000)throw std::runtime_error("Invalid junction count");g.junctions.resize(size_t(n));for(auto& j:g.junctions){Get(f,j.straight);Get(f,j.valve);Get(f,j.forwardArea);Get(f,j.reverseArea);Get(f,j.areaChange);}
 Get(f,g.time);Get(f,g.work);Get(f,g.maxJunctionMassResidual);Get(f,g.maxJunctionMassCorrection);Get(f,g.junctionEntropyIntegral);Get(f,g.maxAreaChangeMomentumResidual);Get(f,g.steps);Get(f,g.secondOrder);Get(f,g.workerCount);Get(f,g.experimentalVolumeFaceReconstruction);

 uint32_t contract;Get(f,contract);if(contract!=(legacy?1:4))throw std::runtime_error("Unsupported source EOS contract");
 Get(f,n);if(n>100000)throw std::runtime_error("Invalid source count");g.sources.resize(size_t(n));
 for(auto& s:g.sources){Get(f,s.pipe);Get(f,s.cell);Get(f,s.conductance);Get(f,s.wallTemperature);Get(f,s.fuelRate);Get(f,s.darcy);Get(f,s.diameter);Get(f,s.woschni);Get(f,s.rpm);Get(f,s.bore);Get(f,s.stroke);Get(f,s.clearance);Get(f,s.pistonArea);Get(f,s.headArea);Get(f,s.ivcPressure);Get(f,s.ivcVolume);Get(f,s.trappedAir);Get(f,s.cw1);if(!legacy)Get(f,s.exhaustStroke);}
 Get(f,g.sourceLedger.heat);Get(f,g.sourceLedger.reactionEnergy);Get(f,g.sourceLedger.burnedFuel);Get(f,g.sourceLedger.frictionImpulse);Get(f,g.sourceLedger.species);
 if(!legacy){GetVector(f,g.boundaryLedgers);Get(f,n);if(n>100000)throw std::runtime_error("Invalid source ledger count");g.cellSourceLedgers.resize(n);for(auto& s:g.cellSourceLedgers){Get(f,s.heat);Get(f,s.reactionEnergy);Get(f,s.burnedFuel);Get(f,s.frictionImpulse);Get(f,s.species);}}
 Get(f,cycle.fuelDelivered);Get(f,cycle.dose);Get(f,cycle.fuelSensibleEnergy);Get(f,cycle.fuelEnthalpy);Get(f,cycle.mechanicalLoss);
 if(f.peek()!=std::char_traits<char>::eof())throw std::runtime_error("Trailing checkpoint data");if(legacy){auto convert=[](ThermalQ& q){LegacyMixture::Composition y{};for(unsigned i=0;i<6;++i)y[i]=q[i+3]/q[0];double u=q[1]/q[0];double t=LegacyMixture::Temperature(LegacyMixture::MixtureLaw(y),q[2]/q[0]-.5*u*u);q[2]=q[0]*(Energy(MixtureLaw(y),t)+.5*u*u);};for(auto& v:g.volumes)convert(v.q);for(auto& p:g.pipes)for(auto& q:p.q)convert(q);for(auto& q:g.reservoirs)convert(q);}
 g.Validate();return g;
}
}
