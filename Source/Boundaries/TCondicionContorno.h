/* --------------------------------------------------------------------------------*\
|==========================|
 |\\   /\ /\   // O pen     | OpenWAM: The Open Source 1D Gas-Dynamic Code
 | \\ |  X  | //  W ave     |
 |  \\ \/_\/ //   A ction   | CMT-Motores Termicos / Universidad Politecnica
 Valencia |   \\/   \//    M odel    |
 ----------------------------------------------------------------------------------
 | License
 |
 |	This file is part of OpenWAM.
 |
 |	OpenWAM is free software: you can redistribute it and/or modify
 |	it under the terms of the GNU General Public License as published by
 |	the Free Software Foundation, either version 3 of the License, or
 |	(at your option) any later version.
 |
 |	OpenWAM is distributed in the hope that it will be useful,
 |	but WITHOUT ANY WARRANTY; without even the implied warranty of
 |	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 |	GNU General Public License for more details.
 |
 |	You should have received a copy of the GNU General Public License
 |	along with OpenWAM.  If not, see <http://www.gnu.org/licenses/>.
 |
 \*--------------------------------------------------------------------------------*/

#ifndef TCondicionContornoH
#define TCondicionContornoH

#include "Globales.h"
#include <cstdio>
#include <iostream>
#include <vector>
#include <memory>
#include "BoundaryFunctions.h"

class TTubo;
class TDPF;

class TCondicionContorno {
public:
  TCondicionContorno(nmTypeBC TipoCC, int numCC,
                     nmTipoCalculoEspecies SpeciesModel, int numeroespecies,
                     nmCalculoGamma GammaCalculation, bool ThereIsEGR);
  virtual ~TCondicionContorno();

  nmTypeBC getTipoCC() { return FTipoCC; }
  int getNumeroCC() { return FNumeroCC; }
  double getGamma() { return FGamma; }
  double getR() { return FRMezcla; }
  int getNumeroTubosCC() { return FNumeroTubosCC; }

  stTuboExtremo GetTuboExtremo(int i);
  void PutBeta(int i, double valor);
  void PutLanda(int i, double valor);
  void PutEntropia(int i, double valor);

  double GetFraccionMasicaEspecie(int i);
  double GetEntropia(int i);
  double GetBeta(int i);
  double GetLanda(int i);

  virtual void CalculaCondicionContorno(double Time) {};
  virtual void CalculaCaracteristicas(double Time);

  virtual void TuboCalculandose(int i) {};

  // Updated signature for vectors
  virtual void
  ReadBoundaryData(const char *FileWAM, fpos_t &filepos, int NumberOfPipes,
                   const std::vector<std::unique_ptr<TTubo>> &Pipe, int nDPF,
                   const std::vector<std::unique_ptr<TDPF>> &DPF) {};

  virtual void AsignAmbientConditions(double Tamb, double Pamb,
                                      double *AtmosphericComposition) {};

  virtual void AsignaTubos(int NumberOfPipes,
                           const std::vector<std::unique_ptr<TTubo>> &Pipe) {};

  double getPosicionNodo() { return FPosicionNodo; }
  void PutPosicionNodo(double v) { FPosicionNodo = v; }

  bool getUnionDPF() { return FUnionDPF; }

protected:
  nmTypeBC FTipoCC;
  int FNumeroCC;
  nmTipoCalculoEspecies FCalculoEspecies;
  int FNumeroEspecies;
  nmCalculoGamma FCalculoGamma;
  bool FHayEGR;
  int FIntEGR;
  bool FUnionDPF;
  int FNumeroTubosCC;

  stTuboExtremo *FTuboExtremo;
  double *FFraccionMasicaEspecie;
  double FPosicionNodo;

  double FTime0;
  double FTime1;
  double FDeltaT;
  double FRegimen;
  double FGamma;
  double FAnguloActual;
  double FAnguloAnterior;
  double FDeltaAngulo;
  double FRMezcla;
  double FCpMezcla;
};

#endif
