#define _CRT_SECURE_NO_WARNINGS
// ---------------------------------------------------------------------------

#pragma hdrstop

#include "TOutputResults.h"

TOutputResults::TOutputResults() {

  FAvgOutput.str("");
  AvgEngine = NULL;
  FInsOutput.str("");
  FPlotThisCycle = true;
  FFirstTime = true;
  InsHeaderCreated = false;
  FWriteSpaceTime = false;
  FFileCountI = 1;
  WriteInsHeader = false;
}

TOutputResults::~TOutputResults() {}

void TOutputResults::ReadAverageResults(
    std::istream &FileInput, const std::vector<std::unique_ptr<TTubo>> &Pipe,
    bool EngineBlock, const std::vector<std::unique_ptr<TBloqueMotor>> &Engine,
    const std::vector<std::unique_ptr<TDeposito>> &Plenum,
    const std::vector<std::unique_ptr<TEjeTurbogrupo>> &Axis,
    const std::vector<std::unique_ptr<TCompresor>> &Compressor,
    const std::vector<TTurbina *> &Turbine,
    const std::vector<std::unique_ptr<TCondicionContorno>> &BC,
    const std::vector<std::unique_ptr<TDPF>> &DPF,
    const std::vector<TCCCompresorVolumetrico *> &Root,
    const std::vector<TVenturi *> &Venturi,
    const std::vector<std::unique_ptr<TSensor>> &Sensor,
    const std::vector<std::unique_ptr<TController>> &Controller,
    int TotalCycles, const std::string &ModelName) {

  char buffer[300];
  GetName(ModelName.c_str(), buffer, "AVG.DAT");
  FAvgFilename = buffer;

  int err = remove(FAvgFilename.c_str());

  int intAuxiliar = 0;
  FileInput >> intAuxiliar;
  switch (intAuxiliar) {
  case 0:
    FTypeOfInsResults = nmLastCyle;
    FMultipleFiles = false;
    break;
  case 1:
    FTypeOfInsResults = nmAllCyclesIndependent;
    FMultipleFiles = true;
    FCharacters = int(log10((float)TotalCycles));
    break;
  case 2:
    FTypeOfInsResults = nmAllCyclesConcatenated;
    FMultipleFiles = false;
    break;
  case 3:
    FTypeOfInsResults = nmEveryNCycles;
    FMultipleFiles = true;
    try {
      FileInput >> FCyclePeriod;
    } catch (...) {
      FCyclePeriod = 1;
    }
    FCharacters = int(log10(float(TotalCycles) / FCyclePeriod));
    break;
  }

  // !Read average results in cylinders
  int NumCylindersAvg = 0;
  int CylinderID = 0;
  FileInput >> NumCylindersAvg;
  for (int i = 0; i < NumCylindersAvg; ++i) {
    FileInput >> CylinderID;
    AvgCylinder.push_back(Engine[0]->GetCilindro(CylinderID - 1));
    AvgCylinder[i]->ReadAverageResultsCilindro(FileInput);
  }

  // !Read average results in the engine
  int EngineAvg = 0;
  FileInput >> EngineAvg;
  if (EngineAvg == 1) {
    if (EngineBlock) {
      AvgEngine = Engine[0].get();
      AvgEngine->ReadAverageResultsBloqueMotor(FileInput);
    }
  }

  // !Read average results in plenums
  int NumPlenumsAvg = 0;
  int PlenumID = 0;
  FileInput >> NumPlenumsAvg;
  for (int i = 0; i < NumPlenumsAvg; i++) {
    FileInput >> PlenumID;
    AvgPlenum.push_back(Plenum[PlenumID - 1].get());
    AvgPlenum[i]->ReadAverageResultsDep(FileInput);
  }

  // ! Read average results in pipes
  int NumPipesAvg = 0;
  int PipeID = 0;
  FileInput >> NumPipesAvg;
  /* Dato para WAMer. Numero de resultados medios en tubos */
  int numeroparawamer = 0;
  FileInput >> numeroparawamer;
  for (int i = 0; i < NumPipesAvg; i++) {
    FileInput >> PipeID;
    AvgPipe.push_back(Pipe[PipeID - 1].get());
    AvgPipe[i]->ReadAverageResultsTubo(FileInput, !Engine.empty());
  }

  // !Read average results in turbocharger axis
  int NumAxisAvg = 0;
  int AxisID = 0;
  FileInput >> NumAxisAvg;
  for (int i = 0; i < NumAxisAvg; i++) {
    FileInput >> AxisID;
    AvgAxis.push_back(Axis[AxisID - 1].get());
    AvgAxis[i]->ReadAverageResultsEje(FileInput);
  }

  // !Read average results in compressors
  int NumCompressorAvg = 0;
  int CompressorID = 0;
  FileInput >> NumCompressorAvg;
  for (int i = 0; i < NumCompressorAvg; i++) {
    FileInput >> CompressorID;
    AvgCompressor.push_back(Compressor[CompressorID - 1].get());
    AvgCompressor[i]->LeeDatosGraficasMedias(FileInput);
  }

  // !Read average results in turbines
  int NumTurbineAvg = 0;
  int TurbineID = 0;
  FileInput >> NumTurbineAvg;
  for (int i = 0; i < NumTurbineAvg; i++) {
    FileInput >> TurbineID;
    AvgTurbine.push_back(Turbine[TurbineID - 1]);
    AvgTurbine[i]->ReadAverageResultsTurb(FileInput);
  }

  // !Read average results in valves
  int NumValvesAvg = 0;
  int ValveID = 0;
  FileInput >> NumValvesAvg;
  for (int i = 0; i < NumValvesAvg; i++) {
    FileInput >> ValveID;
    if (BC[ValveID - 1]->getTipoCC() == nmIntakeValve ||
        BC[ValveID - 1]->getTipoCC() == nmExhaustValve) {
      AvgValve.push_back(
          dynamic_cast<TCCCilindro *>(BC[ValveID - 1].get())->getValvula());
    } else if (BC[ValveID - 1]->getTipoCC() == nmPipeToPlenumConnection) {
      AvgValve.push_back(
          dynamic_cast<TCCDeposito *>(BC[ValveID - 1].get())->getValvula());
    } else if (BC[ValveID - 1]->getTipoCC() == nmUnionEntreDepositos) {
      AvgValve.push_back(
          dynamic_cast<TCCUnionEntreDepositos *>(BC[ValveID - 1].get())
              ->getValvula());
    } else
      std::cerr << "ERROR: There is no valves asigned in the connection number "
                << ValveID << std::endl;
    AvgValveNode.push_back(ValveID);
    AvgValve[i]->LeeDatosGraficasMED(FileInput);
  }

  // !Read average results in root compressors
  int NumRootsAvg = 0;
  int RootID = 0;
  FileInput >> NumRootsAvg;

  for (int i = 0; i < NumRootsAvg; ++i) {
    FileInput >> RootID;
    AvgRoot.push_back(Root[RootID - 1]);
    AvgRoot[i]->ReadAverageResultsCV(FileInput);
  }

  // !Read average results in venturis
  int NumVenturisAvg = 0;
  int VenturiID = 0;
  FileInput >> NumVenturisAvg;

  for (int i = 0; i < NumVenturisAvg; ++i) {
    FileInput >> VenturiID;
    AvgVenturi.push_back(Venturi[VenturiID - 1]);
    AvgVenturi[i]->ReadAverageResultsVenturi(FileInput);
  }

  // !Read average results in connections between plenums
  int NumConnectionsAvg = 0;
  int ConnectionID = 0;
  FileInput >> NumConnectionsAvg;

  for (int i = 0; i < NumConnectionsAvg; ++i) {
    FileInput >> ConnectionID;
    if (BC[ConnectionID - 1]->getTipoCC() == nmUnionEntreDepositos) {
      AvgConnection.push_back(
          dynamic_cast<TCCUnionEntreDepositos *>(BC[ConnectionID - 1].get()));
    } else {
      std::cerr << "ERROR: Connection " << ConnectionID
                << "\n does not connect two plenums" << std::endl;
    }
    AvgConnection[i]->ReadAverageResultsUED(FileInput);
  }

  // !Read average results in DPF
#ifdef ParticulateFilter
  int NumDPFAvg = 0;
  int DPFID = 0;
  FileInput >> NumDPFAvg;
  for (int i = 0; i < NumDPFAvg; i++) {
    FileInput >> DPFID;
    AvgDPF.push_back(DPF[DPFID - 1].get());
    AvgDPF[i]->LeeResultadosMediosDPF(FileInput);
  }
#endif

  // !Read average results in sensors
  int NumSensorAvg = 0;
  int SensorID = 0;
  FileInput >> NumSensorAvg;
  for (int i = 0; i < NumSensorAvg; ++i) {
    FileInput >> SensorID;
    AvgSensor.push_back(Sensor[SensorID - 1].get());
    AvgSensor[i]->LeeResultadosMedSensor(FileInput);
  }

  // !Read average results in controllers
  int NumControllersAvg = 0;
  int ControllerID = 0;
  FileInput >> NumControllersAvg;

  for (int i = 0; i < NumControllersAvg; ++i) {
    FileInput >> ControllerID;
    AvgController.push_back(Controller[ControllerID - 1].get());
    AvgController[i]->LeeResultadosMedControlador(FileInput);
  }
}

void TOutputResults::ReadInstantaneousResults(
    std::istream &FileInput,
    const std::vector<std::unique_ptr<TBloqueMotor>> &Engine,
    const std::vector<std::unique_ptr<TDeposito>> &Plenum,
    const std::vector<std::unique_ptr<TTubo>> &Pipe,
    const std::vector<TVenturi *> &Venturi,
    const std::vector<std::unique_ptr<TCondicionContorno>> &BC,
    const std::vector<std::unique_ptr<TDPF>> &DPF,
    const std::vector<std::unique_ptr<TEjeTurbogrupo>> &Turbo,
    const std::vector<std::unique_ptr<TCompresor>> &Compressor,
    const std::vector<TTurbina *> &Turbine,
    const std::vector<TCCCompresorVolumetrico *> &Root,
    const std::vector<TCondicionContorno *> &BCWasteGate,
    int NumberOfWasteGates,
    const std::vector<TCondicionContorno *> &BCReedValve,
    int NumberOfReedValves, const std::vector<std::unique_ptr<TSensor>> &Sensor,
    const std::vector<std::unique_ptr<TController>> &Controller,
    const std::string &ModelName) {

  char buffer[300];
  GetName(ModelName.c_str(), buffer, "INS.DAT");
  FInsFilename = buffer;

  int err = remove(FInsFilename.c_str());

  // ! Instantaneous results in cylinders
  int NumCylindersIns = 0;
  int CylinderID = 0;
  FileInput >> NumCylindersIns;
  for (int i = 0; i < NumCylindersIns; i++) {
    FileInput >> CylinderID;
    InsCylinder.push_back(Engine[0]->GetCilindro(CylinderID - 1));
    InsCylinder[i]->ReadInstantaneousResultsCilindro(FileInput);
  }

  // ! Instantaneous results in plenums
  int NumPlenumsIns = 0;
  int PlenumID = 0;
  FileInput >> NumPlenumsIns;
  for (int i = 0; i < NumPlenumsIns; i++) {
    FileInput >> PlenumID;
    InsPlenum.push_back(Plenum[PlenumID - 1].get());
    InsPlenum[i]->ReadInstantaneousResultsDep(FileInput);
  }

  // ! Instantaneous results in pipes
  int NumPipesIns = 0;
  int PipeID = 0;
  FileInput >> NumPipesIns;
  /* Dato para WAMer. Numero de resultados instantaneos en tubos */
  int numeroparawamer = 0;
  FileInput >> numeroparawamer;
  for (int i = 0; i < NumPipesIns; i++) {
    FileInput >> PipeID;
    InsPipe.push_back(Pipe[PipeID - 1].get());
    InsPipe[i]->ReadInstantaneousResultsTubo(FileInput, Engine);
  }

  // ! Instantaneous results in venturis
  int NumVenturisIns = 0;
  int VenturiID = 0;
  FileInput >> NumVenturisIns;
  for (int i = 0; i < NumVenturisIns; i++) {
    FileInput >> VenturiID;
    InsVenturi.push_back(Venturi[VenturiID - 1]);
    InsVenturi[i]->LeeResultadosInstantVenturi(FileInput);
  }

  // ! Instantaneous results in connections
  int NumValvesIns = 0;
  int ValveID = 0;
  FileInput >> NumValvesIns;
  for (int i = 0; i < NumValvesIns; i++) {
    FileInput >> ValveID;
    if (BC[ValveID - 1]->getTipoCC() == nmIntakeValve ||
        BC[ValveID - 1]->getTipoCC() == nmExhaustValve) {
      InsValve.push_back(
          dynamic_cast<TCCCilindro *>(BC[ValveID - 1].get())->getValvula());
    } else if (BC[ValveID - 1]->getTipoCC() == nmPipeToPlenumConnection) {
      InsValve.push_back(
          dynamic_cast<TCCDeposito *>(BC[ValveID - 1].get())->getValvula());
    } else if (BC[ValveID - 1]->getTipoCC() == nmUnionEntreDepositos) {
      InsValve.push_back(
          dynamic_cast<TCCUnionEntreDepositos *>(BC[ValveID - 1].get())
              ->getValvula());
    } else
      std::cerr << "ERROR: There is no valves asigned in the connection number "
                << ValveID << std::endl;
    InsValveNode.push_back(ValveID);
    InsValve[i]->LeeDatosGraficasINS(FileInput);
  }

  // ! Instantaneous results turbochargers.
  int NumTurboIns = 0;
  int TurboID = 0;
  FileInput >> NumTurboIns;
  for (int i = 0; i < NumTurboIns; i++) {
    FileInput >> TurboID;
    InsTurbo.push_back(Turbo[TurboID - 1].get());
    InsTurbo[i]->ReadInstantaneousResultsEje(FileInput);
  }

  int NumCompressorIns = 0;
  int CompressorID = 0;
  FileInput >> NumCompressorIns;
  for (int i = 0; i < NumCompressorIns; i++) {
    FileInput >> CompressorID;
    InsCompressor.push_back(Compressor[CompressorID - 1].get());
    InsCompressor[i]->LeeDatosGraficasInstantaneas(FileInput);
  }

  int NumTurbineIns = 0;
  int TurbineID = 0;
  FileInput >> NumTurbineIns;
  for (int i = 0; i < NumTurbineIns; i++) {
    FileInput >> TurbineID;
    InsTurbine.push_back(Turbine[TurbineID - 1]);
    InsTurbine[i]->LeeResultadosInstantTurb(FileInput);
  }

  int NumRootsIns = 0;
  int RootID = 0;
  FileInput >> NumRootsIns;
  for (int i = 0; i < NumRootsIns; ++i) {
    FileInput >> RootID;
    InsRoot.push_back(Root[RootID - 1]);
    InsRoot[i]->LeeResultadosInstantCV(FileInput);
  }

  // !Read instantaneous results in connections between plenums
  int NumConnectionsIns = 0;
  int ConnectionID = 0;
  FileInput >> NumConnectionsIns;
  for (int i = 0; i < NumConnectionsIns; ++i) {
    FileInput >> ConnectionID;
    if (BC[ConnectionID - 1]->getTipoCC() == nmUnionEntreDepositos) {
      InsConnection.push_back(
          dynamic_cast<TCCUnionEntreDepositos *>(BC[ConnectionID - 1].get()));
    } else {
      std::cerr << "ERROR: Connection " << ConnectionID
                << "\n does not connect two plenums" << std::endl;
    }
    InsConnection[i]->LeeResultadosInstantUED(FileInput);
  }

  //
  // // RESULTADOS INSTANTANEOS WASTE-GATE.

  int NumWasteGateIns = 0;
  int WasteGateID = 0;
  bool valido = false;
  FileInput >> NumWasteGateIns;
  for (int i = 0; i < NumWasteGateIns; i++) {
    FileInput >> WasteGateID;
    for (int j = 0; j < NumberOfWasteGates; j++) {
      if (BCWasteGate[j]->getNumeroCC() == WasteGateID) {
        valido = true;
        if (BCWasteGate[j]->getTipoCC() == nmPipeToPlenumConnection) {
          InsWasteGate.push_back(dynamic_cast<TWasteGate *>(
              dynamic_cast<TCCDeposito *>(BCWasteGate[j])->getValvula()));
        } else if (BCWasteGate[j]->getTipoCC() == nmUnionEntreDepositos) {
          InsWasteGate.push_back(dynamic_cast<TWasteGate *>(
              dynamic_cast<TCCUnionEntreDepositos *>(BCWasteGate[j])
                  ->getValvula()));
        }
        InsWasteGate[i]->LeeDatosGraficasINS(FileInput);
      }
    }
    if (!valido)
      std::cerr << "ERROR: A WasteGate does not exist in connection number "
                << WasteGateID << std::endl;
    valido = false;
  }
  //
  // // RESULTADOS INSTANTANEOS LAMINA.
  int NumReedIns = 0;
  int ReedID = 0;
  FileInput >> NumReedIns;
  for (int i = 0; i < NumReedIns; i++) {
    FileInput >> ReedID;
    for (int j = 0; j < NumberOfReedValves; j++) {
      if (BCReedValve[j]->getNumeroCC() == ReedID) {
        valido = true;
        if (BCReedValve[j]->getTipoCC() == nmPipeToPlenumConnection) {
          InsReedValve.push_back(dynamic_cast<TLamina *>(
              dynamic_cast<TCCDeposito *>(BCReedValve[j])->getValvula()));
        } else if (BCReedValve[j]->getTipoCC() == nmUnionEntreDepositos) {
          InsReedValve.push_back(dynamic_cast<TLamina *>(
              dynamic_cast<TCCUnionEntreDepositos *>(BCReedValve[j])
                  ->getValvula()));
        }
        InsReedValve[i]->LeeDatosGraficasINS(FileInput);
      }
    }
    if (!valido)
      std::cerr << "ERROR: A reed valve does not exist in connection number "
                << ReedID << std::endl;
    valido = false;
  }

  // !Read instantaneous results in DPF.
#ifdef ParticulateFilter
  int NumDPFIns = 0;
  int DPFID = 0;
  FileInput >> NumDPFIns;
  for (int i = 0; i < NumDPFIns; ++i) {
    FileInput >> DPFID;
    InsDPF.push_back(DPF[DPFID - 1].get());
    InsDPF[i]->LeeResultadosInstantaneosDPF(FileInput);
  }
#endif

  // !Read instantaneous results in sensors
  int NumSensorIns = 0;
  int SensorID = 0;
  FileInput >> NumSensorIns;
  for (int i = 0; i < NumSensorIns; ++i) {
    FileInput >> SensorID;
    InsSensor.push_back(Sensor[SensorID - 1].get());
    InsSensor[i]->LeeResultadosInsSensor(FileInput);
  }

  // !Read instantaneous results in controllers

  int NumControllersIns = 0;
  int ControllerID = 0;
  FileInput >> NumControllersIns;

  for (int i = 0; i < NumControllersIns; ++i) {
    FileInput >> ControllerID;
    InsController.push_back(Controller[ControllerID - 1].get());
    InsController[i]->LeeResultadosInsControlador(FileInput);
  }
}

void TOutputResults::ReadSpaceTimeResults(
    std::istream &FileInput, const std::vector<std::unique_ptr<TTubo>> &Pipe,
    const std::vector<std::unique_ptr<TBloqueMotor>> &Engine,
    const std::vector<std::unique_ptr<TDeposito>> &Plenum) {

  char buffer[300];
  // Anadido para diferenciar ficheros spacetime
  //	if(FMultipleFiles){
  //		char count[10]="";
  //		itoa(FFileCountI,count,10);
  //		strcat(count,"_");
  //		strcat(count,"STM.DAT");
  //		GetName(ModelName, buffer, count);
  //	}else{
  //		GetName(ModelName, buffer, "STM.DAT");
  //	}
  //	FSpaceTimeFilename = buffer;

  //	int err = remove( FSpaceTimeFilename.c_str() );

  // !Space-time results in pipes
  FileInput >> FWriteSpaceTime;
  if (FWriteSpaceTime) {
    FileInput >> FSpaceTimeFilename;
  }

  // !Space-time results in pipes
  int NumPipesSpaceTime = 0;
  int PipeID = 0;
  int EngineID = 0;
  FileInput >> NumPipesSpaceTime;
  for (int i = 0; i < NumPipesSpaceTime; i++) {
    FileInput >> PipeID;
    STPipe.push_back(Pipe[PipeID - 1].get());
    // Space-Time methods missing in TTubo
    // STPipe[i]->ReadSpaceTimeResultsTubo(FileInput);
  }

  // !Space-time results in cylinders
  int NumCylindersSpaceTime = 0;
  int CylinderID = 0;
  FileInput >> NumCylindersSpaceTime;
  for (int i = 0; i < NumCylindersSpaceTime; i++) {
    FileInput >> CylinderID;
    STCylinder.push_back(Engine[0]->GetCilindro(CylinderID - 1));
    // Space-Time methods missing in TCilindro
    // STCylinder[i]->ReadSpaceTimeResultsCilindro(FileInput);
  }

  // !Space-time results in plenums
  int NumPlenumsSpaceTime = 0;
  int PlenumID = 0;
  FileInput >> NumPlenumsSpaceTime;
  for (int i = 0; i < NumPlenumsSpaceTime; i++) {
    FileInput >> PlenumID;
    STPlenum.push_back(Plenum[PlenumID - 1].get());
    // Space-Time methods missing in TDeposito
    // STPlenum[i]->ReadSpaceTimeResultsDep(FileInput);
  }
}

void TOutputResults::DoSpaceTimeFiles(int SpeciesNumber) {
  /*
          // ! Create new file o rewrite if it exists
          char FileName[300];
          char Extension[50];


          if(FMultipleFiles){
                  ConvertCharacter(FFileCountI,FFileCountC,FCharacters);
                  strcat(FFileCountC,".STM");
                  char tempIns[300];
                  strcpy(tempIns,FSpaceTimeFilename.c_str());
                  GetName(tempIns, FileName, FFileCountC);
          }else{
                  char tempIns[300];
                  strcpy(tempIns,FSpaceTimeFilename.c_str());
                  GetName(tempIns, FileName, ".STM");
          }
  */
  if (FWriteSpaceTime) {
    if (SpeciesNumber == 0) {
      char FileName[300];
      strcpy(FileName, FSpaceTimeFilename.c_str());
      const char *p = strrchr(FileName, '.');
      int lon = p - FileName + 1;
      // strncpy(FileName,FileName,lon);
      FileName[lon + 1] = '\0';
      strcpy(FileName + lon, "pres");

      int err = remove(FileName);
      FileOutPressure.open(FileName, std::fstream::out);

      strcpy(FileName + lon, "temp");
      err = remove(FileName);
      FileOutTemp.open(FileName, std::fstream::out);

      strcpy(FileName + lon, "vel");
      err = remove(FileName);
      FileOutVel.open(FileName, std::fstream::out);

      strcpy(FileName + lon, "den");
      err = remove(FileName);
      FileOutDensity.open(FileName, std::fstream::out);

      // FileOutPressure.open("Pres.txt", std::fstream::out);
      // FileOutTemp.open("Temp.txt", std::fstream::out);
      // FileOutVel.open("Vel.txt", std::fstream::out);
      // FileOutDensity.open("Den.txt", std::fstream::out);
    } else {
      char FileName[300];
      strcpy(FileName, FSpaceTimeFilename.c_str());
      const char *p = strrchr(FileName, '.');
      int lon = p - FileName + 1;
      // strncpy(FileName,FileName,lon);
      FileName[lon + 1] = '\0';

      if (SpeciesNumber == 3) {
        strcpy(FileName + lon, "fa");
        int err = remove(FileName);
        FOutFlowFreshAir.open(FileName, std::fstream::out);

        strcpy(FileName + lon, "fe");
        err = remove(FileName);
        FOutFlowFuel.open(FileName, std::fstream::out);

        strcpy(FileName + lon, "bg");
        err = remove(FileName);
        FOutFlowBurntGas.open(FileName, std::fstream::out); // Mass Flow

        strcpy(FileName + lon, "cfa");
        err = remove(FileName);
        FOutYFreshAir.open(FileName, std::fstream::out);

        strcpy(FileName + lon, "cfe");
        err = remove(FileName);
        FOutYFuel.open(FileName, std::fstream::out);

        strcpy(FileName + lon, "cbg");
        err = remove(FileName);
        FOutYBurntGas.open(FileName, std::fstream::out); // Concentration

      } else if (SpeciesNumber == 9) {
        strcpy(FileName + lon, "O2");
        int err = remove(FileName);
        FOutFlowO2.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cO2");
        err = remove(FileName);
        FOutYO2.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

        strcpy(FileName + lon, "CO2");
        err = remove(FileName);
        FOutFlowCO2.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cCO2");
        err = remove(FileName);
        FOutYCO2.open(FileName, std::fstream::out); // Concentration (mass
                                                    // fraction)

        strcpy(FileName + lon, "H2O");
        err = remove(FileName);
        FOutFlowH2O.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cH2O");
        err = remove(FileName);
        FOutYH2O.open(FileName, std::fstream::out); // Concentration (mass
                                                    // fraction)

        strcpy(FileName + lon, "HC");
        err = remove(FileName);
        FOutFlowHC.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cHC");
        err = remove(FileName);
        FOutYHC.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

        strcpy(FileName + lon, "Soot");
        err = remove(FileName);
        FOutFlowSoot.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cSoot");
        err = remove(FileName);
        FOutYSoot.open(FileName, std::fstream::out); // Concentration (mass
                                                     // fraction)

        strcpy(FileName + lon, "NOx");
        err = remove(FileName);
        FOutFlowNOx.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cNOx");
        err = remove(FileName);
        FOutYNOx.open(FileName, std::fstream::out); // Concentration (mass
                                                    // fraction)

        strcpy(FileName + lon, "CO");
        err = remove(FileName);
        FOutFlowCO.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cCO");
        err = remove(FileName);
        FOutYCO.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

        strcpy(FileName + lon, "N2");
        err = remove(FileName);
        FOutFlowN2.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cN2");
        err = remove(FileName);
        FOutYN2.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

      } else if (SpeciesNumber == 10) {
        strcpy(FileName + lon, "O2");
        int err = remove(FileName);
        FOutFlowO2.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cO2");
        err = remove(FileName);
        FOutYO2.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

        strcpy(FileName + lon, "CO2");
        err = remove(FileName);
        FOutFlowCO2.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cCO2");
        err = remove(FileName);
        FOutYCO2.open(FileName, std::fstream::out); // Concentration (mass
                                                    // fraction)

        strcpy(FileName + lon, "H2O");
        err = remove(FileName);
        FOutFlowH2O.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cH2O");
        err = remove(FileName);
        FOutYH2O.open(FileName, std::fstream::out); // Concentration (mass
                                                    // fraction)

        strcpy(FileName + lon, "HC");
        err = remove(FileName);
        FOutFlowHC.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cHC");
        err = remove(FileName);
        FOutYHC.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

        strcpy(FileName + lon, "Soot");
        err = remove(FileName);
        FOutFlowSoot.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cSoot");
        err = remove(FileName);
        FOutYSoot.open(FileName, std::fstream::out); // Concentration (mass
                                                     // fraction)

        strcpy(FileName + lon, "NOx");
        err = remove(FileName);
        FOutFlowNOx.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cNOx");
        err = remove(FileName);
        FOutYNOx.open(FileName, std::fstream::out); // Concentration (mass
                                                    // fraction)

        strcpy(FileName + lon, "CO");
        err = remove(FileName);
        FOutFlowCO.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cCO");
        err = remove(FileName);
        FOutYCO.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)

        strcpy(FileName + lon, "Fuel");
        err = remove(FileName);
        FOutFlowFuel.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cFuel");
        err = remove(FileName);
        FOutYFuel.open(FileName, std::fstream::out); // Concentration (mass
                                                     // fraction)

        strcpy(FileName + lon, "N2");
        err = remove(FileName);
        FOutFlowN2.open(FileName, std::fstream::out); // Mass Flow;

        strcpy(FileName + lon, "cN2");
        err = remove(FileName);
        FOutYN2.open(FileName, std::fstream::out); // Concentration (mass
                                                   // fraction)
      }
    }
  }
}

void TOutputResults::HeaderSpaceTimeResults(bool ThereIsDLL,
                                            stEspecies *SpeciesName,
                                            int SpeciesNumber) {
  std::string Label;
  float pasafloat = 0.0;

  if (FWriteSpaceTime) {
    if (SpeciesNumber == 0) {
      // Escritura en Pres.txt

      FileOutPressure << "Time";   // "Tiempo (s)";
      FileOutPressure << " Cycle"; // "Ciclo";
      // CABECERA RESULTADOS SPACETIME CILINDROS.
      for (unsigned int i = 0; i < STCylinder.size(); ++i) {
        // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FileOutPressure, 1);
      }
      // CABECERA RESULTADOS SPACETIME DEPOSITOS.
      for (unsigned int i = 0; i < STPlenum.size(); ++i) {
        // STPlenum[i]->HeaderSpaceTimeResultsDep(FileOutPressure, 1);
      }
      // CABECERA RESULTADOS SPACETIME TUBOS.
      for (unsigned int i = 0; i < STPipe.size(); ++i) {
        // STPipe[i]->HeaderSpaceTimeResultsTubo(FileOutPressure, 1);
      }
      FileOutPressure << "\n" << pasafloat;

      // Escritura en Temp.txt

      FileOutTemp << "Time";   // "Tiempo (s)";
      FileOutTemp << " Cycle"; // "Ciclo";
      // CABECERA RESULTADOS SPACETIME CILINDROS.
      for (unsigned int i = 0; i < STCylinder.size(); ++i) {
        // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FileOutTemp, 2);
      }
      // CABECERA RESULTADOS SPACETIME DEPOSITOS.
      for (unsigned int i = 0; i < STPlenum.size(); ++i) {
        // STPlenum[i]->HeaderSpaceTimeResultsDep(FileOutTemp, 2);
      }
      // CABECERA RESULTADOS SPACETIME TUBOS.
      for (unsigned int i = 0; i < STPipe.size(); ++i) {
        // STPipe[i]->HeaderSpaceTimeResultsTubo(FileOutTemp, 2);
      }
      FileOutTemp << "\n" << pasafloat;

      // Escritura en Vel.txt

      FileOutVel << "Time";   // "Tiempo (s)";
      FileOutVel << " Cycle"; // "Ciclo";
      // CABECERA RESULTADOS SPACETIME CILINDROS.
      for (unsigned int i = 0; i < STCylinder.size(); ++i) {
        // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FileOutVel, 3);
      }
      // CABECERA RESULTADOS SPACETIME DEPOSITOS.
      for (unsigned int i = 0; i < STPlenum.size(); ++i) {
        // STPlenum[i]->HeaderSpaceTimeResultsDep(FileOutVel, 3);
      }
      // CABECERA RESULTADOS SPACETIME TUBOS.
      for (unsigned int i = 0; i < STPipe.size(); ++i) {
        // STPipe[i]->HeaderSpaceTimeResultsTubo(FileOutVel, 3);
      }
      FileOutVel << "\n" << pasafloat;

      // Escritura en Den.txt

      FileOutDensity << "Time";   // "Tiempo (s)";
      FileOutDensity << " Cycle"; // "Ciclo";
      // CABECERA RESULTADOS SPACETIME CILINDROS.
      for (unsigned int i = 0; i < STCylinder.size(); ++i) {
        // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FileOutDensity, 4);
      }
      // CABECERA RESULTADOS SPACETIME DEPOSITOS.
      for (unsigned int i = 0; i < STPlenum.size(); ++i) {
        // STPlenum[i]->HeaderSpaceTimeResultsDep(FileOutDensity, 4);
      }
      // CABECERA RESULTADOS SPACETIME TUBOS.
      for (unsigned int i = 0; i < STPipe.size(); ++i) {
        // STPipe[i]->HeaderSpaceTimeResultsTubo(FileOutDensity, 4);
      }
      FileOutDensity << "\n" << pasafloat;
    } else {
      if (SpeciesNumber == 3) {
        FOutYFreshAir << "Time";
        FOutYFreshAir << " Cycle";
        FOutYFuel << "Time";
        FOutYFuel << " Cycle";
        FOutYBurntGas << "Time";
        FOutYBurntGas << " Cycle";

        FOutFlowFreshAir << "Time";
        FOutFlowFreshAir << " Cycle";
        FOutFlowFuel << "Time";
        FOutFlowFuel << " Cycle";
        FOutFlowBurntGas << "Time";
        FOutFlowBurntGas << " Cycle";

        // CABECERA RESULTADOS SPACETIME CILINDROS.
        for (unsigned int i = 0; i < STCylinder.size(); ++i) {
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYFreshAir, 5);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYFuel, 6);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYBurntGas, 7);

          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowFreshAir, 8);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowFuel, 9);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowBurntGas,
          // 10);
        }
        // CABECERA RESULTADOS SPACETIME DEPOSITOS.
        for (unsigned int i = 0; i < STPlenum.size(); ++i) {
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYFreshAir, 5);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYFuel, 6);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYBurntGas, 7);

          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowFreshAir, 8);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowFuel, 9);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowBurntGas, 10);
        }
        // CABECERA RESULTADOS SPACETIME TUBOS.
        for (unsigned int i = 0; i < STPipe.size(); ++i) {
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYFreshAir, 5);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYFuel, 6);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYBurntGas, 7);

          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowFreshAir, 8);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowFuel, 9);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowBurntGas, 10);
        }

        FOutYFreshAir << "\n" << pasafloat;
        FOutYFuel << "\n" << pasafloat;
        FOutYBurntGas << "\n" << pasafloat;

        FOutFlowFreshAir << "\n" << pasafloat;
        FOutFlowFuel << "\n" << pasafloat;
        FOutFlowBurntGas << "\n" << pasafloat;

      } else if (SpeciesNumber == 9) {
        FOutYO2 << "Time";
        FOutYO2 << " Cycle";
        FOutYCO2 << "Time";
        FOutYCO2 << " Cycle";
        FOutYH2O << "Time";
        FOutYH2O << " Cycle";
        FOutYHC << "Time";
        FOutYHC << " Cycle";
        FOutYSoot << "Time";
        FOutYSoot << " Cycle";
        FOutYNOx << "Time";
        FOutYNOx << " Cycle";
        FOutYCO << "Time";
        FOutYCO << " Cycle";
        FOutYN2 << "Time";
        FOutYN2 << " Cycle";

        FOutFlowO2 << "Time";
        FOutFlowO2 << " Cycle";
        FOutFlowCO2 << "Time";
        FOutFlowCO2 << " Cycle";
        FOutFlowH2O << "Time";
        FOutFlowH2O << " Cycle";
        FOutFlowHC << "Time";
        FOutFlowHC << " Cycle";
        FOutFlowSoot << "Time";
        FOutFlowSoot << " Cycle";
        FOutFlowNOx << "Time";
        FOutFlowNOx << " Cycle";
        FOutFlowCO << "Time";
        FOutFlowCO << " Cycle";
        FOutFlowN2 << "Time";
        FOutFlowN2 << " Cycle";

        // CABECERA RESULTADOS SPACETIME CILINDROS.
        for (unsigned int i = 0; i < STCylinder.size(); ++i) {
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYO2, 11);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYCO2, 12);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYH2O, 13);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYHC, 14);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYSoot, 15);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYNOx, 16);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYCO, 17);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYN2, 18);

          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowO2, 19);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowCO2, 20);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowH2O, 21);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowHC, 22);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowSoot, 23);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowNOx, 24);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowCO, 25);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowN2, 26);
        }
        // CABECERA RESULTADOS SPACETIME DEPOSITOS.
        for (unsigned int i = 0; i < STPlenum.size(); ++i) {
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYO2, 11);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYCO2, 12);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYH2O, 13);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYHC, 14);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYSoot, 15);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYNOx, 16);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYCO, 17);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYN2, 18);

          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowO2, 19);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowCO2, 20);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowH2O, 21);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowHC, 22);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowSoot, 23);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowNOx, 24);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowCO, 25);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowN2, 26);
        }
        // CABECERA RESULTADOS SPACETIME TUBOS.
        for (unsigned int i = 0; i < STPipe.size(); ++i) {
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYO2, 11);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYCO2, 12);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYH2O, 13);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYHC, 14);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYSoot, 15);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYNOx, 16);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYCO, 17);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYN2, 18);

          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowO2, 19);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowCO2, 20);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowH2O, 21);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowHC, 22);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowSoot, 23);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowNOx, 24);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowCO, 25);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowN2, 26);
        }
        FOutYO2 << "\n" << pasafloat;
        FOutYCO2 << "\n" << pasafloat;
        FOutYH2O << "\n" << pasafloat;
        FOutYHC << "\n" << pasafloat;
        FOutYSoot << "\n" << pasafloat;
        FOutYNOx << "\n" << pasafloat;
        FOutYCO << "\n" << pasafloat;
        FOutYN2 << "\n" << pasafloat;

        FOutFlowO2 << "\n" << pasafloat;
        FOutFlowCO2 << "\n" << pasafloat;
        FOutFlowH2O << "\n" << pasafloat;
        FOutFlowHC << "\n" << pasafloat;
        FOutFlowSoot << "\n" << pasafloat;
        FOutFlowNOx << "\n" << pasafloat;
        FOutFlowCO << "\n" << pasafloat;
        FOutFlowN2 << "\n" << pasafloat;

      } else if (SpeciesNumber == 10) {
        FOutYO2 << "Time";
        FOutYO2 << " Cycle";
        FOutYCO2 << "Time";
        FOutYCO2 << " Cycle";
        FOutYH2O << "Time";
        FOutYH2O << " Cycle";
        FOutYHC << "Time";
        FOutYHC << " Cycle";
        FOutYSoot << "Time";
        FOutYSoot << " Cycle";
        FOutYNOx << "Time";
        FOutYNOx << " Cycle";
        FOutYCO << "Time";
        FOutYCO << " Cycle";
        FOutYFuel << "Time";
        FOutYFuel << " Cycle";
        FOutYN2 << "Time";
        FOutYN2 << " Cycle";

        FOutFlowO2 << "Time";
        FOutFlowO2 << " Cycle";
        FOutFlowCO2 << "Time";
        FOutFlowCO2 << " Cycle";
        FOutFlowH2O << "Time";
        FOutFlowH2O << " Cycle";
        FOutFlowHC << "Time";
        FOutFlowHC << " Cycle";
        FOutFlowSoot << "Time";
        FOutFlowSoot << " Cycle";
        FOutFlowNOx << "Time";
        FOutFlowNOx << " Cycle";
        FOutFlowCO << "Time";
        FOutFlowCO << " Cycle";
        FOutFlowFuel << "Time";
        FOutFlowFuel << " Cycle";
        FOutFlowN2 << "Time";
        FOutFlowN2 << " Cycle";

        // CABECERA RESULTADOS SPACETIME CILINDROS.
        for (unsigned int i = 0; i < STCylinder.size(); ++i) {
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYO2, 11);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYCO2, 12);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYH2O, 13);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYHC, 14);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYSoot, 15);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYNOx, 16);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYCO, 17);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYFuel, 18);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutYN2, 19);

          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowO2, 20);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowCO2, 21);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowH2O, 22);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowHC, 23);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowSoot, 24);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowNOx, 25);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowCO, 26);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowFuel, 27);
          // STCylinder[i]->HeaderSpaceTimeResultsCilindro(FOutFlowN2, 28);
        }
        // CABECERA RESULTADOS SPACETIME DEPOSITOS.
        for (unsigned int i = 0; i < STPlenum.size(); ++i) {
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYO2, 11);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYCO2, 12);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYH2O, 13);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYHC, 14);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYSoot, 15);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYNOx, 16);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYCO, 17);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYFuel, 18);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutYN2, 19);

          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowO2, 20);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowCO2, 21);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowH2O, 22);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowHC, 23);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowSoot, 24);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowNOx, 25);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowCO, 26);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowFuel, 27);
          // STPlenum[i]->HeaderSpaceTimeResultsDep(FOutFlowN2, 28);
        }
        // CABECERA RESULTADOS SPACETIME TUBOS.
        for (unsigned int i = 0; i < STPipe.size(); ++i) {
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYO2, 11);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYCO2, 12);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYH2O, 13);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYHC, 14);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYSoot, 15);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYNOx, 16);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYCO, 17);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYFuel, 18);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutYN2, 19);

          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowO2, 20);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowCO2, 21);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowH2O, 22);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowHC, 23);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowSoot, 24);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowNOx, 25);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowCO, 26);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowFuel, 27);
          // STPipe[i]->HeaderSpaceTimeResultsTubo(FOutFlowN2, 28);
        }
        FOutYO2 << "\n" << pasafloat;
        FOutYCO2 << "\n" << pasafloat;
        FOutYH2O << "\n" << pasafloat;
        FOutYHC << "\n" << pasafloat;
        FOutYSoot << "\n" << pasafloat;
        FOutYNOx << "\n" << pasafloat;
        FOutYCO << "\n" << pasafloat;
        FOutYFuel << "\n" << pasafloat;
        FOutYN2 << "\n" << pasafloat;

        FOutFlowO2 << "\n" << pasafloat;
        FOutFlowCO2 << "\n" << pasafloat;
        FOutFlowH2O << "\n" << pasafloat;
        FOutFlowHC << "\n" << pasafloat;
        FOutFlowSoot << "\n" << pasafloat;
        FOutFlowNOx << "\n" << pasafloat;
        FOutFlowCO << "\n" << pasafloat;
        FOutFlowFuel << "\n" << pasafloat;
        FOutFlowN2 << "\n" << pasafloat;
      }
    }
  }
}

void TOutputResults::PrintSpaceTimeResults(
    bool EngineBlock, double Theta, double SimulationDuration,
    const std::vector<std::unique_ptr<TBloqueMotor>> &Engine,
    int SpeciesNumber) {

  std::string Label;
  char Label1[20];
  char Label2[20];
  // char * Label1 = new char [20];
  // char * Label2 = new char [20];

  int m = 0;
  float pasafloat = 0.;
  std::stringstream Buffer; // TStringStream Buffer;

  if (FWriteSpaceTime) {
    if (SpeciesNumber == 0) {
      if (EngineBlock) {
        m = int(Theta / Engine[0]->getAngTotalCiclo());
        pasafloat = (float)(Theta - (m * Engine[0]->getAngTotalCiclo()));
        ConvertCharacter(int(pasafloat * 10), Label1, 5);
        // itoa(int(pasafloat*10),Label1,10);
        ConvertCharacter((Engine[0]->getCiclo() + 1), Label2, 3);
        // itoa((Engine->getCiclo()+1),Label2,10);
      } else {
        pasafloat = (float)Theta;
        ConvertCharacter(int(pasafloat * 1000), Label1, 5);
        // itoa(int(pasafloat*1000),Label1,10);
        ConvertCharacter(1, Label2, 3);
        // itoa(1,Label2,10);
      }
      Buffer << std::endl;
      Buffer << (float)SimulationDuration;
      Buffer << "\t";
      if (EngineBlock) {
        Buffer << (Engine[0]->getCiclo() + 1);
      } else {
        Buffer << 1;
      }

      // IMPRIME RESULTADOS SPACETIME EN CILINDROS.

      FileOutPressure << Buffer.str();
      FileOutTemp << Buffer.str();
      FileOutVel << Buffer.str();
      FileOutDensity << Buffer.str();

      for (unsigned int i = 0; i < STCylinder.size(); ++i) {
        // STCylinder[i]->ReadSpaceTimeResultsCilindro();
        // STCylinder[i]->PrintSpaceTimeResultsCilindro(FileOutPressure, 1);
        // STCylinder[i]->PrintSpaceTimeResultsCilindro(FileOutTemp, 2);
        // STCylinder[i]->PrintSpaceTimeResultsCilindro(FileOutVel, 3);
        // STCylinder[i]->PrintSpaceTimeResultsCilindro(FileOutDensity, 4);
      }

      // Buffer.str("");

      // IMPRIME RESULTADOS SPACETIME EN DEPOSITOS.

      for (unsigned int i = 0; i < STPlenum.size(); ++i) {
        // STPlenum[i]->ReadSpaceTimeResultsDep();
        // STPlenum[i]->PrintSpaceTimeResultsDep(FileOutPressure, 1);
        // STPlenum[i]->PrintSpaceTimeResultsDep(FileOutTemp, 2);
        // STPlenum[i]->PrintSpaceTimeResultsDep(FileOutVel, 3);
        // STPlenum[i]->PrintSpaceTimeResultsDep(FileOutDensity, 4);
      }

      // IMPRIME RESULTADOS SPACETIME EN TUBOS.

      for (unsigned int i = 0; i < STPipe.size(); ++i) {
        // STPipe[i]->ReadSpaceTimeResultsTubo();
        // STPipe[i]->PrintSpaceTimeResultsTubo(FileOutPressure, 1);
        // STPipe[i]->PrintSpaceTimeResultsTubo(FileOutTemp, 2);
        // STPipe[i]->PrintSpaceTimeResultsTubo(FileOutVel, 3);
        // STPipe[i]->PrintSpaceTimeResultsTubo(FileOutDensity, 4);
      }

    } else {
      if (SpeciesNumber == 3) {
        if (EngineBlock) {
          m = int(Theta / Engine[0]->getAngTotalCiclo());
          pasafloat = (float)(Theta - (m * Engine[0]->getAngTotalCiclo()));
          ConvertCharacter(int(pasafloat * 10), Label1, 5);
          ConvertCharacter((Engine[0]->getCiclo() + 1), Label2, 3);
        } else {
          pasafloat = (float)Theta;
          ConvertCharacter(int(pasafloat * 1000), Label1, 5);
          ConvertCharacter(1, Label2, 3);
        }
        Buffer << std::endl;
        Buffer << (float)SimulationDuration;
        Buffer << "\t";
        if (EngineBlock) {
          Buffer << (Engine[0]->getCiclo() + 1);
        } else {
          Buffer << 1;
        }

        FOutYFreshAir << Buffer.str();
        FOutYFuel << Buffer.str();
        FOutYBurntGas << Buffer.str();

        FOutFlowFreshAir << Buffer.str();
        FOutFlowFuel << Buffer.str();
        FOutFlowBurntGas << Buffer.str();

        // IMPRIME RESULTADOS SPACETIME EN CILINDROS.
        for (unsigned int i = 0; i < STCylinder.size(); ++i) {
          // STCylinder[i]->ReadSpaceTimeResultsCilindro();
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYFreshAir, 5);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYFuel, 6);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYBurntGas, 7);

          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowFreshAir, 8);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowFuel, 9);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowBurntGas, 10);
        }
        // IMPRIME RESULTADOS SPACETIME EN DEPOSITOS.
        for (unsigned int i = 0; i < STPlenum.size(); ++i) {
          // STPlenum[i]->ReadSpaceTimeResultsDep();
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYFreshAir, 5);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYFuel, 6);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYBurntGas, 7);

          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowFreshAir, 8);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowFuel, 9);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowBurntGas, 10);
        }
        // IMPRIME RESULTADOS SPACETIME EN TUBOS.
        for (unsigned int i = 0; i < STPipe.size(); ++i) {
          // STPipe[i]->ReadSpaceTimeResultsTubo();
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYFreshAir, 5);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYFuel, 6);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYBurntGas, 7);

          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowFreshAir, 8);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowFuel, 9);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowBurntGas, 10);
        }
      } else if (SpeciesNumber == 9) {
        if (EngineBlock) {
          m = int(Theta / Engine[0]->getAngTotalCiclo());
          pasafloat = (float)(Theta - (m * Engine[0]->getAngTotalCiclo()));
          ConvertCharacter(int(pasafloat * 10), Label1, 5);
          ConvertCharacter((Engine[0]->getCiclo() + 1), Label2, 3);
        } else {
          pasafloat = (float)Theta;
          ConvertCharacter(int(pasafloat * 1000), Label1, 5);
          ConvertCharacter(1, Label2, 3);
        }
        Buffer << std::endl;
        Buffer << (float)SimulationDuration;
        Buffer << "\t";
        if (EngineBlock) {
          Buffer << (Engine[0]->getCiclo() + 1);
        } else {
          Buffer << 1;
        }

        FOutYO2 << Buffer.str();
        FOutYCO2 << Buffer.str();
        FOutYH2O << Buffer.str();
        FOutYHC << Buffer.str();
        FOutYSoot << Buffer.str();
        FOutYNOx << Buffer.str();
        FOutYCO << Buffer.str();
        FOutYN2 << Buffer.str();

        FOutFlowO2 << Buffer.str();
        FOutFlowCO2 << Buffer.str();
        FOutFlowH2O << Buffer.str();
        FOutFlowHC << Buffer.str();
        FOutFlowSoot << Buffer.str();
        FOutFlowNOx << Buffer.str();
        FOutFlowCO << Buffer.str();
        FOutFlowN2 << Buffer.str();

        // IMPRIME RESULTADOS SPACETIME EN CILINDROS.
        for (unsigned int i = 0; i < STCylinder.size(); ++i) {
          // STCylinder[i]->ReadSpaceTimeResultsCilindro();
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYO2, 11);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYCO2, 12);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYH2O, 13);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYHC, 14);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYSoot, 15);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYNOx, 16);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYCO, 17);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYN2, 18);

          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowO2, 19);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowCO2, 20);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowH2O, 21);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowHC, 22);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowSoot, 23);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowNOx, 24);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowCO, 25);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowN2, 26);
        }
        // IMPRIME RESULTADOS SPACETIME EN DEPOSITOS.
        for (unsigned int i = 0; i < STPlenum.size(); ++i) {
          // STPlenum[i]->ReadSpaceTimeResultsDep();
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYO2, 11);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYCO2, 12);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYH2O, 13);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYHC, 14);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYSoot, 15);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYNOx, 16);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYCO, 17);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYN2, 18);

          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowO2, 19);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowCO2, 20);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowH2O, 21);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowHC, 22);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowSoot, 23);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowNOx, 24);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowCO, 25);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowN2, 26);
        }
        // IMPRIME RESULTADOS SPACETIME EN TUBOS.
        for (unsigned int i = 0; i < STPipe.size(); ++i) {
          // STPipe[i]->ReadSpaceTimeResultsTubo();
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYO2, 11);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYCO2, 12);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYH2O, 13);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYHC, 14);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYSoot, 15);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYNOx, 16);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYCO, 17);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYN2, 18);

          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowO2, 19);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowCO2, 20);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowH2O, 21);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowHC, 22);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowSoot, 23);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowNOx, 24);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowCO, 25);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowN2, 26);
        }

      } else if (SpeciesNumber == 10) {
        if (EngineBlock) {
          m = int(Theta / Engine[0]->getAngTotalCiclo());
          pasafloat = (float)(Theta - (m * Engine[0]->getAngTotalCiclo()));
          ConvertCharacter(int(pasafloat * 10), Label1, 5);
          ConvertCharacter((Engine[0]->getCiclo() + 1), Label2, 3);
        } else {
          pasafloat = (float)Theta;
          ConvertCharacter(int(pasafloat * 1000), Label1, 5);
          ConvertCharacter(1, Label2, 3);
        }
        Buffer << std::endl;
        Buffer << (float)SimulationDuration;
        Buffer << "\t";
        if (EngineBlock) {
          Buffer << (Engine[0]->getCiclo() + 1);
        } else {
          Buffer << 1;
        }

        FOutYO2 << Buffer.str();
        FOutYCO2 << Buffer.str();
        FOutYH2O << Buffer.str();
        FOutYHC << Buffer.str();
        FOutYSoot << Buffer.str();
        FOutYNOx << Buffer.str();
        FOutYCO << Buffer.str();
        FOutYFuel << Buffer.str();
        FOutYN2 << Buffer.str();

        FOutFlowO2 << Buffer.str();
        FOutFlowCO2 << Buffer.str();
        FOutFlowH2O << Buffer.str();
        FOutFlowHC << Buffer.str();
        FOutFlowSoot << Buffer.str();
        FOutFlowNOx << Buffer.str();
        FOutFlowCO << Buffer.str();
        FOutFlowFuel << Buffer.str();
        FOutFlowN2 << Buffer.str();

        // IMPRIME RESULTADOS SPACETIME EN CILINDROS.
        for (unsigned int i = 0; i < STCylinder.size(); ++i) {
          // STCylinder[i]->ReadSpaceTimeResultsCilindro();
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYO2, 11);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYCO2, 12);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYH2O, 13);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYHC, 14);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYSoot, 15);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYNOx, 16);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYCO, 17);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYFuel, 18);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutYN2, 19);

          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowO2, 20);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowCO2, 21);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowH2O, 22);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowHC, 23);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowSoot, 24);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowNOx, 25);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowCO, 26);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowFuel, 27);
          // STCylinder[i]->PrintSpaceTimeResultsCilindro(FOutFlowN2, 28);
        }
        // IMPRIME RESULTADOS SPACETIME EN DEPOSITOS.
        for (unsigned int i = 0; i < STPlenum.size(); ++i) {
          // STPlenum[i]->ReadSpaceTimeResultsDep();
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYO2, 11);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYCO2, 12);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYH2O, 13);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYHC, 14);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYSoot, 15);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYNOx, 16);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYCO, 17);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYFuel, 18);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutYN2, 19);

          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowO2, 19);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowCO2, 20);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowH2O, 21);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowHC, 22);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowSoot, 23);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowNOx, 24);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowCO, 25);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowFuel, 27);
          // STPlenum[i]->PrintSpaceTimeResultsDep(FOutFlowN2, 28);
        }
        // IMPRIME RESULTADOS SPACETIME EN TUBOS.
        for (unsigned int i = 0; i < STPipe.size(); ++i) {
          // STPipe[i]->ReadSpaceTimeResultsTubo();
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYO2, 11);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYCO2, 12);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYH2O, 13);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYHC, 14);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYSoot, 15);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYNOx, 16);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYCO, 17);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYFuel, 18);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutYN2, 19);

          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowO2, 19);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowCO2, 20);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowH2O, 21);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowHC, 22);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowSoot, 23);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowNOx, 24);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowCO, 25);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowFuel, 27);
          // STPipe[i]->PrintSpaceTimeResultsTubo(FOutFlowN2, 28);
        }
      }
    }
  }
}

void TOutputResults::HeaderInstantaneousResults(TCalculoExtern *EXTERN,
                                                bool ThereIsDLL,
                                                bool EngineBlock,
                                                stEspecies *SpeciesName) {

  if (WriteInsHeader) {

    std::string Label;

    FInsOutput << "Time";

    if (EngineBlock) {
      Label = PutLabel(702);
      FInsOutput << "\t" << Label.c_str();
    }

    // std::cout << (*FInsOutput).str() << std::endl;

    // fflush(fg);
    //// CABECERA RESULTADOS INSTANTANEOS CILINDROS.
    for (unsigned int i = 0; i < InsCylinder.size(); ++i) {
      InsCylinder[i]->HeaderInstantaneousResultsCilindro(FInsOutput,
                                                         SpeciesName);
    }

    // CABECERA RESULTADOS INSTANTANEOS DEPOSITOS.
    for (unsigned int i = 0; i < InsPlenum.size(); ++i) {
      InsPlenum[i]->HeaderInstantaneousResultsDep(FInsOutput, SpeciesName);
    }

    // CABECERA RESULTADOS INSTANTANEOS TUBOS.

    for (unsigned int i = 0; i < InsPipe.size(); i++) {
      InsPipe[i]->HeaderInstantaneousResults(FInsOutput, SpeciesName);
    }

    // CABECERA RESULTADOS INSTANTANEOS DPF.
#ifdef ParticulateFilter
    for (unsigned int i = 0; i < InsDPF.size(); i++) {
      InsDPF[i]->CabeceraResultadosInstantaneos(FInsOutput, SpeciesName);
    }
#endif

    // CABECERA RESULTADOS INSTANTANEOS VENTURIS.

    for (unsigned int i = 0; i < InsVenturi.size(); i++) {
      InsVenturi[i]->CabeceraResultadosInstantVenturi(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS EJES.

    for (unsigned int i = 0; i < InsTurbo.size(); ++i) {
      InsTurbo[i]->HeaderInstantaneousResultsEje(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS TURBINAS.
    for (unsigned int i = 0; i < InsTurbine.size(); i++) {
      InsTurbine[i]->CabeceraResultadosInstantTurb(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS COMPRESOR.
    for (unsigned int i = 0; i < InsCompressor.size(); ++i) {
      InsCompressor[i]->CabeceraGraficasInstantaneas(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS VALVULAS.

    for (unsigned int i = 0; i < InsValve.size(); i++) {
      InsValve[i]->CabeceraGraficaINS(FInsOutput, InsValveNode[i]);
    }

    // CABECERA RESULTADOS INSTANTANEOS WASTE-GATES.
    for (unsigned int i = 0; i < InsWasteGate.size(); i++) {
      InsWasteGate[i]->CabeceraGraficaINS(FInsOutput, i);
    }

    // CABECERA RESULTADOS INSTANTANEOS LAMINAS.
    for (unsigned int i = 0; i < InsReedValve.size(); i++) {
      InsReedValve[i]->CabeceraGraficaINS(FInsOutput, i);
    }

    // CABECERA RESULTADOS INSTANTANEOS COMPRESOR VOLUMETRICO (TORNILLO).
    for (unsigned int i = 0; i < InsRoot.size(); i++) {
      InsRoot[i]->CabeceraResultadosInstantCV(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS UNION ENTRE DEPOSITOS.
    for (unsigned int i = 0; i < InsConnection.size(); i++) {
      InsConnection[i]->CabeceraResultadosInstantUED(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS SENSOR.
    for (unsigned int i = 0; i < InsSensor.size(); i++) {
      InsSensor[i]->CabeceraResultadosInsSensor(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS CONTROLADOR.
    for (unsigned int i = 0; i < InsController.size(); i++) {
      InsController[i]->CabeceraResultadosInsControlador(FInsOutput);
    }

    // CABECERA RESULTADOS INSTANTANEOS CALCULOS EXTERNOS.
    if (ThereIsDLL) {
      EXTERN->ImprimeCabeceraInstantaneas(FInsOutput);
    }
  }
}

void TOutputResults::ConvertCharacter(int confile, char confile1[],
                                      int Characters) {
  try {
    int i, j = 0;

    i = 0;
    do {
      confile1[Characters - i] = (char)(confile % 10) + '0';
      ++i;
    } while ((confile /= 10) > 0);
    confile1[Characters + 1] = '\0';

    if (i < Characters + 1) {
      for (j = 0; j <= (Characters - i); j++) {
        confile1[j] = '0';
      }
    }
  } catch (std::exception &N) {
    std::cout << "ERROR: ConvertCharacter" << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TOutputResults::PlotThisCycle(TBloqueMotor *Engine, int TotalCycles) {

  switch (FTypeOfInsResults) {
  case nmLastCyle:
    if ((Engine->getCiclo() + 1) == TotalCycles - 1) {
      FPlotThisCycle = true;
    } else {
      FPlotThisCycle = false;
    }
    break;
  case nmEveryNCycles:
    if ((Engine->getCiclo() + 1) % FCyclePeriod == 0) {
      FPlotThisCycle = true;
    } else {
      FPlotThisCycle = false;
    }
  default:
    FPlotThisCycle = true;
  }
}

void TOutputResults::PlotControl(double Theta0, double Theta,
                                 double CycleDuration) {

  int n1 = 0, n0 = 0;

  if (FFirstTime) {
    FFirstTime = false;
    FControlAngle1 = 0;
    while (FControlAngle1 <= Theta) {
      FControlAngle1 += FInsPeriod;
    }
    if (FControlAngle1 > Theta + 10) {
      FControlAngle1 = Theta + 10;
    }
    FControlAngle0 = FControlAngle1 - FInsPeriod;
  }
  while (FControlAngle1 < Theta0) {
    FControlAngle1 = FControlAngle1 + FInsPeriod;
    FControlAngle0 = FControlAngle1 - FInsPeriod;
  }
  if (FControlAngle1 > Theta0 && FControlAngle1 <= Theta) {
    FControlAngle0 = FControlAngle1;
    FControlAngle1 += FInsPeriod;
    if (fmod(FControlAngle1, CycleDuration) < FInsPeriod) {
      FControlAngle1 -= fmod(FControlAngle1, CycleDuration);
    }
    if (FPlotThisCycle)
      FPlotIns = true;
    else
      FPlotIns = false;
  } else {
    FPlotIns = false;
  }
}

void TOutputResults::OutputInstantaneousResults(TCalculoExtern *EXTERN,
                                                bool ThereIsDLL,
                                                bool EngineBlock, double Theta,
                                                TBloqueMotor *Engine,
                                                double Time) {

  if (FPlotIns) {
    float pasafloat, m;
    double RegimenFicticio = 0.;

    FInsOutput << std::endl;
    FInsOutput << Time;

    if (EngineBlock) {
      m = int(Theta / Engine->getAngTotalCiclo());
      pasafloat = (float)(Theta - (m * Engine->getAngTotalCiclo()));
      FInsOutput << "\t" << pasafloat;
    }

    // IMPRIME RESULTADOS INSTANTANEOS CILINDROS.
    for (unsigned int i = 0; i < InsCylinder.size(); ++i) {
      InsCylinder[i]->CalculaResultadosInstantaneosCilindro();
      InsCylinder[i]->ImprimeResultadosInstantaneosCilindro(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS DEPOSITOS.
    for (unsigned int i = 0; i < InsPlenum.size(); ++i) {
      InsPlenum[i]->ResultadosInstantaneosDep();
      InsPlenum[i]->ImprimeResultadosInstantaneosDep(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS TUBOS.

    for (unsigned int i = 0; i < InsPipe.size(); i++) {
      InsPipe[i]->CalculaResultadosInstantaneos();
      InsPipe[i]->ImprimeResultadosInstantaneos(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS VENTURIS.

    for (unsigned int i = 0; i < InsVenturi.size(); i++) {
      InsVenturi[i]->CalculaResultadosVenturi();
      InsVenturi[i]->ImprimeResultadosInstantVenturi(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS EJES.

    for (unsigned int i = 0; i < InsTurbo.size(); ++i) {
      InsTurbo[i]->ResultadosInstantEje();
      InsTurbo[i]->ImprimeResultadosInstantaneosEje(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS TURBINAS.
    for (unsigned int i = 0; i < InsTurbine.size(); i++) {
      InsTurbine[i]->ResultadosInstantTurb();
      InsTurbine[i]->ImprimeResultadosInstantTurb(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS COMPRESOR.
    for (unsigned int i = 0; i < InsCompressor.size(); ++i) {
      InsCompressor[i]->CalculaInstantaneos();
      InsCompressor[i]->ImprimeGraficasInstantaneas(FInsOutput);
    }

    // RESULTADOS INSTANTANEOS EN DPF.
#ifdef ParticulateFilter
    for (int i = 0; i < InsDPF.size(); i++) {
      InsDPF[i]->CalculaResultadosInstantaneos();
      InsDPF[i]->ImprimeResultadosInstantaneos(FInsOutput);
    }
#endif

    // IMPRIME RESULTADOS INSTANTANEOS VALVULAS.

    for (unsigned int i = 0; i < InsValve.size(); i++) {
      InsValve[i]->ImprimeGraficaINS(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS WASTE-GATES.
    for (unsigned int i = 0; i < InsWasteGate.size(); i++) {
      InsWasteGate[i]->ImprimeGraficaINS(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS LAMINAS.
    for (unsigned int i = 0; i < InsReedValve.size(); i++) {
      InsReedValve[i]->ImprimeGraficaINS(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS COMPRESOR VOLUMETRICO (TORNILLO).
    for (unsigned int i = 0; i < InsRoot.size(); i++) {
      InsRoot[i]->ResultadosInstantCV();
      InsRoot[i]->ImprimeResultadosInstantCV(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS UNION ENTRE DEPOSITOS.
    for (unsigned int i = 0; i < InsConnection.size(); i++) {
      InsConnection[i]->ResultadosInstantUED();
      InsConnection[i]->ImprimeResultadosInstantUED(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS SENSOR.
    for (unsigned int i = 0; i < InsSensor.size(); i++) {
      InsSensor[i]->ResultadosInstantSensor();
      InsSensor[i]->ImprimeResultadosInsSensor(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS CONTROLADOR.
    for (unsigned int i = 0; i < InsController.size(); i++) {
      InsController[i]->ResultadosInstantController();
      InsController[i]->ImprimeResultadosInsControlador(FInsOutput);
    }

    // IMPRIME RESULTADOS INSTANTANEOS CALCULOS EXTERNOS.
    if (ThereIsDLL) {
      EXTERN->ImprimeGraficosInstantaneas(FInsOutput);
    }
#ifdef WriteINS
    CopyInstananeousResultsToFile(1);
#endif
  }
}

void TOutputResults::WriteInstantaneous(bool EngineBlock, double Angle,
                                        double AngStep, TBloqueMotor *Engine,
                                        int TotalCycles) {

  if (EngineBlock) {
    switch (FTypeOfInsResults) {
    case nmLastCyle:
      if ((Engine->getCiclo() + 1) == TotalCycles - 1) {
        FPlotThisCycle = true;
        if (Angle - AngStep < 0)
          WriteInsHeader = true;
        else
          WriteInsHeader = false;
      } else {
        FPlotThisCycle = false;
        WriteInsHeader = false;
      }

      break;
    case nmAllCyclesIndependent:
      FPlotThisCycle = true;
      if (Angle - AngStep < 0)
        WriteInsHeader = true;
      else
        WriteInsHeader = false;
      break;
    case nmAllCyclesConcatenated:
      FPlotThisCycle = true;
      if (InsHeaderCreated) {
        WriteInsHeader = false;
      } else {
        WriteInsHeader = true;
        InsHeaderCreated = true;
      }
      break;
    case nmEveryNCycles:

      if ((Engine->getCiclo() + 1) % FCyclePeriod == 0 &&
          Engine->getCiclo() > 0) {
        FPlotThisCycle = true;
        if (Angle - AngStep < 0) {
          WriteInsHeader = true;
        } else {
          WriteInsHeader = false;
        }
      } else {
        FPlotThisCycle = false;
      }
    }
  } else {
    if (InsHeaderCreated) {
      WriteInsHeader = false;
    } else {
      WriteInsHeader = true;
      InsHeaderCreated = true;
    }
  }
}

void TOutputResults::WriteSpaceTime(bool EngineBlock, TBloqueMotor *Engine,
                                    int TotalCycles) {
  if (EngineBlock) {
    if ((Engine->getCiclo() + 1) == TotalCycles - 1) {
      FWriteSpaceTime = true;
    }
  } else {
    FWriteSpaceTime = true;
  }
}

// ---------------------------------------------------------------------------

#pragma package(smart_init)

void TOutputResults::HeaderAverageResults(stEspecies *SpeciesName,
                                          TCalculoExtern *EXTERN,
                                          bool ThereIsDLL) {

  FAvgOutput << PutLabel(704);
  FAvgOutput << "\t" << PutLabel(701);

  // ! Header average results in cylinders.

  for (Uint i = 0; i < AvgCylinder.size(); ++i) {
    AvgCylinder[i]->HeaderAverageResultsCilindro(FAvgOutput, SpeciesName);
  }

  // ! Header average results in the engine.
  if (AvgEngine != NULL) {
    AvgEngine->HeaderAverageResultsBloqueMotor(FAvgOutput);
  }

  // ! Header average results in plenums
  for (Uint i = 0; i < AvgPlenum.size(); ++i) {
    AvgPlenum[i]->HeaderAverageResultsDep(FAvgOutput, SpeciesName);
  }

  // ! Header average results in pipes
  for (Uint i = 0; i < AvgPipe.size(); i++) {
    AvgPipe[i]->HeaderAverageResults(FAvgOutput, SpeciesName);
  }

  // ! Header average results in valves
  for (Uint i = 0; i < AvgValve.size(); i++) {
    AvgValve[i]->CabeceraGraficaMED(FAvgOutput, AvgValveNode[i]);
  }

  // ! Header average results in venturis
  for (Uint i = 0; i < AvgVenturi.size(); i++) {
    AvgVenturi[i]->HeaderAverageResultsVenturi(FAvgOutput);
  }

  // ! Header average results in turbocharger.
  for (Uint i = 0; i < AvgAxis.size(); ++i) {
    AvgAxis[i]->CabeceraResultadosMedEje(FAvgOutput);
  }

  // ! Header averge results in compressors.
  for (Uint i = 0; i < AvgCompressor.size(); ++i) {
    AvgCompressor[i]->CabeceraGraficasMedias(FAvgOutput);
  }

  // ! Header average results in turbines

  for (Uint i = 0; i < AvgTurbine.size(); i++) {
    AvgTurbine[i]->CabeceraResultadosMedTurb(FAvgOutput);
  }

  // ! Header average results in root compressors
  for (Uint i = 0; i < AvgRoot.size(); i++) {
    AvgRoot[i]->CabeceraResultadosMedCV(FAvgOutput);
  }

  // ! Header average results in connections between plenums
  for (Uint i = 0; i < AvgConnection.size(); i++) {
    AvgConnection[i]->HeaderAverageResultsUED(FAvgOutput);
  }

  // ! Header average results in connections between DPF.
#ifdef ParticulateFilter
  for (Uint i = 0; i < AvgDPF.size(); i++) {
    AvgDPF[i]->CabeceraResultadosMedios(FAvgOutput, SpeciesName);
  }
#endif

  // ! Header average results in sensors
  for (Uint i = 0; i < AvgSensor.size(); i++) {
    AvgSensor[i]->CabeceraResultadosMedSensor(FAvgOutput);
  }

  // ! Header average results in controllers
  for (Uint i = 0; i < AvgController.size(); i++) {
    AvgController[i]->CabeceraResultadosMedControlador(FAvgOutput);
  }

  // ! Average results in external calculations
  if (ThereIsDLL) {
    EXTERN->ImprimeCabeceraMedias(FAvgOutput);
  }
}

void TOutputResults::OutputAverageResults(double AcumulatedTime,
                                          TCalculoExtern *EXTERN,
                                          bool ThereIsDLL, int CycleNumber) {

  float pasafloat;

  pasafloat = (float)(AcumulatedTime);

  FAvgOutput << std::endl;
  FAvgOutput << CycleNumber;
  FAvgOutput << "\t";
  FAvgOutput << pasafloat;

  // ! Average results in cylinders

  for (Uint i = 0; i < AvgCylinder.size(); ++i) {
    AvgCylinder[i]->CalculaResultadosMediosCilindro();
    AvgCylinder[i]->ImprimeResultadosMediosCilindro(FAvgOutput);
  }

  // ! Average results in the engine
  if (AvgEngine != NULL) {
    AvgEngine->ResultadosMediosBloqueMotor();
    AvgEngine->ImprimeResultadosMediosBloqueMotor(FAvgOutput);
  }

  // ! Average results in plenums

  for (Uint i = 0; i < AvgPlenum.size(); ++i) {
    AvgPlenum[i]->ResultadosMediosDep();
    AvgPlenum[i]->ImprimeResultadosMediosDep(FAvgOutput);
  }

  // ! Average results in pipes
  for (Uint i = 0; i < AvgPipe.size(); ++i) {
    AvgPipe[i]->ImprimeResultadosMedios(FAvgOutput);
  }

  // ! Average results in valves.
  for (Uint i = 0; i < AvgValve.size(); i++) {
    AvgValve[i]->ImprimeGraficaMED(FAvgOutput);
  }

  // ! Average results in venturis
  for (Uint i = 0; i < AvgVenturi.size(); i++) {
    AvgVenturi[i]->ResultadosMediosVenturi();
    AvgVenturi[i]->ImprimeResultadosMediosVenturi(FAvgOutput);
  }

  // ! Average results in turbocharger axis
  for (Uint i = 0; i < AvgAxis.size(); ++i) {
    AvgAxis[i]->ResultadosMediosEje();
    AvgAxis[i]->ImprimeResultadosMedEje(FAvgOutput);
  }

  // ! Average results in compressors.
  for (Uint i = 0; i < AvgCompressor.size(); ++i) {
    AvgCompressor[i]->ImprimeGraficasMedias(FAvgOutput);
  }

  // ! Average results in turbines.
  for (Uint i = 0; i < AvgTurbine.size(); i++) {
    AvgTurbine[i]->CalculaResultadosMediosTurb();
    AvgTurbine[i]->ImprimeResultadosMedTurb(FAvgOutput);
  }

  // ! Average results in root compressors.
  for (Uint i = 0; i < AvgRoot.size(); i++) {
    AvgRoot[i]->ResultadosMediosCV();
    AvgRoot[i]->ImprimeResultadosMedCV(FAvgOutput);
  }

  // ! Average results in connections.
  for (Uint i = 0; i < AvgConnection.size(); i++) {
    AvgConnection[i]->ResultadosMediosUED();
    AvgConnection[i]->ImprimeResultadosMediosUED(FAvgOutput);
  }

  // ! Average results in DPF.
#ifdef ParticulateFilter
  for (int i = 0; i < AvgConnection.size(); i++) {
    AvgDPF[i]->ImprimeResultadosMedios(FAvgOutput);
  }
#endif

  // ! Average results in sensors.
  for (Uint i = 0; i < AvgSensor.size(); i++) {
    AvgSensor[i]->ResultadosMediosSensor();
    AvgSensor[i]->ImprimeResultadosMedSensor(FAvgOutput);
  }

  // ! Average results in controllers
  for (Uint i = 0; i < AvgController.size(); i++) {
    AvgController[i]->ResultadosMediosController();
    AvgController[i]->ImprimeResultadosMedControlador(FAvgOutput);
  }

  // ! Average results in external calculations.
  if (ThereIsDLL) {
    EXTERN->CalculaMedias();
    EXTERN->ImprimeGraficosMedias(FAvgOutput);
  }
}

void TOutputResults::CopyAverageResultsToFile(int mode) {

  if (mode == 0) { // ! Create new file o rewrite if it exists
    FFileAvg.open(FAvgFilename.c_str(), fstream::out);
  } else { // ! Create new file or append if it exists
    FFileAvg.open(FAvgFilename.c_str(), fstream::out | fstream::app);
  }

  FFileAvg << FAvgOutput.str();

  FFileAvg.close();

  FAvgOutput.str("");
}

void TOutputResults::CopyInstananeousResultsToFile(int mode) {

  if (FInsOutput.str() != "" && (WriteInsHeader || mode == 1)) {

    char FileName[300];

    if (FMultipleFiles) {
      ConvertCharacter(FFileCountI, FFileCountC, FCharacters);

      strcat(FFileCountC, ".DAT");
      char tempIns[300];
      strcpy(tempIns, FInsFilename.c_str());
      GetName(tempIns, FileName, FFileCountC);
    } else {
      char tempIns[300];
      strcpy(tempIns, FInsFilename.c_str());
      GetName(tempIns, FileName, ".DAT");
    }

    if (WriteInsHeader) {
      FFileIns.open(FileName, fstream::out);
    } else {
#ifdef WriteINS
      FFileIns.open(FileName, fstream::out | fstream::app);
#endif
#ifndef WriteINS
      FFileIns.open(FileName, fstream::out);
#endif
    }
    if (!FFileIns.is_open()) {
      cout << "WARNING: The file " << FileName << " in in use" << endl;
      cout << "Please close the file, insert any character and press enter to "
              "continue"
           << endl;
      string key;
      cin >> key;
    }

    FFileIns << FInsOutput.str();

    FFileIns.close();

    FInsOutput.str("");

    FFileCountI++;
  }
}
