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
    const char *FileWAM, fpos_t &filepos,
    const std::vector<std::unique_ptr<TTubo>> &Pipe, bool EngineBlock,
    const std::vector<std::unique_ptr<TBloqueMotor>> &Engine,
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
    int TotalCycles, const char *ModelName) {

  char buffer[300];
  GetName(ModelName, buffer, "AVG.DAT");
  FAvgFilename = buffer;

  int err = remove(FAvgFilename.c_str());

  std::ifstream FileInput(FileWAM);
  FileInput.seekg((std::streamoff)filepos);

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
    FileInput >> FCyclePeriod;
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgCylinder[i]->ReadAverageResultsCilindro(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in the engine
  int EngineAvg = 0;
  FileInput >> EngineAvg;
  if (EngineAvg == 1) {
    if (EngineBlock) {
      AvgEngine = Engine[0].get();
      filepos = (fpos_t)FileInput.tellg();
      FileInput.close();
      AvgEngine->ReadAverageResultsBloqueMotor(FileWAM, filepos);
      FileInput.open(FileWAM);
      FileInput.seekg((std::streamoff)filepos);
    }
  }

  // !Read average results in plenums
  int NumPlenumsAvg = 0;
  int PlenumID = 0;
  FileInput >> NumPlenumsAvg;
  for (int i = 0; i < NumPlenumsAvg; i++) {
    FileInput >> PlenumID;
    AvgPlenum.push_back(Plenum[PlenumID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgPlenum[i]->ReadAverageResultsDep(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgPipe[i]->ReadAverageResultsTubo(FileWAM, filepos, !Engine.empty());
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in turbocharger axis
  int NumAxisAvg = 0;
  int AxisID = 0;
  FileInput >> NumAxisAvg;
  for (int i = 0; i < NumAxisAvg; i++) {
    FileInput >> AxisID;
    AvgAxis.push_back(Axis[AxisID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgAxis[i]->ReadAverageResultsEje(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in compressors
  int NumCompressorAvg = 0;
  int CompressorID = 0;
  FileInput >> NumCompressorAvg;
  for (int i = 0; i < NumCompressorAvg; i++) {
    FileInput >> CompressorID;
    AvgCompressor.push_back(Compressor[CompressorID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgCompressor[i]->LeeDatosGraficasMedias(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in turbines
  int NumTurbineAvg = 0;
  int TurbineID = 0;
  FileInput >> NumTurbineAvg;
  for (int i = 0; i < NumTurbineAvg; i++) {
    FileInput >> TurbineID;
    AvgTurbine.push_back(Turbine[TurbineID - 1]);
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgTurbine[i]->ReadAverageResultsTurb(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgValve[i]->LeeDatosGraficasMED(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in root compressors
  int NumRootsAvg = 0;
  int RootID = 0;
  FileInput >> NumRootsAvg;

  for (int i = 0; i < NumRootsAvg; ++i) {
    FileInput >> RootID;
    AvgRoot.push_back(Root[RootID - 1]);
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgRoot[i]->ReadAverageResultsCV(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in venturis
  int NumVenturisAvg = 0;
  int VenturiID = 0;
  FileInput >> NumVenturisAvg;

  for (int i = 0; i < NumVenturisAvg; ++i) {
    FileInput >> VenturiID;
    AvgVenturi.push_back(Venturi[VenturiID - 1]);
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgVenturi[i]->ReadAverageResultsVenturi(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgConnection[i]->ReadAverageResultsUED(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in DPF
#ifdef ParticulateFilter
  int NumDPFAvg = 0;
  int DPFID = 0;
  FileInput >> NumDPFAvg;
  for (int i = 0; i < NumDPFAvg; i++) {
    FileInput >> DPFID;
    AvgDPF.push_back(DPF[DPFID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgDPF[i]->LeeResultadosMediosDPF(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }
#endif

  // !Read average results in sensors
  int NumSensorAvg = 0;
  int SensorID = 0;
  FileInput >> NumSensorAvg;
  for (int i = 0; i < NumSensorAvg; ++i) {
    FileInput >> SensorID;
    AvgSensor.push_back(Sensor[SensorID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgSensor[i]->LeeResultadosMedSensor(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read average results in controllers
  int NumControllersAvg = 0;
  int ControllerID = 0;
  FileInput >> NumControllersAvg;

  for (int i = 0; i < NumControllersAvg; ++i) {
    FileInput >> ControllerID;
    AvgController.push_back(Controller[ControllerID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    AvgController[i]->LeeResultadosMedControlador(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }
  filepos = (fpos_t)FileInput.tellg();
  FileInput.close();
}

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
                                          bool ThereIsDLL) {

  float pasafloat;

  pasafloat = (float)(AcumulatedTime);

  FAvgOutput << std::endl;
  FAvgOutput << AvgEngine->getCiclo();
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

void TOutputResults::ReadInstantaneousResults(
    const char *FileWAM, fpos_t &filepos,
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
    const char *ModelName) {

  char buffer[300];
  GetName(ModelName, buffer, "INS.DAT");
  FInsFilename = buffer;

  int err = remove(FInsFilename.c_str());

  std::ifstream FileInput(FileWAM);
  FileInput.seekg((std::streamoff)filepos);

  // ! Instantaneous results in cylinders
  int NumCylindersIns = 0;
  int CylinderID = 0;
  FileInput >> NumCylindersIns;
  for (int i = 0; i < NumCylindersIns; ++i) {
    FileInput >> CylinderID;
    InsCylinder.push_back(Engine[0]->GetCilindro(CylinderID - 1));
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsCylinder[i]->ReadInstantaneousResultsCilindro(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // ! Instantaneous results in plenums
  int NumPlenumsIns = 0;
  int PlenumID = 0;
  FileInput >> NumPlenumsIns;
  for (int i = 0; i < NumPlenumsIns; i++) {
    FileInput >> PlenumID;
    InsPlenum.push_back(Plenum[PlenumID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsPlenum[i]->ReadInstantaneousResultsDep(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsPipe[i]->ReadInstantaneousResultsTubo(FileWAM, filepos, Engine);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // ! Instantaneous results in venturis
  int NumVenturisIns = 0;
  int VenturiID = 0;
  FileInput >> NumVenturisIns;
  for (int i = 0; i < NumVenturisIns; i++) {
    FileInput >> VenturiID;
    InsVenturi.push_back(Venturi[VenturiID - 1]);
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsVenturi[i]->LeeResultadosInstantVenturi(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsValve[i]->LeeDatosGraficasINS(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // ! Instantaneous results turbochargers.
  int NumTurboIns = 0;
  int TurboID = 0;
  FileInput >> NumTurboIns;
  for (int i = 0; i < NumTurboIns; i++) {
    FileInput >> TurboID;
    InsTurbo.push_back(Turbo[TurboID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsTurbo[i]->ReadInstantaneousResultsEje(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  int NumCompressorIns = 0;
  int CompressorID = 0;
  FileInput >> NumCompressorIns;
  for (int i = 0; i < NumCompressorIns; i++) {
    FileInput >> CompressorID;
    InsCompressor.push_back(Compressor[CompressorID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsCompressor[i]->LeeDatosGraficasInstantaneas(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  int NumTurbineIns = 0;
  int TurbineID = 0;
  FileInput >> NumTurbineIns;
  for (int i = 0; i < NumTurbineIns; i++) {
    FileInput >> TurbineID;
    InsTurbine.push_back(Turbine[TurbineID - 1]);
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsTurbine[i]->LeeResultadosInstantTurb(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  int NumRootsIns = 0;
  int RootID = 0;
  FileInput >> NumRootsIns;
  for (int i = 0; i < NumRootsIns; ++i) {
    FileInput >> RootID;
    InsRoot.push_back(Root[RootID - 1]);
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsRoot[i]->LeeResultadosInstantCV(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsConnection[i]->LeeResultadosInstantUED(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
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
        filepos = (fpos_t)FileInput.tellg();
        FileInput.close();
        if (BCWasteGate[j]->getTipoCC() == nmPipeToPlenumConnection) {
          InsWasteGate.push_back(dynamic_cast<TWasteGate *>(
              dynamic_cast<TCCDeposito *>(BCWasteGate[j])->getValvula()));
        } else if (BCWasteGate[j]->getTipoCC() == nmUnionEntreDepositos) {
          InsWasteGate.push_back(dynamic_cast<TWasteGate *>(
              dynamic_cast<TCCUnionEntreDepositos *>(BCWasteGate[j])
                  ->getValvula()));
        }
        InsWasteGate[i]->LeeDatosGraficasINS(FileWAM, filepos);
        FileInput.open(FileWAM);
        FileInput.seekg((std::streamoff)filepos);
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
        filepos = (fpos_t)FileInput.tellg();
        FileInput.close();
        if (BCReedValve[j]->getTipoCC() == nmPipeToPlenumConnection) {
          InsReedValve.push_back(dynamic_cast<TLamina *>(
              dynamic_cast<TCCDeposito *>(BCReedValve[j])->getValvula()));
        } else if (BCReedValve[j]->getTipoCC() == nmUnionEntreDepositos) {
          InsReedValve.push_back(dynamic_cast<TLamina *>(
              dynamic_cast<TCCUnionEntreDepositos *>(BCReedValve[j])
                  ->getValvula()));
        }
        InsReedValve[i]->LeeDatosGraficasINS(FileWAM, filepos);
        FileInput.open(FileWAM);
        FileInput.seekg((std::streamoff)filepos);
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
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsDPF[i]->LeeResultadosInstantaneosDPF(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }
#endif

  // !Read instantaneous results in sensors
  int NumSensorIns = 0;
  int SensorID = 0;
  FileInput >> NumSensorIns;
  for (int i = 0; i < NumSensorIns; ++i) {
    FileInput >> SensorID;
    InsSensor.push_back(Sensor[SensorID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsSensor[i]->LeeResultadosInsSensor(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  // !Read instantaneous results in controllers

  int NumControllersIns = 0;
  int ControllerID = 0;
  FileInput >> NumControllersIns;

  for (int i = 0; i < NumControllersIns; ++i) {
    FileInput >> ControllerID;
    InsController.push_back(Controller[ControllerID - 1].get());
    filepos = (fpos_t)FileInput.tellg();
    FileInput.close();
    InsController[i]->LeeResultadosInsControlador(FileWAM, filepos);
    FileInput.open(FileWAM);
    FileInput.seekg((std::streamoff)filepos);
  }

  filepos = (fpos_t)FileInput.tellg();
  FileInput.close();
}

void TOutputResults::ReadSpaceTimeResults(
    const char *FileWAM, fpos_t &filepos,
    const std::vector<std::unique_ptr<TTubo>> &Pipe,
    const std::vector<std::unique_ptr<TBloqueMotor>> &Engine,
    const std::vector<std::unique_ptr<TDeposito>> &Plenum) {

  // Numero de elementos en los que se grafica
  int FNumMagnitudesEspTemp = 0;
  int NumCilEspTemp = 0;
  int NumDepEspTemp = 0;
  int NumTubEspTemp = 0;

  std::ifstream FileInput(FileWAM);
  FileInput.seekg((std::streamoff)filepos);

  FileInput >> FNumMagnitudesEspTemp;
  if (FNumMagnitudesEspTemp != 0) {
    FileInput >> NumCilEspTemp >> NumDepEspTemp >> NumTubEspTemp;

    int CylinderID = 0;
    for (int i = 0; i < NumCilEspTemp; ++i) {
      FileInput >> CylinderID;
      STCylinder.push_back(Engine[0]->GetCilindro(CylinderID - 1));
    }

    int PlenumID = 0;
    for (int i = 0; i < NumDepEspTemp; ++i) {
      FileInput >> PlenumID;
      STPlenum.push_back(Plenum[PlenumID - 1].get());
    }

    int PipeID = 0;
    for (int i = 0; i < NumTubEspTemp; ++i) {
      FileInput >> PipeID;
      STPipe.push_back(Pipe[PipeID - 1].get());
    }

    // Magnitudes que se grafican
    int ParameterID = 0;
    for (int i = 0; i < FNumMagnitudesEspTemp; ++i) {
      FileInput >> ParameterID;
      FParameterSpaceTime.push_back(ParameterID);
    }
  }

  filepos = (fpos_t)FileInput.tellg();
  FileInput.close();
}

void TOutputResults::DoSpaceTimeFiles(int SpeciesNumber) {

  if (FParameterSpaceTime.size() > 0) {
    size_t dotPos = FInsFilename.find_last_of('.');
    string baseName = (dotPos == string::npos) ? FInsFilename
                                               : FInsFilename.substr(0, dotPos);

    for (unsigned int i = 0; i < FParameterSpaceTime.size(); ++i) {
      switch (FParameterSpaceTime[i]) {
      case 0:
        salpre = baseName + "_pre.DAT";
        FileOutPressure.open(salpre.c_str());
        break;
      case 1:
        saltem = baseName + "_tem.DAT";
        FileOutTemp.open(saltem.c_str());
        break;
      case 2:
        salvel = baseName + "_vel.DAT";
        FileOutVel.open(salvel.c_str());
        break;
      case 3:
        salair = baseName + "_air.DAT";
        FileOutFlow.open(salair.c_str());
        break;
      case 4:
        if (SpeciesNumber == 3) {
          salYGasQuemado = baseName + "_YGQ.DAT";
          salYAireFresco = baseName + "_YAF.DAT";
          FOutYBurntGas.open(salYGasQuemado.c_str());
          FOutYFreshAir.open(salYAireFresco.c_str());

        } else if (SpeciesNumber == 4) {
          salYGasQuemado = baseName + "_YGQ.DAT";
          salYCombustible = baseName + "_Ycomb.DAT";
          salYAireFresco = baseName + "_YAF.DAT";
          FOutYBurntGas.open(salYGasQuemado.c_str());
          FOutYFuel.open(salYCombustible.c_str());
          FOutYFreshAir.open(salYAireFresco.c_str());

        } else if (SpeciesNumber == 9) {
          salYO2 = baseName + "_YO2.DAT";
          salYCO2 = baseName + "_YCO2.DAT";
          salYH2O = baseName + "_YH2O.DAT";
          salYHC = baseName + "_YHC.DAT";
          salYSoot = baseName + "_YSoot.DAT";
          salYNOx = baseName + "_YNOx.DAT";
          salYCO = baseName + "_YCO.DAT";
          salYN2 = baseName + "_YN2.DAT";
          FOutYO2.open(salYO2.c_str());
          FOutYCO2.open(salYCO2.c_str());
          FOutYH2O.open(salYH2O.c_str());
          FOutYHC.open(salYHC.c_str());
          FOutYSoot.open(salYSoot.c_str());
          FOutYNOx.open(salYNOx.c_str());
          FOutYCO.open(salYCO.c_str());
          FOutYN2.open(salYN2.c_str());

        } else if (SpeciesNumber == 10) {
          salYO2 = baseName + "_YO2.DAT";
          salYCO2 = baseName + "_YCO2.DAT";
          salYH2O = baseName + "_YH2O.DAT";
          salYHC = baseName + "_YHC.DAT";
          salYSoot = baseName + "_YSoot.DAT";
          salYNOx = baseName + "_YNOx.DAT";
          salYCO = baseName + "_YCO.DAT";
          salYCombustible = baseName + "_YComb.DAT";
          salYN2 = baseName + "_YN2.DAT";
          FOutYO2.open(salYO2.c_str());
          FOutYCO2.open(salYCO2.c_str());
          FOutYH2O.open(salYH2O.c_str());
          FOutYHC.open(salYHC.c_str());
          FOutYSoot.open(salYSoot.c_str());
          FOutYNOx.open(salYNOx.c_str());
          FOutYCO.open(salYCO.c_str());
          FOutYFuel.open(salYCombustible.c_str());
          FOutYN2.open(salYN2.c_str());
        }
        break;
      case 5:
        if (SpeciesNumber == 3) {
          salGastoGasQuemado = baseName + "_GastoGQ.DAT";
          salGastoAireFresco = baseName + "_GastoAF.DAT";
          FOutFlowBurntGas.open(salGastoGasQuemado.c_str());
          FOutFlowFreshAir.open(salGastoAireFresco.c_str());

        } else if (SpeciesNumber == 4) {
          salGastoGasQuemado = baseName + "_GastoGQ.DAT";
          salGastoCombustible = baseName + "_Gastocomb.DAT";
          salGastoAireFresco = baseName + "_GastoAF.DAT";
          FOutFlowBurntGas.open(salGastoGasQuemado.c_str());
          FOutFlowFuel.open(salGastoCombustible.c_str());
          FOutFlowFreshAir.open(salGastoAireFresco.c_str());

        } else if (SpeciesNumber == 9) {
          salGastoO2 = baseName + "_GastoO2.DAT";
          salGastoCO2 = baseName + "_GastoCO2.DAT";
          salGastoH2O = baseName + "_GastoH2O.DAT";
          salGastoHC = baseName + "_GastoHC.DAT";
          salGastoSoot = baseName + "_GastoSoot.DAT";
          salGastoNOx = baseName + "_GastoNOx.DAT";
          salGastoCO = baseName + "_GastoCO.DAT";
          salGastoN2 = baseName + "_GastoN2.DAT";
          FOutFlowO2.open(salGastoO2.c_str());
          FOutFlowCO2.open(salGastoCO2.c_str());
          FOutFlowH2O.open(salGastoH2O.c_str());
          FOutFlowHC.open(salGastoHC.c_str());
          FOutFlowSoot.open(salGastoSoot.c_str());
          FOutFlowNOx.open(salGastoNOx.c_str());
          FOutFlowCO.open(salGastoCO.c_str());
          FOutFlowN2.open(salGastoN2.c_str());

        } else if (SpeciesNumber == 10) {
          salGastoO2 = baseName + "_GastoO2.DAT";
          salGastoCO2 = baseName + "_GastoCO2.DAT";
          salGastoH2O = baseName + "_GastoH2O.DAT";
          salGastoHC = baseName + "_GastoHC.DAT";
          salGastoSoot = baseName + "_GastoSoot.DAT";
          salGastoNOx = baseName + "_GastoNOx.DAT";
          salGastoCO = baseName + "_GastoCO.DAT";
          salGastoCombustible = baseName + "_GastoComb.DAT";
          salGastoN2 = baseName + "_GastoN2.DAT";
          FOutFlowO2.open(salGastoO2.c_str());
          FOutFlowCO2.open(salGastoCO2.c_str());
          FOutFlowH2O.open(salGastoH2O.c_str());
          FOutFlowHC.open(salGastoHC.c_str());
          FOutFlowSoot.open(salGastoSoot.c_str());
          FOutFlowNOx.open(salGastoNOx.c_str());
          FOutFlowCO.open(salGastoCO.c_str());
          FOutFlowFuel.open(salGastoCombustible.c_str());
          FOutFlowN2.open(salGastoN2.c_str());
        }
        break;
      }
    }
  }
}

void TOutputResults::HeaderSpaceTimeResults(double thmax, double grmax,
                                            double agincr, int SpeciesNumber)

{

  for (unsigned int i = 0; i < FParameterSpaceTime.size(); ++i) {
    switch (FParameterSpaceTime[i]) {
    case 0: // PRESION
      FileOutPressure << STCylinder.size() << " " << STPlenum.size() << " "
                      << STPipe.size() << endl;
      for (unsigned int j = 0; j < STCylinder.size(); ++j) {
        FileOutPressure << STCylinder[j]->getNumeroCilindro() << " ";
      }
      FileOutPressure << endl;
      for (unsigned int j = 0; j < STPlenum.size(); ++j) {
        FileOutPressure << STPlenum[j]->getNumeroDeposito() << " ";
      }
      FileOutPressure << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutPressure << STPipe[j]->getNumeroTubo() << " ";
      }
      FileOutPressure << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutPressure << STPipe[j]->getNin() << " ";
      }
      FileOutPressure << endl << (int)((thmax - grmax) / agincr);
      break;
    case 1: // TEMPERATURA
      FileOutTemp << STCylinder.size() << " " << STPlenum.size() << " "
                  << STPipe.size() << endl;
      for (unsigned int j = 0; j < STCylinder.size(); ++j) {
        FileOutTemp << STCylinder[j]->getNumeroCilindro() << " ";
      }
      FileOutTemp << endl;
      for (unsigned int j = 0; j < STPlenum.size(); ++j) {
        FileOutTemp << STPlenum[j]->getNumeroDeposito() << " ";
      }
      FileOutTemp << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutTemp << STPipe[j]->getNumeroTubo() << " ";
      }
      FileOutTemp << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutTemp << STPipe[j]->getNin() << " ";
      }
      FileOutTemp << endl << (int)((thmax - grmax) / agincr);
      break;
    case 2: // VELOCIDAD
      FileOutVel << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
      for (unsigned int j = 0; j < STCylinder.size(); ++j) {
        FileOutVel << STCylinder[j]->getNumeroCilindro() << " ";
      }
      FileOutVel << endl;
      for (unsigned int j = 0; j < STPlenum.size(); ++j) {
        FileOutVel << STPlenum[j]->getNumeroDeposito() << " ";
      }
      FileOutVel << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutVel << STPipe[j]->getNumeroTubo() << " ";
      }
      FileOutVel << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutVel << STPipe[j]->getNin() << " ";
      }
      FileOutVel << endl << (int)((thmax - grmax) / agincr);
      break;
    case 3: // GASTO
      FileOutFlow << STCylinder.size() << " " << STPlenum.size() << " "
                  << STPipe.size() << endl;
      for (unsigned int j = 0; j < STCylinder.size(); ++j) {
        FileOutFlow << STCylinder[j]->getNumeroCilindro() << " ";
      }
      FileOutFlow << endl;
      for (unsigned int j = 0; j < STPlenum.size(); ++j) {
        FileOutFlow << STPlenum[j]->getNumeroDeposito() << " ";
      }
      FileOutFlow << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutFlow << STPipe[j]->getNumeroTubo() << " ";
      }
      FileOutFlow << endl;
      for (unsigned int j = 0; j < STPipe.size(); ++j) {
        FileOutFlow << STPipe[j]->getNin() << " ";
      }
      FileOutFlow << endl << (int)((thmax - grmax) / agincr);
      break;
    case 4: // FRACCION MASICA DE ESPECIES
      if (SpeciesNumber == 3) {
        FOutYBurntGas << STCylinder.size() << " " << STPlenum.size() << " "
                      << STPipe.size() << endl;
        FOutYFreshAir << STCylinder.size() << " " << STPlenum.size() << " "
                      << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutYBurntGas << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYFreshAir << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutYBurntGas << endl;
        FOutYFreshAir << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutYBurntGas << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYFreshAir << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutYBurntGas << endl;
        FOutYFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYBurntGas << STPipe[j]->getNumeroTubo() << " ";
          FOutYFreshAir << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutYBurntGas << endl;
        FOutYFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYBurntGas << STPipe[j]->getNin() << " ";
          FOutYFreshAir << STPipe[j]->getNin() << " ";
        }
        FOutYBurntGas << endl << (int)((thmax - grmax) / agincr);
        FOutYFreshAir << endl << (int)((thmax - grmax) / agincr);

      } else if (SpeciesNumber == 4) {
        FOutYBurntGas << STCylinder.size() << " " << STPlenum.size() << " "
                      << STPipe.size() << endl;
        FOutYFuel << STCylinder.size() << " " << STPlenum.size() << " "
                  << STPipe.size() << endl;
        FOutYFreshAir << STCylinder.size() << " " << STPlenum.size() << " "
                      << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutYBurntGas << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYFuel << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYFreshAir << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutYBurntGas << endl;
        FOutYFuel << endl;
        FOutYFreshAir << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutYBurntGas << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYFuel << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYFreshAir << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutYBurntGas << endl;
        FOutYFuel << endl;
        FOutYFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYBurntGas << STPipe[j]->getNumeroTubo() << " ";
          FOutYFuel << STPipe[j]->getNumeroTubo() << " ";
          FOutYFreshAir << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutYBurntGas << endl;
        FOutYFuel << endl;
        FOutYFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYBurntGas << STPipe[j]->getNin() << " ";
          FOutYFuel << STPipe[j]->getNin() << " ";
          FOutYFreshAir << STPipe[j]->getNin() << " ";
        }
        FOutYBurntGas << endl << (int)((thmax - grmax) / agincr);
        FOutYFuel << endl << (int)((thmax - grmax) / agincr);
        FOutYFreshAir << endl << (int)((thmax - grmax) / agincr);

      } else if (SpeciesNumber == 9) {
        FOutYO2 << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        FOutYCO2 << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
        FOutYH2O << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
        FOutYHC << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        FOutYSoot << STCylinder.size() << " " << STPlenum.size() << " "
                  << STPipe.size() << endl;
        FOutYNOx << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
        FOutYCO << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        FOutYN2 << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutYO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYCO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYH2O << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYHC << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYSoot << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYNOx << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYCO << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYN2 << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutYO2 << endl;
        FOutYCO2 << endl;
        FOutYH2O << endl;
        FOutYHC << endl;
        FOutYSoot << endl;
        FOutYNOx << endl;
        FOutYCO << endl;
        FOutYN2 << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutYO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYCO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYH2O << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYHC << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYSoot << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYNOx << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYCO << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYN2 << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutYO2 << endl;
        FOutYCO2 << endl;
        FOutYH2O << endl;
        FOutYHC << endl;
        FOutYSoot << endl;
        FOutYNOx << endl;
        FOutYCO << endl;
        FOutYN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutYCO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutYH2O << STPipe[j]->getNumeroTubo() << " ";
          FOutYHC << STPipe[j]->getNumeroTubo() << " ";
          FOutYSoot << STPipe[j]->getNumeroTubo() << " ";
          FOutYNOx << STPipe[j]->getNumeroTubo() << " ";
          FOutYCO << STPipe[j]->getNumeroTubo() << " ";
          FOutYN2 << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutYO2 << endl;
        FOutYCO2 << endl;
        FOutYH2O << endl;
        FOutYHC << endl;
        FOutYSoot << endl;
        FOutYNOx << endl;
        FOutYCO << endl;
        FOutYN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYO2 << STPipe[j]->getNin() << " ";
          FOutYCO2 << STPipe[j]->getNin() << " ";
          FOutYH2O << STPipe[j]->getNin() << " ";
          FOutYHC << STPipe[j]->getNin() << " ";
          FOutYSoot << STPipe[j]->getNin() << " ";
          FOutYNOx << STPipe[j]->getNin() << " ";
          FOutYCO << STPipe[j]->getNin() << " ";
          FOutYN2 << STPipe[j]->getNin() << " ";
        }
        FOutYO2 << endl << (int)((thmax - grmax) / agincr);
        FOutYCO2 << endl << (int)((thmax - grmax) / agincr);
        FOutYH2O << endl << (int)((thmax - grmax) / agincr);
        FOutYHC << endl << (int)((thmax - grmax) / agincr);
        FOutYSoot << endl << (int)((thmax - grmax) / agincr);
        FOutYNOx << endl << (int)((thmax - grmax) / agincr);
        FOutYCO << endl << (int)((thmax - grmax) / agincr);
        FOutYN2 << endl << (int)((thmax - grmax) / agincr);

      } else if (SpeciesNumber == 10) {
        FOutYO2 << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        FOutYCO2 << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
        FOutYH2O << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
        FOutYHC << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        FOutYSoot << STCylinder.size() << " " << STPlenum.size() << " "
                  << STPipe.size() << endl;
        FOutYNOx << STCylinder.size() << " " << STPlenum.size() << " "
                 << STPipe.size() << endl;
        FOutYCO << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        FOutYFuel << STCylinder.size() << " " << STPlenum.size() << " "
                  << STPipe.size() << endl;
        FOutYN2 << STCylinder.size() << " " << STPlenum.size() << " "
                << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutYO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYCO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYH2O << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYHC << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYSoot << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYNOx << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYCO << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYFuel << STCylinder[j]->getNumeroCilindro() << " ";
          FOutYN2 << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutYO2 << endl;
        FOutYCO2 << endl;
        FOutYH2O << endl;
        FOutYHC << endl;
        FOutYSoot << endl;
        FOutYNOx << endl;
        FOutYCO << endl;
        FOutYFuel << endl;
        FOutYN2 << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutYO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYCO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYH2O << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYHC << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYSoot << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYNOx << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYCO << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYFuel << STPlenum[j]->getNumeroDeposito() << " ";
          FOutYN2 << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutYO2 << endl;
        FOutYCO2 << endl;
        FOutYH2O << endl;
        FOutYHC << endl;
        FOutYSoot << endl;
        FOutYNOx << endl;
        FOutYCO << endl;
        FOutYFuel << endl;
        FOutYN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutYCO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutYH2O << STPipe[j]->getNumeroTubo() << " ";
          FOutYHC << STPipe[j]->getNumeroTubo() << " ";
          FOutYSoot << STPipe[j]->getNumeroTubo() << " ";
          FOutYNOx << STPipe[j]->getNumeroTubo() << " ";
          FOutYCO << STPipe[j]->getNumeroTubo() << " ";
          FOutYFuel << STPipe[j]->getNumeroTubo() << " ";
          FOutYN2 << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutYO2 << endl;
        FOutYCO2 << endl;
        FOutYH2O << endl;
        FOutYHC << endl;
        FOutYSoot << endl;
        FOutYNOx << endl;
        FOutYCO << endl;
        FOutYFuel << endl;
        FOutYN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutYO2 << STPipe[j]->getNin() << " ";
          FOutYCO2 << STPipe[j]->getNin() << " ";
          FOutYH2O << STPipe[j]->getNin() << " ";
          FOutYHC << STPipe[j]->getNin() << " ";
          FOutYSoot << STPipe[j]->getNin() << " ";
          FOutYNOx << STPipe[j]->getNin() << " ";
          FOutYCO << STPipe[j]->getNin() << " ";
          FOutYFuel << STPipe[j]->getNin() << " ";
          FOutYN2 << STPipe[j]->getNin() << " ";
        }
        FOutYO2 << endl << (int)((thmax - grmax) / agincr);
        FOutYCO2 << endl << (int)((thmax - grmax) / agincr);
        FOutYH2O << endl << (int)((thmax - grmax) / agincr);
        FOutYHC << endl << (int)((thmax - grmax) / agincr);
        FOutYSoot << endl << (int)((thmax - grmax) / agincr);
        FOutYNOx << endl << (int)((thmax - grmax) / agincr);
        FOutYCO << endl << (int)((thmax - grmax) / agincr);
        FOutYFuel << endl << (int)((thmax - grmax) / agincr);
        FOutYN2 << endl << (int)((thmax - grmax) / agincr);
      }
      break;
    case 5: // GASTO MASICO DE ESPECIES
      if (SpeciesNumber == 3) {
        FOutFlowBurntGas << STCylinder.size() << " " << STPlenum.size() << " "
                         << STPipe.size() << endl;
        FOutFlowFreshAir << STCylinder.size() << " " << STPlenum.size() << " "
                         << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutFlowBurntGas << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowFreshAir << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutFlowBurntGas << endl;
        FOutFlowFreshAir << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutFlowBurntGas << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowFreshAir << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutFlowBurntGas << endl;
        FOutFlowFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowBurntGas << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowFreshAir << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutFlowBurntGas << endl;
        FOutFlowFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowBurntGas << STPipe[j]->getNin() << " ";
          FOutFlowFreshAir << STPipe[j]->getNin() << " ";
        }
        FOutFlowBurntGas << endl << (int)((thmax - grmax) / agincr);
        FOutFlowFreshAir << endl << (int)((thmax - grmax) / agincr);

      } else if (SpeciesNumber == 4) {
        FOutFlowBurntGas << STCylinder.size() << " " << STPlenum.size() << " "
                         << STPipe.size() << endl;
        FOutFlowFuel << STCylinder.size() << " " << STPlenum.size() << " "
                     << STPipe.size() << endl;
        FOutFlowFreshAir << STCylinder.size() << " " << STPlenum.size() << " "
                         << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutFlowBurntGas << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowFuel << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowFreshAir << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutFlowBurntGas << endl;
        FOutFlowFuel << endl;
        FOutFlowFreshAir << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutFlowBurntGas << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowFuel << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowFreshAir << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutFlowBurntGas << endl;
        FOutFlowFuel << endl;
        FOutFlowFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowBurntGas << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowFuel << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowFreshAir << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutFlowBurntGas << endl;
        FOutFlowFuel << endl;
        FOutFlowFreshAir << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowBurntGas << STPipe[j]->getNin() << " ";
          FOutFlowFuel << STPipe[j]->getNin() << " ";
          FOutFlowFreshAir << STPipe[j]->getNin() << " ";
        }
        FOutFlowBurntGas << endl << (int)((thmax - grmax) / agincr);
        FOutFlowFuel << endl << (int)((thmax - grmax) / agincr);
        FOutFlowFreshAir << endl << (int)((thmax - grmax) / agincr);

      } else if (SpeciesNumber == 9) {
        FOutFlowO2 << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        FOutFlowCO2 << STCylinder.size() << " " << STPlenum.size() << " "
                    << STPipe.size() << endl;
        FOutFlowH2O << STCylinder.size() << " " << STPlenum.size() << " "
                    << STPipe.size() << endl;
        FOutFlowHC << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        FOutFlowSoot << STCylinder.size() << " " << STPlenum.size() << " "
                     << STPipe.size() << endl;
        FOutFlowNOx << STCylinder.size() << " " << STPlenum.size() << " "
                    << STPipe.size() << endl;
        FOutFlowCO << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        FOutFlowN2 << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutFlowO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowCO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowH2O << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowHC << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowSoot << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowNOx << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowCO << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowN2 << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutFlowO2 << endl;
        FOutFlowCO2 << endl;
        FOutFlowH2O << endl;
        FOutFlowHC << endl;
        FOutFlowSoot << endl;
        FOutFlowNOx << endl;
        FOutFlowCO << endl;
        FOutFlowN2 << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutFlowO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowCO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowH2O << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowHC << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowSoot << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowNOx << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowCO << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowN2 << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutFlowO2 << endl;
        FOutFlowCO2 << endl;
        FOutFlowH2O << endl;
        FOutFlowHC << endl;
        FOutFlowSoot << endl;
        FOutFlowNOx << endl;
        FOutFlowCO << endl;
        FOutFlowN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowCO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowH2O << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowHC << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowSoot << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowNOx << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowCO << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowN2 << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutFlowO2 << endl;
        FOutFlowCO2 << endl;
        FOutFlowH2O << endl;
        FOutFlowHC << endl;
        FOutFlowSoot << endl;
        FOutFlowNOx << endl;
        FOutFlowCO << endl;
        FOutFlowN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowO2 << STPipe[j]->getNin() << " ";
          FOutFlowCO2 << STPipe[j]->getNin() << " ";
          FOutFlowH2O << STPipe[j]->getNin() << " ";
          FOutFlowHC << STPipe[j]->getNin() << " ";
          FOutFlowSoot << STPipe[j]->getNin() << " ";
          FOutFlowNOx << STPipe[j]->getNin() << " ";
          FOutFlowCO << STPipe[j]->getNin() << " ";
          FOutFlowN2 << STPipe[j]->getNin() << " ";
        }
        FOutFlowO2 << endl << (int)((thmax - grmax) / agincr);
        FOutFlowCO2 << endl << (int)((thmax - grmax) / agincr);
        FOutFlowH2O << endl << (int)((thmax - grmax) / agincr);
        FOutFlowHC << endl << (int)((thmax - grmax) / agincr);
        FOutFlowSoot << endl << (int)((thmax - grmax) / agincr);
        FOutFlowNOx << endl << (int)((thmax - grmax) / agincr);
        FOutFlowCO << endl << (int)((thmax - grmax) / agincr);
        FOutFlowN2 << endl << (int)((thmax - grmax) / agincr);

      } else if (SpeciesNumber == 10) {
        FOutFlowO2 << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        FOutFlowCO2 << STCylinder.size() << " " << STPlenum.size() << " "
                    << STPipe.size() << endl;
        FOutFlowH2O << STCylinder.size() << " " << STPlenum.size() << " "
                    << STPipe.size() << endl;
        FOutFlowHC << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        FOutFlowSoot << STCylinder.size() << " " << STPlenum.size() << " "
                     << STPipe.size() << endl;
        FOutFlowNOx << STCylinder.size() << " " << STPlenum.size() << " "
                    << STPipe.size() << endl;
        FOutFlowCO << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        FOutFlowFuel << STCylinder.size() << " " << STPlenum.size() << " "
                     << STPipe.size() << endl;
        FOutFlowN2 << STCylinder.size() << " " << STPlenum.size() << " "
                   << STPipe.size() << endl;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FOutFlowO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowCO2 << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowH2O << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowHC << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowSoot << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowNOx << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowCO << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowFuel << STCylinder[j]->getNumeroCilindro() << " ";
          FOutFlowN2 << STCylinder[j]->getNumeroCilindro() << " ";
        }
        FOutFlowO2 << endl;
        FOutFlowCO2 << endl;
        FOutFlowH2O << endl;
        FOutFlowHC << endl;
        FOutFlowSoot << endl;
        FOutFlowNOx << endl;
        FOutFlowCO << endl;
        FOutFlowFuel << endl;
        FOutFlowN2 << endl;
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FOutFlowO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowCO2 << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowH2O << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowHC << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowSoot << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowNOx << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowCO << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowFuel << STPlenum[j]->getNumeroDeposito() << " ";
          FOutFlowN2 << STPlenum[j]->getNumeroDeposito() << " ";
        }
        FOutFlowO2 << endl;
        FOutFlowCO2 << endl;
        FOutFlowH2O << endl;
        FOutFlowHC << endl;
        FOutFlowSoot << endl;
        FOutFlowNOx << endl;
        FOutFlowCO << endl;
        FOutFlowFuel << endl;
        FOutFlowN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowCO2 << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowH2O << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowHC << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowSoot << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowNOx << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowCO << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowFuel << STPipe[j]->getNumeroTubo() << " ";
          FOutFlowN2 << STPipe[j]->getNumeroTubo() << " ";
        }
        FOutFlowO2 << endl;
        FOutFlowCO2 << endl;
        FOutFlowH2O << endl;
        FOutFlowHC << endl;
        FOutFlowSoot << endl;
        FOutFlowNOx << endl;
        FOutFlowCO << endl;
        FOutFlowFuel << endl;
        FOutFlowN2 << endl;
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          FOutFlowO2 << STPipe[j]->getNin() << " ";
          FOutFlowCO2 << STPipe[j]->getNin() << " ";
          FOutFlowH2O << STPipe[j]->getNin() << " ";
          FOutFlowHC << STPipe[j]->getNin() << " ";
          FOutFlowSoot << STPipe[j]->getNin() << " ";
          FOutFlowNOx << STPipe[j]->getNin() << " ";
          FOutFlowCO << STPipe[j]->getNin() << " ";
          FOutFlowFuel << STPipe[j]->getNin() << " ";
          FOutFlowN2 << STPipe[j]->getNin() << " ";
        }
        FOutFlowO2 << endl << (int)((thmax - grmax) / agincr);
        FOutFlowCO2 << endl << (int)((thmax - grmax) / agincr);
        FOutFlowH2O << endl << (int)((thmax - grmax) / agincr);
        FOutFlowHC << endl << (int)((thmax - grmax) / agincr);
        FOutFlowSoot << endl << (int)((thmax - grmax) / agincr);
        FOutFlowNOx << endl << (int)((thmax - grmax) / agincr);
        FOutFlowCO << endl << (int)((thmax - grmax) / agincr);
        FOutFlowFuel << endl << (int)((thmax - grmax) / agincr);
        FOutFlowN2 << endl << (int)((thmax - grmax) / agincr);
      }
      break;
    }
  }
}

void TOutputResults::PrintSpaceTimeResults(
    bool EngineBlock, double Theta, double SimulationDuration,
    const std::vector<std::unique_ptr<TBloqueMotor>> &Engine, int SpeciesNumber)

{

  if (FWriteSpaceTime) {
    float pasafloat = 0.;
    double m = 0., RegimenFicticio = 0.;

    if (EngineBlock) {
      m = floor(Theta / Engine[0]->getAngTotalCiclo());
      pasafloat = (float)(Theta - (m * Engine[0]->getAngTotalCiclo()));
    } else {
      RegimenFicticio = 720. / 6. / SimulationDuration;
      m = floor(Theta / 720.);
      pasafloat = (float)(Theta - (m * 720.));
      pasafloat = pasafloat / 6. / RegimenFicticio;
    }
    for (unsigned int i = 0; i < FParameterSpaceTime.size(); ++i) {
      switch (FParameterSpaceTime[i]) {
      case 0:
        FileOutPressure << "\n" << pasafloat;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FileOutPressure << " " << STCylinder[j]->getPressure();
        }
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FileOutPressure << " " << STPlenum[j]->getPressure();
        }
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          for (int k = 0; k < STPipe[j]->getNin(); ++k) {
            FileOutPressure << " " << STPipe[j]->GetPresion(k);
          }
        }
        break;
      case 1:
        FileOutTemp << "\n" << pasafloat;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FileOutTemp << " " << STCylinder[j]->getTemperature();
        }
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FileOutTemp << " " << STPlenum[j]->getTemperature();
        }
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          for (int k = 0; k < STPipe[j]->getNin(); ++k) {
            double temp = __units::KTodegC(
                pow2(STPipe[j]->GetAsonido(k) * __cons::ARef) /
                (STPipe[j]->GetGamma(k) * STPipe[j]->GetRMezcla(k)));
            FileOutTemp << " " << temp;
          }
        }
        break;
      case 2:
        FileOutVel << "\n" << pasafloat;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FileOutVel << " " << 0.0;
        }
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FileOutVel << " " << 0.0;
        }
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          for (int k = 0; k < STPipe[j]->getNin(); ++k) {
            double vel = STPipe[j]->GetVelocidad(k) * __cons::ARef;
            FileOutVel << " " << vel;
          }
        }
        break;
      case 3:
        FileOutFlow << "\n" << pasafloat;
        for (unsigned int j = 0; j < STCylinder.size(); ++j) {
          FileOutFlow << " " << 0.0;
        }
        for (unsigned int j = 0; j < STPlenum.size(); ++j) {
          FileOutFlow << " " << 0.0;
        }
        for (unsigned int j = 0; j < STPipe.size(); ++j) {
          for (int k = 0; k < STPipe[j]->getNin(); ++k) {
            if (STPipe[j]->getFormulacionLeyes() == nmConArea) {
              FileOutFlow << " " << STPipe[j]->GetU0(1, k);
            } else {
              double massflow = __units::BarToPa(STPipe[j]->GetPresion(k)) /
                                pow2(STPipe[j]->GetAsonido(k) * __cons::ARef) *
                                STPipe[j]->GetGamma(k) *
                                STPipe[j]->GetVelocidad(k) * __cons::ARef *
                                __geom::Circle_area(STPipe[j]->GetDiametro(k));
              FileOutFlow << " " << massflow;
            }
          }
        }
        break;
      case 4:
        if (SpeciesNumber == 3) {
          FOutYBurntGas << "\n" << pasafloat;
          FOutYFreshAir << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutYBurntGas << " " << STCylinder[j]->GetFraccionMasicaEspecie(0);
            FOutYFreshAir << " " << STCylinder[j]->GetFraccionMasicaEspecie(1);
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutYBurntGas << " " << STPlenum[j]->GetFraccionMasicaEspecie(0);
            FOutYFreshAir << " " << STPlenum[j]->GetFraccionMasicaEspecie(1);
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              FOutYBurntGas << " " << STPipe[j]->GetFraccionMasica(k, 0);
              FOutYFreshAir << " " << STPipe[j]->GetFraccionMasica(k, 1);
            }
          }

        } else if (SpeciesNumber == 4) {
          FOutYBurntGas << "\n" << pasafloat;
          FOutYFuel << "\n" << pasafloat;
          FOutYFreshAir << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutYBurntGas << " " << STCylinder[j]->GetFraccionMasicaEspecie(0);
            FOutYFuel << " " << STCylinder[j]->GetFraccionMasicaEspecie(1);
            FOutYFreshAir << " " << STCylinder[j]->GetFraccionMasicaEspecie(2);
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutYBurntGas << " " << STPlenum[j]->GetFraccionMasicaEspecie(0);
            FOutYFuel << " " << STPlenum[j]->GetFraccionMasicaEspecie(1);
            FOutYFreshAir << " " << STPlenum[j]->GetFraccionMasicaEspecie(2);
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              FOutYBurntGas << " " << STPipe[j]->GetFraccionMasica(k, 0);
              FOutYFuel << " " << STPipe[j]->GetFraccionMasica(k, 1);
              FOutYFreshAir << " " << STPipe[j]->GetFraccionMasica(k, 2);
            }
          }

        } else if (SpeciesNumber == 9) {
          FOutYO2 << "\n" << pasafloat;
          FOutYCO2 << "\n" << pasafloat;
          FOutYH2O << "\n" << pasafloat;
          FOutYHC << "\n" << pasafloat;
          FOutYSoot << "\n" << pasafloat;
          FOutYNOx << "\n" << pasafloat;
          FOutYCO << "\n" << pasafloat;
          FOutYN2 << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutYO2 << " " << STCylinder[j]->GetFraccionMasicaEspecie(0);
            FOutYCO2 << " " << STCylinder[j]->GetFraccionMasicaEspecie(1);
            FOutYH2O << " " << STCylinder[j]->GetFraccionMasicaEspecie(2);
            FOutYHC << " " << STCylinder[j]->GetFraccionMasicaEspecie(3);
            FOutYSoot << " " << STCylinder[j]->GetFraccionMasicaEspecie(4);
            FOutYNOx << " " << STCylinder[j]->GetFraccionMasicaEspecie(5);
            FOutYCO << " " << STCylinder[j]->GetFraccionMasicaEspecie(6);
            FOutYN2 << " " << STCylinder[j]->GetFraccionMasicaEspecie(7);
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutYO2 << " " << STPlenum[j]->GetFraccionMasicaEspecie(0);
            FOutYCO2 << " " << STPlenum[j]->GetFraccionMasicaEspecie(1);
            FOutYH2O << " " << STPlenum[j]->GetFraccionMasicaEspecie(2);
            FOutYHC << " " << STPlenum[j]->GetFraccionMasicaEspecie(3);
            FOutYSoot << " " << STPlenum[j]->GetFraccionMasicaEspecie(4);
            FOutYNOx << " " << STPlenum[j]->GetFraccionMasicaEspecie(5);
            FOutYCO << " " << STPlenum[j]->GetFraccionMasicaEspecie(6);
            FOutYN2 << " " << STPlenum[j]->GetFraccionMasicaEspecie(7);
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              FOutYO2 << " " << STPipe[j]->GetFraccionMasica(k, 0);
              FOutYCO2 << " " << STPipe[j]->GetFraccionMasica(k, 1);
              FOutYH2O << " " << STPipe[j]->GetFraccionMasica(k, 2);
              FOutYHC << " " << STPipe[j]->GetFraccionMasica(k, 3);
              FOutYSoot << " " << STPipe[j]->GetFraccionMasica(k, 4);
              FOutYNOx << " " << STPipe[j]->GetFraccionMasica(k, 5);
              FOutYCO << " " << STPipe[j]->GetFraccionMasica(k, 6);
              FOutYN2 << " " << STPipe[j]->GetFraccionMasica(k, 7);
            }
          }

        } else if (SpeciesNumber == 10) {
          FOutYO2 << "\n" << pasafloat;
          FOutYCO2 << "\n" << pasafloat;
          FOutYH2O << "\n" << pasafloat;
          FOutYHC << "\n" << pasafloat;
          FOutYSoot << "\n" << pasafloat;
          FOutYNOx << "\n" << pasafloat;
          FOutYCO << "\n" << pasafloat;
          FOutYFuel << "\n" << pasafloat;
          FOutYN2 << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutYO2 << " " << STCylinder[j]->GetFraccionMasicaEspecie(0);
            FOutYCO2 << " " << STCylinder[j]->GetFraccionMasicaEspecie(1);
            FOutYH2O << " " << STCylinder[j]->GetFraccionMasicaEspecie(2);
            FOutYHC << " " << STCylinder[j]->GetFraccionMasicaEspecie(3);
            FOutYSoot << " " << STCylinder[j]->GetFraccionMasicaEspecie(4);
            FOutYNOx << " " << STCylinder[j]->GetFraccionMasicaEspecie(5);
            FOutYCO << " " << STCylinder[j]->GetFraccionMasicaEspecie(6);
            FOutYFuel << " " << STCylinder[j]->GetFraccionMasicaEspecie(7);
            FOutYN2 << " " << STCylinder[j]->GetFraccionMasicaEspecie(8);
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutYO2 << " " << STPlenum[j]->GetFraccionMasicaEspecie(0);
            FOutYCO2 << " " << STPlenum[j]->GetFraccionMasicaEspecie(1);
            FOutYH2O << " " << STPlenum[j]->GetFraccionMasicaEspecie(2);
            FOutYHC << " " << STPlenum[j]->GetFraccionMasicaEspecie(3);
            FOutYSoot << " " << STPlenum[j]->GetFraccionMasicaEspecie(4);
            FOutYNOx << " " << STPlenum[j]->GetFraccionMasicaEspecie(5);
            FOutYCO << " " << STPlenum[j]->GetFraccionMasicaEspecie(6);
            FOutYFuel << " " << STPlenum[j]->GetFraccionMasicaEspecie(7);
            FOutYN2 << " " << STPlenum[j]->GetFraccionMasicaEspecie(8);
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              FOutYO2 << " " << STPipe[j]->GetFraccionMasica(k, 0);
              FOutYCO2 << " " << STPipe[j]->GetFraccionMasica(k, 1);
              FOutYH2O << " " << STPipe[j]->GetFraccionMasica(k, 2);
              FOutYHC << " " << STPipe[j]->GetFraccionMasica(k, 3);
              FOutYSoot << " " << STPipe[j]->GetFraccionMasica(k, 4);
              FOutYNOx << " " << STPipe[j]->GetFraccionMasica(k, 5);
              FOutYCO << " " << STPipe[j]->GetFraccionMasica(k, 6);
              FOutYFuel << " " << STPipe[j]->GetFraccionMasica(k, 7);
              FOutYN2 << " " << STPipe[j]->GetFraccionMasica(k, 8);
            }
          }
        }
        break;
      case 5:
        double massflow = 0.;
        if (SpeciesNumber == 3) {
          FOutFlowBurntGas << "\n" << pasafloat;
          FOutFlowFreshAir << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutFlowBurntGas << " " << 0.0;
            FOutFlowFreshAir << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutFlowBurntGas << " " << 0.0;
            FOutFlowFreshAir << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              if (STPipe[j]->getFormulacionLeyes() == nmConArea) {
                massflow = STPipe[j]->GetU0(1, k);
              } else {
                massflow = __units::BarToPa(STPipe[j]->GetPresion(k)) /
                           pow2(STPipe[j]->GetAsonido(k) * __cons::ARef) *
                           STPipe[j]->GetGamma(k) * STPipe[j]->GetVelocidad(k) *
                           __cons::ARef *
                           __geom::Circle_area(STPipe[j]->GetDiametro(k));
              }
              FOutFlowBurntGas << " "
                               << STPipe[j]->GetFraccionMasica(k, 0) * massflow;
              FOutFlowFreshAir << " "
                               << STPipe[j]->GetFraccionMasica(k, 1) * massflow;
            }
          }

        } else if (SpeciesNumber == 4) {
          FOutFlowBurntGas << "\n" << pasafloat;
          FOutFlowFuel << "\n" << pasafloat;
          FOutFlowFreshAir << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutFlowBurntGas << " " << 0.0;
            FOutFlowFuel << " " << 0.0;
            FOutFlowFreshAir << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutFlowBurntGas << " " << 0.0;
            FOutFlowFuel << " " << 0.0;
            FOutFlowFreshAir << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              if (STPipe[j]->getFormulacionLeyes() == nmConArea) {
                massflow = STPipe[j]->GetU0(1, k);
              } else {
                massflow = __units::BarToPa(STPipe[j]->GetPresion(k)) /
                           pow2(STPipe[j]->GetAsonido(k) * __cons::ARef) *
                           STPipe[j]->GetGamma(k) * STPipe[j]->GetVelocidad(k) *
                           __cons::ARef *
                           __geom::Circle_area(STPipe[j]->GetDiametro(k));
              }
              FOutFlowBurntGas << " "
                               << STPipe[j]->GetFraccionMasica(k, 0) * massflow;
              FOutFlowFuel << " "
                           << STPipe[j]->GetFraccionMasica(k, 1) * massflow;
              FOutFlowFreshAir << " "
                               << STPipe[j]->GetFraccionMasica(k, 2) * massflow;
            }
          }

        } else if (SpeciesNumber == 9) {
          FOutFlowO2 << "\n" << pasafloat;
          FOutFlowCO2 << "\n" << pasafloat;
          FOutFlowH2O << "\n" << pasafloat;
          FOutFlowHC << "\n" << pasafloat;
          FOutFlowSoot << "\n" << pasafloat;
          FOutFlowNOx << "\n" << pasafloat;
          FOutFlowCO << "\n" << pasafloat;
          FOutFlowN2 << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutFlowO2 << " " << 0.0;
            FOutFlowCO2 << " " << 0.0;
            FOutFlowH2O << " " << 0.0;
            FOutFlowHC << " " << 0.0;
            FOutFlowSoot << " " << 0.0;
            FOutFlowNOx << " " << 0.0;
            FOutFlowCO << " " << 0.0;
            FOutFlowN2 << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutFlowO2 << " " << 0.0;
            FOutFlowCO2 << " " << 0.0;
            FOutFlowH2O << " " << 0.0;
            FOutFlowHC << " " << 0.0;
            FOutFlowSoot << " " << 0.0;
            FOutFlowNOx << " " << 0.0;
            FOutFlowCO << " " << 0.0;
            FOutFlowN2 << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              if (STPipe[j]->getFormulacionLeyes() == nmConArea) {
                massflow = STPipe[j]->GetU0(1, k);
              } else {
                massflow = __units::BarToPa(STPipe[j]->GetPresion(k)) /
                           pow2(STPipe[j]->GetAsonido(k) * __cons::ARef) *
                           STPipe[j]->GetGamma(k) * STPipe[j]->GetVelocidad(k) *
                           __cons::ARef *
                           __geom::Circle_area(STPipe[j]->GetDiametro(k));
              }
              FOutFlowO2 << " "
                         << STPipe[j]->GetFraccionMasica(k, 0) * massflow;
              FOutFlowCO2 << " "
                          << STPipe[j]->GetFraccionMasica(k, 1) * massflow;
              FOutFlowH2O << " "
                          << STPipe[j]->GetFraccionMasica(k, 2) * massflow;
              FOutFlowHC << " "
                         << STPipe[j]->GetFraccionMasica(k, 3) * massflow;
              FOutFlowSoot << " "
                           << STPipe[j]->GetFraccionMasica(k, 4) * massflow;
              FOutFlowNOx << " "
                          << STPipe[j]->GetFraccionMasica(k, 5) * massflow;
              FOutFlowCO << " "
                         << STPipe[j]->GetFraccionMasica(k, 6) * massflow;
              FOutFlowN2 << " "
                         << STPipe[j]->GetFraccionMasica(k, 7) * massflow;
            }
          }

        } else if (SpeciesNumber == 10) {
          FOutFlowO2 << "\n" << pasafloat;
          FOutFlowCO2 << "\n" << pasafloat;
          FOutFlowH2O << "\n" << pasafloat;
          FOutFlowHC << "\n" << pasafloat;
          FOutFlowSoot << "\n" << pasafloat;
          FOutFlowNOx << "\n" << pasafloat;
          FOutFlowCO << "\n" << pasafloat;
          FOutFlowFuel << "\n" << pasafloat;
          FOutFlowN2 << "\n" << pasafloat;
          for (unsigned int j = 0; j < STCylinder.size(); ++j) {
            FOutFlowO2 << " " << 0.0;
            FOutFlowCO2 << " " << 0.0;
            FOutFlowH2O << " " << 0.0;
            FOutFlowHC << " " << 0.0;
            FOutFlowSoot << " " << 0.0;
            FOutFlowNOx << " " << 0.0;
            FOutFlowCO << " " << 0.0;
            FOutFlowFuel << " " << 0.0;
            FOutFlowN2 << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPlenum.size(); ++j) {
            FOutFlowO2 << " " << 0.0;
            FOutFlowCO2 << " " << 0.0;
            FOutFlowH2O << " " << 0.0;
            FOutFlowHC << " " << 0.0;
            FOutFlowSoot << " " << 0.0;
            FOutFlowNOx << " " << 0.0;
            FOutFlowCO << " " << 0.0;
            FOutFlowFuel << " " << 0.0;
            FOutFlowN2 << " " << 0.0;
          }
          for (unsigned int j = 0; j < STPipe.size(); ++j) {
            for (int k = 0; k < STPipe[j]->getNin(); ++k) {
              if (STPipe[j]->getFormulacionLeyes() == nmConArea) {
                massflow = STPipe[j]->GetU0(1, k);
              } else {
                massflow = __units::BarToPa(STPipe[j]->GetPresion(k)) /
                           pow2(STPipe[j]->GetAsonido(k) * __cons::ARef) *
                           STPipe[j]->GetGamma(k) * STPipe[j]->GetVelocidad(k) *
                           __cons::ARef *
                           __geom::Circle_area(STPipe[j]->GetDiametro(k));
              }
              FOutFlowO2 << " "
                         << STPipe[j]->GetFraccionMasica(k, 0) * massflow;
              FOutFlowCO2 << " "
                          << STPipe[j]->GetFraccionMasica(k, 1) * massflow;
              FOutFlowH2O << " "
                          << STPipe[j]->GetFraccionMasica(k, 2) * massflow;
              FOutFlowHC << " "
                         << STPipe[j]->GetFraccionMasica(k, 3) * massflow;
              FOutFlowSoot << " "
                           << STPipe[j]->GetFraccionMasica(k, 4) * massflow;
              FOutFlowNOx << " "
                          << STPipe[j]->GetFraccionMasica(k, 5) * massflow;
              FOutFlowCO << " "
                         << STPipe[j]->GetFraccionMasica(k, 6) * massflow;
              FOutFlowFuel << " "
                           << STPipe[j]->GetFraccionMasica(k, 7) * massflow;
              FOutFlowN2 << " "
                         << STPipe[j]->GetFraccionMasica(k, 8) * massflow;
            }
          }
        }
        break;
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
    // fclose(fg);

    // CABECERA RESULTADOS INSTANTANEOS CILINDROS.
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
  } catch (exception &N) {
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
