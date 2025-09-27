# OpenWAM Python Model Design

This document outlines the design for a new Python-based engine simulator, derived from the models and architecture of the C++ OpenWAM project. The initial focus is on simulating a 4-stroke gasoline engine.

## 1. Overall Architecture

The simulation is structured as a collection of interconnected components that model the physical parts of an engine. A main simulator object orchestrates the simulation by managing the components and stepping through time (or crank angle).

The primary components are:

*   **Simulator (`TOpenWAM`):** The top-level orchestrator. It is responsible for:
    *   Reading the input configuration.
    *   Instantiating and connecting all other components.
    *   Running the main simulation loop.
    *   Collecting and outputting results.

*   **Engine Block (`TBloqueMotor`):** Represents the engine as a whole. It contains:
    *   One or more Cylinder objects.
    *   Global engine parameters like geometry (bore, stroke), engine speed, and fuel properties.
    *   Models for calculating overall engine performance (torque, power, efficiency).

*   **Cylinder (`TCilindro` / `TCilindro4T`):** The core of the simulation, where the thermodynamic cycle occurs. Its responsibilities include:
    *   Tracking the state of the gas inside the cylinder (pressure, temperature, mass, composition).
    *   Calculating the cylinder volume based on crank angle.
    *   Modeling the combustion process (e.g., using a Wiebe function to determine heat release).
    *   Modeling heat transfer to the cylinder walls, piston, and head.
    *   Calculating instantaneous torque produced by gas pressure on the piston.

*   **Pipes (`TTubo`):** Models the intake and exhaust runners. This component simulates the 1D gas dynamics (wave action) within the pipes, which is critical for accurately predicting engine breathing.

*   **Valves (`TValvula4T`):** Models the physical intake and exhaust valves. Its primary role is to provide the effective flow area at any given crank angle, based on:
    *   A predefined lift profile (valve lift vs. crank angle).
    *   A discharge coefficient profile (flow efficiency vs. valve lift).

*   **Boundary Conditions (`TCondicionContorno`):** These objects connect the other components. For example, the `TCCCilindro` class acts as the boundary between a `TTubo` (pipe) and a `TCilindro`, using a `TValvula4T` to calculate the mass flow between them based on the pressure difference.

The simulation proceeds by iteratively solving for the state of each component at discrete time steps. The state of one component (e.g., the pressure in a pipe) affects the state of its neighbors (e.g., the mass flow into the cylinder), requiring a coupled solution approach.

## 2. Key Parameters

The following parameters are essential for defining a simulation case for a 4-stroke gasoline engine.

### Engine Geometry (`stGeometria` in `TBloqueMotor.h`)
*   `NCilin`: Number of cylinders
*   `Diametro`: Cylinder bore (m)
*   `Carrera`: Cylinder stroke (m)
*   `Biela`: Connecting rod length (m)
*   `RelaCompresion`: Geometric compression ratio
*   `VCC`: Clearance volume (m^3) - *Calculated from the above*

### Operating Conditions
*   `FRegimen`: Engine speed (rpm)
*   `AmbientPressure`: Ambient pressure (Pa)
*   `AmbientTemperature`: Ambient temperature (K)
*   `FMasaFuel`: Mass of fuel injected per cycle per cylinder (kg)

### Fuel Properties
*   `FPoderCalorifico`: Lower heating value of the fuel (J/kg)
*   `FDensidadCombustible`: Density of the fuel (kg/m^3)
*   `FRendimientoCombustion`: Combustion efficiency (0-1)

### Combustion Model (Wiebe Function)
*   `FNumeroLeyesQuemado`: Number of Wiebe functions used to model combustion.
*   For each Wiebe function (`stWiebe`):
    *   `m`: Shape parameter
    *   `C`: Duration parameter
    *   `IncAlpha`: Combustion duration (crank angle degrees)
    *   `Alpha0`: Start of combustion angle (crank angle degrees, relative to TDC)

### Heat Transfer (Woschni Model)
*   `FWoschni.cw1`: Woschni model constant 1
*   `FWoschni.cw2`: Woschni model constant 2
*   `FTempRefrigerante`: Coolant temperature (K)
*   Wall properties (`stPropTermicas` for piston, head, cylinder):
    *   `Espesor`: Wall thickness (m)
    *   `Conductividad`: Thermal conductivity (W/mK)
    *   `Density`: Density (kg/m^3)
    *   `CalorEspecifico`: Specific heat (J/kgK)

### Intake/Exhaust Valves (`TValvula4T.h`)
*   `FDiametro`: Valve head diameter (m)
*   `FAnguloApertura`: Crank angle for valve opening (degrees)
*   `FAnguloCierre`: Crank angle for valve closing (degrees)
*   **Lift Profile:** A table of valve lift (m) vs. crank angle (degrees).
*   **Discharge Coefficient Profile:** A table of the discharge coefficient (Cd) vs. valve lift (m). This is crucial for accurate flow calculations.

### Pipes (`TTubo.h`)
*   `longitud`: Pipe length (m)
*   `diametro`: Pipe diameter (m)
*   `nin`: Number of computational cells along the pipe.

## 3. Core Models & Equations

This section describes the key physical models and governing equations used in the simulation.

### In-Cylinder Thermodynamics (First Law of Thermodynamics)

The core of the simulation is the energy balance within the cylinder during the closed-valve period (compression and power strokes). This is an application of the First Law of Thermodynamics for an open system (though it's treated as closed during this phase, except for blow-by).

The change in internal energy of the gas in the cylinder (`dU`) over a small crank angle step (`d_theta`) is given by:

`dU/d_theta = dQ_comb/d_theta - dQ_loss/d_theta - dW/d_theta`

Where:
*   `dQ_comb/d_theta`: Rate of heat addition from combustion.
*   `dQ_loss/d_theta`: Rate of heat loss to the cylinder walls.
*   `dW/d_theta`: Rate of work done by the piston.

The simulation solves this differential equation numerically at each step.

#### 3.1. Work Done (`dW`)

The work done by the cylinder gas on the piston is calculated from the cylinder pressure (`P`) and the change in cylinder volume (`dV`):

`dW = P * dV`

The cylinder volume `V` is calculated at each crank angle (`theta`) based on the engine geometry (bore, stroke, con-rod length) using standard crank-slider kinematics, implemented in the `CalculaVolumen` method.

#### 3.2. Heat Release from Combustion (`dQ_comb`)

The rate of heat release is modeled using the Wiebe function, which provides a normalized profile of the combustion process.

*   `x(theta)`: The mass fraction of fuel burned at crank angle `theta`. This is calculated by the `fql` and `fun_wiebe` methods.
*   The instantaneous heat released is then: `dQ_comb = M_fuel * LHV * dx`
    *   `M_fuel`: Total mass of fuel injected per cycle.
    *   `LHV`: Lower Heating Value of the fuel.
    *   `dx`: The change in the burned mass fraction over the current step.

#### 3.3. Heat Loss (`dQ_loss`)

Heat loss from the hot in-cylinder gas to the cooler cylinder head, piston, and liner walls is a major factor in engine performance and is modeled using the Woschni heat transfer correlation.

`h = C1 * D^(m-1) * P^m * T^(0.75-1.62m)`

Where:
*   `h`: Heat transfer coefficient.
*   `D`: Cylinder bore.
*   `P`, `T`: Instantaneous cylinder pressure and temperature.
*   `C1`, `m`: Empirical constants.

The heat loss is then `dQ_loss = h * A_wall * (T_gas - T_wall) * dt`, where `A_wall` is the exposed surface area and `T_wall` is the wall temperature.

### Gas Exchange (Open Cycle)

During the intake and exhaust strokes, the valves are open, and the cylinder is treated as an open system. The mass flow through the valves is calculated by the boundary condition objects (`TCCCilindro`) using the quasi-steady, one-dimensional compressible flow equations for a nozzle:

`mass_flow_rate = Cd * A_ref * (P_upstream / sqrt(R*T_upstream)) * f(gamma, P_ratio)`

Where:
*   `Cd`: The valve's discharge coefficient (from `TValvula4T`).
*   `A_ref`: The reference area, typically the valve curtain area (`pi * D_valve * lift`).
*   `P_upstream`, `T_upstream`: Upstream pressure and temperature (in the pipe or cylinder).
*   `P_ratio`: The ratio of downstream to upstream pressure.

The state of the cylinder (mass, temperature, composition) is then updated based on the mass and enthalpy flowing in or out.

## 4. Function Relationships (Simulation Loop)

The simulation proceeds in a loop, advancing crank angle by a small step at each iteration.

1.  **`TOpenWAM::CalculateFlowIndependent` (Main Loop):**
    1.  **`DetermineTimeStep`:** Calculate the size of the next time step based on stability criteria (e.g., the Courant–Friedrichs–Lewy condition for the pipes).
    2.  **`NewEngineCycle`:** Check if a new engine cycle is beginning and reset cycle-based accumulators.
    3.  **`CalculateFlowIndependent`:** This is the core calculation step.
        *   It iterates through all the `TTubo` (pipe) objects and solves the 1D gas dynamics equations for that time step.
        *   It then calls the `CalculaCondicionContorno` method on the boundary condition objects at the ends of each pipe.
        *   If a boundary is a cylinder (`TCCCilindro`), this triggers the update of the cylinder's state.
    4.  **`TCilindro::ActualizaPropiedades`:**
        *   Determines if the cylinder is in the open or closed part of the cycle based on valve timing.
        *   If **closed**, it solves the first-law energy balance (as described in Section 3) to find the new P and T.
        *   If **open**, it accounts for the mass and enthalpy entering/leaving through the valves.
    5.  **`ManageOutput`:** Collects and writes the results for the current time step.
    6.  The loop continues until `CalculationEnd()` returns true (e.g., a set number of cycles has been simulated).

## 5. Proposed Python Implementation Plan

This section outlines a proposed structure for the new Python-based simulator.

### 5.1. Recommended Libraries

*   **NumPy:** This will be the cornerstone for all numerical data, including vector and matrix operations. It's essential for handling arrays of thermodynamic states, valve profiles, and time-series results efficiently.
*   **SciPy:** We will use `scipy.interpolate` for creating 1D interpolators for the valve lift and discharge coefficient profiles. This is a direct replacement for the `Hermite_interp` class in the C++ code. If a more sophisticated ODE solver is required for the cylinder model, `scipy.integrate` will be used.
*   **Matplotlib/Plotly:** While not part of the core simulation, these libraries will be invaluable for validating the model by plotting results like the P-V diagram, in-cylinder pressure traces, and engine performance metrics.

### 5.2. Proposed Module Structure

A modular structure will be used to separate concerns and improve code organization.

*   `config.py`: A dedicated file to hold all input parameters for a given simulation case (engine geometry, operating conditions, etc.). This makes it easy to define and switch between different engine configurations.
*   `thermo.py`: This module will contain helper functions for calculating thermodynamic properties of the working fluid (e.g., specific heat, gas constant as a function of temperature and composition).
*   `components.py`: This will contain the core classes that model the physical parts of the engine:
    *   `EngineBlock`: Holds cylinder objects and global engine data.
    *   `Cylinder`: Contains the in-cylinder thermodynamic model.
    *   `Valve`: Models the intake/exhaust valves and their lift/Cd profiles.
*   `gas_dynamics.py`: This module will house the `Pipe` class and the solver for the 1D gas dynamics within the pipes.
*   `engine_simulator.py`: This will be the main entry point, containing the `Simulator` class that orchestrates the entire simulation, and the main script logic to run a simulation from a config file.

### 5.3. Proposed Class Definitions

The class structure will closely mirror the component-based architecture of the original C++ code.

*   **`Simulator`**
    *   `__init__(self, config)`: Initializes the simulator with a configuration object.
    *   `_setup_components(self)`: Private method to create and connect the `EngineBlock`, `Pipe`, and `Boundary` objects.
    *   `run(self)`: The main simulation loop that advances time and calls the update methods on each component.

*   **`EngineBlock`**
    *   `__init__(self, config)`: Sets up the engine based on the config.
    *   `cylinders`: A list containing the `Cylinder` objects.
    *   `calculate_performance(self)`: A method called at the end of a simulation run to compute final metrics like torque, power, and BSFC.

*   **`Cylinder`**
    *   `__init__(self, config, engine_block)`: Initializes the cylinder.
    *   `state`: A simple object or dictionary holding the current thermodynamic state (`P`, `T`, `mass`, `composition`).
    *   `update(self, dt)`: The primary method called by the simulator at each time step. It will implement the state machine logic to switch between closed-cycle and gas-exchange phases.
    *   `_solve_closed_cycle(self, dt)`: Private method to solve the first-law energy balance.
    *   `_update_gas_exchange(self, mass_flow_in, mass_flow_out, ...)`: Private method to update the state based on flow through the valves.

*   **`Valve`**
    *   `__init__(self, lift_profile, cd_profile)`: Initialized with NumPy arrays for lift and Cd profiles.
    *   `_lift_interpolator`: A `scipy.interpolate` object created from the lift profile.
    *   `_cd_interpolator`: A `scipy.interpolate` object created from the Cd profile.
    *   `get_flow_area(self, crank_angle)`: Calculates the effective flow area for a given crank angle.

*   **`Pipe`**
    *   `__init__(self, config)`: Initializes the pipe with its geometry and discretizes it into cells.
    *   `update(self, dt)`: Solves the 1D gas dynamics equations for one time step.
    *   `get_boundary_conditions(self)`: Returns the state at the pipe ends (e.g., pressure, velocity).
