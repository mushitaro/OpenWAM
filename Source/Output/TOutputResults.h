// ---------------------------------------------------------------------------

#ifndef TOutputResultsH
#define TOutputResultsH

#include "Globales.h"
#include <sstream>

#include "TTubo.h"
#include "TBloqueMotor.h"
#include "TDeposito.h"
#include "TEjeTurbogrupo.h"
#include "TCompresor.h"
#include "TTurbina.h"
#include "TTipoValvula.h"
#include "TCCCilindro.h"
#include "TCCDeposito.h"
#include "TCCUnionEntreDepositos.h"
#include "TCCCompresorVolumetrico.h"
#include "TVenturi.h"
#include "TSensor.h"
#include "TController.h"
#include "TCalculoExtern.h"
#include "TWasteGate.h"
#include "TLamina.h"
#include "TDPF.h"

// ---------------------------------------------------------------------------

enum nmTypeOfResults {
	nmLastCyle = 0, nmAllCyclesIndependent = 1, nmAllCyclesConcatenated = 2, nmEveryNCycles = 3
};

class TOutputResults {
  private:
	nmTypeOfResults FTypeOfInsResults;

	int FCyclePeriod;

	double FInsPeriod;

	bool FPlotThisCycle;
	bool FMultipleFiles;
	bool FPlotIns;

	bool FFirstTime;

	bool InsHeaderCreated;
	bool WriteInsHeader;

	bool FWriteSpaceTime;

	double FControlAngle0;
	double FControlAngle1;

	vector<TTubo*> AvgPipe;
	vector<TCilindro*> AvgCylinder;
	TBloqueMotor* AvgEngine;
	vector<TDeposito*> AvgPlenum;
	vector<TEjeTurbogrupo*> AvgAxis;
	vector<TCompresor*> AvgCompressor;
	vector<TTurbina*> AvgTurbine;
	vector<TTipoValvula*> AvgValve;
	iVector AvgValveNode;
	vector<TCCCompresorVolumetrico*> AvgRoot;
	vector<TVenturi*> AvgVenturi;
	vector<TCCUnionEntreDepositos*> AvgConnection;
	vector<TSensor*> AvgSensor;
	vector<TController*> AvgController;
	vector<TDPF*> AvgDPF;

	stringstream FAvgOutput;
	fstream FFileAvg;
	string FAvgFilename;

	vector<TCilindro*> InsCylinder;
	vector<TDeposito*> InsPlenum;
	vector<TTubo*> InsPipe;
	vector<TVenturi*> InsVenturi;
	vector<TTipoValvula*> InsValve;
	iVector InsValveNode;
	vector<TEjeTurbogrupo*> InsTurbo;
	vector<TCompresor*> InsCompressor;
	vector<TTurbina*> InsTurbine;
	vector<TCCCompresorVolumetrico*> InsRoot;
	vector<TCCUnionEntreDepositos*> InsConnection;
	vector<TWasteGate*> InsWasteGate;
	vector<TLamina*> InsReedValve;
	vector<TSensor*> InsSensor;
	vector<TController*> InsController;
	vector<TDPF*> InsDPF;

	stringstream FInsOutput;
	fstream FFileIns;
	string FInsFilename;

	char FFileCountC[10];
	int FFileCountI;
	int FCharacters;

	vector<TTubo*> STPipe;
	vector<TDeposito*> STPlenum;
	vector<TCilindro*> STCylinder;

	iVector FParameterSpaceTime;

	ofstream FileOutPressure; // !< Pointers to files for space time results.
	ofstream FileOutTemp; // !< Pointers to files for space time results.
	ofstream FileOutVel; // !< Pointers to files for space time results.
	ofstream FileOutFlow; // !< Pointers to files for space time results.
	ofstream FOutYO2; // !< Pointers to files for space time results.
	ofstream FOutYN2; // !< Pointers to files for space time results.
	ofstream FOutYCO2; // !< Pointers to files for space time results.
	ofstream FOutYH2O; // !< Pointers to files for space time results.
	ofstream FOutYCO; // !< Pointers to files for space time results.
	ofstream FOutYNOx; // !< Pointers to files for space time results.
	ofstream FOutYSoot; // !< Pointers to files for space time results.
	ofstream FOutYHC; // !< Pointers to files for space time results.
	ofstream FOutYFuel; // !< Pointers to files for space time results.
	ofstream FOutYFreshAir; // !< Pointers to files for space time results.
	ofstream FOutYBurntGas; // !< Pointers to files for space time results.
	ofstream FOutFlowO2; // !< Pointers to files for space time results.
	ofstream FOutFlowN2; // !< Pointers to files for space time results.
	ofstream FOutFlowCO2; // !< Pointers to files for space time results.
	ofstream FOutFlowH2O; // !< Pointers to files for space time results.
	ofstream FOutFlowCO; // !< Pointers to files for space time results.
	ofstream FOutFlowNOx; // !< Pointers to files for space time results.
	ofstream FOutFlowSoot; // !< Pointers to files for space time results.
	ofstream FOutFlowHC; // !< Pointers to files for space time results.
	ofstream FOutFlowFuel; // !< Pointers to files for space time results.
	ofstream FOutFlowFreshAir; // !< Pointers to files for space time results.
	ofstream FOutFlowBurntGas; // !< Pointers to files for space time results.

	string salpre;
	string saltem;
	string salvel;
	string salair;
	string salYO2;
	string salYN2;
	string salYCO2;
	string salYH2O;
	string salYCO;
	string salYNOx;
	string salYSoot;
	string salYHC;
	string salYCombustible;
	string salYAireFresco;
	string salYGasQuemado;
	string salGastoO2;
	string salGastoN2;
	string salGastoCO2;
	string salGastoH2O;
	string salGastoCO;
	string salGastoNOx;
	string salGastoSoot;
	string salGastoHC;
	string salGastoCombustible;
	string salGastoAireFresco;
	string salGastoGasQuemado;

	void ConvertCharacter(int confile, char confile1[], int Characters);

  public:
	TOutputResults();

	~TOutputResults();

	double GetFControlAngle1() {
		return FControlAngle1;
	}
	;

	void ReadAverageResults(const char* FileWAM, fpos_t& filepos, TTubo** Pipe, bool EngineBlock, TBloqueMotor** Engine,
							TDeposito **Plenum, TEjeTurbogrupo** Axis, TCompresor** Compressor, TTurbina** Turbine, TCondicionContorno** BC,
							TDPF** DPF, TCCCompresorVolumetrico** Root, TVenturi** Venturi, TSensor** Sensor, TController** Controller,
							int TotalCycles, char* ModelName);

	void HeaderAverageResults(stEspecies *SpeciesName, TCalculoExtern* EXTERN, bool ThereIsDLL);

	void OutputAverageResults(double AcumulatedTime, TCalculoExtern* EXTERN, bool ThereIsDLL);

	void CopyAverageResultsToFile(int mode);

	void CopyInstananeousResultsToFile(int mode);

	void ReadInstantaneousResults(const char* FileWAM, fpos_t &filepos, TBloqueMotor** Engine, TDeposito** Plenum,
								  TTubo** Pipe, TVenturi** Venturi, TCondicionContorno** BC, TDPF** DPF, TEjeTurbogrupo** Turbo, TCompresor** Compressor,
								  TTurbina** Turbine, TCCCompresorVolumetrico** Root, TCondicionContorno** BCWasteGate, int NumberOfWasteGates,
								  TCondicionContorno** BCReedValve, int NumberOfReedValves, TSensor** Sensor, TController** Controller, char* ModelName);

	void ReadSpaceTimeResults(const char* FileWAM, fpos_t &filepos, TTubo** Pipe, TBloqueMotor** Engine,
							  TDeposito **Plenum);

	void DoSpaceTimeFiles(int SpeciesNumber);

	void HeaderSpaceTimeResults(double thmax, double grmax, double agincr, int SpeciesNumber);

	void PrintSpaceTimeResults(bool EngineBlock, double Theta, double SimulationDuration, TBloqueMotor **Engine,
							   int SpeciesNumber);

	void HeaderInstantaneousResults(TCalculoExtern *EXTERN, bool ThereIsDLL, bool EngineBlock, stEspecies *SpeciesName);

	void PlotThisCycle(TBloqueMotor* Engine, int TotalCycles);

	void OutputInstantaneousResults(TCalculoExtern *EXTERN, bool ThereIsDLL, bool EngineBlock, double Theta,
									TBloqueMotor* Engine, double Time);

	void PlotControl(double Theta0, double Theta, double CycleDuration);

	void WriteInstantaneous(bool EngineBlock, double Angle, double AngStep, TBloqueMotor* Engine, int TotalCycles);

	void WriteSpaceTime(bool EngineBlock, TBloqueMotor* Engine, int TotalCycles);

	void PutInsPeriod(double agincr) {
		FInsPeriod = agincr;
	}
	;

};
#endif
