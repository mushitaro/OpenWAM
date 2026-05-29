/*--------------------------------------------------------------------------------*\
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

// ---------------------------------------------------------------------------
#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1
#endif

#ifdef __BORLANDC__
#include <vcl.h>
#endif

#pragma hdrstop

#include "TOpenWAM.h"
#include "labels.hpp"

#if defined(__linux__)
#include <cfenv>
#include <cstdlib>
#endif

// #include <tchar.h>
// ---------------------------------------------------------------------------

// VERBOSE_DEBUG: Uncomment to enable per-loop debug output (WARNING: ~750MB
// logs) #define VERBOSE_DEBUG

#ifdef VERBOSE_DEBUG
#define LOOP_DEBUG(msg)                                                        \
  printf(msg);                                                                 \
  fflush(stdout);
#else
#define LOOP_DEBUG(msg)
#endif

#pragma argsused

TOpenWAM *Aplication = NULL;

int main(int argc, char *argv[]) {

#if defined(__linux__)
  // Diagnostic aid (opt-in): set OPENWAM_FPTRAP=1 to trap the first
  // NaN/Inf-producing floating-point op (SIGFPE) so its exact origin can be
  // located under gdb. No effect on normal runs when the variable is unset.
  if (getenv("OPENWAM_FPTRAP"))
    feenableexcept(FE_INVALID | FE_DIVBYZERO);
#endif

  init_labels();

  Aplication = new TOpenWAM();

  Aplication->ReadInputData(argv[1]);
  printf("DEBUG: ReadInputData Finished\n");
  fflush(stdout);

  printf("DEBUG: Calling ConnectFlowElements\n");
  fflush(stdout);
  Aplication->ConnectFlowElements();
  printf("DEBUG: ConnectFlowElements Finished\n");
  fflush(stdout);

  printf("DEBUG: Calling ConnectControlElements\n");
  fflush(stdout);
  Aplication->ConnectControlElements();
  printf("DEBUG: ConnectControlElements Finished\n");
  fflush(stdout);

  printf("DEBUG: Calling InitializeParameters\n");
  fflush(stdout);
  Aplication->InitializeParameters();
  printf("DEBUG: InitializeParameters Finished\n");
  fflush(stdout);

  printf("DEBUG: Calling InitializeOutput\n");
  fflush(stdout);
  Aplication->InitializeOutput();
  printf("DEBUG: InitializeOutput Finished\n");
  fflush(stdout);

  Aplication->ProgressBegin();

  Aplication->ProgressBegin();

  if (Aplication->IsIndependent()) {
    printf("DEBUG: Simulation Mode: Independent\n");
    fflush(stdout);

    do {
      LOOP_DEBUG("DEBUG: Loop Start (Independent)\n")

      Aplication->Progress();
      LOOP_DEBUG("DEBUG: After Progress (Independent)\n")

      Aplication->DetermineTimeStepIndependent();
      LOOP_DEBUG("DEBUG: After DetermineTimeStepIndependent\n")

      Aplication->NewEngineCycle();
      LOOP_DEBUG("DEBUG: After NewEngineCycle (Independent)\n")

      Aplication->CalculateFlowIndependent();
      LOOP_DEBUG("DEBUG: After CalculateFlowIndependent\n")

      Aplication->ManageOutput();
      LOOP_DEBUG("DEBUG: After ManageOutput (Independent)\n")

    } while (!Aplication->CalculationEnd());

  } else {
    do {
      LOOP_DEBUG("DEBUG: Loop Start\n")

      Aplication->Progress();
      LOOP_DEBUG("DEBUG: After Progress\n")

      Aplication->DetermineTimeStepCommon();
      LOOP_DEBUG("DEBUG: After DetermineTimeStepCommon\n")

      Aplication->NewEngineCycle();
      LOOP_DEBUG("DEBUG: After NewEngineCycle\n")

      Aplication->CalculateFlowCommon();
      LOOP_DEBUG("DEBUG: After CalculateFlowCommon\n")

      Aplication->ManageOutput();
      LOOP_DEBUG("DEBUG: After ManageOutput\n")

    } while (!Aplication->CalculationEnd());
  }

  Aplication->GeneralOutput();

  Aplication->ProgressEnd();

  delete Aplication;

  return 0;
}
// ---------------------------------------------------------------------------
