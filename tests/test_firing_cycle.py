# Test for the firing cycle simulation.

import sys
import os
import numpy as np
import matplotlib.pyplot as plt

# Add the parent directory to the path to allow imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from engine_simulator.main import Simulator
from engine_simulator.config import get_default_config

def test_firing_cycle_visual():
    """
    Runs a firing cycle simulation and generates plots for visual validation.
    """
    print("Running test: test_firing_cycle_visual")

    config = get_default_config()
    config['simulation']['num_cycles'] = 4 # Run a few cycles to stabilize

    simulator = Simulator(config)
    simulator.run()

    history = simulator.history

    # --- P-V Diagram ---
    plt.figure(figsize=(10, 8))
    plt.plot(history['volume'], history['pressure'])
    plt.xlabel("Volume (m^3)")
    plt.ylabel("Pressure (Pa)")
    plt.title("P-V Diagram (Firing Cycle)")
    plt.grid(True)

    pv_output_path = "pv_diagram_firing.png"
    plt.savefig(pv_output_path)
    print(f"P-V diagram saved to {pv_output_path}")

    # --- Pressure vs. Crank Angle ---
    plt.figure(figsize=(12, 6))
    plt.plot(history['crank_angle'], history['pressure'])
    plt.xlabel("Crank Angle (degrees)")
    plt.ylabel("Pressure (Pa)")
    plt.title("Cylinder Pressure vs. Crank Angle")
    plt.grid(True)
    # Set x-axis limits to show two full cycles (1440 degrees)
    if len(history['crank_angle']) > 0:
        plt.xlim(0, 1440)

    pressure_output_path = "pressure_trace_firing.png"
    plt.savefig(pressure_output_path)
    print(f"Pressure trace saved to {pressure_output_path}")

    # Basic assertion to ensure the simulation ran
    assert len(history['pressure']) > 0
    # Check that peak pressure is significantly higher than initial pressure
    assert np.max(history['pressure']) > 5 * config['engine']['cylinder']['compression_ratio'] * 1.013e5

if __name__ == "__main__":
    test_firing_cycle_visual()
