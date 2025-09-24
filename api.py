from flask import Flask, request, jsonify
from flask_cors import CORS
from engine_simulator.main import Simulator
from engine_simulator.config import get_default_config
import numpy as np
import json
import collections.abc

app = Flask(__name__)
CORS(app) # Enable CORS for all routes

# Custom JSON encoder to handle NumPy arrays
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)

app.json_encoder = NumpyEncoder

def update_config(d, u):
    """
    Recursively update a dictionary.
    """
    for k, v in u.items():
        if isinstance(v, collections.abc.Mapping):
            d[k] = update_config(d.get(k, {}), v)
        else:
            d[k] = v
    return d

@app.route('/simulate', methods=['POST'])
def simulate():
    """
    Runs a simulation with parameters from the request body.
    The request body should be a JSON object with the same structure as the default config.
    """
    try:
        # Get the default configuration
        config = get_default_config()

        # Get parameters from the request
        params = request.get_json()
        if not params:
            return jsonify({"error": "Invalid request: no JSON body found"}), 400

        # Update the config with provided parameters
        config = update_config(config, params)

        # Create and run the simulator
        simulator = Simulator(config)
        simulator.run()

        # Return the results
        return jsonify(simulator.history)

    except KeyError as e:
        return jsonify({"error": f"Invalid parameter provided: {e}"}), 400
    except Exception as e:
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)
