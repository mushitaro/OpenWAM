# Main script to run the engine simulation.
from engine_simulator import config
from engine_simulator.components import EngineBlock, Valve
from engine_simulator.gas_dynamics import Pipe
from engine_simulator.thermo import Air

class Simulator:
    def __init__(self, config):
        print("Initializing simulator...")
        self.config = config
        self._setup_components()

    def _setup_components(self):
        """
        Creates and connects all the components based on the config.
        """
        print("Setting up components...")
        self.engine_block = EngineBlock(self.config['engine'])

        # In a real simulation, we would create pipes, valves, etc.
        # and connect them using boundary condition objects.
        # For this initial implementation, we will keep it simple.
        print("Components set up.")

    def run(self):
        """
        Executes the main simulation loop.
        """
        print("Starting simulation run...")
        # The main loop would go here, stepping through crank angle
        # and calling update() on each component.
        for i in range(self.config['simulation']['num_cycles'] * 360 * 2): # 0.5 degree steps
            crank_angle = i * 0.5
            # self.engine_block.update(crank_angle)
            # self.pipe1.update(...)
            pass

        print("Simulation finished.")
        # self.engine_block.calculate_performance()


if __name__ == "__main__":
    sim_config = config.get_default_config()
    simulator = Simulator(sim_config)
    simulator.run()
    print("Simulator execution complete.")
