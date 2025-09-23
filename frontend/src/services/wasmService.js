/* global Module */

// This service wraps the WebAssembly module and provides a simple interface to it.

// The Emscripten module object, which will be initialized once the script is loaded.
let wasmModule;

/**
 * Initializes the WebAssembly module.
 * This function should be called once when the application starts.
 * It loads the 'openwam.js' script, which in turn loads the .wasm file.
 *
 * @returns {Promise<void>} A promise that resolves when the module is initialized.
 */
export const initWasm = () => {
  return new Promise((resolve, reject) => {
    // Check if the module is already initialized
    if (wasmModule) {
      return resolve();
    }

    // Create a script element to load the Emscripten-generated glue code.
    const script = document.createElement('script');
    script.src = '/openwam.js'; // The script is in the public folder
    script.async = true;
    document.body.appendChild(script);

    // Emscripten's 'Module' object provides an 'onRuntimeInitialized' callback.
    // We need to define this callback *before* the script loads.
    window.Module = {
      onRuntimeInitialized: () => {
        console.log('WebAssembly module runtime initialized.');
        wasmModule = window.Module;
        resolve();
      },
      // Redirect wasm stdout to the console for debugging
      print: (text) => console.log('WASM >', text),
      printErr: (text) => console.error('WASM ERR >', text),
    };

    script.onerror = (err) => {
      console.error('Failed to load WebAssembly module script.', err);
      reject(err);
    };
  });
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
    // The C++ wrapper function is exposed via ccall
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
