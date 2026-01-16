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
#ifdef __BORLANDC__
#include <vcl.h>
#endif

#pragma hdrstop

#include "TOpenWAM.h"
#include "labels.hpp"

// #include <tchar.h>
// ---------------------------------------------------------------------------

#pragma argsused

TOpenWAM *Aplication = NULL;

int main(int argc, char *argv[]) {

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
      printf("DEBUG: Loop Start (Independent)\n");
      fflush(stdout);

      Aplication->Progress();
      printf("DEBUG: After Progress (Independent)\n");
      fflush(stdout);

      Aplication->DetermineTimeStepIndependent();
      printf("DEBUG: After DetermineTimeStepIndependent\n");
      fflush(stdout);

      Aplication->NewEngineCycle();
      printf("DEBUG: After NewEngineCycle (Independent)\n");
      fflush(stdout);

      Aplication->CalculateFlowIndependent();
      printf("DEBUG: After CalculateFlowIndependent\n");
      fflush(stdout);

      Aplication->ManageOutput();
      printf("DEBUG: After ManageOutput (Independent)\n");
      fflush(stdout);

    } while (!Aplication->CalculationEnd());

  } else {
    do {
      printf("DEBUG: Loop Start\n");
      fflush(stdout);

      Aplication->Progress();
      printf("DEBUG: After Progress\n");
      fflush(stdout);

      Aplication->DetermineTimeStepCommon();
      printf("DEBUG: After DetermineTimeStepCommon\n");
      fflush(stdout);

      Aplication->NewEngineCycle();
      printf("DEBUG: After NewEngineCycle\n");
      fflush(stdout);

      Aplication->CalculateFlowCommon();
      printf("DEBUG: After CalculateFlowCommon\n");
      fflush(stdout);

      Aplication->ManageOutput();
      printf("DEBUG: After ManageOutput\n");
      fflush(stdout);

    } while (!Aplication->CalculationEnd());
  }

  Aplication->GeneralOutput();

  Aplication->ProgressEnd();

  delete Aplication;

  return 0;
}
// ---------------------------------------------------------------------------
