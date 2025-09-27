#include <iostream>
#include <string>
#include <vector>
#include <fstream>
#include <stdexcept>

// Emscripten headers
#include <emscripten.h>

// If emscripten.h doesn't define this for some reason, define it manually.
#ifndef EMSCRIPTEN_KEEPALIVE
#define EMSCRIPTEN_KEEPALIVE __attribute__((used))
#endif

// OpenWAM Headers
#include "TOpenWAM.h"
#include "TOutputResults.h"
#include "TBloqueMotor.h"
#include "TCilindro.h"
#include "TCCCilindro.h"
#include "TValvula4T.h"


// nlohmann::json
#include "json.hpp"
using json = nlohmann::json;

extern "C" {

static std::string result_str;

EMSCRIPTEN_KEEPALIVE
const char* run_simulation_wrapper(const char* params_json_str) {
    json response;
    TOpenWAM* sim = nullptr;

    try {
        // 1. Parse the incoming JSON from the frontend
        auto params = json::parse(params_json_str);

        // 2. Create the simulation object
        sim = new TOpenWAM();

        // 3. Get the engine block and programmatically set parameters from JSON
        // This replaces the old approach of reading a .wam file.
        TBloqueMotor* engine = sim->getEngine();
        if (engine) {
            engine->FRegimen = params.value("engine_speed_rpm", 2000.0);

            // Access geometry via the now reference-returning getter
            stGeometria& geom = engine->getGeometria();
            geom.Diametro = params.value("cylinder_bore_m", 0.086);
            geom.Carrera = params.value("cylinder_stroke_m", 0.086);
            geom.RelaCompresion = params.value("compression_ratio", 9.5);

            // Set VVT angle by navigating the object hierarchy
            if (params.contains("vvt_intake_angle_deg")) {
                TCilindro* pCyl = engine->GetCilindro(0); // Assume cylinder 0
                if (pCyl) {
                    // Assume first intake valve
                    TCondicionContorno* pBC = pCyl->GetCCValvulaAdm(0);
                    TCCCilindro* pCylBC = dynamic_cast<TCCCilindro*>(pBC);
                    if (pCylBC) {
                        TTipoValvula* pValveBase = pCylBC->getValvula();
                        TValvula4T* pValve4T = dynamic_cast<TValvula4T*>(pValveBase);
                        if (pValve4T) {
                            pValve4T->setVVT(params.value("vvt_intake_angle_deg", 0.0));
                        }
                    }
                }
            }
        }

        // The rest of the simulation process remains the same
        // Note: ReadInputData is skipped as we are setting params manually
        sim->InitializeParameters();
        sim->ConnectFlowElements();
        sim->InitializeOutput();
        sim->ProgressBegin();

        // The main simulation loop
        // The number of cycles is controlled by the simulation's end condition,
        // but the frontend parameter `num_cycles` could be used to adapt this loop if needed.
        do {
            sim->DetermineTimeStepIndependent();
            sim->NewEngineCycle();
            sim->CalculateFlowIndependent();
            sim->ManageOutput();
        } while(!sim->CalculationEnd());

        sim->ProgressEnd();
        sim->GeneralOutput();

        // --- Extract Results ---
        TOutputResults* results = sim->getOutputResults();
        if (results) {
            response["status"] = "success";
            response["message"] = "Simulation completed.";
            response["output"]["crank_angle"] = results->crank_angle;

            if (!results->pressure.empty()){
                 response["output"]["pressure"] = results->pressure[0];
            }
            if (!results->temperature.empty()){
                response["output"]["temperature"] = results->temperature[0];
            }

            if (engine) {
                response["performance"]["torque"] = engine->getTorque();
                response["performance"]["power_hp"] = engine->getPower() / 745.7;
                response["performance"]["imep"] = engine->getIMEP();
            } else {
                response["performance"]["torque"] = 0;
                response["performance"]["power_hp"] = 0;
                response["performance"]["imep"] = 0;
            }

        } else {
            response["status"] = "error";
            response["message"] = "Simulation ran but produced no output.";
        }


    } catch (const std::exception& e) {
        response["status"] = "error";
        response["message"] = "C++ exception: " + std::string(e.what());
    } catch (...) {
        response["status"] = "error";
        response["message"] = "An unknown C++ exception occurred during simulation.";
    }

    if (sim) {
        delete sim;
    }

    result_str = response.dump();
    return result_str.c_str();
}

} // extern "C"
