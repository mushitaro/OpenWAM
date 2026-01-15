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
#ifndef TOpenWAMH
#define TOpenWAMH

#ifdef __BORLANDC__
#include <vcl.h>
#endif
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <regex>
#include <fstream>
#pragma hdrstop
#include "Globales.h"

#include "TTimeControl.h"

// ENGINE BLOCK AND CYLINDERS
#include "TBloqueMotor.h"
#include "TCilindro4T.h"

// COMPRESSOR
#include "TCompresorDep.h"
#include "TCompTubDep.h"
#include "TCompTubos.h"

// EXTERNAL CALCULATIONS
#include "TCalculoExtern.h"
#include "TRemansoMatlab.h"
#include "TCoefDescarga.h"
#include "TControlFuel.h"

// VALVES
#include "TCDExterno.h"
#include "TEstatorTurbina.h"
#include "TRotorTurbina.h"
#include "TWasteGate.h"
#include "TValvulaContr.h"
#include "TDiscoRotativo.h"
#include "TLumbrera.h"
#include "TCDFijo.h"
#include "TValvula4T.h"
#include "TLamina.h"
#include "TMariposa.h"

// PIPES
#include "TTubo.h"

// PLENUMS
#include "TDepVolVariable.h"
#include "TDepVolCte.h"
#include "TTurbinaSimple.h"
#include "TTurbinaTwin.h"
#include "TVenturi.h"
#include "TUnionDireccional.h"

// BOUNDARY CONDITIONS
#include "TCCDescargaExtremoAbierto.h"
#include "TCCExtremoAnecoico.h"
#include "TCCExtremoCerrado.h"
#include "TCCPulso.h"
#include "TCCCilindro.h"
#include "TCCUnionEntreTubos.h"
#include "TCCPerdidadePresion.h"
#include "TCCDeposito.h"
#include "TCCRamificacion.h"
#include "TCCExtremoInyeccion.h"
#include "TCCEntradaCompresor.h"
#include "TCCUnionEntreDepositos.h"
#include "TCCCompresorVolumetrico.h"
#include "TCCCompresor.h"
#include "TCCPreVble.h"
#include "TCFDConnection.h"
#include "TCCExternalConnection.h"
#include "TCCExternalConnectionVol.h"

// TURBOCHARGER AXIS
#include "TEjeTurbogrupo.h"

// DIESEL PARTICULATE FILTER
#include "TDPF.h"
#include "TCanalDPF.h"

// CONCENTRIC 1D ELEMENTS
#ifdef ConcentricElement
#include "TConcentricoTubos.h"
#include "TConcentricoDPF.h"
#endif

// CONTROL DEVICES
#include "TSensor.h"
#include "TPIDController.h"
#include "TTable1D.h"
#include "TTable.h"
#include "TDecisor.h"
#include "TGain.h"

// OUTPUT RESULTS
#include "TOutputResults.h"
#define completo 1

/* ! \def gestorcom
 Allow the communication with WAMer
 */

#include <sys/timeb.h>

#ifdef __BORLANDC__
#define gestorcom true
#define graphicalout true
#else
// #define gestorcom 0
// #define graphicalout 0
#endif

#ifdef gestorcom
#include "TCGestorWAM.h"
#endif

#include <memory>
#include <vector>

// ... (includes)

class TOpenWAM {
private:
#ifdef gestorcom
  std::unique_ptr<TCGestorWAM> GestorWAM;
#endif

  std::string tzstr;
  struct timeb begining, final, current;

  stRun Run;

  std::vector<stDatosTGV> DatosTGV;
  // move to vector if array
  std::string fileinput;

  std::ifstream FileInput;
  // !< Pointers to input and output files.
  FILE *fc; // !< Pointers to input and output files.

  // char fileinput[8];

  std::vector<std::unique_ptr<TBloqueMotor>> Engine;
  std::vector<std::unique_ptr<TCompresor>> Compressor;
  std::unique_ptr<TCalculoExtern> EXTERN;
  std::vector<std::unique_ptr<TEjeTurbogrupo>> Axis;

  // ! ARRAY OF TYPES OF VALVES
  // ! ARRAY OF TYPES OF VALVES
  std::vector<std::unique_ptr<TTipoValvula>>
      TypeOfValve; // Ownership transferred to vector
                   // need to check ownership. Keeping as raw observers for now
                   // if unsure, or vector of pointers.

  // ! POINTERS ARRAY TO VALVES TYPE TURBINE STATOR
  std::vector<std::vector<TEstatorTurbina *>> StatorTurbine;
  // ! POINTERS ARRAY TO VALVES TYPE TURBINE ROTOR
  std::vector<TRotorTurbina *> RotorTurbine;
  // ! POINTERS ARRAY TO EXTERNAL CONNECTIONS
  std::vector<TTipoValvula *> CCCalcExtern;
  std::vector<TTipoValvula *> BCButerflyValve;

  // ! ARRAY OF PIPES
  std::vector<std::unique_ptr<TTubo>> Pipe;

#ifdef ConcentricElement
  // ! ARRAY OF CONCENTRIC ELEMENTS
  std::vector<std::unique_ptr<TConcentrico>> Concentric;
#endif

  // ! ARRAY OF DPFs
  std::vector<std::unique_ptr<TDPF>> DPF;

  // ! ARRAYS OF PLENUMS
  std::vector<std::unique_ptr<TDeposito>> Plenum;
  std::vector<TTurbina *> Turbine;
  std::vector<TVenturi *> Venturi;

  // ! ARRAYS OF BOUNDARY CONDITIONS
  std::vector<std::unique_ptr<TCondicionContorno>> BC;

  // These likely point to subsets of BC, so they should remain raw pointers
  // (observers)
  std::vector<TCondicionContorno *> BCIntakeValve;
  std::vector<TCondicionContorno *> BCExhaustValve;
  std::vector<TCondicionContorno *> BCReedValve;
  std::vector<TCondicionContorno *> BCWasteGate;

  std::vector<TCCExternalConnection *> BCExtConnection;
  std::vector<TCCExternalConnectionVol *> BCExtConnectionVol;

  std::vector<TCCCompresorVolumetrico *> VolumetricCompressor;
  std::vector<TCCDescargaExtremoAbierto *> MatlabDischarge;
  std::vector<TCCExtremoInyeccion *> InjectionEnd;
  std::vector<TCCPerdidadePresion *> PerdidaPresion;

  // !OUTPUT OBJECT
  std::unique_ptr<TOutputResults> Output;

  // ! NUMBER OF COMPRESSORS
  int NumberOfCompressors;

  // ! NUMBER OF PRESSURE LOSSES
  int NumTCCPerdidaPresion;

  int fi_num_threads; ///< Available threads for CalculateFlowIndependent.

  // Simulation variables
  bool ThereIsEGR;
  bool ThereIsFuel;
  int OpenWAMVersion;
  int Steps;
  int Increment;
  int Percentage;
  double ThetaIni;
  double ene;
  double agincr;
  double thmax;
  double grmax;
  double SimulationDuration;
  int CyclesWithoutThemalInertia;
  double AmbientPressure;
  double AmbientTemperature;
  bool ConvergenceFirstTime;
  bool Independent;
  bool PipeStepMax;
  bool DPFStepMax;
  bool TimeMinPipe;
  bool TimeMinDPF;

  double CrankAngle;
  double AcumulatedTime;
  double Theta;
  double Theta0;

  std::vector<stEspecies> SpeciesName;
  int SpeciesNumber;
  std::vector<double> AtmosphericComposition;

  nmTipoModelado SimulationType;
  nmTipoCalculoEspecies SpeciesModel;
  nmCalculoGamma GammaCalculation;
  nmTipoMotor EngineType;
  nmTipoCombustible FuelType;
  bool EngineBlock;
  bool ThereIsDLL;

  int NumberOfPipes;
  int NumberOfConcentrics;
  int NumberOfDPF;
  int NumberOfValves;
  int NumberOfReedValves;
  int NumberOfWasteGates;
  int NumberOfExternalCalculatedValves;
  int NumberOfConnections;
  int NumberOfVolumetricCompressors;
  int NumberOfExhaustValves;
  int NumberOfIntakeValves;
  int NumberOfCompressorsConnections;
  int NumberOfInjectionEnds;
  int NumberOfConectionsBetweenPlenums;
  int NumberOfButerflyValves;
  int NumberOfPlenums;
  int NumberOfVenturis;
  int NumberOfDirectionalJunctions;
  int NumberOfSensors;
  int NumberOfControllers;
  int controlvalv;
  int nematlab;
  int NumberOfTurbines;
  int CountVGT;
  int NumberOfAxis;
  double TimeEndStep;
  int JCurrent;
  int JCurrentDPF;
  bool FirstIterStep;
  int JStepMax;
  int JStepMaxDPF;
  bool Is_EndStep;
  double DeltaTPlenums;

  std::vector<std::unique_ptr<TSensor>> Sensor;
  std::vector<std::unique_ptr<TController>> Controller;

  /**
   * @brief Assigns the number of threads for CalculateFlowIndependent.
   *
   * As CalculateFlowFlowIndependent can use up to 3 threads, it counts
   * the number of available processors and sets fi_num_threads to 1, 2
   * or 3 accordingly.  Also, if OMP_NUM_THREADS is set to 2 or 1, it
   * observes it.
   */
  void InitFlowIndependentNumThreads();

  void CleanLabelsX();

  void CleanLabels();

  void ReadGeneralData();

  void ReadEngine();

  void ReadPipes();

  void ReadDPF();

  void ReadConcentric();

  void ReadValves();

  void ReadPlenums();

  void ReadCompressors();

  void ReadConnections();

  void ReadTurbochargerAxis();

  void ReadSensors();

  void ReadControllers();

  void ReadOutput(std::string FileName);

  void ReadDataDLL(fpos_t &filepos);

  void RunningControl();

  void InitializeRunningAngles();

  void AllocateVGTData();

  void CalculateNewHeatPositions();

  void
  CalculateDistance(int NodoOrigen, int NodoFin, double Longitud,
                    int NumberOfPlenums, int NumberOfPipes,
                    int NumberOfConnections,
                    const std::vector<std::unique_ptr<TTubo>> &Pipe,
                    const std::vector<std::unique_ptr<TCondicionContorno>> &BC);

  int SelectPipe(const std::vector<std::unique_ptr<TTubo>> &Pipe,
                 int NumberOfPipes, int nodo1, int nodo2);

  void MethodStability();

  void SearchMinimumTimeStep();

  void StudyInflowOutflowMass();

  void
  SearchMinimumTime(int LNumDepInicial, double *LTMinimo,
                    const std::vector<std::unique_ptr<TDeposito>> &LPlenum);

  void SearchMinimumTimeGroup(
      double *LTMinimo, int LNumDeposito,
      const std::vector<std::unique_ptr<TDeposito>> &LPlenum);

  void FixTimeStep();

  void FixTimeStepExternal(double deltat);

  void RecalculateStability();

  void SolveAdjacentElements(int PipeEnd, double TiempoActual);

  void SolveBranch(int NumDeposito, double TiempoActual);

  void UpdateEngine();

  void SolveRoadLoadModel();

  void RecalculateStabilitySolver();

  void UpdateTurbocharger();

  void comunica_wam_dll();

  void ModificacionControlEjecucion();

  void Actuadores();

public:
  TOpenWAM();

  ~TOpenWAM();

  void ReadInputData(std::string FileName);

  void InitializeParameters();

  void ConnectFlowElements();

  void ConnectControlElements();

  void InitialHeatTransferParameters();

  void DetermineTimeStepIndependent();

  void DetermineTimeStepCommon();

  void DetermineTimeStep(double t);

  void InitializeOutput();

  void CalculateFlowIndependent();

  void CalculateFlowCommon();

  void ManageOutput();

  bool CalculationEnd();

  void Progress();

  void ProgressBegin();

  void ProgressEnd();

  void NewEngineCycle();

  void GeneralOutput();

  bool IsIndependent() { return Independent; };

  void UpdateExternalBoundary(int i, double U0, double U1, double T0, double T1,
                              double P0, double P1, double t);

  void UpdateExternalBoundary(int i, double U0, double T0, double P0, double t);

  void InitiateExternalBoundary(int i, double D0, double D1, double dX);

  void InitiateExternalBoundary(int i, double D0, double dX);

  void LoadNewData(int i, double *p, double *T, double *u);

  bool GetIs_EndStep();
};
// ---------------------------------------------------------------------------
#endif
