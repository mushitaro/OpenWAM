/* --------------------------------------------------------------------------------*\
==========================|
 \\   /\ /\   // O pen     | OpenWAM: The Open Source 1D Gas-Dynamic Code
 \\ |  X  | //  W ave     |
 \\ \/_\/ //   A ction   | CMT-Motores Termicos / Universidad Politecnica
Valencia
 \/   \//    M odel    |
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

#include "TCCRamificacion.h"
// #include <cmath>
#include <atomic>
#include <cmath>
#include <iostream>
#include <map>
#include <vector>
#include <memory>
#include "TTubo.h"

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TCCRamificacion::TCCRamificacion(nmTypeBC TipoCC, int numCC,
                                 nmTipoCalculoEspecies SpeciesModel,
                                 int numeroespecies,
                                 nmCalculoGamma GammaCalculation,
                                 bool ThereIsEGR)
    : TCondicionContorno(TipoCC, numCC, SpeciesModel, numeroespecies,
                         GammaCalculation, ThereIsEGR) {

  FTuboExtremo = NULL;

  // Stage 66: Type-12 mouth radiation damping (env-gated, default OFF)
  FT12RadAlpha = -1.0; // sentinel: env not yet read
  FT12RadW = 0.0;
  FT12RadGated = false;
  FT12DampEnd = -1;
  FVelBarT12 = 0.0;

  FNodoFin = NULL;
  FIndiceCC = NULL;
  FEntropia = NULL;
  FSeccionTubo = NULL;
  FVelocity = NULL;
  FDensidad = NULL;
  FNumeroTubo = NULL;

  FCC = NULL;
  FCD = NULL;

  FMasaEspecie = NULL;
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TCCRamificacion::~TCCRamificacion() {

  if (FTuboExtremo != NULL)
    delete[] FTuboExtremo;
  if (FNodoFin != NULL)
    delete[] FNodoFin;
  if (FIndiceCC != NULL)
    delete[] FIndiceCC;
  if (FEntropia != NULL)
    delete[] FEntropia;
  if (FSeccionTubo != NULL)
    delete[] FSeccionTubo;
  if (FVelocity != NULL)
    delete[] FVelocity;
  if (FDensidad != NULL)
    delete[] FDensidad;
  if (FNumeroTubo != NULL)
    delete[] FNumeroTubo;

  if (FCC != NULL)
    delete[] FCC;
  if (FCD != NULL)
    delete[] FCD;

  if (FMasaEspecie != NULL)
    delete[] FMasaEspecie;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCRamificacion::AsignaTubos(
    int NumberOfPipes, const std::vector<std::unique_ptr<TTubo>> &Pipe) {
  try {
    int i = 0;
    int ContadorTubosRamificacion = 0;

    ContadorTubosRamificacion = 0;

    for (int i = 0; i < NumberOfPipes; i++) {
      if (Pipe[i]->getNodoIzq() == FNumeroCC ||
          Pipe[i]->getNodoDer() == FNumeroCC) {
        ContadorTubosRamificacion++;
      }
    }

    FTuboExtremo = new stTuboExtremo[ContadorTubosRamificacion];
    FNodoFin = new int[ContadorTubosRamificacion];
    FIndiceCC = new int[ContadorTubosRamificacion];
    FCC = new double *[ContadorTubosRamificacion];
    FCD = new double *[ContadorTubosRamificacion];
    FEntropia = new double[ContadorTubosRamificacion];
    FSeccionTubo = new double[ContadorTubosRamificacion];
    FVelocity = new double[ContadorTubosRamificacion];
    FDensidad = new double[ContadorTubosRamificacion];
    FNumeroTubo = new int[ContadorTubosRamificacion];

    for (int i = 0; i < ContadorTubosRamificacion; i++) {
      FTuboExtremo[i].Pipe = NULL;
      FVelocity[i] = 0;
    }

    while (FNumeroTubosCC < ContadorTubosRamificacion && i < NumberOfPipes) {
      if (Pipe[i]->getNodoIzq() == FNumeroCC) {
        FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
        FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
        FNodoFin[FNumeroTubosCC] = 0;
        FIndiceCC[FNumeroTubosCC] = 0;
        FNumeroTubo[FNumeroTubosCC] = Pipe[i]->getNumeroTubo() - 1;
        FCC[FNumeroTubosCC] = &(FTuboExtremo[FNumeroTubosCC].Beta);
        FCD[FNumeroTubosCC] = &(FTuboExtremo[FNumeroTubosCC].Landa);
        FSeccionTubo[FNumeroTubosCC] =
            __geom::Circle_area(Pipe[i]->GetDiametro(FNodoFin[FNumeroTubosCC]));
        FNumeroTubosCC++;
      }
      if (Pipe[i]->getNodoDer() == FNumeroCC) {
        FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
        FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
        FNodoFin[FNumeroTubosCC] = Pipe[i]->getNin() - 1;
        FIndiceCC[FNumeroTubosCC] = 1;
        FNumeroTubo[FNumeroTubosCC] = Pipe[i]->getNumeroTubo() - 1;
        FCC[FNumeroTubosCC] = &(FTuboExtremo[FNumeroTubosCC].Landa);
        FCD[FNumeroTubosCC] = &(FTuboExtremo[FNumeroTubosCC].Beta);
        FSeccionTubo[FNumeroTubosCC] =
            __geom::Circle_area(Pipe[i]->GetDiametro(FNodoFin[FNumeroTubosCC]));
        FNumeroTubosCC++;
      }
      i++;
    }

    // Inicializacion del transporte de especies quimicas.
    FFraccionMasicaEspecie = new double[FNumeroEspecies - FIntEGR];
    FMasaEspecie = new double[FNumeroEspecies - FIntEGR];
    for (int i = 0; i < FNumeroEspecies - FIntEGR; i++) {
      FFraccionMasicaEspecie[i] =
          FTuboExtremo[0].Pipe->GetFraccionMasicaInicial(i);
      // Se inicializa con el Pipe 0 de modo arbitrario.
    }

  } catch (std::exception &N) {
    std::cout << "ERROR: TCCRamificacion::AsignaTubos en la condicion de "
                 "contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TCCRamificacion::TuboCalculandose(int TuboActual) {
  try {
    FTuboActual = TuboActual;
    if (FTuboActual == 10000) {
      FTiempoActual = FTuboExtremo[0].Pipe->getTime1();
    } else {
      for (int i = 0; i < FNumeroTubosCC; i++) {
        if (FNumeroTubo[i] == FTuboActual) {
          FTiempoActual = FTuboExtremo[i].Pipe->getTime1();
        }
      }
    }
  } catch (std::exception &N) {
    std::cout << "ERROR: TCCRamificacion::TuboCalculandose en la condicion de "
                 "contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

// Stage 66: mouth acoustic-radiation damping at a Type-12 branch end. Same
// physics as the TCCDeposito Type-11 block (TCCDeposito.cpp Stage 56): damp
// ONLY the AC (oscillating) part of the junction-oriented end velocity about a
// per-junction running mean, attenuating the reflected standing wave at the
// trumpet-adapter mouth WITHOUT touching the DC mean flow (identity at a
// converged fixed point). Junction conventions (see the writeback above):
//   v_junction = (*FCC - *FCD) / G1   (positive = OUT of the pipe),
//   a          = (*FCC + *FCD) / 2,   G1 = 2*G3.
// Applied only to pipe-end k == FT12DampEnd (the smallest section = the
// adapter mouth), only when its own tube is being updated, so the EWMA
// advances exactly once per time step.
void TCCRamificacion::T12MouthRad(int k) {
  if (!FT12RadGated || k != FT12DampEnd)
    return;
  const double vin = (*FCC[k] - *FCD[k]) / FGamma1;
  const double a_end = 0.5 * (*FCC[k] + *FCD[k]);
  FVelBarT12 = (1.0 - FT12RadW) * FVelBarT12 + FT12RadW * vin;
  const double vnew = FVelBarT12 + (1.0 - FT12RadAlpha) * (vin - FVelBarT12);
  *FCC[k] = a_end + FGamma3 * vnew;
  *FCD[k] = a_end - FGamma3 * vnew;
  FVelocity[k] = vnew;
}

void TCCRamificacion::CalculaCondicionContorno(double Time) {
  try {
    double sonido_supuesta_ad, sonido_ant_ad, entropia_entrante, corr_entropia;
    double suma1 = 0., suma2 = 0., sm1 = 0., sm2 = 0., sm3 = 0.;
    int TuboCalculado = 0;
    double DeltaT, MasaTotal = 0., g, m, FraccionMasicaAcum = 0.;
    // Necesarias para el calculo de especies en la BC.

    /* Fix 2a: Better initial guess from average of input characteristics */
    sonido_supuesta_ad = 0.0;
    for (int i = 0; i < FNumeroTubosCC; i++) {
      sonido_supuesta_ad += *FCC[i];
    }
    sonido_supuesta_ad /= FNumeroTubosCC;
    if (sonido_supuesta_ad <= 0.0 || std::isnan(sonido_supuesta_ad))
      sonido_supuesta_ad = 1.0;

    FTiempoActual = Time;
    DeltaT = FTiempoActual - FTiempoAnterior;
    FTiempoAnterior = FTiempoActual;

    if (FTuboActual == 10000) {
      TuboCalculado = FTuboActual;
      FGamma = FTuboExtremo[0].Pipe->GetGamma(FNodoFin[0]);
    } else {
      for (int i = 0; i < FNumeroTubosCC; i++) {
        if (FNumeroTubo[i] == FTuboActual) {
          TuboCalculado = i;
        }
      }
      FGamma =
          FTuboExtremo[TuboCalculado].Pipe->GetGamma(FNodoFin[TuboCalculado]);
    }
    // FGamma=FTuboExtremo[TuboCalculado].Pipe->GetGamma(FNodoFin[TuboCalculado]);
    FGamma1 = __Gamma::G1(FGamma);
    FGamma3 = __Gamma::G3(FGamma);
    FGamma4 = __Gamma::G4(FGamma);

    // Stage 66: cache the Type-12 mouth-rad env once (unset -> gate stays
    // false -> zero behavioral change). FNumeroCC matches the deck cid + 1.
    if (FT12RadAlpha < 0.0) {
      FT12RadAlpha = 0.0;
      const char *el = getenv("OPENWAM_MOUTH_RAD_T12_CC");
      if (el) {
        bool listed = false;
        const char *p = el;
        while (*p) {
          char *endp = NULL;
          long cc = strtol(p, &endp, 10);
          if (endp == p) { ++p; continue; }
          if ((int)cc == FNumeroCC) { listed = true; break; }
          p = endp;
        }
        if (listed) {
          const char *ev = getenv("OPENWAM_MOUTH_RAD");
          double a = ev ? atof(ev) : 0.0;
          if (a < 0.0) a = 0.0;
          if (a > 1.0) a = 1.0;
          const char *ew = getenv("OPENWAM_MOUTH_RAD_W");
          double w = ew ? atof(ew) : 0.02;
          if (w < 0.0) w = 0.0;
          if (w > 1.0) w = 1.0;
          FT12RadAlpha = a;
          FT12RadW = w;
          FT12RadGated = (a > 1e-8) && (FNumeroTubosCC > 0);
          if (FT12RadGated) {
            int k = 0;
            for (int i = 1; i < FNumeroTubosCC; i++)
              if (FSeccionTubo[i] < FSeccionTubo[k])
                k = i;
            FT12DampEnd = k;
            printf("T12 MOUTHRAD CC%d: damping end %d (S=%.5f m2) a=%.3f w=%.3f\n",
                   FNumeroCC, k, FSeccionTubo[k], FT12RadAlpha, FT12RadW);
          }
        }
      }
    }

    for (int i = 0; i < FNumeroTubosCC; i++) {
      FEntropia[i] = FTuboExtremo[i].Entropia;
    }

    /* Fix 2b: Iteration-limited convergence with entropy/denominator guards */
    int iter = 0;
    const int MAX_ITER = 100;
    do {
      /* Determinacion de la velocidad del sonido en la ramificacion. */
      suma1 = 0.;
      suma2 = 0.;
      for (int i = 0; i < FNumeroTubosCC; i++) {
        double ent2 = pow2(FEntropia[i]);
        if (ent2 < 1e-12 || std::isnan(ent2))
          ent2 = 1.0;
        suma1 = suma1 + (*FCC[i]) * FSeccionTubo[i] / ent2;
        suma2 = suma2 + FTuboExtremo[i].Entropia * FSeccionTubo[i] / ent2;
      }
      sonido_ant_ad = sonido_supuesta_ad;
      if (suma2 < 1e-12)
        break; /* Degenerate: all entropy collapsed */
      sonido_supuesta_ad = suma1 / suma2;

      for (int i = 0; i < FNumeroTubosCC; i++) {
        FVelocity[i] =
            (*FCC[i] - sonido_supuesta_ad * FTuboExtremo[i].Entropia) / FGamma3;
      }

      sm1 = 0.;
      sm2 = 0.;
      sm3 = 0.;
      for (int i = 0; i < FNumeroTubosCC; i++) {
        sm3 = sm3 + FTuboExtremo[i].Entropia;
        if (FVelocity[i] > 2e-6) {
          sm1 = sm1 + FVelocity[i] * FSeccionTubo[i] * FEntropia[i];
          sm2 = sm2 + FVelocity[i] * FSeccionTubo[i];
        }
      }

      if (sm2 < 2e-6) {
        entropia_entrante = sm3 / FNumeroTubosCC;
      } else {
        entropia_entrante = sm1 / sm2;
      }
      for (int i = 0; i < FNumeroTubosCC; i++) {
        FEntropia[i] = FTuboExtremo[i].Entropia;
        if (FVelocity[i] < 0) { // Flujo entrante al tubo
          FEntropia[i] = entropia_entrante;
        }
      }
      iter++;
    } while (iter < MAX_ITER && fabs(sonido_supuesta_ad - sonido_ant_ad) /
                                        (fabs(sonido_ant_ad) + 0.01) >
                                    1e-4);

    if (TuboCalculado != 10000) {
      corr_entropia =
          FTuboExtremo[TuboCalculado].Entropia / FEntropia[TuboCalculado];
      // A collapsed/NaN entropy ratio would poison the characteristics; fall
      // back to "no correction" (ratio 1) when it is not physical.
      if (!std::isfinite(corr_entropia) || corr_entropia <= 0.0)
        corr_entropia = 1.0;
      *FCC[TuboCalculado] =
          (*FCC[TuboCalculado] +
           FGamma3 * FVelocity[TuboCalculado] * (corr_entropia - 1)) /
          corr_entropia;
      *FCD[TuboCalculado] =
          *FCC[TuboCalculado] - FGamma1 * FVelocity[TuboCalculado];
      FTuboExtremo[TuboCalculado].Entropia = FEntropia[TuboCalculado];

      double ason = (*FCC[TuboCalculado] + *FCD[TuboCalculado]) / 2;
      // Sound speed must be strictly positive. During violent choked blowdown
      // the update above can make ason non-positive (or NaN); then
      // Machx = |v|/ason comes out negative, the `Machx > 1` sonic test below
      // is bypassed, and the unphysical state propagates into the connected
      // pipe as NaN. Floor ason so the normal-shock reduction actually fires
      // and returns a physical post-shock state.
      if (!(ason > 0.0))
        ason = 1e-4;
      double Machx = fabs(FVelocity[TuboCalculado]) / ason;
      if (Machx > 1) {
        printf("Sonic condition in boundary: %d\n", FNumeroCC);
        ReduceSubsonicFlow(ason, FVelocity[TuboCalculado], FGamma);
        *FCC[TuboCalculado] = ason + FGamma3 * FVelocity[TuboCalculado];
        *FCD[TuboCalculado] = ason - FGamma3 * FVelocity[TuboCalculado];
      }
      T12MouthRad(TuboCalculado); // Stage 66 (no-op unless env-gated)
    } else {
      for (int i = 0; i < FNumeroTubosCC; i++) {
        corr_entropia = FTuboExtremo[i].Entropia / FEntropia[i];
        if (!std::isfinite(corr_entropia) || corr_entropia <= 0.0)
          corr_entropia = 1.0;
        *FCC[i] = (*FCC[i] + FGamma3 * FVelocity[i] * (corr_entropia - 1)) /
                  corr_entropia;
        *FCD[i] = *FCC[i] - FGamma1 * FVelocity[i];
        FTuboExtremo[i].Entropia = FEntropia[i];
        /* Fix 3b: Guarded inline normal shock (same pattern as
         * ReduceSubsonicFlow) */
        double sum_cc = *FCC[i] + *FCD[i];
        if (fabs(sum_cc) < 1e-12)
          sum_cc = 1e-12;
        double Machx = fabs(*FCC[i] - *FCD[i]) / fabs(sum_cc) * 2.0 / FGamma1;
        if (Machx > 1) {
          printf("Sonic condition in boundary: %d\n", FNumeroCC);
          if (Machx < 1.001)
            Machx = 1.001;
          double denom_shock = FGamma4 * pow2(Machx) - 1.0;
          if (denom_shock < 1e-6)
            denom_shock = 1e-6;
          double Machy = sqrt((pow2(Machx) + 2. / FGamma1) / denom_shock);
          double asonido = fabs(sum_cc) / 2.0;
          double Sonidoy = asonido * sqrt((FGamma3 * pow2(Machx) + 1.) /
                                          (FGamma3 * pow2(Machy) + 1.));
          double sign_v = (*FCC[i] - *FCD[i] >= 0) ? 1.0 : -1.0;
          double Velocidady = sign_v * Sonidoy * Machy;
          *FCC[i] = Sonidoy + FGamma3 * Velocidady;
          *FCD[i] = Sonidoy - FGamma3 * Velocidady;
        }
        T12MouthRad(i); // Stage 66 (no-op unless env-gated)
      }
    }

    // Final positivity / finiteness guard on the junction characteristics.
    // A Type-12 Riemann junction (port-merge, intake equalisation, collector)
    // under sustained supersonic / reversing blowdown can leave a non-finite or
    // non-physical (Landa, Beta, Entropia) in a connected pipe end. That NaN is
    // then read straight into the pipe's boundary cell and poisons the whole
    // network -- it is THE residual exhaust/intake freeze source. For any pipe
    // end whose stored state is non-finite, or whose implied sound speed
    // (Landa+Beta)/2 is non-positive, reset it to a quiescent state built from
    // that pipe's own incident characteristic (sound speed = |incident|, zero
    // velocity), which is positivity-preserving and lets the solve continue
    // instead of diverging. Healthy junctions (a ~ 1) never enter this branch.
    {
      static std::atomic<int> s_juncWarn{0};
      for (int i = 0; i < FNumeroTubosCC; i++) {
        double L = *FCD[i]; // Landa stored via FCD/FCC aliases per end type
        double B = *FCC[i];
        double E = FTuboExtremo[i].Entropia;
        double ason = 0.5 * (L + B);
        if (!std::isfinite(L) || !std::isfinite(B) || !std::isfinite(E) ||
            !(E > 1.0e-6) || !(ason > 1.0e-4)) {
          // Incident characteristic from the pipe (Landa at this end), floored.
          double inc = FTuboExtremo[i].Landa;
          if (!std::isfinite(inc) || inc < 1.0e-3)
            inc = 1.0e-3;
          // Quiescent reset: a = inc, v = 0  ->  Landa = Beta = inc.
          *FCC[i] = inc;
          *FCD[i] = inc;
          if (!std::isfinite(E) || E < 1.0e-6)
            FTuboExtremo[i].Entropia = 1.0;
          FVelocity[i] = 0.0;
          int n = s_juncWarn.fetch_add(1);
          if (n < 20)
            printf("WARNING: junction %d pipe-end %d non-physical state reset "
                   "(L=%.2e B=%.2e E=%.2e)\n", FNumeroCC, i, L, B, E);
        }
      }
    }

    // Transporte de especies quimicas.
    for (int j = 0; j < FNumeroEspecies - FIntEGR; j++) {
      FMasaEspecie[j] = 0.;
    }
    for (int i = 0; i < FNumeroTubosCC; i++) {
      if (FVelocity[i] > 0.) { // Flujo Saliente del tubo
        // Guard the pow() base: (lambda+beta)/2 is the sound speed and must be
        // >= 0; a non-finite/negative base would make pow(neg, FGamma4) NaN.
        double dens_base =
            ((*FCC[i] + *FCD[i]) / 2) / FTuboExtremo[i].Entropia;
        if (!std::isfinite(dens_base) || dens_base < 0.0)
          dens_base = 0.0;
        FDensidad[i] = pow(dens_base, FGamma4);
        g = FDensidad[i] * FSeccionTubo[i] * FVelocity[i];
        m = g * DeltaT;
        MasaTotal += m;
        for (int j = 0; j < FNumeroEspecies - FIntEGR; j++) {
          FMasaEspecie[j] +=
              FTuboExtremo[i].Pipe->GetFraccionMasicaCC(FIndiceCC[i], j) * m;
        }
      }
    }

    if (MasaTotal != 0) {
      for (int j = 0; j < FNumeroEspecies - 2; j++) {
        FFraccionMasicaEspecie[j] = FMasaEspecie[j] / MasaTotal;
        FraccionMasicaAcum += FFraccionMasicaEspecie[j];
      }
      FFraccionMasicaEspecie[FNumeroEspecies - 2] = 1. - FraccionMasicaAcum;
      if (FHayEGR)
        FFraccionMasicaEspecie[FNumeroEspecies - 1] =
            FMasaEspecie[FNumeroEspecies - 1] / MasaTotal;
    }

    // Junction energy-conservation probe (OPENWAM_JUNCENE=1). The intake heats to
    // a spurious ~570 K from a NUMERICAL energy source in the manifold interior
    // (Stage 27-28). An adiabatic branch junction must conserve mass and enthalpy:
    // summed over all its pipe ends, <net mass flux INTO junction> and <net
    // enthalpy flux INTO junction> are both ~0 in a converged cycle. A junction
    // that CREATES enthalpy shows net enthalpy flux != 0. Accumulate per junction
    // over a time window using the junction's own imposed velocities and the
    // connected pipe states; report the net rates. Single-thread diagnostic.
    if (getenv("OPENWAM_JUNCENE")) {
      struct JBal { double t = 0, mIn = 0, hIn = 0, absM = 0, hAbs = 0; };
      static std::map<int, JBal> s_jb;
      JBal &jb = s_jb[FNumeroCC];
      const double R = 287.0;
      const double cp = FGamma * R / FGamma1;
      // Accumulate the dimensional flux INTO the junction from each connected pipe
      // end (FVelocity>0 = out of the pipe = into the junction). The main solver
      // calls this BC once per step in all-tubes mode (TuboCalculado==10000), so
      // sum over ALL tubes here; in the per-tube call path sum only the current
      // tube and pro-rate the window time.
      int lo = 0, hi = FNumeroTubosCC;
      bool allTubes = (TuboCalculado == 10000);
      if (!allTubes) { lo = TuboCalculado; hi = TuboCalculado + 1; }
      for (int i = lo; i < hi; i++) {
        double vdim = FVelocity[i] * __cons::ARef;            // m/s, +into junction
        double rho = FTuboExtremo[i].Pipe->GetDensidad(FNodoFin[i]); // kg/m^3
        double p = __units::BarToPa(FTuboExtremo[i].Pipe->GetPresion(FNodoFin[i]));
        double T = (rho > 0.0) ? p / (rho * R) : 0.0;
        if (std::isfinite(vdim) && std::isfinite(rho) && rho > 0.0 &&
            std::isfinite(T)) {
          double mdot = rho * FSeccionTubo[i] * vdim;          // kg/s into junction
          double hdot = mdot * (cp * T + 0.5 * vdim * vdim);   // W into junction
          jb.mIn += mdot * DeltaT;
          jb.hIn += hdot * DeltaT;
          jb.absM += fabs(mdot) * DeltaT;
          jb.hAbs += fabs(hdot) * DeltaT;
        }
      }
      jb.t += allTubes ? DeltaT : (DeltaT / FNumeroTubosCC);
      double win = getenv("OPENWAM_JUNCENE_WIN")
                       ? atof(getenv("OPENWAM_JUNCENE_WIN")) : 0.02;
      if (jb.t >= win && jb.t > 0.0) {
        // netHdot > 0 means net enthalpy flows INTO the junction and is destroyed;
        // netHdot < 0 means the junction emits more enthalpy than it receives, i.e.
        // it CREATES enthalpy. Report the created power = -netHdot.
        printf("JUNCENE CC%d: netMdot=% .3e kg/s netHdot=% .3e W "
               "(|M|=% .3e |H|=% .3e) creates=%+.2f kW\n",
               FNumeroCC, jb.mIn / jb.t, jb.hIn / jb.t, jb.absM / jb.t,
               jb.hAbs / jb.t, -(jb.hIn / jb.t) / 1000.0);
        jb = JBal();
      }
    }

  } catch (std::exception &N) {
    std::cout << "ERROR: TCCRamificacion::CalculaCondicionContorno en la "
                 "condicion de contorno: "
              << FNumeroCC << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

#pragma package(smart_init)
