/*--------------------------------------------------------------------------------*\
 *==========================|
 *\\   /\ /\   // O pen     | OpenWAM: The Open Source 1D Gas-Dynamic Code
 * \\ |  X  | //  W ave     |
 *  \\ \/_\/ //   A ction   | CMT-Motores Termicos / Universidad Politecnica
 Valencia
 *   \\/   \//    M odel    |
 *----------------------------------------------------------------------------------
 *License
 *
 * This file is part of OpenWAM.
 *
 * OpenWAM is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * OpenWAM is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with OpenWAM.  If not, see <http://www.gnu.org/licenses/>.
 *
 * TGain.h
 *
 * Created on: 14/07/2014
 *     Author: farnau
 *
 \*--------------------------------------------------------------------------------*/

#ifndef TGAIN_H_
#define TGAIN_H_

#include "TController.h"
#include "TSensor.h"

/*
 *
 */

class TGain : public TController {

  int fID; //!< ID controller number
  double FGain;
  stGainInput *FGainInput;
  nmInputObjet FInObject;
  int FObjectID;
  double fOutput;

public:
  TGain(int i);

  ~TGain();

  double Output(double Time);

  void LeeController(std::istream &FileInput);

  void AsignaObjetos(TSensor **Sensor, TController **Controller);

  /*! Read the average results selected*/
  void LeeResultadosMedControlador(
      std::istream &FileInput //!< Position within the input file
  );

  /*! Read the instantaneous results selected*/
  void LeeResultadosInsControlador(
      std::istream &FileInput //!< Position within the input file
  );

  /*! Generate average results header */
  void CabeceraResultadosMedControlador(
      std::ostream
          &medoutput //!< StringStrems where the average results are stored
  );

  /*! Generate instantaneous results header */
  void CabeceraResultadosInsControlador(
      std::ostream &
          insoutput //!< StringStream where the instantaneous results are stored
  );

  /*! Print average results */
  void ImprimeResultadosMedControlador(
      std::ostream
          &medoutput //!< StringStream where the average results are stored
  );

  /*! Print instantaneous results */
  void ImprimeResultadosInsControlador(
      std::ostream &
          insoutput //!< StringStream where the instantaneous results are stored
  );

  /*! Initialize average results */
  void IniciaMedias();

  /*! Calculate average results */
  void ResultadosMediosController();

  /*! Acumulate average results */
  void AcumulaResultadosMediosController(double Actual //!< Current time
  );

  /*! Calculate instanteneous results */
  void ResultadosInstantController();
};

#endif /* TGAIN_H_ */
