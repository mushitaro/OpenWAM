/* --------------------------------------------------------------------------------*\
==========================|
 \\   /\ /\   // O pen     | OpenWAM: The Open Source 1D Gas-Dynamic Code
 \\ |  X  | //  W ave     |
 \\ \/_\/ //   A ction   | CMT-Motores Termicos / Universidad Politecnica
Valencia
 \\/   \//    M odel    |
 ----------------------------------------------------------------------------------
 License

 This file is part of OpenWAM.

 OpenWAM is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 OpenWAM is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with OpenWAM.  If not, see <http://www.gnu.org/licenses/>.


 \*--------------------------------------------------------------------------------
*/

// ---------------------------------------------------------------------------
#pragma hdrstop

// #include <cmath>
#ifdef __BORLANDC__
#include <vcl.h>
#endif

#include "TCCCompresor.h"
#include "TCompTubDep.h"
#include "TCompTubos.h"
#include "TCompresorDep.h"
#include "TCCEntradaCompresor.h"

#include "TTubo.h"
#include "TDeposito.h"
#include "TCompresor.h"

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
TCCCompresor::TCCCompresor(nmTypeBC TipoCC, int numCC,
                           nmTipoCalculoEspecies SpeciesModel,
                           int numeroespecies, nmCalculoGamma GammaCalculation,
                           bool ThereIsEGR)
    : TCondicionContorno(TipoCC, numCC, SpeciesModel, numeroespecies,
                         GammaCalculation, ThereIsEGR) {

  FTuboExtremo = NULL;
  FTiempoActual = 0;
  FNumeroTubo = NULL;
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TCCCompresor::~TCCCompresor() {

  if (FNumeroTubo != NULL)
    delete[] FNumeroTubo;
  if (FTuboExtremo != NULL)
    delete[] FTuboExtremo;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCCompresor::LeeNumeroCompresor(const std::string &FileWAM,
                                      fpos_t &filepos) {
  try {

    FILE *fich = fopen(FileWAM.c_str(), "rb");
    fsetpos(fich, &filepos);

    fscanf(fich, "%d ", &FNumeroCompresor);

    fgetpos(fich, &filepos);
    fclose(fich);

  } catch (exception &N) {
    std::cout
        << "ERROR: TCCCompresor::LeeCompresor en la condicion de contorno: "
        << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCCompresor::AsignacionDatos(
    const std::vector<std::unique_ptr<TCompresor>> &Compressor,
    const std::vector<std::unique_ptr<TDeposito>> &Plenum,
    const std::string &FileWAM, fpos_t &filepos, int NumberOfPipes,
    const std::vector<std::unique_ptr<TTubo>> &Pipe,
    const std::vector<std::unique_ptr<TCondicionContorno>> &BC, int numCC,
    double AmbientTemperature, double AmbientPressure,
    double *AtmosphericComposition) {
  try {
    int i = 0;
    bool haytubo = false;
    int tipoentrada = 0;

    FTamb = AmbientTemperature;
    FPamb = AmbientPressure;
    FCompresor = Compressor[FNumeroCompresor - 1].get();
    FFraccionMasicaEspecie = new double[FNumeroEspecies - FIntEGR];

    if (FCompresor->getModeloCompresor() == nmCompOriginal) {
      // Posee un tubo y un deposito. Hay que asignarselos a la BC.

      FTuboExtremo = new stTuboExtremo[1];
      FTuboExtremo[0].Pipe = NULL;

      while (FNumeroTubosCC < 1 && i < NumberOfPipes) {
        if (Pipe[i]->getNodoIzq() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
          FNumeroTubosCC++;
        }
        if (Pipe[i]->getNodoDer() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
          FNumeroTubosCC++;
        }
        i++;
      }
      FILE *fich = fopen(FileWAM.c_str(), "rb");
      fsetpos(fich, &filepos);

      fscanf(fich, "%d ", &tipoentrada);

      fgetpos(fich, &filepos);
      fclose(fich);

      switch (tipoentrada) {
      case 0:
        FEntradaCompresor = nmAtmosphere;
        break;
      case 1:
        FEntradaCompresor = nmPipe;
        break;
      case 2:
        FEntradaCompresor = nmPlenum;
        break;
      }

      if (FEntradaCompresor == nmPlenum) {

        FILE *fich = fopen(FileWAM.c_str(), "rb");
        fsetpos(fich, &filepos);

        fscanf(fich, "%d ", &FNumeroDeposito);

        fgetpos(fich, &filepos);
        fclose(fich);

        FDeposito = Plenum[FNumeroDeposito - 1].get();
        dynamic_cast<TCompTubDep *>(FCompresor)
            ->BusquedaEntradaSalida(FEntradaCompresor, FTamb, FNumeroCC, BC,
                                    AtmosphericComposition);

      } else if (FEntradaCompresor == nmPipe) {
        for (int i = 0; i < numCC; i++) {
          if (BC[i]->getTipoCC() == nmEntradaCompre) {
            if (dynamic_cast<TCCEntradaCompresor *>(BC[i].get())
                    ->getNumeroCompresor() == FNumeroCompresor) {
              haytubo = true;
              FTuboRotor = BC[i]->GetTuboExtremo(0).Pipe;
              FExtremoTuboRotor = BC[i]->GetTuboExtremo(0).TipoExtremo;
            }
          }
        }
        if (haytubo) {
          dynamic_cast<TCompTubDep *>(FCompresor)
              ->BusquedaEntradaSalida(FEntradaCompresor, AmbientTemperature,
                                      FNumeroCC, BC, AtmosphericComposition);
        } else {
          printf("ERROR: El compresor %d no tiene una BC tipo EntradaCompresor "
                 "a su entrada.\n ",
                 FNumeroCompresor);
        }
      } else if (FEntradaCompresor == nmAtmosphere) {
        dynamic_cast<TCompTubDep *>(FCompresor)
            ->BusquedaEntradaSalida(FEntradaCompresor, AmbientTemperature,
                                    FNumeroCC, BC, AtmosphericComposition);
      }

    } else if (FCompresor->getModeloCompresor() == nmCompPipes) {
      // Posee dos tubos. Hay que asignarselos a la BC.

      FTuboExtremo = new stTuboExtremo[2];
      FNumeroTubo = new int[2];
      for (int j = 0; j < 2; j++) {
        FTuboExtremo[j].Pipe = NULL;
      }

      while (FNumeroTubosCC < 2 && i < NumberOfPipes) {
        if (Pipe[i]->getNodoIzq() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
          FNumeroTubo[FNumeroTubosCC] = i;
          FNumeroTubosCC++;
        }
        if (Pipe[i]->getNodoDer() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
          FNumeroTubo[FNumeroTubosCC] = i;
          FNumeroTubosCC++;
        }
        i++;
      }
      dynamic_cast<TCompTubos *>(FCompresor)->RelacionTubos(BC, FNumeroCC);

    } else if (FCompresor->getModeloCompresor() == nmCompPlenums) {
      // Posee dos depositos. Hay que asignarselos a la BC.

      FILE *fich = fopen(FileWAM.c_str(), "rb");
      fsetpos(fich, &filepos);

      fscanf(fich, "%d ", &FNumeroDepositoRot);
      fscanf(fich, "%d ", &FNumeroDepositoEst);

      fgetpos(fich, &filepos);
      fclose(fich);

      FDepositoRot = Plenum[FNumeroDepositoRot - 1].get();
      FDepositoEst = Plenum[FNumeroDepositoEst - 1].get();

      dynamic_cast<TCompresorDep *>(FCompresor)
          ->RelacionDepositoCompresor(FDepositoRot, FDepositoEst);
    }

  } catch (exception &N) {
    std::cout
        << "ERROR: TCCCompresor::AsignaCompresor en la condicion de contorno: "
        << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
void TCCCompresor::ObtencionValoresInstantaneos(double Theta,
                                                double tiempoactual) {
  FTheta = Theta;
  FTiempoActual = tiempoactual;
}

void TCCCompresor::CalculaCondicionContorno(double Time) {
  // Placeholder: Implementation missing in original source
}

void TCCCompresor::TuboCalculandose(int TuboActual) {
  FTuboActual = TuboActual;
}

void TCCCompresor::ReadCompressorData(
    const std::string &FileWAM, fpos_t &filepos,
    const std::vector<std::unique_ptr<TCompresor>> &Compressor) {

  int tipoentrada = 0;

  if (Compressor[FNumeroCompresor - 1]->getModeloCompresor() ==
      nmCompOriginal) {
    FILE *fich = fopen(FileWAM.c_str(), "rb");
    fsetpos(fich, &filepos);

    fscanf(fich, "%d ", &tipoentrada);

    switch (tipoentrada) {
    case 0:
      FEntradaCompresor = nmAtmosphere;
      break;
    case 1:
      FEntradaCompresor = nmPipe;
      break;
    case 2:
      FEntradaCompresor = nmPlenum;
      fscanf(fich, "%d ", &FNumeroDeposito);
      break;
    }
    fgetpos(fich, &filepos);
    fclose(fich);
  } else if (Compressor[FNumeroCompresor - 1]->getModeloCompresor() ==
             nmCompPlenums) {
    // Posee dos depositos. Hay que asignarselos a la BC.

    FILE *fich = fopen(FileWAM.c_str(), "rb");
    fsetpos(fich, &filepos);

    fscanf(fich, "%d ", &FNumeroDepositoRot);
    fscanf(fich, "%d ", &FNumeroDepositoEst);

    fgetpos(fich, &filepos);
    fclose(fich);
  }
}

void TCCCompresor::AsignData(
    const std::vector<std::unique_ptr<TDeposito>> &Plenum, int NumberOfPipes,
    const std::vector<std::unique_ptr<TTubo>> &Pipe,
    const std::vector<std::unique_ptr<TCondicionContorno>> &BC, int numCC,
    double *AtmosphericComposition,
    const std::vector<std::unique_ptr<TCompresor>> &Compressor,
    double AmbientTemperature, double AmbientPressure) {
  try {
    int i = 0;
    bool haytubo = false;

    FTamb = AmbientTemperature;
    FPamb = AmbientPressure;
    FCompresor = Compressor[FNumeroCompresor - 1].get();
    FFraccionMasicaEspecie = new double[FNumeroEspecies - FIntEGR];

    if (FCompresor->getModeloCompresor() == nmCompOriginal) {
      // Posee un tubo y un deposito. Hay que asignarselos a la BC.

      FTuboExtremo = new stTuboExtremo[1];
      FTuboExtremo[0].Pipe = NULL;

      while (FNumeroTubosCC < 1 && i < NumberOfPipes) {
        if (Pipe[i]->getNodoIzq() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
          FNumeroTubosCC++;
        }
        if (Pipe[i]->getNodoDer() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
          FNumeroTubosCC++;
        }
        i++;
      }

      if (FEntradaCompresor == nmPlenum) {

        FDeposito = Plenum[FNumeroDeposito - 1].get();
        dynamic_cast<TCompTubDep *>(FCompresor)
            ->BusquedaEntradaSalida(FEntradaCompresor, FTamb, FNumeroCC, BC,
                                    AtmosphericComposition);

      } else if (FEntradaCompresor == nmPipe) {
        for (int i = 0; i < numCC; i++) {
          if (BC[i]->getTipoCC() == nmEntradaCompre) {
            if (dynamic_cast<TCCEntradaCompresor *>(BC[i].get())
                    ->getNumeroCompresor() == FNumeroCompresor) {
              haytubo = true;
              FTuboRotor = BC[i]->GetTuboExtremo(0).Pipe;
              FExtremoTuboRotor = BC[i]->GetTuboExtremo(0).TipoExtremo;
            }
          }
        }
        if (haytubo) {
          dynamic_cast<TCompTubDep *>(FCompresor)
              ->BusquedaEntradaSalida(FEntradaCompresor, FTamb, FNumeroCC, BC,
                                      AtmosphericComposition);
        } else {
          printf("ERROR: El compresor %d no tiene una BC tipo EntradaCompresor "
                 "a su entrada.\n ",
                 FNumeroCompresor);
        }
      } else if (FEntradaCompresor == nmAtmosphere) {
        dynamic_cast<TCompTubDep *>(FCompresor)
            ->BusquedaEntradaSalida(FEntradaCompresor, FTamb, FNumeroCC, BC,
                                    AtmosphericComposition);
      }

    } else if (FCompresor->getModeloCompresor() == nmCompPipes) {
      // Posee dos tubos. Hay que asignarselos a la BC.

      FTuboExtremo = new stTuboExtremo[2];
      FNumeroTubo = new int[2];
      for (int j = 0; j < 2; j++) {
        FTuboExtremo[j].Pipe = NULL;
      }

      while (FNumeroTubosCC < 2 && i < NumberOfPipes) {
        if (Pipe[i]->getNodoIzq() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
          FNumeroTubo[FNumeroTubosCC] = i;
          FNumeroTubosCC++;
        }
        if (Pipe[i]->getNodoDer() == FNumeroCC) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
          FNumeroTubo[FNumeroTubosCC] = i;
          FNumeroTubosCC++;
        }
        i++;
      }
      // dynamic_cast<TCompTubos*>(FCompresor)->RelacionTubos(BC, FNumeroCC);
      dynamic_cast<TCompTubos *>(FCompresor)->AsignPipes(BC, FNumeroCC);

    } else if (FCompresor->getModeloCompresor() == nmCompPlenums) {

      FDepositoRot = Plenum[FNumeroDepositoRot - 1].get();
      FDepositoEst = Plenum[FNumeroDepositoEst - 1].get();

      dynamic_cast<TCompresorDep *>(FCompresor)
          ->RelacionDepositoCompresor(FDepositoRot, FDepositoEst);
    }

  } catch (exception &N) {
    std::cout
        << "ERROR: TCCCompresor::AsignaCompresor en la condicion de contorno: "
        << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
#pragma package(smart_init)
