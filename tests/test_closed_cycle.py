# Test for the closed-cycle (motoring) simulation.

import sys
import os
import numpy as np
import pytest

# Add the parent directory to the path to allow imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from engine_simulator.main import Simulator
from engine_simulator.config import get_default_config
from engine_simulator.thermo import Air

def test_isentropic_compression_expansion():
    """
    Tests that the closed-cycle simulation follows the isentropic relationship
    P * V^gamma = constant.
    """
    print("Running test: test_isentropic_compression_expansion")

    config = get_default_config()
    config['engine']['combustion']['enabled'] = False # This is a closed-cycle test
    # Run for just one cycle to keep it fast
    config['simulation']['num_cycles'] = 1

    simulator = Simulator(config)
    simulator.run()

    history = simulator.history
    P = np.array(history['pressure'])
    V = np.array(history['volume'])
    gamma = Air.gamma

    # Calculate P * V^gamma for each step
    pv_gamma = P * (V**gamma)

    # The first few steps might be noisy due to initialization,
    # so we'll check the relationship after the first 10% of the cycle.
    start_index = len(pv_gamma) // 10

    # Check that the standard deviation of P*V^gamma is small relative to the mean
    # This is a good way to check for constancy without being sensitive to the absolute value.
    mean_pv_gamma = np.mean(pv_gamma[start_index:])
    std_dev_pv_gamma = np.std(pv_gamma[start_index:])

    print(f"Mean of P*V^gamma: {mean_pv_gamma}")
    print(f"Std dev of P*V^gamma: {std_dev_pv_gamma}")

    # Allow for a small relative standard deviation (e.g., < 1%) to account for numerical errors.
    relative_std_dev = std_dev_pv_gamma / mean_pv_gamma
    print(f"Relative Std Dev: {relative_std_dev}")

    assert relative_std_dev < 0.02, "P*V^gamma is not constant, the process is not isentropic."

if __name__ == "__main__":
    # This allows running the test directly and plotting the results for visual inspection.
    try:
        import matplotlib.pyplot as plt

        config = get_default_config()
        config['simulation']['num_cycles'] = 2
        simulator = Simulator(config)
        simulator.run()

        history = simulator.history

        plt.figure()
        plt.plot(history['volume'], history['pressure'])
        plt.xlabel("Volume (m^3)")
        plt.ylabel("Pressure (Pa)")
        plt.title("P-V Diagram (Motoring Cycle)")
        plt.grid(True)

        # Save the plot to a file
        output_path = "pv_diagram.png"
        plt.savefig(output_path)
        print(f"P-V diagram saved to {output_path}")

    except ImportError:
        print("Matplotlib not found. Skipping plot generation.")
        print("Please install it using: pip install matplotlib")

    # Also run the pytest assertion
    test_isentropic_compression_expansion()
