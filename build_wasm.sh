#!/bin/bash
set -e
rm -rf build_wasm
mkdir build_wasm
cd build_wasm
emcmake cmake ..
make
