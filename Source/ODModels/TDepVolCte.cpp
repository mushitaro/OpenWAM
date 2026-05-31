/* --------------------------------------------------------------------------------*\
|==========================|
 |\\   /\ /\   // O pen     | OpenWAM: The Open Source 1D Gas-Dynamic Code
 | \\ |  X  | //  W ave     |
 |  \\ \/_\/ //   A ction   | CMT-Motores Termicos / Universidad Politecnica Valencia
 |   \\/   \//    M odel    |
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


 \*-------------------------------------------------------------------------------- */

// ---------------------------------------------------------------------------
#pragma hdrstop

#include "TDepVolCte.h"

#include <atomic>
#include "TCCDeposito.h"
#include "TCCUnionEntreDepositos.h"
#include "TTubo.h"
#include "TCompresor.h"
#include "TDPF.h"
#include "TCanalDPF.h"

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TDepVolCte::TDepVolCte(int i, nmTipoCalculoEspecies SpeciesModel, int numeroespecies, nmCalculoGamma GammaCalculation,
					   bool ThereIsEGR) :
	TDepVolCteBase(i, nmDepVolCte, SpeciesModel, numeroespecies, GammaCalculation, ThereIsEGR) {
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

TDepVolCte::~TDepVolCte() {

}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

void TDepVolCte::ActualizaPropiedades(double TimeCalculo) {

	double H = 0.; // Entalpia de entrada
	double Energia = 0.;
	double MasaEntrante, FraccionMasicaAcum = 0.;
	double DeltaT = 0.;
	double g = 0., v = 0., a = 0., m = 0., g1 = 0.;
	int SignoFlujo = 1; // Inicializado por si el flujo esta parado.
	int SignoFlujoED = 1; // Inicializado por si el flujo esta parado.

	try {
		FMasa0 = FMasa;
		MasaEntrante = 0.;
		H = 0.;
		DeltaT = TimeCalculo - FTime;

		if(FCalculoEspecies == nmCalculoCompleto) {

			FRMezcla = CalculoCompletoRMezcla(FFraccionMasicaEspecie[0], FFraccionMasicaEspecie[1], FFraccionMasicaEspecie[2], 0,
											  FCalculoGamma, nmMEP);
			FCpMezcla = CalculoCompletoCpMezcla(FFraccionMasicaEspecie[0], FFraccionMasicaEspecie[1], FFraccionMasicaEspecie[2], 0,
												__units::degCToK(FTemperature), FCalculoGamma, nmMEP);
			FGamma = CalculoCompletoGamma(FRMezcla, FCpMezcla, FCalculoGamma);

		} else if(FCalculoEspecies == nmCalculoSimple) {

			FRMezcla = CalculoSimpleRMezcla(FFraccionMasicaEspecie[0], FFraccionMasicaEspecie[1], FCalculoGamma, nmMEP);
			FCvMezcla = CalculoSimpleCvMezcla(__units::degCToK(FTemperature), FFraccionMasicaEspecie[0], FFraccionMasicaEspecie[1],
											  FCalculoGamma, nmMEP);
			FGamma = CalculoSimpleGamma(FRMezcla, FCvMezcla, FCalculoGamma);

		}

		bool Converge = false;
		bool FirstStep = true;
		double H0 = 0.;
		double Asonido0 = FAsonido;
		double Asonido1 = FAsonido;
		double Error = 0.;
		double Diff = 0.;
		double Heat = 0.;
		double MTemp = FGamma / (pow2(FAsonido * __cons::ARef) * FMasa0);

		// The fixed-point iteration on the plenum sound speed below has no
		// intrinsic cap. A small plenum hit by a violent transient (e.g. an
		// exhaust port-merge plenum during cylinder blowdown) can make the
		// enthalpy flux H large enough that the iteration oscillates and never
		// reaches the 1e-6 tolerance, so the whole simulation hangs in this loop
		// (confirmed by gdb: 100 % wall time in TDepVolCte::ActualizaPropiedades
		// with the step counter frozen). Cap the iterations; past the cap, switch
		// to damped (under-relaxed) updates so an oscillating sequence is forced
		// to settle, and accept the result at a looser tolerance. A normal step
		// converges in well under 20 iterations, so this never triggers in
		// healthy operation.
		int iter = 0;
		const int kMaxIter = 200;
		const int kRelaxAfter = 50;

		while(!Converge) {
			H = 0.;
			for(int i = 0; i < FNumeroUniones; i++) {
				if(FCCDeposito[i]->getTipoCC() == nmPipeToPlenumConnection) {
					if(dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getSentidoFlujo() == nmEntrante) {
						SignoFlujo = 1;
					} else if(dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getSentidoFlujo() == nmSaliente) {
						SignoFlujo = -1;
					}
					g = (double) - dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getMassflow();
					if(!FCCDeposito[i]->getUnionDPF()) {
						m = g * DeltaT * FCCDeposito[i]->GetTuboExtremo(0).Pipe->getNumeroConductos();
					} else {
#ifdef ParticulateFilter
						int NumeroCanales = 0;
						int NumeroHaz = FCCDeposito[i]->GetTuboExtremo(0).NumeroHaz;
						int TipoCanal = FCCDeposito[i]->GetTuboExtremo(0).TipoCanal;
						NumeroCanales = FCCDeposito[i]->GetTuboExtremo(0).DPF->GetCanal(NumeroHaz, TipoCanal)->getNumeroCanales();
						m = g * DeltaT * NumeroCanales;
#endif
					}
					v = (double) SignoFlujo * dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getVelocity();
					a = dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getSpeedSound();
					if(FirstStep) {
						MasaEntrante += m;
						for(int j = 0; j < FNumeroEspecies - FIntEGR; j++) {
							FMasaEspecie[j] += FCCDeposito[i]->GetFraccionMasicaEspecie(j) * m;
						}
					}
					if(v > 0) {
						H += EntalpiaEntrada(a, v, m, Asonido1, FMasa, FCCDeposito[i]->getGamma());
					}
				}
			}
			for(int i = 0; i < FNumeroUnionesED; i++) {

				if(FCCUnionEntreDep[i]->getTipoCC() == nmUnionEntreDepositos) {
					if(FNumeroDeposito == dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getNumeroDeposito1()) {
						SignoFlujoED = dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getSentidoFlujoED1();
					} else if(FNumeroDeposito == dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getNumeroDeposito2()) {
						SignoFlujoED = dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getSentidoFlujoED2();
					} else {
						printf("ERROR:TDepVolCte::ActualizaPropiedades en el deposito %d, union entre depositos %d\n", FNumeroDeposito, i);
					}
					g = (double) SignoFlujoED * dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getMassflow();
					m = g * DeltaT;
					a = (double) dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getSpeedSound();
					v = (double) SignoFlujoED * dynamic_cast<TCCUnionEntreDepositos*>(FCCUnionEntreDep[i])->getVelocity() / __cons::ARef;
					if(FirstStep) {
						MasaEntrante += m;
						for(int j = 0; j < FNumeroEspecies - FIntEGR; j++) {
							FMasaEspecie[j] += FCCUnionEntreDep[i]->GetFraccionMasicaEspecie(j) * m;
						}
					}
					if(g > 0) {
						H += EntalpiaEntrada(a, 0., m, Asonido1, FMasa, FCCUnionEntreDep[i]->getGamma());

					}

				}
			}

			if(FHayCompresor) {
				g = (double) FCompresorSentido * FCompresor->getMassflow();
				m = g * DeltaT;
				a = FCompresor->getSpeedSound();
				if(FirstStep) {
					MasaEntrante += m;
					for(int j = 0; j < FNumeroEspecies - FIntEGR; j++) {
						FMasaEspecie[j] += FCompresor->GetFraccionMasicaEspecie(j) * m;
					}
				}
				if(g > 0) {
					H += EntalpiaEntrada(a, 0, m, Asonido1, FMasa, FCompresor->getGamma());
				}
			}
			if(FirstStep) {
				FMasa = FMasa0 + MasaEntrante;
				for(int j = 0; j < FNumeroEspecies - 2; j++) {
					FFraccionMasicaEspecie[j] = FMasaEspecie[j] / FMasa;
					FraccionMasicaAcum += FFraccionMasicaEspecie[j];
				}
				FFraccionMasicaEspecie[FNumeroEspecies - 2] = 1. - FraccionMasicaAcum;
				if(FHayEGR)
					FFraccionMasicaEspecie[FNumeroEspecies - 1] = FMasaEspecie[FNumeroEspecies - 1] / FMasa;
				FirstStep = false;
				H0 = H;
			}
			Heat = FHeatPower * DeltaT * (MTemp + FGamma / (pow2(Asonido1 * __cons::ARef) * FMasa)) / 2.;
			Energia = pow(FMasa / FMasa0 * exp((H0 + H) / 2 - Heat), __Gamma::G1(FGamma));

			Asonido1 = FAsonido * sqrt(Energia);
			// Past the relaxation threshold, blend the new estimate with the
			// previous one to break an oscillating (non-contracting) sequence.
			if(iter >= kRelaxAfter) {
				const double relax = 0.5;
				Asonido1 = relax * Asonido1 + (1. - relax) * Asonido0;
			}
			Error = (Diff = Asonido1 - Asonido0, fabs(Diff)) / Asonido1;
			++iter;
			if(Error <= 1e-6) {
				Converge = true;
				FAsonido = Asonido1;
			} else if(iter >= kMaxIter) {
				// Accept the current (relaxed) estimate rather than spin forever.
				Converge = true;
				FAsonido = Asonido1;
				static std::atomic<int> depNoConv{0};
				int n = depNoConv.fetch_add(1);
				if(n < 20)
					printf("WARNING: plenum %d sound-speed iteration hit cap "
						   "(Error=%.2e), accepting relaxed value\n",
						   FNumeroDeposito, Error);
			} else {
				Asonido0 = Asonido1;
			}
		}
		double A2 = pow2(__cons::ARef * FAsonido);
		FPressure = __units::PaToBar(A2 / FGamma / FVolumen * FMasa);
		FPresionIsen = pow(FPressure / FPresRef, __Gamma::G5(FGamma));
		FTemperature = __units::KTodegC(A2 / FGamma / FRMezcla);
		FTime = TimeCalculo;

		// Diagnostic (OPENWAM_PLENDIAG=<dep>): plenum energy-balance audit. For the
		// target deposit (default 2 = Plenum_Main) accumulate, per window, the
		// mass-flux-weighted INFLOW temperature from every connection and compare
		// it to the plenum's own temperature. By conservation a wall-cooled plenum
		// must satisfy <T_in> >= T_plenum (it loses heat to the walls); if instead
		// the plenum runs HOTTER than every stream feeding it, that is energy
		// creation at the plenum mixing -- the surviving Stage-20 candidate.
		if(getenv("OPENWAM_PLENDIAG")) {
			int target = atoi(getenv("OPENWAM_PLENDIAG"));
			if(target <= 1) target = 2;
			if(FNumeroDeposito == target) {
				const double R = 287.0;
				static double s_dt = 0., s_Tplen = 0.;
				static double s_min[16] = {0}, s_mT[16] = {0}, s_mTin = 0., s_min_tot = 0.;
				static long s_n = 0;
				double Tplen = __units::degCToK(FTemperature);
				s_Tplen += Tplen * DeltaT; s_dt += DeltaT;
				for(int i = 0; i < FNumeroUniones && i < 16; i++) {
					if(FCCDeposito[i]->getTipoCC() == nmPipeToPlenumConnection) {
						int sf = (dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getSentidoFlujo()
								  == nmEntrante) ? 1 : -1;
						double gg = -dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getMassflow();
						double mm = gg * DeltaT
								* FCCDeposito[i]->GetTuboExtremo(0).Pipe->getNumeroConductos();
						double vv = sf * dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getVelocity();
						double aa = dynamic_cast<TCCDeposito*>(FCCDeposito[i])->getSpeedSound();
						double gam = FCCDeposito[i]->getGamma();
						double Tin = pow2(aa * __cons::ARef) / (gam * R);
						if(vv > 0. && mm > 0. && std::isfinite(Tin)) {
							s_min[i] += mm; s_mT[i] += mm * Tin;
							s_min_tot += mm; s_mTin += mm * Tin;
						}
					}
				}
				if((++s_n % 4000) == 0) {
					double Tin_avg = s_min_tot > 0 ? s_mTin / s_min_tot : 0.;
					double Tplen_avg = s_dt > 0 ? s_Tplen / s_dt : 0.;
					printf("PLENDIAG dep%d: T_plenum=%.0fK  <T_in>(massflux-wtd)=%.0fK  "
						   "=> %s by %.0fK", FNumeroDeposito, Tplen_avg, Tin_avg,
						   (Tplen_avg > Tin_avg) ? "PLENUM HOTTER (energy gain!)" : "inflow hotter (ok)",
						   fabs(Tplen_avg - Tin_avg));
					for(int i = 0; i < FNumeroUniones && i < 16; i++) {
						if(s_min[i] > 0)
							printf(" | con%d:%.0fK(m%.0f%%)", i, s_mT[i] / s_min[i],
								   100. * s_min[i] / (s_min_tot > 0 ? s_min_tot : 1.));
					}
					printf("\n");
					s_dt = s_Tplen = s_mTin = s_min_tot = 0.;
					for(int i = 0; i < 16; i++) { s_min[i] = 0.; s_mT[i] = 0.; }
				}
			}
		}
	} catch (std::exception & N) {
		std::cout << "ERROR: TDepVolCte::ActualizaPropiedades en el deposito: " << FNumeroDeposito << std::endl;
		std::cout << "Tipo de error: " << N.what() << std::endl;
		throw Exception(N.what());
	}
}

void TDepVolCte::UpdateProperties0DModel(double TimeCalculo) {

	ActualizaPropiedades(TimeCalculo);

	AcumulaResultadosMedios(TimeCalculo);

}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

#pragma package(smart_init)
