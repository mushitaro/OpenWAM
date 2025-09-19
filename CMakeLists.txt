# This is a new CMake file specifically for building the WebAssembly module.
# It is based on the original CMakeLists.txt files.

project(OpenWAM_WASM)
cmake_minimum_required(VERSION 3.10)

# Set C++ standard
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Set output directories
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# --- Sub-project libraries ---

# Add all the source files from the subdirectories.
file(GLOB_RECURSE LIB_SOURCES
    "Source/1DPipes/*.cpp"
    "Source/Act/*.cpp"
    "Source/Boundaries/*.cpp"
    "Source/Connections/*.cpp"
    "Source/Control/*.cpp"
    "Source/Engine/*.cpp"
    "Source/Labels/*.cpp"
    "Source/Math_wam/*.cpp"
    "Source/ODModels/*.cpp"
    "Source/Output/*.cpp"
    "Source/Turbocompressor/*.cpp"
    "Source/Wrappers/*.cpp"
)

set(EXTERN_SOURCES
    Source/Extern/TAjusteTransCalorCil.cpp
    Source/Extern/TCalculoExtern.cpp
    Source/Extern/TCoefDescarga.cpp
    Source/Extern/TControlFuel.cpp
    Source/Extern/TControlInyeccion.cpp
    Source/Extern/TControlK.cpp
    Source/Extern/TEGRV.cpp
    Source/Extern/TFraccionMasicaCilindro.cpp
    Source/Extern/TMuelle.cpp
    Source/Extern/TRegimenMotor.cpp
    Source/Extern/TTGV.cpp
    Source/Extern/Tfql.cpp
)

list(APPEND LIB_SOURCES ${EXTERN_SOURCES})

# --- Main WASM Module ---

# Add the main sources for the simulation logic, plus our new wrapper
set(WASM_SOURCES
    Source/TOpenWAM.cpp
    Source/TTimeControl.cpp
    Source/wasm_wrapper.cpp # The new wrapper
)

# Create the final target. Emscripten will turn this into .js and .wasm files.
add_executable(openwam_wasm ${WASM_SOURCES} ${LIB_SOURCES})

# Add include directories to our specific target
target_include_directories(openwam_wasm PUBLIC
    "${CMAKE_SOURCE_DIR}/Source"
    "${CMAKE_SOURCE_DIR}/Source/1DPipes"
    "${CMAKE_SOURCE_DIR}/Source/Act"
    "${CMAKE_SOURCE_DIR}/Source/Boundaries"
    "${CMAKE_SOURCE_DIR}/Source/Concentric Pipe"
    "${CMAKE_SOURCE_DIR}/Source/Connections"
    "${CMAKE_SOURCE_DIR}/Source/Control"
    "${CMAKE_SOURCE_DIR}/Source/DPF"
    "${CMAKE_SOURCE_DIR}/Source/Engine"
    "${CMAKE_SOURCE_DIR}/Source/Extern"
    "${CMAKE_SOURCE_DIR}/Source/Includes"
    "${CMAKE_SOURCE_DIR}/Source/Includes/json"
    "${CMAKE_SOURCE_DIR}/Source/Labels"
    "${CMAKE_SOURCE_DIR}/Source/Math_wam"
    "${CMAKE_SOURCE_DIR}/Source/ODModels"
    "${CMAKE_SOURCE_DIR}/Source/Output"
    "${CMAKE_SOURCE_DIR}/Source/Turbocompressor"
    "${CMAKE_SOURCE_DIR}/Source/Wrappers"
)


# --- Emscripten-specific settings ---

# Set linker flags for Emscripten
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_FUNCTIONS=['_run_simulation_wrapper'] -s ALLOW_MEMORY_GROWTH=1")

# Give the output file a clear name.
set_target_properties(openwam_wasm PROPERTIES OUTPUT_NAME "openwam")
