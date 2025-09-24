/* global Module */

// This service wraps the WebAssembly module and provides a simple interface to it.

let wasmModule;

/**
 * Initializes the WebAssembly module using modern ES module dynamic import.
 * This function should be called once when the application starts.
 *
 * @returns {Promise<void>} A promise that resolves when the module is initialized.
 */
export const initWasm = async () => {
  // Prevent re-initialization
  if (wasmModule) {
    return;
  }

  try {
    // Dynamically import the Emscripten-generated glue code.
    // The '.default' is needed because it's a default export.
    const openWamModuleFactory = (await import('/openwam.js')).default;
    console.log('WASM module factory loaded.');

    const moduleArgs = {
      // Redirect wasm stdout and stderr to the console for debugging
      print: (text) => console.log('WASM >', text),
      printErr: (text) => console.error('WASM ERR >', text),
    };

    // The factory function returns a promise that resolves with the initialized module instance.
    wasmModule = await openWamModuleFactory(moduleArgs);
    console.log('WebAssembly module instance is ready.');

  } catch (err) {
    console.error('Failed to initialize WebAssembly module.', err);
    // Re-throw the error to be caught by the caller in App.js
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
    // The C++ wrapper function is exposed via ccall on the module instance
    const runSimulationWrapper = wasmModule.cwrap(
      'run_simulation_wrapper', // name of the C++ function
      'string',                 // return type
      ['string']                // argument types
    );

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
