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
// ---------------------------------------------------------------------------
#pragma hdrstop

#include "TCCDeposito.h"
// #include <cmath>
#ifdef __BORLANDC__
#include <vcl.h>
#endif

#include "TCDFijo.h"
#include "TValvula4T.h"
#include "TLamina.h"
#include "TDiscoRotativo.h"
#include "TLumbrera.h"
#include "TValvulaContr.h"
#include "TWasteGate.h"
#include "TEstatorTurbina.h"
#include "TRotorTurbina.h"
#include "TCDExterno.h"
#include "TMariposa.h"

#include "TDepVolVariable.h"
#include "TDepVolCte.h"
#include "TTurbinaSimple.h"
#include "TTurbinaTwin.h"
#include "TVenturi.h"
#include "TUnionDireccional.h"

#include "TTubo.h"
#include "TDPF.h"
#include "TCanalDPF.h"

// ---------------------------------------------------------------------------
// Stage 72: bank-differential box-mode ROM state (ONE global oscillator; the
// CSL model has a single main plenum). Gated by env OPENWAM_BOX_MODE
// ("freq_hz,zeta,gain"); unset -> on=false -> bit-identical legacy behaviour.
// Deterministic only at OMP_NUM_THREADS=1 (like the whole calibration stack).
// ---------------------------------------------------------------------------
namespace {
struct TBoxModeROM {
  bool parsed = false;
  bool on = false;
  double w = 0.0;    // 2*pi*freq
  double zeta = 0.1; // modal damping ratio
  double gain = 0.0; // [Pa/(unit FGasto)] modal forcing gain
  double q = 0.0;    // modal pressure amplitude [Pa]
  double qd = 0.0;
  double lastT = -1.0;
  double fAcc = 0.0;  // bank-differential flow accumulated THIS step
  double fPrev = 0.0; // forcing applied during the step being integrated
  int fN = 0;         // contributions in fAcc (normalizer)
  double fEma = 0.0;  // v2: one-pole smoothed forcing (tames impulsive noise)
  // v5 knobs (env, all with safe defaults)
  double cap = 1000.0;  // |q| clamp [Pa] (OPENWAM_BOX_MODE_CAP)
  double t0 = 0.15;     // engage time [s] (OPENWAM_BOX_MODE_T0)
  double tr = 0.10;     // engage ramp [s] (OPENWAM_BOX_MODE_TR)
  double vgate = 0.0;   // per-mouth |velocity| envelope ref, characteristic
                        // units (v/aref); 0 = ungated (OPENWAM_BOX_MODE_VGATE)
  double qMax = 0.0;    // max |q| since last DIAG print
};
static TBoxModeROM BoxMode;

static bool BoxModeCCListed(const char *env, int cc) {
  const char *p = getenv(env);
  if (!p)
    return false;
  while (*p) {
    char *endp = NULL;
    long v = strtol(p, &endp, 10);
    if (endp == p) {
      ++p;
      continue;
    }
    if ((int)v == cc)
      return true;
    p = endp;
  }
  return false;
}
} // namespace

double TCCDeposito::PlenumP() {
  return FDeposito->getPressure() + FBoxModeDp;
}

double TCCDeposito::PlenumA() {
  if (FBoxModeDp == 0.0)
    return FDeposito->getSpeedsound(); // exact legacy value when unperturbed
  double P = FDeposito->getPressure();
  return FDeposito->getSpeedsound() * pow((P + FBoxModeDp) / P, 1.0 / FGamma4);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TCCDeposito::TCCDeposito(nmTypeBC TipoCC, int numCC,
                         nmTipoCalculoEspecies SpeciesModel, int numeroespecies,
                         nmCalculoGamma GammaCalculation, bool ThereIsEGR)
    : TCondicionContorno(TipoCC, numCC, SpeciesModel, numeroespecies,
                         GammaCalculation, ThereIsEGR) {

  FTuboExtremo = NULL;
  FValvula = NULL;
  FGasto = 0;
  FVelocity = 0;
  FSonido = 1;
  FVelocidadGarganta = 0;
  FMachGarganta = 1;
  FRelacionPresionGarganta = 1;
  FSentidoFlujo = nmParado;
  FMachVenturi = 0;

  // Gated mouth acoustic-radiation damping (env OPENWAM_MOUTH_RAD); off by default.
  FMouthRadAlpha = -1.0; // sentinel: env not yet read
  FMouthRadW = 0.0;
  FMouthRadGated = false;
  FVelBar = 0.0;
  FMouthRadSkip = false;

  // Stage 72: box-mode ROM (env OPENWAM_BOX_MODE); off by default.
  FBoxModeSign = -2; // sentinel: env not yet read
  FBoxModeDp = 0.0;

  FTime0 = 0.;
  FTime1 = 0.;
  FAnguloAnterior = 0.;
  FAnguloActual = 0.;
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TCCDeposito::~TCCDeposito() {

  delete[] FTuboExtremo;

  if (FValvula != NULL)
    delete FValvula;

  FValvula = NULL;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::ReadBoundaryData(
    std::istream &FileInput, int NumberOfPipes,
    const std::vector<std::unique_ptr<TTubo>> &Pipe, int nDPF,
    const std::vector<std::unique_ptr<TDPF>> &DPF) {
  try {
    int i = 0, j = 0;
    int numid = 0; // Variable necesaria para WAMer.

    FTuboExtremo = new stTuboExtremo[1];
    FTuboExtremo[0].Pipe = NULL;
#ifdef ParticulateFilter
    FTuboExtremo[0].DPF = NULL;
#endif
    FTuboExtremo[0].NumeroHaz = -1;
    FTuboExtremo[0].TipoCanal = -1;

    FPref = 1;

    for (int i = 0; i < NumberOfPipes; i++) {
      if (Pipe[i]->getNodoIzq() == FNumeroCC) {
        if (FNumeroTubosCC < 1) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
          FNodoFin = 0;
          FIndiceCC = 0;
          FCC = &(FTuboExtremo[FNumeroTubosCC].Beta);
          FCD = &(FTuboExtremo[FNumeroTubosCC].Landa);
          FNumeroTubosCC++;
          FUnionDPF = false;
          FEncontrado = true;
        } else {
          // std::cout << "ERROR: TCCDeposito::ReadBoundaryData Mas de un tubo
          // conectado a la condicion de contorno: " << FNumeroCC << std::endl;
          FNumeroTubosCC++;
          // throw Exception("Mas de un tubo conectado a la condicion de
          // contorno");
        }
      }
      if (Pipe[i]->getNodoDer() == FNumeroCC) {
        if (FNumeroTubosCC < 1) {
          FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
          FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
          FNodoFin = Pipe[i]->getNin() - 1;
          FIndiceCC = 1;
          FCC = &(FTuboExtremo[FNumeroTubosCC].Landa);
          FCD = &(FTuboExtremo[FNumeroTubosCC].Beta);
          FNumeroTubosCC++;
          FUnionDPF = false;
          FEncontrado = true;
        } else {
          // std::cout << "ERROR: TCCDeposito::ReadBoundaryData Mas de un tubo
          // conectado a la condicion de contorno: " << FNumeroCC << std::endl;
          FNumeroTubosCC++;
          // throw Exception("Mas de un tubo conectado a la condicion de
          // contorno");
        }
      }
    }

#ifdef ParticulateFilter
    if (!FEncontrado) { // It is a junction between a plenum and a DPF
      int k = 0;
      while (FNumeroTubosCC < 1 && j < nDPF) {
        while (k < DPF[j]->getNumeroHacesCanales()) {
          if (DPF[j]->GetCanal(k, 0)->getNodoIzq() == FNumeroCC) {
            FTuboExtremo[FNumeroTubosCC].NumeroHaz = k;
            FTuboExtremo[FNumeroTubosCC].TipoCanal = 0;
            FTuboExtremo[FNumeroTubosCC].DPF = DPF[j].get();
            FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
            FNodoFin = 0;
            FIndiceCC = 0;
            FCC = &(FTuboExtremo[FNumeroTubosCC].Beta);
            FCD = &(FTuboExtremo[FNumeroTubosCC].Landa);
            FNumeroTubosCC++;
          }
          if (DPF[j]->GetCanal(k, 0)->getNodoDer() == FNumeroCC) {
            FTuboExtremo[FNumeroTubosCC].NumeroHaz = k;
            FTuboExtremo[FNumeroTubosCC].TipoCanal = 0;
            FTuboExtremo[FNumeroTubosCC].DPF = DPF[j].get();
            FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
            FNodoFin = DPF[j]->GetCanal(k, 0)->getNin() - 1;
            FIndiceCC = 1;
            FCC = &(FTuboExtremo[FNumeroTubosCC].Landa);
            FCD = &(FTuboExtremo[FNumeroTubosCC].Beta);
            FNumeroTubosCC++;
          }
          if (DPF[j]->GetCanal(k, 1)->getNodoIzq() == FNumeroCC) {
            FTuboExtremo[FNumeroTubosCC].NumeroHaz = k;
            FTuboExtremo[FNumeroTubosCC].TipoCanal = 1;
            FTuboExtremo[FNumeroTubosCC].DPF = DPF[j].get();
            FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
            FNodoFin = 0;
            FIndiceCC = 0;
            FCC = &(FTuboExtremo[FNumeroTubosCC].Beta);
            FCD = &(FTuboExtremo[FNumeroTubosCC].Landa);
            FNumeroTubosCC++;
          }
          if (DPF[j]->GetCanal(k, 1)->getNodoDer() == FNumeroCC) {
            FTuboExtremo[FNumeroTubosCC].NumeroHaz = k;
            FTuboExtremo[FNumeroTubosCC].TipoCanal = 1;
            FTuboExtremo[FNumeroTubosCC].DPF = DPF[j].get();
            FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
            FNodoFin = DPF[j]->GetCanal(k, 1)->getNin() - 1;
            FIndiceCC = 1;
            FCC = &(FTuboExtremo[FNumeroTubosCC].Landa);
            FCD = &(FTuboExtremo[FNumeroTubosCC].Beta);
            FNumeroTubosCC++;
          }
          k++;
        }
        j++;
        k = 0;
      }
      FEncontrado = true;
      FUnionDPF = true;
    }
#endif
    // Stream is already positioned by caller (ReadConnections)
    // No need to fopen/seek.

    FileInput >> numid;
    FileInput >> FNumeroDeposito;

    // Inicializacion del transporte de especies quimicas
    FFraccionMasicaEspecie = new double[FNumeroEspecies - FIntEGR];
    if (!FUnionDPF) {
      if (FTuboExtremo[0].Pipe == NULL) {
        std::cout << "ERROR: FTuboExtremo[0].Pipe is NULL!" << std::endl;
        throw Exception("Pipe is NULL");
      }
      for (int i = 0; i < FNumeroEspecies - FIntEGR; i++) {
        FFraccionMasicaEspecie[i] =
            FTuboExtremo[0].Pipe->GetFraccionMasicaInicial(i);
      }
    } else {
#ifdef ParticulateFilter
      for (int i = 0; i < FNumeroEspecies - FIntEGR; i++) {
        FFraccionMasicaEspecie[i] =
            FTuboExtremo[0]
                .DPF->GetCanal(FTuboExtremo[0].NumeroHaz, 0)
                ->GetFraccionMasicaInicial(i);
      }
#endif
    }

  } catch (exception &N) {
    std::cout
        << "ERROR: TCCDeposito::LeeCCDeposito en la condicion de contorno: "
        << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::AsignaDeposito(
    const std::vector<std::unique_ptr<TDeposito>> &Plenum) {
  try {

    FDeposito = Plenum[FNumeroDeposito - 1].get();
    FValvula->PutPlenum(FDeposito);

  } catch (exception &N) {
    std::cout
        << "ERROR: TCCDeposito::AsignaDeposito en la condicion de contorno: "
        << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::AsignaTipoValvula(
    const std::vector<std::unique_ptr<TTipoValvula>> &Origen, int Valv, int i) {
  try {

    switch (Origen[Valv - 1]->getTypeOfValve()) {
    case nmCDFijo:
      FValvula =
          new TCDFijo(dynamic_cast<TCDFijo *>(Origen[Valv - 1].get()), i);
      break;
    case nmValvula4T:
      FValvula =
          new TValvula4T(dynamic_cast<TValvula4T *>(Origen[Valv - 1].get()), i);
      break;
    case nmLamina:
      FValvula =
          new TLamina(dynamic_cast<TLamina *>(Origen[Valv - 1].get()), i);
      break;
    case nmDiscoRotativo:
      FValvula = new TDiscoRotativo(
          dynamic_cast<TDiscoRotativo *>(Origen[Valv - 1].get()), i);
      break;
    case nmLumbrera2T:
      FValvula =
          new TLumbrera(dynamic_cast<TLumbrera *>(Origen[Valv - 1].get()), i);
      break;
    case nmValvulaContr:
      FValvula = new TValvulaContr(
          dynamic_cast<TValvulaContr *>(Origen[Valv - 1].get()), i);
      break;
    case nmWasteGate:
      FValvula =
          new TWasteGate(dynamic_cast<TWasteGate *>(Origen[Valv - 1].get()), i);
      break;
    case nmStator:
      FValvula = new TEstatorTurbina(
          dynamic_cast<TEstatorTurbina *>(Origen[Valv - 1].get()), i);
      break;
    case nmRotor:
      FValvula = new TRotorTurbina(
          dynamic_cast<TRotorTurbina *>(Origen[Valv - 1].get()), i);
      break;
    case nmCalcExtern:
      FValvula =
          new TCDExterno(dynamic_cast<TCDExterno *>(Origen[Valv - 1].get()), i);
      break;
    case nmMariposa:
      FValvula =
          new TMariposa(dynamic_cast<TMariposa *>(Origen[Valv - 1].get()), i);
      break;
    }

    if (!FUnionDPF) {
      FValvula->PutPipe(FTuboExtremo[0].Pipe, FNodoFin);
      FValvula->PutDiametroTubo(FTuboExtremo[0].Pipe->GetDiametro(FNodoFin));
    } else {
#ifdef ParticulateFilter
      FValvula->PutDiametroTubo(
          FTuboExtremo[0]
              .DPF
              ->GetCanal(FTuboExtremo[0].NumeroHaz, FTuboExtremo[0].TipoCanal)
              ->GetDiametro(FNodoFin));
#endif
    }

    if (FValvula->getTypeOfValve() == nmCDFijo) {
      // dynamic_cast<TCDFijo *>(FValvula)->CalculaCD();
      FCDEntrada = FValvula->getCDTubVol();
      FCDSalida = FValvula->getCDVolTub();
      // FCTorbellino=FValvula->getCTorb();
      if (FCDEntrada > 1.) {
        FValvula->AsignaCRecuperacion(FCDEntrada - 1.);
      } else
        FValvula->AsignaCRecuperacion(0.);
    }

  } catch (exception &N) {
    std::cout
        << "ERROR: TCCDeposito::AsignaTipoValvula en la condicion de contorno: "
        << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::CalculaCoeficientesDescarga(double TiempoActual,
                                              double mfcomb,
                                              double RegimenMotor) {
  try {
    double PVol = 0., PTub = 0., PAdm = 0., DeltaP = 0., distancia = 0.,
           CDExt = 0., nodoadm = 0., p1 = 0., p2 = 0.;
    int turb = 0, entr = 0, NodoFin = 0;

    switch (FValvula->getTypeOfValve()) {
    case nmCDFijo:
      dynamic_cast<TCDFijo *>(FValvula)->CalculaCD();
      break;

    case nmValvula4T:
      if (FValvula->getControlRegimen() == nmMotor) {
        FRegimen = RegimenMotor;
      } else {
        FRegimen = FValvula->getRegimen();
      }
      FTime0 = FTime1;
      FTime1 = TiempoActual;
      FDeltaT = FTime1 - FTime0;
      FDeltaAngulo =
          360. * FRegimen * FValvula->getRelacionVelocidades() / 60. * FDeltaT;
      FAnguloAnterior = FAnguloActual;
      FAnguloActual = FAnguloAnterior + FDeltaAngulo;
      if (FAnguloActual > 360.) {
        FAnguloActual -= 360.;
      }
      dynamic_cast<TValvula4T *>(FValvula)->CalculaCD(FAnguloActual);
      break;

    case nmStator:
      dynamic_cast<TEstatorTurbina *>(FValvula)->CalculaCD();
      break;

    case nmRotor:
      dynamic_cast<TRotorTurbina *>(FValvula)->CalculaCD();
      break;

    case nmLamina:
      if (FTuboExtremo[0].TipoExtremo == nmLeft) {
        NodoFin = 0;
      } else
        NodoFin = FTuboExtremo[0].Pipe->getNin() - 1;
      DeltaP =
          FTuboExtremo[0].Pipe->GetPresion(NodoFin) - PlenumP();
      dynamic_cast<TLamina *>(FValvula)->CalculaCD(
          DeltaP, FTuboExtremo[0].Pipe->getTime1());
      break;

    case nmDiscoRotativo:
      if (FValvula->getControlRegimen() == nmMotor) {
        FRegimen = RegimenMotor;
      } else {
        FRegimen = FValvula->getRegimen();
      }
      FTime0 = FTime1;
      FTime1 = TiempoActual;
      FDeltaT = FTime1 - FTime0;
      FDeltaAngulo =
          360. * FRegimen * FValvula->getRelacionVelocidades() / 60. * FDeltaT;
      FAnguloAnterior = FAnguloActual;
      FAnguloActual = FAnguloAnterior + FDeltaAngulo;
      if (FAnguloActual > 360.) {
        FAnguloActual -= 360.;
      }
      dynamic_cast<TDiscoRotativo *>(FValvula)->CalculaCD(FAnguloActual);
      break;

    case nmLumbrera2T:
      FRegimen = dynamic_cast<TDepVolVariable *>(FDeposito)->getRegimen();
      FTime0 = FTime1;
      FTime1 = TiempoActual;
      FDeltaT = FTime1 - FTime0;
      FDeltaAngulo =
          360. * FRegimen *
          dynamic_cast<TDepVolVariable *>(FDeposito)->getRelacionVelocidades() /
          60. * FDeltaT;
      FAnguloAnterior = FAnguloActual;
      FAnguloActual = FAnguloAnterior + FDeltaAngulo;
      if (FAnguloActual > 360.) {
        FAnguloActual -= 360.;
      }
      dynamic_cast<TLumbrera *>(FValvula)->CalculaCD(FAnguloActual);
      break;

    case nmValvulaContr:
      FRegimen = RegimenMotor;
      FTime0 = FTime1;
      FTime1 = TiempoActual;
      FDeltaT = FTime1 - FTime0;
      FDeltaAngulo = 360. * FRegimen / 60. * FDeltaT;
      FAnguloAnterior = FAnguloActual;
      FAnguloActual = FAnguloAnterior + FDeltaAngulo;
      if (FAnguloActual > 720.) {
        FAnguloActual -= 720.;
      }
      dynamic_cast<TValvulaContr *>(FValvula)->CalculaCD(FAnguloActual, mfcomb);
      break;

    case nmWasteGate:
      if (FTuboExtremo[0].TipoExtremo == nmLeft) {
        NodoFin = 0;
      } else
        NodoFin = FTuboExtremo[0].Pipe->getNin() - 1;
      PTub = FTuboExtremo[0].Pipe->GetPresion(NodoFin);
      PVol = PlenumP();
      nodoadm = dynamic_cast<TWasteGate *>(FValvula)->getNodoAdm();
      distancia = dynamic_cast<TWasteGate *>(FValvula)->getDist();
      p1 = dynamic_cast<TWasteGate *>(FValvula)->getTuboAdm()->GetPresion(
          nodoadm);
      p2 = dynamic_cast<TWasteGate *>(FValvula)->getTuboAdm()->GetPresion(
          nodoadm + 1);
      PAdm = Interpola(p1, p2, 1.0, distancia);
      dynamic_cast<TWasteGate *>(FValvula)->CalculaCD(
          PAdm, PTub, PVol, FTuboExtremo[0].Pipe->getTime1());
      break;

    case nmCalcExtern:
      dynamic_cast<TCDExterno *>(FValvula)->CalculaCD();
      break;

    case nmMariposa:
      dynamic_cast<TMariposa *>(FValvula)->CalculaCD(TiempoActual);
      break;
    }

    FCDEntrada = FValvula->getCDTubVol();
    FCDEntrada = FValvula->getCDTubVol();
    FCDSalida = FValvula->getCDVolTub();
    FCTorbellino = FValvula->getCTorb();
    if (FCDEntrada > 1.) {
      FValvula->AsignaCRecuperacion(FCDEntrada - 1.);
    } else
      FValvula->AsignaCRecuperacion(0.);

    if (FCDEntrada > 2.0 || FCDEntrada < 0.0) {
      printf("ERROR: TCCDeposito::CalculaCoeficientesDescarga, en calculo "
             "coeficiente descarga entrante: %lf, en %lf grados,en la "
             "condicion de contorno: %d \n",
             FCDEntrada, FAnguloActual, FNumeroCC);
      throw Exception("ERROR: TCCDeposito::CalculaCoeficientesDescarga en "
                      "calculo coeficiente descarga entrante: " +
                      std::to_string(FCDEntrada) + ", en " +
                      std::to_string(FAnguloActual) + " grados ");
    }
    if (FCDSalida > 1.0 || FCDSalida < 0.0) {
      printf("ERROR: TCCDeposito::CalculaCoeficientesDescarga, en calculo "
             "coeficiente descarga saliente: %lf, en %lf grados, en la "
             "condicion de contorno: %d\n",
             FCDSalida, FAnguloActual, FNumeroCC);
      throw Exception("ERROR: TCCDeposito::CalculaCoeficientesDescarga en "
                      "calculo coeficiente descarga saliente: " +
                      std::to_string(FCDSalida) + ", en " +
                      std::to_string(FAnguloActual) + " grados ");
    }
  } catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::CalculaCoeficientesDescarga en la "
                 "condicion de contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::IniciaGamma() {
  try {

    if (!FUnionDPF) {
      FRMezcla = FTuboExtremo[0].Pipe->GetRMezcla(FNodoFin);
      FGamma = FTuboExtremo[0].Pipe->GetGamma(FNodoFin);
      FSeccionTubo =
          __geom::Circle_area(FTuboExtremo[0].Pipe->GetDiametro(FNodoFin));
    } else {
#ifdef ParticulateFilter
      FRMezcla =
          FTuboExtremo[0]
              .DPF
              ->GetCanal(FTuboExtremo[0].NumeroHaz, FTuboExtremo[0].TipoCanal)
              ->GetRMezcla(FNodoFin);
      FGamma =
          FTuboExtremo[0]
              .DPF
              ->GetCanal(FTuboExtremo[0].NumeroHaz, FTuboExtremo[0].TipoCanal)
              ->GetGamma(FNodoFin);
      FSeccionTubo = __geom::Circle_area(
          FTuboExtremo[0]
              .DPF
              ->GetCanal(FTuboExtremo[0].NumeroHaz, FTuboExtremo[0].TipoCanal)
              ->GetDiametro(FNodoFin));
#endif
    }
    FSeccionValvula = FSeccionTubo;

  } catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::CalculaCondicionContorno en la condicion "
                 "de contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::CalculaCondicionContorno(double Time) {
  try {
    double rel_CCon_Entropia, FraccionMasicaAcum = 0.;

    // === Stage 72: box-mode ROM -- parse once, advance once per timestep ===
    if (FBoxModeSign == -2) { // per-CC env cache
      if (!BoxMode.parsed) {
        BoxMode.parsed = true;
        if (const char *ev = getenv("OPENWAM_BOX_MODE")) {
          double f = 0.0, z = 0.1, g = 0.0;
          if (sscanf(ev, "%lf,%lf,%lf", &f, &z, &g) >= 1 && f > 0.0) {
            BoxMode.on = true;
            BoxMode.w = 2.0 * 3.14159265358979 * f;
            BoxMode.zeta = (z > 0.0) ? z : 0.1;
            BoxMode.gain = g;
            if (const char *ec = getenv("OPENWAM_BOX_MODE_CAP"))
              BoxMode.cap = atof(ec);
            if (BoxMode.cap <= 0.0) BoxMode.cap = 1000.0;
            if (const char *e0 = getenv("OPENWAM_BOX_MODE_T0"))
              BoxMode.t0 = atof(e0);
            if (const char *er = getenv("OPENWAM_BOX_MODE_TR"))
              BoxMode.tr = atof(er);
            if (BoxMode.tr < 1e-6) BoxMode.tr = 1e-6;
            if (const char *eg = getenv("OPENWAM_BOX_MODE_VGATE"))
              BoxMode.vgate = atof(eg);
            printf("BOXMODE ROM on (v5): f=%.1fHz zeta=%.3f gain=%.3g "
                   "cap=%.0fPa t0=%.3f tr=%.3f vgate=%.4f\n", f,
                   BoxMode.zeta, BoxMode.gain, BoxMode.cap, BoxMode.t0,
                   BoxMode.tr, BoxMode.vgate);
            fflush(stdout);
          }
        }
      }
      FBoxModeSign = 0;
      if (BoxMode.on) {
        if (BoxModeCCListed("OPENWAM_BOX_MODE_CC1", FNumeroCC))
          FBoxModeSign = 1;
        else if (BoxModeCCListed("OPENWAM_BOX_MODE_CC2", FNumeroCC))
          FBoxModeSign = -1;
      }
    }
    if (BoxMode.on) {
      // NB: the `Time` parameter is NOT a reliable absolute clock here; use
      // the attached pipe's absolute time (same clock the wastegate case
      // reads via getTime1()) so the oscillator advances once per global step.
      double tNow = FTuboExtremo[0].Pipe->getTime1();
      if (tNow > BoxMode.lastT) { // a boundary whose clock moved us forward
        // v5 POST-MORTEM of v3/v4: gain 1e-4 and 1e-5 produced BYTE-IDENTICAL
        // dead runs (ve 47.56 / slope -91.4476) => the applied dp was gain-
        // independent => q sat clamped at the +/-cap rails: the semi-implicit
        // Euler advance was numerically UNSTABLE on the ragged multi-pipe
        // clock (dt spikes up to the old 0.01 guard give w*dt >> 2), and the
        // "lastT = Time" bookkeeping mixed the unreliable Time argument into
        // the pipe-clock comparisons. Fix: exact exponential integrator of
        // the damped oscillator (unconditionally stable for ANY dt) and a
        // consistent lastT = tNow.
        double dt = (BoxMode.lastT < 0.0) ? 0.0 : (tNow - BoxMode.lastT);
        if (dt > 0.0 && dt < 0.05) {
          // normalize the accumulated bank-differential flow by its
          // contribution count and one-pole smooth it (tau ~ 1 ms) -- the raw
          // per-fire sum was impulsive and noisy on the ragged clock.
          double fRaw = (BoxMode.fN > 0) ? BoxMode.fAcc / BoxMode.fN : 0.0;
          double aEma = dt / (0.001 + dt); // tau = 1 ms
          BoxMode.fEma += aEma * (fRaw - BoxMode.fEma);
          BoxMode.fPrev = BoxMode.fEma;
          // exact update of  q'' + 2*zeta*w*q' + w^2*q = u,
          // u = gain*w^2*F held constant over dt. Underdamped closed form
          // about the equilibrium qe = u/w^2 (zeta < 1 always in practice;
          // guard the discriminant anyway).
          double zw = BoxMode.zeta * BoxMode.w;
          double disc = 1.0 - BoxMode.zeta * BoxMode.zeta;
          double qe = BoxMode.gain * BoxMode.fPrev; // u/w^2
          double x0 = BoxMode.q - qe;
          double v0 = BoxMode.qd;
          if (disc > 1e-12) {
            double wd = BoxMode.w * sqrt(disc);
            double E = exp(-zw * dt);
            double c = cos(wd * dt), s = sin(wd * dt);
            double B = (v0 + zw * x0) / wd;
            double x1 = E * (x0 * c + B * s);
            double v1 = -zw * x1 + E * wd * (B * c - x0 * s);
            BoxMode.q = qe + x1;
            BoxMode.qd = v1;
          } else { // critically/over-damped: stable first-order fallback
            double E = exp(-zw * dt);
            BoxMode.q = qe + (x0 + v0 * dt) * E;
            BoxMode.qd = v0 * E;
          }
          // amplitude guard: the mode is a perturbation; clamp so a
          // mis-scaled gain degrades gracefully instead of draining a plenum.
          if (BoxMode.q > BoxMode.cap) BoxMode.q = BoxMode.cap;
          if (BoxMode.q < -BoxMode.cap) BoxMode.q = -BoxMode.cap;
          double aq = fabs(BoxMode.q);
          if (aq > BoxMode.qMax) BoxMode.qMax = aq;
        }
        BoxMode.fAcc = 0.0;
        BoxMode.fN = 0;
        BoxMode.lastT = tNow;
        if (getenv("OPENWAM_BOX_MODE_DIAG")) {
          static long bmDiag = 0;
          if ((bmDiag % 2000) == 0) {
            printf("BOXMODE q=%.2fPa qmax=%.2f qd=%.1f F=%.4g t=%.4f\n",
                   BoxMode.q, BoxMode.qMax, BoxMode.qd, BoxMode.fPrev, tNow);
            fflush(stdout);
            BoxMode.qMax = 0.0;
          }
          ++bmDiag;
        }
      }
      // Ramp-in: keep the mode fully decoupled until the flow field has
      // established (the pure-timing decks start from rest on a stability
      // knife edge; engaging the mode during warmup kills the run at cycle 0).
      if (tNow < BoxMode.t0) {
        BoxMode.q = 0.0;
        BoxMode.qd = 0.0;
        BoxMode.fEma = 0.0;
        FBoxModeDp = 0.0;
      } else {
        // engage GRADUALLY -- ramp the applied perturbation from 0 to full
        // over tr seconds after t0 so the flow field tracks the growing mode
        // instead of being shocked by it.
        double ramp = (tNow - BoxMode.t0) / BoxMode.tr;
        if (ramp > 1.0)
          ramp = 1.0;
        double dp = ramp * ((FBoxModeSign > 0)
                                ? BoxMode.q
                                : (FBoxModeSign < 0 ? -BoxMode.q : 0.0));
        // v5 velocity-envelope gate: fade dp out smoothly as THIS mouth
        // approaches stall/flow reversal. The plenum-side dp shifts the
        // entrante/saliente branch decision (rel/FAdCr vs 1 +/- 1e-5); near
        // stall even a ~Pa dp flips the branch discontinuously, which is
        // lethal on the alpha-stabilized knife edge. g = x^2/(1+x^2) with
        // x = |FVelocity_prev| / vgate keeps the perturbation acting only
        // while the mouth genuinely flows (also approximates the intake-
        // valve-open window, when induction flow is strong). vgate is in
        // characteristic units (v/aref); 0 = ungated (v3/v4 behaviour).
        if (BoxMode.vgate > 0.0 && dp != 0.0) {
          double x = fabs(FVelocity) / BoxMode.vgate;
          double g = (x * x) / (1.0 + x * x);
          dp *= g;
        }
        FBoxModeDp = dp;
      }
    } else {
      FBoxModeDp = 0.0;
    }

    if (!FUnionDPF) {
      FGamma = FTuboExtremo[0].Pipe->GetGamma(FNodoFin);
    } else {
#ifdef ParticulateFilter
      FGamma =
          FTuboExtremo[0]
              .DPF
              ->GetCanal(FTuboExtremo[0].NumeroHaz, FTuboExtremo[0].TipoCanal)
              ->GetGamma(FNodoFin);
#endif
    }
    FGamma1 = __Gamma::G1(FGamma);
    FGamma2 = __Gamma::G2(FGamma);
    FGamma3 = __Gamma::G3(FGamma);
    FGamma4 = __Gamma::G4(FGamma);
    FGamma5 = __Gamma::G5(FGamma);
    FGamma6 = __Gamma::G6(FGamma);

    FAd = pow(PlenumP() / FPref, 1. / FGamma4);
    rel_CCon_Entropia = *FCC / FTuboExtremo[0].Entropia;
    FAdCr = FAd / sqrt(1 + pow2(FMachVenturi) *
                               FGamma3); // Importante solo si hay venturi.
    // Si no es asi, no modifica el valor de Ad.
    if (rel_CCon_Entropia / FAdCr > 1 + 1e-5) { // Flujo entrante al deposito
      FValvula->GetCDin(Time);
      FCDEntrada = FValvula->getCDTubVol();
      FSentidoFlujo = nmEntrante;
      if (FCDEntrada > 0.0001) { /* Abierto */
        if (FCDEntrada <= 1.0) {
          FSeccionEficaz = FCDEntrada * FSeccionValvula;
          FlujoEntranteDeposito();
        } else { /* Recuperacion de la energia cinetica */
          FEDRecuperacionEnergiaCinetica();
        }

        // Transporte de especies quimicas.
        for (int j = 0; j < FNumeroEspecies - 2; j++) {
          if (!FUnionDPF) {
            FFraccionMasicaEspecie[j] =
                FTuboExtremo[0].Pipe->GetFraccionMasicaCC(FIndiceCC, j);
          } else {
#ifdef ParticulateFilter
            FFraccionMasicaEspecie[j] =
                FTuboExtremo[0]
                    .DPF
                    ->GetCanal(FTuboExtremo[0].NumeroHaz,
                               FTuboExtremo[0].TipoCanal)
                    ->GetFraccionMasicaCC(FIndiceCC, j);
#endif
          }
          FraccionMasicaAcum += FFraccionMasicaEspecie[j];
        }
        FFraccionMasicaEspecie[FNumeroEspecies - 2] = 1. - FraccionMasicaAcum;
        if (!FUnionDPF) {
          if (FHayEGR)
            FFraccionMasicaEspecie[FNumeroEspecies - 1] =
                FTuboExtremo[0].Pipe->GetFraccionMasicaCC(FIndiceCC,
                                                          FNumeroEspecies - 1);
        } else {
#ifdef ParticulateFilter
          if (FHayEGR)
            FFraccionMasicaEspecie[FNumeroEspecies - 1] =
                FTuboExtremo[0]
                    .DPF
                    ->GetCanal(FTuboExtremo[0].NumeroHaz,
                               FTuboExtremo[0].TipoCanal)
                    ->GetFraccionMasicaCC(FIndiceCC, FNumeroEspecies - 1);
#endif
        }
      } else { /* Cerrado */
        *FCD = *FCC;
        FGasto = 0.;
        FVelocity = 0.;
        FSonido = *FCC;
        // La composicion se mantiene, al estar el deposito cerrado.
      }
    } else if (rel_CCon_Entropia / FAdCr <
               1 - 1e-5) { // Flujo saliente del deposito
      FSentidoFlujo = nmSaliente;
      FValvula->GetCDout(Time);
      FCDSalida = FValvula->getCDVolTub();
      if (FCDSalida > 0.0001) { /* Abierto */
        // double TmpAa=FTuboExtremo[0].Entropia;  // nuevo para ver que pasa
        FSeccionEficaz = FCDSalida * FSeccionValvula;
        if (FDeposito->getTipoDeposito() == nmUnionDireccional) {
          FValvula->AsignaCDVolTub(FCDSalida);
        }
        FlujoSalienteDeposito();

        // Transporte de especies quimicas.
        for (int j = 0; j < FNumeroEspecies - 2; j++) {
          FFraccionMasicaEspecie[j] = FDeposito->GetFraccionMasicaEspecie(j);
          FraccionMasicaAcum += FFraccionMasicaEspecie[j];
        }
        FFraccionMasicaEspecie[FNumeroEspecies - 2] = 1. - FraccionMasicaAcum;
        if (FHayEGR)
          FFraccionMasicaEspecie[FNumeroEspecies - 1] =
              FDeposito->GetFraccionMasicaEspecie(FNumeroEspecies - 1);
        // }                                           // nuevo para ver que
        // pasa
      } else { /* Cerrado */
        *FCD = *FCC;
        FGasto = 0.;
        FVelocity = 0.;
        FSonido = *FCC;
        // La composicion se mantiene, al estar el deposito cerrado.
      }
    } else { // Flujo Parado
      FSentidoFlujo = nmParado;
      *FCD = *FCC;
      FGasto = 0.;
      FVelocity = 0.;
      FSonido = *FCC;
      // La composicion se mantiene, al estar el flujo parado.
    }

    // === GATED MOUTH ACOUSTIC-RADIATION DAMPING (Stage 56; default OFF -> byte-identical) ===
    // The intake ram resonance is unphysically high-Q, making the WOT cycle multistable
    // (the converged VE jumps chaotically with any parameter). A real trumpet mouth radiates
    // acoustic energy into the airbox (a partially-absorbing open end); the plenum BC here
    // reflects almost fully. We damp ONLY the AC (oscillating) part of the end velocity about a
    // per-boundary running mean, attenuating the reflected standing wave (lowering Q) while
    // leaving the DC (mean) WOT flow untouched: at a converged fixed point FVelocity==FVelBar,
    // so the deviation is 0 and this block is an identity (no choking). The (FVelocity, FGasto,
    // *FCD, *FCC) quadruple is kept mutually consistent using the same per-direction sign the
    // flow routines use (entrante: *FCD = FSonido - G3*V ; saliente: *FCD = FSonido + G3*V).
    if (FMouthRadAlpha < 0.0) { // read env once, then cache
      const char *ev = getenv("OPENWAM_MOUTH_RAD");
      double a = ev ? atof(ev) : 0.0;
      if (a < 0.0) a = 0.0;
      if (a > 1.0) a = 1.0;
      const char *ew = getenv("OPENWAM_MOUTH_RAD_W");
      double w = ew ? atof(ew) : 0.02;
      if (w < 0.0) w = 0.0;
      if (w > 1.0) w = 1.0;
      FMouthRadAlpha = a;
      FMouthRadW = w;
      FMouthRadGated = (a > 1e-8);
      // Stage 64: per-CC exemption list (comma-separated CC numbers). A listed
      // boundary skips the damping entirely -- used to (a) probe whether the
      // supply-side (filter->plenum) oscillation is being over-damped, and
      // (b) exempt the multi-cell box connectors so the internal box mode is
      // not artificially damped. Unset -> FMouthRadSkip stays false.
      FMouthRadSkip = false;
      if (const char *es = getenv("OPENWAM_MOUTH_RAD_SKIP_CC")) {
        const char *p = es;
        while (*p) {
          char *endp = NULL;
          long cc = strtol(p, &endp, 10);
          if (endp == p) { ++p; continue; } // skip non-numeric separator
          if ((int)cc == FNumeroCC) { FMouthRadSkip = true; break; }
          p = endp;
        }
      }
    }
    if (FMouthRadGated && !FMouthRadSkip &&
        (FSentidoFlujo == nmEntrante || FSentidoFlujo == nmSaliente)) {
      const double s = (FSentidoFlujo == nmSaliente) ? 1.0 : -1.0;
      FVelBar = (1.0 - FMouthRadW) * FVelBar + FMouthRadW * FVelocity;
      const double Vold = FVelocity;
      const double Vnew = FVelBar + (1.0 - FMouthRadAlpha) * (FVelocity - FVelBar);
      if (fabs(Vold) > 1e-30)
        FGasto *= (Vnew / Vold); // keep mass flow consistent with the damped velocity
      FVelocity = Vnew;
      *FCD = FSonido + s * FGamma3 * FVelocity;
      *FCC = FSonido - s * FGamma3 * FVelocity;
      if (getenv("OPENWAM_MOUTH_RADDIAG")) {
        static int mrDiag = 0;
        if (mrDiag < 12 || (mrDiag % 200000) == 0) {
          printf("MOUTHRAD CC%d dir=%d a=%.3f w=%.3f Vbar=%.5f Vold=%.5f Vnew=%.5f FCD=%.5f\n",
                 FNumeroCC, (int)FSentidoFlujo, FMouthRadAlpha, FMouthRadW, FVelBar, Vold, Vnew, *FCD);
          fflush(stdout);
        }
        ++mrDiag;
      }
    }

    // Stage 72: accumulate this boundary's signed flow into the box-mode
    // forcing (bank1 minus bank2). Sign convention folds into `gain`.
    if (BoxMode.on && FBoxModeSign != 0 &&
        (FSentidoFlujo == nmEntrante || FSentidoFlujo == nmSaliente)) {
      double s = (FSentidoFlujo == nmSaliente) ? 1.0 : -1.0;
      BoxMode.fAcc += FBoxModeSign * s * fabs(FGasto);
      BoxMode.fN += 1;
    }

    FValvula->AcumulaCDMedio(Time);
  } catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::CalculaCondicionContorno en la condicion "
                 "de contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::FEDRecuperacionEnergiaCinetica() {
  try {
    double xaa2 = 0., ed = 0., ei = 0., a1 = 0., a2supuesta = 0.;

    ed = *FCC;
    ei = *FCC * 2. / FGamma2;
    a2supuesta = ei; // Se suponen condiciones sonicas.

    stRecover FA2(FTuboExtremo[0].Entropia, FAdCr, FGamma,
                  FValvula->getCRecuperacion(), *FCC);
    double error = FA2(a2supuesta);

    if (error > 0) {
      FSonido = FindRoot(FA2, ed, ei);
      FVelocity = FA2.U2;
      FVelocidadGarganta = FA2.UThroat;
      a1 = FA2.A1;
    } else {
      FVelocity = 0.9999 * ei;
      FSonido = FA2.A2_2;
      FVelocidadGarganta = FA2.UThroat;
      a1 = FA2.A1;
    }

    xaa2 = pow(FTuboExtremo[0].Entropia, FGamma4);
    *FCD = FSonido - FGamma3 * FVelocity;
    *FCC = FSonido + FGamma3 * FVelocity;
    FGasto = __units::BarToPa(-FGamma * FSeccionTubo *
                              pow(FSonido,
                                  2 * FGamma6) *
                              FVelocity) /
             (__cons::ARef * xaa2); // Massflow entrante al deposito negativo.
    FRelacionPresionGarganta =
        pow(FSonido / (FTuboExtremo[0].Entropia * FAdCr), FGamma4);
    FGastoGarganta = FGasto / (FValvula->getCRecuperacion() * FSeccionValvula);
    FMachGarganta = FVelocidadGarganta / a1; // En valor absoluto.

  } catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::FEDRecuperacionEnergiaCinetica en la "
                 "condicion de contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::FlujoEntranteDeposito() {
  try {
    double vel_son_garganta = 0., velocidad_garganta = 0., Mach = 0., xaa2 = 0.,
           ycal = 0., d1 = 0.;

    Fk = FSeccionTubo / FSeccionEficaz;
    if (Fk < 1)
      Fk = 1.0;
    vel_son_garganta = FTuboExtremo[0].Entropia * FAdCr;
    // Velocity del sonido en la garganta. Adimensional.

    // Calculo de la velocidad en la garganta.Caso de salto subcritico.
    FCaso = nmFlujoEntranteSaltoSubcritico;
    if (Fk == 1) {
      FSonido = FTuboExtremo[0].Entropia * FAdCr;
      FVelocity = (*FCC - FSonido) / FGamma3;
    } else
      Resolucion(vel_son_garganta, *FCC, FCaso, &FVelocity, &FSonido);

    // Ecuacion de la energia
    velocidad_garganta = sqrt(
        2. * FGamma6 *
        (pow2(FSonido) + FGamma3 * pow2(FVelocity) - pow2(vel_son_garganta)));
    // Se ha calculado la velocidad en la garganta en valor absoluto.

    // Calculo de la velocidad en la garganta en el caso de salto supercritico
    if (velocidad_garganta > vel_son_garganta) {
      FCaso = nmFlujoEntranteSaltoSupercritico;
      Resolucion(0.0, 1.0, FCaso, &ycal, &Mach);
      FVelocity = *FCC / (1 / Mach + FGamma3);
      FSonido = FVelocity / Mach;

      d1 = Fk * FVelocity * pow(FSonido, 1. / FGamma3);
      vel_son_garganta = pow(d1, FGamma1 / FGamma2);
      velocidad_garganta = vel_son_garganta;
    }
    // Fin caso de salto supercritico

    xaa2 = pow(FTuboExtremo[0].Entropia, FGamma4);
    FGasto = __units::BarToPa(-FGamma * FSeccionTubo *
                              pow(FSonido,
                                  2 * FGamma6) *
                              FVelocity) /
             (__cons::ARef * xaa2); // Massflow entrante al deposito negativo
    *FCD = FSonido - FGamma3 * FVelocity;
    *FCC = FSonido + FGamma3 * FVelocity;
    FRelacionPresionGarganta =
        pow(FSonido / (FTuboExtremo[0].Entropia * FAdCr), FGamma4);
    FGastoGarganta = FGasto / (FCDEntrada * FSeccionValvula);
    FMachGarganta = velocidad_garganta / vel_son_garganta;
    // En valor absoluto.Antes tenia signo.
    FVelocidadGarganta = velocidad_garganta;

  }

  catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::FlujoEntranteDeposito en la condicion de "
                 "contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::FlujoSalienteDeposito() {
  try {

    double a1 = 0., xx = 0., yy = 0., d1 = 0.;
    double a2cr = 0., val1 = 0., val2 = 0., u2cr = 0., ycal = 0., error = 0.,
           valde = 0., miembro2 = 0.;
    // Variables para resolver la onda de choque.
    double relacion_velocidades_son, Mach_tras_ondachoque, Mach,
        temp_antes_ondachoque, temp_tras_ondachoque;

    Fk = FSeccionTubo / FSeccionEficaz;
    if (Fk < 1)
      Fk = 1;

    /* Calculo del valor de la velocidad del sonido en el extremo del tubo para
     el cual el salto es critico. */
    u2cr = PlenumA() * sqrt(2. / FGamma2) *
           (sqrt(pow2(Fk) + FGamma1 * FGamma2) - Fk) / FGamma1;
    a2cr = sqrt(pow2(PlenumA()) - FGamma3 * pow2(u2cr));
    // Ecuacion de la energia. Garganta-Deposito.

    /* A partir  de a2cr se determina el error en el calculo de A2 al suponer
     salto subcritico. Si es negativo, el salto es supercritico. Si es positivo,
     el salto es subcritico. */
    // FSSubcritico(a2cr,&error,&miembro2);
    stFSSub FSA2(FTuboExtremo[0].Entropia, FAdCr, FGamma, Fk, *FCC,
                 PlenumA());

    error = FSA2(a2cr);

    if (error < 0.) { // Salto de presiones supercritico.

      /* Determinacion del intervalo de iteracion. Para ello se supone que
       en el extremo del tubo se dan las condiciones criticas. Explicado en
       los apuntes de Pedro. */
      a1 = sqrt(2. / FGamma2) * PlenumA();
      FVelocidadGarganta = a1;
      xx = pow(FAdCr / PlenumA(), FGamma4);
      yy = pow(a1, 2. / FGamma1);
      Fcc = FVelocidadGarganta * yy * xx / Fk;

      stFSSup FU2(FTuboExtremo[0].Entropia, Fcc, FGamma, Fk, *FCC,
                  PlenumA());
      val1 = FU2(FVelocidadGarganta);

      // FSSupercritico(FVelocidadGarganta,&val1,&val2);
      if (val1 < 0.)
        valde = FVelocidadGarganta;
      if (val1 >= 0.) {
        double Epsilon = numeric_limits<double>::epsilon();
        valde = PlenumA() / sqrt(FGamma3) - Epsilon;
      }

      /* Una vez conocido el intervalo de iteracion, se pasa a la resolucion
       del caso flujo saliente salto supercritico. */
      FCaso = nmFlujoSalienteSaltoSupercritico;
      Resolucion(0.0, valde, FCaso, &FVelocity, &FSonido);

      // Calcula del massflow. Como es saliente del deposito, siempre es
      // positivo.
      xx = pow(sqrt(2. / FGamma2), (FGamma2 / FGamma1));
      yy = pow(FAdCr, FGamma4);
      FGasto =
          __units::BarToPa(FCDSalida * FSeccionValvula * FGamma * xx * yy) /
          (PlenumA() * __cons::ARef);

      /* Reduccion a flujo subsonico mediante onda de choque plana en el caso
       de que se hayan obtenido condiciones supersonicas en el extremo del
       tubo. Explicado en la tesis Corberan (pagina de la 47 a la 52
       (punto 2.5) y de la 122 a la 129 (lo importante a partir de la 127) */
      Mach = FVelocity / FSonido;
      xx = *FCC + FGamma3 * FVelocity;
      FTuboExtremo[0].Entropia = FTuboExtremo[0].Entropia * FSonido / xx;
      // Ecuacion de la caracteristica incidente.
      if (Mach > 1.) {

        /* Las ecuaciones siguientes corresponden a la resolucion de la onda
         de choque plana. Se pueden encontrar en el punto 2.5 de la tesis
         de Corberan. */
        xx = FGamma4 * pow2(Mach) - 1.;
        Mach_tras_ondachoque = sqrt((pow2(Mach) + 2. / FGamma1) / xx);
        temp_tras_ondachoque = FGamma3 * pow2(Mach) + 1.;
        temp_antes_ondachoque = FGamma3 * pow2(Mach_tras_ondachoque) + 1.;
        relacion_velocidades_son =
            sqrt(temp_tras_ondachoque / temp_antes_ondachoque);
        FSonido = FSonido * relacion_velocidades_son;
        FVelocity = FSonido * Mach_tras_ondachoque;
        d1 = xx * FGamma1 / FGamma2;
        FTuboExtremo[0].Entropia = FTuboExtremo[0].Entropia *
                                   relacion_velocidades_son / pow(d1, FGamma5);
      }
    } else { // Salto de presiones subcritico.

      // Resolucion del caso de flujo saliente salto subcritico.
      FCaso = nmFlujoSalienteSaltoSubcritico;
      Resolucion(a2cr, PlenumA(), FCaso, &ycal, &FSonido);
      // Aplicando la Ecuacion de la Energia entre el deposito y la garganta:
      FVelocity =
          sqrt((pow2(PlenumA()) - pow2(FSonido)) / FGamma3);

      // Calculo del massflow. Como es saliente del deposito, siempre es
      // positivo.
      a1 = PlenumA() * (*FCC + FGamma3 * FVelocity) /
           (FTuboExtremo[0].Entropia * FAd);
      FVelocidadGarganta = Fk * pow2(a1) * FVelocity / pow2(FSonido);
      FGasto = __units::BarToPa(FCDSalida * FSeccionValvula * FGamma *
                                pow(FAd / PlenumA(), FGamma4) *
                                FVelocidadGarganta * pow(a1, 2. / FGamma1)) /
               __cons::ARef;
      xx = *FCC + FGamma3 * FVelocity;
      FTuboExtremo[0].Entropia = FTuboExtremo[0].Entropia * FSonido / xx;
      // Ecuacion de la caracteristica incidente.
    }
    *FCD = FSonido + FGamma3 * FVelocity;
    *FCC = FSonido - FGamma3 * FVelocity;
    d1 = FSonido / (FTuboExtremo[0].Entropia * FAdCr);
    FRelacionPresionGarganta = pow(d1, FGamma4);
    FMachGarganta = FVelocidadGarganta / a1; // En valor absoluto.
    FGastoGarganta = FGasto / (FCDSalida * FSeccionValvula);
  } catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::FlujoSalienteDeposito en la condicion de "
                 "contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCDeposito::Resolucion(double ext1, double ext2, nmCaso Caso, double *u2t,
                             double *a2t) {
  try {
    /* std::cout << FNumeroCC << std::endl;
     if(FNumeroCC==26){
     std::cout << "peta";
     } */

    if (Caso == nmFlujoEntranteSaltoSubcritico) {
      stFESub FEA2(FTuboExtremo[0].Entropia, FAdCr, FGamma, Fk, *FCC);
      *a2t = FindRoot(FEA2, ext1, ext2);
      *u2t = FEA2.U2;
    } else if (Caso == nmFlujoEntranteSaltoSupercritico) {
      stFESup FMatch(FGamma, Fk);
      *a2t = FindRoot(FMatch, ext1, ext2);
      *u2t = 0.;
    } else if (Caso == nmFlujoSalienteSaltoSubcritico) {
      stFSSub FSA2(FTuboExtremo[0].Entropia, FAdCr, FGamma, Fk, *FCC,
                   PlenumA());
      *a2t = FindRoot(FSA2, ext1, ext2);
      *u2t = FSA2.U2;
    } else if (Caso == nmFlujoSalienteSaltoSupercritico) {
      stFSSup FU2(FTuboExtremo[0].Entropia, Fcc, FGamma, Fk, *FCC,
                  PlenumA());
      *u2t = FindRoot(FU2, ext1, ext2);
      *a2t = FU2.A2;
    } else {
      printf("Error en la definicion del flujo TCCDeposito::Resolucion en la "
             "condicion de contorno: %d\n",
             FNumeroCC);
      throw Exception("");
    }
  }

  catch (exception &N) {
    std::cout << "ERROR: TCCDeposito::Resolucion en la condicion de contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

////---------------------------------------------------------------------------
////---------------------------------------------------------------------------
//
// void TCCDeposito::FESubcritico(double vel_son_supuesta,double *u2_1,double
// *u2_2)
// {
// try
// {
//
// double xx,yy;
//
// /* Resolucion de la ecuacion (20) del articulo "Solucion a la condicion de
// contorno de la union cilindro-conducto de los MCIA". Ecuacion 4.30 en la
// tesis de Corberan */
//
// xx=vel_son_supuesta/(FTuboExtremo[0].Entropia*FAdCr);
// yy=pow(xx,4.*FGamma6);
// yy=pow(Fk,2.)*yy-1.;
// *u2_2=FTuboExtremo[0].Entropia*FAdCr*sqrt(2.*FGamma6*(pow(xx,2.)-1.)/yy); //
// Valor absoluto
//
//
// /* Resolucion de la ecuacion de la caracteristica incidente. */
//
// *u2_1=(*FCC-vel_son_supuesta)/FGamma3;  // En valor absoluto
//
//
//
// }
// catch(Exception &N)
// {
// std::cout << "ERROR: TCCDeposito::FESubcritico en la condicion de contorno: "
// << FNumeroCC << std::endl; std::cout << "Tipo de error: " << N.what() <<
// std::endl; throw Exception(N.what());
// }
// }
//
////---------------------------------------------------------------------------
////---------------------------------------------------------------------------.
//
// void TCCDeposito::FESupercritico(double mach_supuesto,double *miembro1,
// double *miembro2)
// {
// try
// {
//
// double xx,yy;
//
// /* Resolucion de la ecuacion (21) del articulo "Solucion a la condicion de
// contorno de la union cilindro-conducto de los MCIA". Ecuacion (4.31) de
// la tesis de Corberan */
//
// yy=(FGamma2/2.)*pow(Fk*mach_supuesto,2.*FGamma1/FGamma2);
// xx=FGamma3*pow(mach_supuesto,2);
// *miembro1=xx-yy+1.;     // Miembro 1 de la ecuacion (21)
// *miembro2=0;            // Miembro 2 de la ecuacion (21)
//
// }
// catch(Exception &N)
// {
// std::cout << "ERROR: TCCDeposito::FESupercritico en la condicion de contorno:
// " << FNumeroCC << std::endl; std::cout << "Tipo de error: " << N.what() <<
// std::endl; throw Exception(N.what());
// }
// }
//
////---------------------------------------------------------------------------
////---------------------------------------------------------------------------
//
// void TCCDeposito::FSSubcritico(double vel_son_supuesta,double *error,double
// *miembro2)
// {
// try
// {
// double a1,u1,u2;
//
// *miembro2=0;
//
// /* Resolucion del algoritmo de calculo propuesto en la pagina 113 de la tesis
// de Corberan. */
//
// u2 =
// sqrt((pow(FDeposito->getSpeedsound(),2)-pow(vel_son_supuesta,2))/FGamma3); a1
// =
// FDeposito->getSpeedsound()*(*FCC+FGamma3*u2)/(FTuboExtremo[0].Entropia*FAdCr);
// u1 = Fk*u2*pow(a1,2)/pow(vel_son_supuesta,2);
// *error=pow(a1,2)+FGamma3*pow(u1,2)-pow(FDeposito->getSpeedsound(),2);
//
// }
// catch(Exception &N)
// {
// std::cout << "ERROR: TCCDeposito::FSSubcritico en la condicion de contorno: "
// << FNumeroCC << std::endl; std::cout << "Tipo de error: " << N.what() <<
// std::endl; throw Exception(N.what());
// }
// }
//
////---------------------------------------------------------------------------
////---------------------------------------------------------------------------
//
// void TCCDeposito::FSSupercritico(double vel_supuesta,double *a2_1,double
// *a2_2)
// {
// try
// {
//
// // Resolucion de la ecuacion de la energia entre el deposito y el extremo del
// tubo. *a2_1 =
// sqrt(pow(FDeposito->getSpeedsound(),2)-FGamma3*pow(vel_supuesta,2));
//
// // Resolucion de la ecuacion 4.20 de la tesis de Corberan.
// *a2_2 = sqrt(vel_supuesta*pow((*FCC+FGamma3*vel_supuesta)/
// FTuboExtremo[0].Entropia,FGamma4)/Fcc);
//
// }
// catch(Exception &N)
// {
// std::cout << "ERROR: TCCDeposito::FSSupercritico en la condicion de contorno:
// " << FNumeroCC << std::endl; std::cout << "Tipo de error: " << N.what() <<
// std::endl; throw Exception(N.what());
// }
// }
//
////---------------------------------------------------------------------------
////---------------------------------------------------------------------------

#pragma package(smart_init)
