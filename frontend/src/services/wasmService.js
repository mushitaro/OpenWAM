// This service wraps the WebAssembly module and provides a simple interface to it.

let wasmModule;

/**
 * Initializes the WebAssembly module using modern ES module dynamic import.
 * This function should be called once when the application starts.
 *
 * @returns {Promise<void>} A promise that resolves when the module is initialized.
 */
export const initWasm = async () => {
  if (wasmModule) {
    return;
  }

  try {
    const EmscriptenModuleFactory = (await import('../openwam.js')).default;

    const EmscriptenModule = {
      print: (text) => console.log('WASM >', text),
      printErr: (text) => console.error('WASM ERR >', text),
    };

    await EmscriptenModuleFactory(EmscriptenModule);

    wasmModule = EmscriptenModule;
    console.log('WASM module is ready.');
    console.dir(wasmModule); // <--- ADDED THIS LINE

  } catch (err) {
    console.error('Failed to initialize WebAssembly module.', err);
    throw err;
  }
};

/**
 * Runs the engine simulation by calling the wrapped C++ function.
 *
 * @param {object} params - The simulation parameters as a JavaScript object.
 * @returns {object|null} The simulation results as a JavaScript object, or null if an error occurs.
 */
export const runSimulation = (params) => {
  if (!wasmModule) {
    console.error('WASM module is not initialized. Call initWasm() first.');
    return null;
  }

  try {
    // Directly call the wrapped C++ function
    const runSimulationWrapper = wasmModule._run_simulation_wrapper; // <--- MODIFIED LINE

    const paramsJson = JSON.stringify(params);
    console.log('Running simulation with params:', paramsJson);

    const resultJson = runSimulationWrapper(paramsJson);
    console.log('Simulation result (raw JSON string):', resultJson);

    if (resultJson) {
      return JSON.parse(resultJson);
    }
    return null;
  } catch (error) {
    console.error('An error occurred while running the simulation:', error);
    return null;
  }
};
