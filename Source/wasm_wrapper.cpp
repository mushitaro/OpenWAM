#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>

// Emscripten headers
#include <emscripten.h>

// If emscripten.h doesn't define this for some reason, define it manually.
#ifndef EMSCRIPTEN_KEEPALIVE
#define EMSCRIPTEN_KEEPALIVE __attribute__((used))
#endif

// OpenWAM Headers
#include "TOpenWAM.h"
#include "TBloqueMotor.h"
#include "TCilindro4T.h"
#include "TValvula4T.h"
#include "TTubo.h"

#include "json.hpp"

// Use the nlohmann namespace for convenience
using json = nlohmann::json;

// This is the C function that will be called from JavaScript.
extern "C" {

static std::string result_str;

EMSCRIPTEN_KEEPALIVE
const char* run_simulation_wrapper(const char* input_str) {
    json response;

    try {
        json input_json = json::parse(input_str);
        double rpm = input_json.value("rpm", 2000.0);
        double vvt_angle = input_json.value("vvt_angle", 0.0);
        double fuel_mass = input_json.value("fuel_mass", 0.02);

        TOpenWAM* sim = new TOpenWAM();

        // 1. General Parameters
        sim->setAmbientPressure(1.013);
        sim->setAmbientTemperature(25.0);
        sim->setSpeciesModel(nmCalculoSimple);
        sim->setGammaCalculation(nmComposicionTemperatura);
        sim->setEngineBlock(true);
        sim->setEngineType(nm4T);
        sim->setSimulationType(nmEstacionario);
        sim->setThereIsEGR(false);
        sim->setThereIsFuel(true);
        sim->setFuelType(nmGasolina);
        sim->setSpeciesNumber(4);
        double* atm_comp = new double[4]{0.0, 0.0, 1.0, 0.0};
        sim->setAtmosphericComposition(atm_comp);

        // 2. Engine Block
        TBloqueMotor** engine_ptr = new TBloqueMotor*[1];
        engine_ptr[0] = new TBloqueMotor(sim->getAmbientPressure(), sim->getAmbientTemperature(), sim->getSpeciesModel(), sim->getSpeciesNumber(), sim->getGammaCalculation(), sim->getThereIsEGR());
        sim->setEngine(engine_ptr);

        TBloqueMotor* engine = engine_ptr[0];
        stGeometria& geom = engine->getGeometria();
        geom.NCilin = 1;
        geom.Diametro = 0.086;
        geom.Carrera = 0.086;
        geom.Biela = 0.140;
        geom.RelaCompresion = 10.0;
        engine->PutRegimen(rpm);
        engine->setMasaFuel(fuel_mass / 1000.0);

        TCilindro** cylinders = new TCilindro*[1];
        cylinders[0] = new TCilindro4T(engine, 1, sim->getThereIsEGR());
        engine->setFCilindro(cylinders);

        // 3. Pipes
        sim->NumberOfPipes = 2;
        sim->Pipe = new TTubo*[2];

        // Intake Pipe
        json intake_pipe_config = {
            {"numero_tubo", 1},
            {"longitud", 0.4},
            {"diametro", 0.04},
            {"mallado", 0.01},
            {"friccion", 0.02},
            {"tipo_trans_cal", 1} // nmTuboAdmision
        };
        sim->Pipe[0] = new TTubo(sim->getSpeciesNumber(), 0, 0, engine_ptr, sim->getSpeciesModel(), sim->getGammaCalculation(), sim->getThereIsEGR());
        sim->Pipe[0]->configure_from_json(intake_pipe_config, engine_ptr);

        // Exhaust Pipe
        json exhaust_pipe_config = {
            {"numero_tubo", 2},
            {"longitud", 0.8},
            {"diametro", 0.04},
            {"mallado", 0.01},
            {"friccion", 0.02},
            {"tipo_trans_cal", 2} // nmTuboEscape
        };
        sim->Pipe[1] = new TTubo(sim->getSpeciesNumber(), 1, 0, engine_ptr, sim->getSpeciesModel(), sim->getGammaCalculation(), sim->getThereIsEGR());
        sim->Pipe[1]->configure_from_json(exhaust_pipe_config, engine_ptr);


        // TODO: Create Valves and Boundary Conditions and link them.

        response["status"] = "success";
        response["message"] = "Successfully created pipes.";
        response["rpm_set"] = rpm;

        // Cleanup
        delete[] atm_comp;
        delete cylinders[0];
        delete[] cylinders;
        delete sim->Pipe[0];
        delete sim->Pipe[1];
        delete[] sim->Pipe;
        delete engine;
        delete[] engine_ptr;
        delete sim;

    } catch (json::parse_error& e) {
        std::cerr << "WASM: JSON parsing error: " << e.what() << std::endl;
        response["status"] = "error";
        response["message"] = "Failed to parse input JSON: " + std::string(e.what());
    } catch (std::exception& e) {
        std::cerr << "WASM: An unexpected error occurred: " << e.what() << std::endl;
        response["status"] = "error";
        response["message"] = "An unexpected error occurred in the simulation: " + std::string(e.what());
    }

    result_str = response.dump();
    return result_str.c_str();
}

} // extern "C"
