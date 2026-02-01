# OpenWAM - BMW S54 CSL Simulator Fork

A fork of [CMT-UPV/OpenWAM](https://github.com/CMT-UPV/OpenWAM) customized for high-fidelity BMW S54 (M3 CSL) engine simulation with Volumetric Efficiency (VE) table generation.

## Key Modifications

### OpenWAM Engine Core (C++)

- **NaN Guards**: Symmetric fallback to air properties (γ=1.386, R=287) in cylinder and pipe solvers
- **Stability Fixes**: Crash prevention for Pipe ID bounds and species transport
- **Memory Modernization**: `std::unique_ptr`, `std::shared_ptr`, `std::string`
- **Parallelization**: OpenMP enabled for flow calculations

### CSL Simulator (Python)

A complete VE simulation pipeline for the S54B32HP engine:

- **WAM Generator**: Dynamic topology creation with 81 pipes, dual-bank exhaust, H-pipe crossover
- **VANOS Integration**: OEM map-based intake/exhaust cam timing
- **VE Validation**: 13-point sweep comparing simulation vs OEM ECU maps
- **Parallel Execution**: Multi-threaded VE table generation

## Project Structure

```
OpenWAM/
├── Source/                              # C++ Engine Core
│   ├── Engine/TCilindro4T.cpp          # Cylinder solver (w/ NaN guard)
│   ├── 1DPipes/TTubo.cpp               # Pipe solver (w/ NaN guard)
│   └── CMakeLists.txt
├── build/                               # CMake build output
│   └── bin/release/OpenWAM.exe
├── CSL_Simulator/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── models.py               # Pydantic config (S54 spec)
│   │   │   ├── data/csl_ecu_maps.json  # OEM VE/VANOS maps
│   │   │   └── simulator/
│   │   │       └── wam_generator.py    # WAM file generator
│   │   ├── scripts/                    # CLI tools
│   │   │   ├── ve_validation_sequential.py
│   │   │   └── ve_table_runner_parallel.py
│   │   └── output/                     # Generated files
│   └── docs/
│       └── csl_simulator_technical_spec.md
└── README.md
```

## Build Instructions

### OpenWAM Engine (C++)

Requirements: CMake 3.10+, C++17 compiler, OpenMP (optional)

```bash
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
```

### CSL Simulator (Python)

Requirements: Python 3.10+, pandas

```bash
cd CSL_Simulator/backend
python scripts/ve_validation_sequential.py
```

## S54 Engine Configuration

| Parameter | Value |
|-----------|-------|
| Bore × Stroke | 87.0 × 91.0 mm |
| Displacement | 3246 cc |
| Compression Ratio | 11.5:1 |
| Cylinders | 6 (Inline) |
| Valve Lift | 11.8 / 11.2 mm (In/Ex) |

## Validation Results

| RPM Range | TPS Range | Accuracy |
|-----------|-----------|----------|
| 1400-3100 | 10-50% | ±13% |
| 3500-7000 | 65-100% | -23% to -35% |

**Status**: 12/13 points passing (92%)

## License

GNU General Public License v3.0 - See original [OpenWAM](https://github.com/CMT-UPV/OpenWAM) for details.

## Acknowledgments

- [CMT-UPV/OpenWAM](https://github.com/CMT-UPV/OpenWAM) - Original engine simulation framework
