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

#include "TControlK.h"

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

TControlK::TControlK() {}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

TControlK::~TControlK() {}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

void TControlK::LeeDatosEntrada(const std::string &Ruta,
                                std::istream &FileInput, double DiametroTubo) {
  std::string FileK_Re;

  try {
    FDiametro = DiametroTubo;
    FileInput >> FileK_Re;
    std::string FullPath = Ruta + FileK_Re;

    std::ifstream KStream(FullPath.c_str());
    if (!KStream.is_open()) {
      std::cout << "ERROR: Fichero de K vs Re no cargado: " << FullPath
                << std::endl;
    } else {
      KStream >> FNumeroDatos;
      FVector_Re = new double[FNumeroDatos];
      FVector_K = new double[FNumeroDatos];

      for (int i = 0; i < FNumeroDatos; i++) {
        KStream >> FVector_Re[i];
      }

      for (int i = 0; i < FNumeroDatos; i++) {
        KStream >> FVector_K[i];
      }
    }

  } catch (std::exception &N) {
    std::cout << "ERROR: TControlK::LeeDatosEntrada (DLL)" << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

void TControlK::CalculaK(double velocidad, double temperatura, double presion,
                         double R_mezcla) {
  try {
    double viscgas = 0., rho = 0., deltaRe = 0., VariacionRe = 0.,
           K_Actual = 0.;
    int i = 0;

    viscgas = 1.4615e-6 * pow150(__units::degCToK(temperatura)) /
              (__units::degCToK(temperatura) + 110.4);
    rho = __units::BarToPa(presion) / __units::degCToK(temperatura) / R_mezcla;
    FRe = rho * velocidad * FDiametro / viscgas;

    FK = Interp1(FRe, FVector_Re, FVector_K, FNumeroDatos);

  } catch (std::exception &N) {
    std::cout << "ERROR: TControlK::CalculaK (DLL)" << std::endl;
    std::cout << "Tipo de error: " << N.what() << std::endl;
    throw Exception(N.what());
  }
}

//---------------------------------------------------------------------------
//---------------------------------------------------------------------------

#pragma package(smart_init)
