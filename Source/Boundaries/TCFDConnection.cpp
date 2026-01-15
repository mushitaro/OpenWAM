// ---------------------------------------------------------------------------

#pragma hdrstop

#include "TCFDConnection.h"
#include "TTubo.h"
// #include <dos.h>
#include <sys/stat.h>

// ---------------------------------------------------------------------------

TCFDConnection::TCFDConnection(nmTypeBC TipoCC, int numCC,
                               nmTipoCalculoEspecies SpeciesModel,
                               int numeroespecies,
                               nmCalculoGamma GammaCalculation, bool ThereIsEGR)
    : TCondicionContorno(TipoCC, numCC, SpeciesModel, numeroespecies,
                         GammaCalculation, ThereIsEGR) {

  FirstTime = true;
  FUpdateTime = 0;
  FExistFile = false;
  FSpecieCFD.resize(numeroespecies, 0.);
}

TCFDConnection::~TCFDConnection() {}

void TCFDConnection::ReadBoundaryData(
    std::istream &FileInput, int NumberOfPipes,
    const std::vector<std::unique_ptr<TTubo>> &Pipe, int nDPF,
    const std::vector<std::unique_ptr<TDPF>> &DPF) {

  FTuboExtremo = new stTuboExtremo[1];
  FTuboExtremo[0].Pipe = NULL;

  int i = 0;
  while (FNumeroTubosCC < 1 && i < NumberOfPipes) {
    if (Pipe[i]->getNodoIzq() == FNumeroCC) {
      FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
      FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmLeft;
      FCC = &(FTuboExtremo[FNumeroTubosCC].Beta);
      FCD = &(FTuboExtremo[FNumeroTubosCC].Landa);
      FNodoFin = 0;
      FIndiceCC = 0;
      FNumeroTubosCC++;
    }
    if (Pipe[i]->getNodoDer() == FNumeroCC) {
      FTuboExtremo[FNumeroTubosCC].Pipe = Pipe[i].get();
      FTuboExtremo[FNumeroTubosCC].TipoExtremo = nmRight;
      FCC = &(FTuboExtremo[FNumeroTubosCC].Landa);
      FCD = &(FTuboExtremo[FNumeroTubosCC].Beta);
      FNodoFin = FTuboExtremo[FNumeroTubosCC].Pipe->getNin() - 1;
      FIndiceCC = 1;
      FNumeroTubosCC++;
    }
    i++;
  }

  char *TMP;
  FileInput >> TMP;
  FCFDModel = TMP;
  FCFDout = new char[(int)strlen(FCFDModel)];
  GetName(FCFDModel, FCFDout, ".1d");
  // GetName(FCFDModel, FCFDout, ".cfd"); //< CFD
  FCFDin = new char[(int)strlen(FCFDModel)];
  GetName(FCFDModel, FCFDin, ".cfd");
  // GetName(FCFDModel, FCFDin, ".1d"); //< CFD

  // FileInput >> FCFDTiemStep;

  FFraccionMasicaEspecie = new double[FNumeroEspecies - FIntEGR];
  for (int i = 0; i < FNumeroEspecies - 1; i++) {
    FFraccionMasicaEspecie[i] =
        FTuboExtremo[0].Pipe->GetFraccionMasicaInicial(i);
  }
  if (FHayEGR) {
    FFraccionMasicaEspecie[FNumeroEspecies - 1] =
        FTuboExtremo[0].Pipe->GetFraccionMasicaInicial(FNumeroEspecies - 1);
  }
}

void TCFDConnection::CalculaCondicionContorno(double Time) {

  struct stat buf;

  FILE *fileout;
  // FILE *filein;

  double FraccionMasicaAcum = 0.;

  if (FirstTime) {
    fileout = fopen(FCFDout, "r");
    if (fileout != NULL) {
      remove(FCFDout);
    }
    FirstTime = false;
  }

  for (int j = 0; j < FNumeroEspecies - 2; j++) {
    FFraccionMasicaEspecie[j] =
        FTuboExtremo[0].Pipe->GetFraccionMasicaCC(FIndiceCC, j);
    FraccionMasicaAcum += FFraccionMasicaEspecie[j];
  }
  FFraccionMasicaEspecie[FNumeroEspecies - 2] = 1. - FraccionMasicaAcum;
  if (FHayEGR)
    FFraccionMasicaEspecie[FNumeroEspecies - 1] =
        FTuboExtremo[0].Pipe->GetFraccionMasicaCC(FIndiceCC,
                                                  FNumeroEspecies - 1);

  fileout = fopen(FCFDout, "a");

  fprintf(fileout, "%.16f %g %g", Time, *FCC * __cons::ARef,
          FTuboExtremo[0].Entropia * __cons::ARef);
  for (int j = 0; j < FNumeroEspecies - 1; j++) {
    fprintf(fileout, " %g", FFraccionMasicaEspecie[j]);
  }
  if (FHayEGR)
    fprintf(fileout, " %g", FFraccionMasicaEspecie[FNumeroEspecies - 1]);
  fprintf(fileout, "\n");
  if (!FExistFile) {
    std::ifstream FileInput(FCFDin);

    while (!FileInput.is_open()) {
      std::cout << "INFO: Waiting for the file creation" << std::endl;
      // 			sleep(30);
      FileInput.open(FCFDin);
    }
    FileInput.close();
    FExistFile = true;
  }

  // stat(FCFDin, &buf);
  //
  // while (difftime(buf.st_mtime, FUpdateTime) == 0) {
  // sleep(30);
  // stat(FCFDin, &buf);
  // }

  double t0 = 0.;
  double t1 = 0.;
  double b0 = *FCC;
  double b1 = *FCC;
  double AA0 = FTuboExtremo[0].Entropia;
  double AA1 = FTuboExtremo[0].Entropia;

  while (t1 < Time - 1e-16) {
    while (t1 < Time - 1e-16) {
      std::ifstream FileInput(FCFDin);

      while (!FileInput.eof()) {
        t0 = t1;
        b0 = b1;
        AA0 = AA1;
        FileInput >> t1 >> b1 >> AA1;
        for (int j = 0; j < FNumeroEspecies - 1; j++) {
          FileInput >> FSpecieCFD[j];
        }
        if (FHayEGR)
          FileInput >> FSpecieCFD[FNumeroEspecies - 1];
        // fscanf(filein, "\n"); // Removed undefined C-style I/O
        // FileInput handles newlines automatically usually.
      }
      FileInput.close();

      if (t1 < Time - 1e-16) {
        stat(FCFDin, &buf);

        while (difftime(buf.st_mtime, FUpdateTime) == 0) {
          std::cout << "INFO: Waiting for an update" << std::endl;
          // 				sleep(3);
          stat(FCFDin, &buf);
        }
        FUpdateTime = buf.st_mtime;
      }
    }

    double TimeStep = t1 - t0;
    double DeltaTime = Time - t0;

    double Beta = Interpola(b0, b1, TimeStep, DeltaTime);
    double AA = Interpola(AA0, AA1, TimeStep, DeltaTime);

    double flow = (Beta / AA) / (*FCC / FTuboExtremo[0].Entropia);

    // ! Flow from de pipe to the cfd model
    if (flow < 0.99999) {
      *FCD = Beta / __cons::ARef;
    } else if (flow > 1.00001) {
      *FCD = Beta / __cons::ARef;
      *FCC = *FCC * AA / __cons::ARef / FTuboExtremo[0].Entropia;
      FTuboExtremo[0].Entropia = AA / __cons::ARef;
    } else {
      *FCD = *FCC;
    }
  }
}

#pragma package(smart_init)
