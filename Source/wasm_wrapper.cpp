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


// nlohmann::json
#include "json.hpp"
using json = nlohmann::json;

extern "C" {

static std::string result_str;

EMSCRIPTEN_KEEPALIVE
const char* run_simulation_wrapper(const char* wam_file_content) {
    json response;
    TOpenWAM* sim = nullptr;
    const char* filename = "input.wam";

    try {
        // Write the input string to a temporary file
        std::ofstream out(filename);
        out << wam_file_content;
        out.close();

        // Run the simulation
        sim = new TOpenWAM();
        sim->ReadInputData((char*)filename);
        sim->InitializeParameters();
        sim->ConnectFlowElements();
        sim->InitializeOutput();
        sim->ProgressBegin();

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

            TBloqueMotor* engine = sim->getEngine();
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
        response["message"] = "Simulation error: " + std::string(e.what());
    } catch (...) {
        response["status"] = "error";
        response["message"] = "An unknown C++ exception occurred.";
    }

    if (sim) {
        delete sim;
    }

    result_str = response.dump();
    return result_str.c_str();
}

} // extern "C"
