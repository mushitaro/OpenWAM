/* --------------------------------------------------------------------------------*\
|==========================|
 |\\   /\ /\   // O pen     | OpenWAM: The Open Source 1D Gas-Dynamic Code
 | \\ |  X  | //  W ave     |
 |  \\ \/_\/ //   A ction   | CMT-Motores Termicos / Universidad Politecnica
Valencia |   \\/   \//    M odel    |
 |----------------------------------------------------------------------------------
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

#include "TTable1D.h"

// ---------------------------------------------------------------------------

TTable1D::TTable1D(int i) : TController(nmCtlTable, i) {
  fID = i + 1;
  /* fError_ant=0;
   fTime_ant=0;
   fInicio=true; */

  fDimensiones = 1;
  fDatos = NULL;
}

TTable1D::~TTable1D() { delete fDatos; }

double TTable1D::Output(double Time) {

  double X = FSensor[0]->Output();

  fOutput = fDatos->interp(X);

  AcumulaResultadosMediosController(Time);

  return fOutput;
}

void TTable1D::LeeController(std::istream &FileInput) {

  int xnum = 0, tip = 0, fromfile = 0;
  FileInput >> fromfile;

  if (fromfile == 1) {
    std::string InputFile;
    FileInput >> InputFile;
    std::ifstream MapFile(InputFile.c_str());
    if (!MapFile.is_open()) {
      throw std::runtime_error("Could not open table map file: " + InputFile);
    }
    double X_tmp = 0., Y_tmp = 0.;
    dVector X_vec, Y_vec;
    while (MapFile >> X_tmp >> Y_tmp) {
      X_vec.push_back(X_tmp);
      Y_vec.push_back(Y_tmp);
    }
    fX_map = X_vec;
    fY_map = Y_vec;
  } else if (fromfile == 0) {
    // FileInput >> fDimensiones;
    FileInput >> xnum;
    fX_map.resize(xnum);
    fY_map.resize(xnum);
    for (int i = 0; i < xnum; i++) {
      FileInput >> fX_map[i] >> fY_map[i];
    }
  } else {
  }

  FileInput >> fPeriod;

  FileInput >> tip;
  switch (tip) {
  case 0:
    fTipo = nmLineal;
    fDatos = new Linear_interp(fX_map, fY_map);
    break;
  case 1:
    fTipo = nmHermite;
    fDatos = new Hermite_interp(fX_map, fY_map);
    break;
  case 2:
    fTipo = nmSteps;
    fDatos = new Step_interp(fX_map, fY_map);
    break;
  }

  FSensorID.resize(1);
  FileInput >> FSensorID[0];
}

void TTable1D::AsignaObjetos(TSensor **Sensor, TController **Controller) {

  FSensor.push_back(Sensor[FSensorID[0] - 1]);

  // fSetPointController=Controller[fSetPointControllerID-1];
}

void TTable1D::LeeResultadosMedControlador(std::istream &FileInput) {
  try {
    int nvars = 0, var = 0;
    FileInput >> nvars;
    for (int i = 0; i < nvars; i++) {
      FileInput >> var;
      switch (var) {
      case 0:
        FResMediosCtrl.Output = true;
        break;
      default:
        std::cout << "Resultados medios en Controlador " << fID
                  << " no implementados " << std::endl;
      }
    }
  } catch (std::exception &N) {
    std::cout << "ERROR: TTable::LeeResultadosControlador en el controlador "
              << fID << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::LeeResultadosInsControlador(std::istream &FileInput) {
  try {
    int nvars = 0, var = 0;
    FileInput >> nvars;
    for (int i = 0; i < nvars; i++) {
      FileInput >> var;
      switch (var) {
      case 0:
        FResInstantCtrl.Output = true;
        break;
      default:
        std::cout << "Resultados instantaneos en Controlador " << fID
                  << " no implementados " << std::endl;
      }
    }
  } catch (std::exception &N) {
    std::cout << "ERROR: TTable::LeeResultadosInsControlador en el controlador "
              << fID << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::CabeceraResultadosMedControlador(std::ostream &medoutput) {
  try {
    std::string Label;

    if (FResMediosCtrl.Output) {
      Label = "\t" + PutLabel(705) + std::to_string(fID) + PutLabel(901);
      medoutput << Label.c_str();
    }

  } catch (std::exception &N) {
    std::cout
        << "ERROR: TTable::CabeceraResultadosMedControlador en el controlador "
        << fID << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::CabeceraResultadosInsControlador(std::ostream &insoutput) {
  try {
    std::string Label;

    if (FResInstantCtrl.Output) {
      Label = "\t" + PutLabel(705) + std::to_string(fID) + PutLabel(901);
      insoutput << Label.c_str();
    }

  } catch (std::exception &N) {
    std::cout
        << "ERROR: TTable::CabeceraResultadosInsControlador en el controlador "
        << fID << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::ImprimeResultadosMedControlador(std::ostream &medoutput) {
  try {
    std::string Label;

    if (FResMediosCtrl.Output) {
      medoutput << "\t" << FResMediosCtrl.OutputMED;
    }

  } catch (std::exception &N) {
    std::cout
        << "ERROR: TTable::ImprimeResultadosMedControlador en el controlador "
        << fID << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::ImprimeResultadosInsControlador(std::ostream &insoutput) {
  try {
    std::string Label;

    if (FResInstantCtrl.Output) {
      insoutput << "\t" << FResInstantCtrl.OutputINS;
    }

  } catch (std::exception &N) {
    std::cout
        << "ERROR: TTable::CabeceraResultadosInsControlador en el controlador "
        << fID << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::IniciaMedias() {
  try {

    FResMediosCtrl.OutputSUM = 0.;
    FResMediosCtrl.TiempoSUM = 0.;
    FResMediosCtrl.Tiempo0 = 0.;

  } catch (std::exception &N) {
    std::cout << "ERROR: TTable::IniciaMedias en el controlador: " << fID
              << std::endl;
    // std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::ResultadosMediosController() {
  try {

    if (FResMediosCtrl.Output && FResMediosCtrl.TiempoSUM > 0) {
      FResMediosCtrl.OutputMED =
          FResMediosCtrl.OutputSUM / FResMediosCtrl.TiempoSUM;
      FResMediosCtrl.OutputSUM = 0.;
    } else {
      FResMediosCtrl.OutputMED = 0.;
    }

    FResMediosCtrl.TiempoSUM = 0;

  } catch (std::exception &N) {
    std::cout << "ERROR: TTable::ResultadosMediosController en el eje: " << fID
              << std::endl;
    // std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::AcumulaResultadosMediosController(double Actual) {
  try {
    /* Lo que se hace en esta funcion se realiza dentro del calculo del eje,
     para asi poder llevar a cabo la salida de resultados medios por pantalla.
   */
    double Delta = Actual - FResMediosCtrl.Tiempo0;

    if (FResMediosCtrl.Output) {
      FResMediosCtrl.OutputSUM += fOutput * Delta;
    }

    FResMediosCtrl.TiempoSUM += Delta;
    FResMediosCtrl.Tiempo0 = Actual;

  } catch (std::exception &N) {
    std::cout << "ERROR: TTable::AcumulaResultadosMediosController en el eje: "
              << fID << std::endl;
    // std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

void TTable1D::ResultadosInstantController() {
  try {
    if (FResInstantCtrl.Output)
      FResInstantCtrl.OutputINS = fOutput;

  } catch (std::exception &N) {
    std::cout << "ERROR: TTable::ResultadosInstantController en el eje " << fID
              << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

#pragma package(smart_init)
