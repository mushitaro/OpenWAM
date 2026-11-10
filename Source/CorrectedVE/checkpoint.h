#pragma once
#include "sources/Source/Engine/ThermalDuctNetwork.h"
#include <fstream>
#include <cstdint>
#include <type_traits>
namespace HCheckpoint {
using namespace OpenWAMThermalReference;
template<class T>void Put(std::ostream& f,const T& x){static_assert(std::is_trivially_copyable<T>::value,"POD only");f.write(reinterpret_cast<const char*>(&x),sizeof(x));if(!f)throw std::runtime_error("Checkpoint write failed");}
template<class T>void Get(std::istream& f,T& x){static_assert(std::is_trivially_copyable<T>::value,"POD only");f.read(reinterpret_cast<char*>(&x),sizeof(x));if(!f)throw std::runtime_error("Incomplete checkpoint");}
template<class T>void PutVector(std::ostream& f,const std::vector<T>& a){Put(f,uint64_t(a.size()));for(const auto& x:a)Put(f,x);}
template<class T>void GetVector(std::istream& f,std::vector<T>& a){uint64_t n;Get(f,n);if(n>100000)throw std::runtime_error("Invalid checkpoint size");a.resize(size_t(n));for(auto& x:a)Get(f,x);}
inline void Save(const std::string& path,const ThermalDuctNetwork& g,double budget,uint64_t frames){
 std::ifstream existing(path,std::ios::binary);if(existing.good())throw std::runtime_error("Refuse checkpoint overwrite");
 std::ofstream f(path,std::ios::binary);Put(f,uint64_t(0x484e415449564531ULL));Put(f,budget);Put(f,frames);
 Put(f,uint64_t(g.volumes.size()));for(const auto& v:g.volumes){Put(f,v.q);Put(f,v.volume);Put(f,v.dvolume);}
 Put(f,uint64_t(g.pipes.size()));for(const auto& p:g.pipes){PutVector(f,p.q);PutVector(f,p.cellVolume);PutVector(f,p.faceArea);for(const auto& e:p.ends){Put(f,e.volume);Put(f,e.forwardArea);Put(f,e.reverseArea);Put(f,e.junction);Put(f,e.reservoir);Put(f,e.experimentalFaceReconstruction);}Put(f,p.impulse);}
 PutVector(f,g.reservoirs);Put(f,g.external);Put(f,uint64_t(g.junctions.size()));for(const auto& j:g.junctions){Put(f,j.straight);Put(f,j.valve);Put(f,j.forwardArea);Put(f,j.reverseArea);Put(f,j.areaChange);}
 Put(f,g.time);Put(f,g.work);Put(f,g.maxJunctionMassResidual);Put(f,g.maxJunctionMassCorrection);Put(f,g.junctionEntropyIntegral);Put(f,g.maxAreaChangeMomentumResidual);Put(f,g.steps);Put(f,g.secondOrder);Put(f,g.workerCount);Put(f,g.experimentalVolumeFaceReconstruction);
 f.flush();if(!f)throw std::runtime_error("Checkpoint flush failed");
}
inline ThermalDuctNetwork Load(const std::string& path,double& budget,uint64_t& frames){
 std::ifstream f(path,std::ios::binary);uint64_t magic,n;Get(f,magic);if(magic!=0x484e415449564531ULL)throw std::runtime_error("Snapshot format mismatch");Get(f,budget);Get(f,frames);ThermalDuctNetwork g;
 Get(f,n);if(n>100000)throw std::runtime_error("Invalid volume count");g.volumes.resize(size_t(n));for(auto& v:g.volumes){Get(f,v.q);Get(f,v.volume);Get(f,v.dvolume);}
 Get(f,n);if(n>100000)throw std::runtime_error("Invalid pipe count");g.pipes.resize(size_t(n));for(auto& p:g.pipes){GetVector(f,p.q);GetVector(f,p.cellVolume);GetVector(f,p.faceArea);for(auto& e:p.ends){Get(f,e.volume);Get(f,e.forwardArea);Get(f,e.reverseArea);Get(f,e.junction);Get(f,e.reservoir);Get(f,e.experimentalFaceReconstruction);}Get(f,p.impulse);}
 GetVector(f,g.reservoirs);Get(f,g.external);Get(f,n);if(n>100000)throw std::runtime_error("Invalid junction count");g.junctions.resize(size_t(n));for(auto& j:g.junctions){Get(f,j.straight);Get(f,j.valve);Get(f,j.forwardArea);Get(f,j.reverseArea);Get(f,j.areaChange);}
 Get(f,g.time);Get(f,g.work);Get(f,g.maxJunctionMassResidual);Get(f,g.maxJunctionMassCorrection);Get(f,g.junctionEntropyIntegral);Get(f,g.maxAreaChangeMomentumResidual);Get(f,g.steps);Get(f,g.secondOrder);Get(f,g.workerCount);Get(f,g.experimentalVolumeFaceReconstruction);
 if(f.peek()!=std::char_traits<char>::eof())throw std::runtime_error("Trailing checkpoint data");auto convert=[](ThermalQ& q){Composition y{};for(unsigned i=0;i<6;++i)y[i]=q[i+3]/q[0];const double u=q[1]/q[0],t=LegacyMixture::Temperature(LegacyMixture::MixtureLaw(y),q[2]/q[0]-.5*u*u);q[2]=q[0]*(Energy(MixtureLaw(y),t)+.5*u*u);};for(auto& v:g.volumes)convert(v.q);for(auto& p:g.pipes)for(auto& q:p.q)convert(q);for(auto& q:g.reservoirs)convert(q);g.Validate();return g;
}
}
