/*--------------------------------------------------------------------------------*\
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


 \*--------------------------------------------------------------------------------*/

//---------------------------------------------------------------------------
#pragma hdrstop

#include "TRegimenMotor.h"
//---------------------------------------------------------------------------
//---------------------------------------------------------------------------
TRegimenMotor::TRegimenMotor() {}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

TRegimenMotor::~TRegimenMotor() {
  if (FTiempo != NULL)
    delete[] FTiempo;

  if (FRegimen != NULL)
    delete[] FRegimen;
}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

void TRegimenMotor::LeeDatosEntrada(const std::string &Ruta,
                                    std::istream &FileInput) {
  std::string FileRegimen;

  try {
    FileInput >> FileRegimen;
    std::string FullPath = Ruta + FileRegimen;

    std::ifstream FichRegimen(FullPath.c_str());
    if (!FichRegimen.is_open()) {
      std::cout << "ERROR: Fichero de regimen de giro no cargado: " << FullPath
                << std::endl;
    } else {
      FNumeroDatos = 0;
      double temp1 = 0.;
      double temp2 = 0.;
      // Count lines using a dummy read loop or safer logic
      // Using std::vector would be better, but sticking to array for now.
      // Pre-read to count
      std::string line;
      while (std::getline(FichRegimen, line)) {
        if (!line.empty())
          FNumeroDatos++;
      }
      // Reset stream
      FichRegimen.clear();
      FichRegimen.seekg(0, std::ios::beg);

      FTiempo = new double[FNumeroDatos];
      FRegimen = new double[FNumeroDatos];
      int i = 0;
      while (i < FNumeroDatos && FichRegimen >> FTiempo[i] >> FRegimen[i]) {
        i++;
      }
    }
  } catch (std::exception &N) {
    std::cout << "ERROR: LeeDatosEntrada de RegimenMotor (DLL)" << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

void TRegimenMotor::CalculaRegimen(double TiempoActual) {
  try {
    // AQUI SE CALCULAN LOS COEFICIENTES DE DESCARGA Y TURBULENCIA

    int j = 0, jmax = FNumeroDatos - 1;
    double RegimenAct = 0., deltaT = 0., t = 0.;
    while (TiempoActual > FTiempo[j] && j < jmax) {
      j++;
    }
    if (j == jmax) {
      RegimenAct = FRegimen[jmax];
    } else {
      deltaT = FTiempo[j] - FTiempo[j - 1];
      t = TiempoActual - FTiempo[j - 1];
      RegimenAct = xit_(FRegimen[j - 1], FRegimen[j], deltaT, t);
    }

    FRegimenMotor = RegimenAct;

  } catch (std::exception &N) {
    std::cout << "ERROR: Calculo del Regimen del Engine(DLL)" << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

//---------------------------------------------------------------------------

double TRegimenMotor::xit_(double vizq, double vder, double axid, double xif) {
  try {
    double xx = 0., yy = 0.;
    double ret_val = 0.;

    xx = vder - vizq;
    if (axid != 0.) {
      yy = xx / axid * xif;
      ret_val = vizq + yy;
    } else {
      printf("ERROR: valores entrada xit\n");
      throw Exception("");
    }
    return ret_val;
  } catch (std::exception &N) {
    std::cout << "ERROR: xit_" << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

//---------------------------------------------------------------------------

#pragma package(smart_init)
