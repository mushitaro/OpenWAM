# Basic smoke test to ensure the simulator can be initialized.

import sys
import os

# Add the parent directory to the path to allow imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from engine_simulator.main import Simulator
from engine_simulator.config import get_default_config

def test_simulator_initialization():
    """
    Tests that the Simulator class can be instantiated without errors.
    """
    print("Running smoke test: test_simulator_initialization")
    try:
        config = get_default_config()
        simulator = Simulator(config)
        assert simulator is not None
        print("Simulator initialized successfully.")
    except Exception as e:
        assert False, f"Simulator initialization failed: {e}"

if __name__ == "__main__":
    test_simulator_initialization()
    print("Smoke test passed.")
