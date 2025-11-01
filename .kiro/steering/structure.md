# OpenWAM Project Structure

## Root Directory

- `CMakeLists.txt` - Main build configuration
- `CodeSummary.txt` - Comprehensive project documentation
- `Doxyfile.in` - Doxygen configuration template
- `Icon.ico` - Application icon
- `Source/` - All source code

## Source Code Organization (`Source/`)

### Core Application

- `OpenWAM.cpp` - Main entry point
- `TOpenWAM.cpp/.h` - Main application class
- `TTimeControl.cpp/.h` - Time control and simulation timing
- `TCGestorWAM.cpp/.h` - Communication manager (Windows pipes)
- `Version.h` - Version information
- `OpenWAM.rc` - Windows resource file

### Modular Components (Each with CMakeLists.txt)

#### Engine Simulation

- `Engine/` - Engine blocks and cylinders (TBloqueMotor, TCilindro4T)
- `1DPipes/` - 1D pipe flow modeling (TTubo)
- `Boundaries/` - Boundary conditions for various components

#### Turbocharging System

- `Turbocompressor/` - Compressor modeling and maps
- `ODModels/` - 0D models for plenums, turbines, venturis

#### Specialized Components

- `DPF/` - Diesel Particulate Filter modeling
- `Concentric Pipe/` - Concentric pipe elements
- `Connections/` - Valves and connection elements
- `Control/` - Control systems (sensors, PID controllers)

#### Support Systems

- `Extern/` - External calculations and interfaces
- `Output/` - Results output management
- `Math_wam/` - Mathematical utilities
- `Labels/` - Internationalization support
- `Wrappers/` - Exception handling and wrappers

#### Configuration

- `Includes/` - Global headers (Constantes.h, Globales.h, fluids.h)
- `Act/` - Action definitions and injection rate calculations

## Naming Conventions

- Classes use Hungarian notation with 'T' prefix (e.g., `TOpenWAM`, `TTubo`)
- Header guards follow pattern: `ClassNameH`
- Boundary conditions prefixed with `TCC` (e.g., `TCCCilindro`)
- File extensions: `.cpp/.h` for C++, `.hpp` for headers-only

## Architecture Patterns

- Modular design with clear separation of concerns
- Each major component has its own subdirectory and CMake target
- Extensive use of inheritance for boundary conditions and valve types
- Global configuration through `Globales.h` and `Constantes.h`
- Optional features controlled by preprocessor directives (`#ifdef ParticulateFilter`, `#ifdef ConcentricElement`)
