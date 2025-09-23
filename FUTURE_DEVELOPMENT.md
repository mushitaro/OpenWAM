# Future Development Plan: OpenWAM Interactive Web Simulator

## 1. Overall Goal

The primary objective of this project is to transform the command-line-based OpenWAM C++ engine simulation tool into a fully interactive, web-based application. This will allow users to modify engine parameters through a modern graphical user interface and visualize the simulation results in real-time, without needing to compile the C++ code or manage local executables.

## 2. High-Level Architecture

The application will consist of three main parts:

1.  **C++ Simulation Core (WebAssembly):** The original OpenWAM C++ codebase, with minimal modifications for portability, will be compiled into a WebAssembly (WASM) module. This allows the high-performance simulation logic to run directly in the browser.
2.  **C++ Wrapper:** A C++ function will act as the single entry point for the WASM module. It will be responsible for receiving simulation parameters from the UI (as a JSON object), programmatically setting up the entire engine configuration, running the simulation, and returning a comprehensive set of results (also as a JSON object).
3.  **React Frontend:** A modern, responsive web interface built with React. This UI will communicate with the WASM module, providing users with interactive controls and dynamic data visualizations.

## 3. JSON Schema Design

To achieve the goal of supporting all possible parameters, the C++ wrapper will be driven by a comprehensive JSON object that mirrors the structure and hierarchy of the original `.wam` input files. This provides a flexible and extensible way to define a complete engine simulation case from the frontend.

## 4. Phased Parameter Expansion Plan

Due to the large number of configurable parameters in OpenWAM, implementation will be done in phases.

### Phase 1: Core Engine Functionality (Initial Implementation)

This phase focuses on implementing the most critical parameters to get a basic, single-cylinder, naturally aspirated engine simulation running.

**Input Parameters:**

*   **Global:**
    *   Engine Speed (RPM)
    *   Ambient Pressure
    *   Ambient Temperature
*   **Engine Geometry (`stGeometria`):**
    *   Bore (`Diametro`)
    *   Stroke (`Carrera`)
    *   Connecting Rod Length (`Biela`)
    *   Compression Ratio (`RelaCompresion`)
*   **Engine Operation:**
    *   Fuel Mass per cycle (`FMasaFuel`)
*   **Pipes (`TTubo`):**
    *   Intake & Exhaust Pipe Length
    *   Intake & Exhaust Pipe Diameter
*   **Valves (`TValvula4T`):**
    *   Intake & Exhaust Valve Lift Profile (from a predefined table)
    *   Intake & Exhaust Valve Opening/Closing Angles
    *   Variable Valve Timing (VVT) Phase Shift Angle

**Output Parameters:**

*   Instantaneous Cylinder Pressure vs. Crank Angle
*   Instantaneous Torque vs. Crank Angle
*   Average Indicated Mean Effective Pressure (IMEP)
*   Average Pumping Mean Effective Pressure (PMEP)
*   Brake Mean Effective Pressure (BMEP)
*   Power Output
*   Volumetric Efficiency

### Phase 2: Comprehensive Parameter Support (Future Expansion)

This phase will involve systematically adding support for the full range of OpenWAM's capabilities.

**Input Parameters to be Added:**

*   **Multi-Cylinder Engines:** Support for `NCilin` > 1.
*   **Advanced Pipes:**
    *   Multi-segment pipes with varying diameters and lengths.
    *   Detailed heat transfer and friction models (`stCapa`, `stPropTermicas`).
    *   Concentric pipes (`TConcentrico`).
*   **Plenums:**
    *   Constant Volume (`TDepVolCte`).
    *   Variable Volume (`TDepVolVariable`).
*   **Forced Induction:**
    *   **Compressors (`TCompressor`):** Including full map-based performance (`TCompressorMap`).
    *   **Turbines (`TTurbina`):** Including fixed and variable geometry (`TTurbinaSimple`, `TTurbinaTwin`, VGT).
    *   **Turbocharger Axis (`TEjeTurbogrupo`):** Connecting compressors and turbines.
*   **Advanced Boundary Conditions:**
    *   Pipe Branches (`TCCRamificacion`).
    *   Plenum-to-Plenum Connections (`TCCUnionEntreDepositos`).
    *   Pressure Pulse Generators (`TCCPulso`).
*   **Fuel & Combustion:**
    *   Detailed fuel injection parameters (`stInjectionSys`, `stInjecPulse`).
    *   Multiple combustion models (`nmFQL`, `nmACT`).
    *   Support for different fuel types (`nmDiesel`, `nmGasolina`).
*   **Control Systems:**
    *   Full implementation of Sensors (`TSensor`) and Controllers (`TPIDController`, `TTable`, etc.).
*   **Chemical Species:**
    *   Full support for `nmCalculoCompleto` species transport.
    *   EGR simulation (`ThereIsEGR`).

**Output Parameters to be Added:**

*   Detailed plenum and pipe conditions (pressure, temperature, mass flow) at any point.
*   Turbocharger performance metrics (boost pressure, RPM, efficiency).
*   Mass fractions of all chemical species throughout the system.
*   Detailed heat transfer analysis.

## 5. UI Development Plan

The React UI will be designed to be as dynamic and flexible as the C++ wrapper.

*   **Parameter Editor:** Instead of hard-coded controls, the UI will parse the JSON schema (or a simplified version of it) to generate a dynamic form or tree structure. This will allow users to view and edit any parameter that the C++ wrapper supports, without requiring UI code changes for every new parameter.
*   **Chart Component:** The charting component will be highly configurable. Users will be able to select which output variables they want to plot on the X and Y axes from a list of available outputs returned by the simulation. This will allow for flexible analysis, such as plotting P-V diagrams, Torque vs. RPM curves, or pressure waves in a pipe.
*   **Case Management:** The UI will allow users to save and load their simulation configurations (the comprehensive JSON object) as local files.
