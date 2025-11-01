# OpenWAM Technology Stack

## Build System

- **Primary**: CMake (minimum version 2.8)
- **C++ Standard**: C++11 (`-std=c++11`)
- **Compiler Support**: GCC, MSVC, Borland C++ Builder

## Core Technologies

- **Language**: C++ with some C components
- **Parallel Computing**: OpenMP (optional, enabled with `BUILD_PARALLEL=ON`)
- **Documentation**: Doxygen (optional, enabled with `BUILD_DOCUMENTATION=ON`)
- **Platform**: Cross-platform (Windows, Linux)

## Key Libraries & Dependencies

- Standard C++ libraries (cstdio, cstdlib, cstring, fstream, etc.)
- Math libraries for numerical computations
- Windows-specific: Windows API for named pipes (TCGestorWAM)
- Optional: OpenMP for parallel simulations

## Build Commands

### Basic Build

```bash
mkdir build && cd build
cmake ..
make
```

### With Parallel Support

```bash
cmake -DBUILD_PARALLEL=ON ..
make
```

### With Documentation

```bash
cmake -DBUILD_DOCUMENTATION=ON ..
make
make doc
```

## Output Structure

- **Executables**: `bin/debug/` or `bin/release/`
- **Libraries**: `lib/`
- **Documentation**: `doc/` (if enabled)

## Compilation Flags

- Debug builds use separate output directories
- Resource compilation for Windows (.rc files)
- OpenMP flags automatically added when enabled