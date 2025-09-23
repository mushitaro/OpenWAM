# Main script to run the engine simulation.
from engine_simulator import config
from engine_simulator.components import EngineBlock, Valve
from engine_simulator.gas_dynamics import Pipe
from engine_simulator.thermo import Air

class Simulator:
    def __init__(self, config):
        print("Initializing simulator...")
        self.config = config
        self.history = {'crank_angle': [], 'pressure': [], 'volume': []}
        self._setup_components()

    def _setup_components(self):
        """
        Creates and connects all the components based on the config.
        """
        print("Setting up components...")
        self.engine_block = EngineBlock(self.config)
        # For now, we only have one cylinder
        self.cylinder = self.engine_block.cylinders[0]

        # In a real simulation, we would create pipes, valves, etc.
        # and connect them using boundary condition objects.
        # For this initial implementation, we will keep it simple.
        print("Components set up.")

    def run(self):
        """
        Executes the main simulation loop.
        """
        print("Starting simulation run...")

        rpm = self.config['engine']['rpm']
        d_theta_deg = 0.5  # Crank angle step in degrees

        # Calculate time step based on engine speed
        # dt = d_theta_deg / (rpm * 360 deg/rev * 1 min/60s)
        dt = d_theta_deg / (rpm * 6.0)

        num_steps = int(self.config['simulation']['num_cycles'] * 720 / d_theta_deg)

        for i in range(num_steps):
            crank_angle = i * d_theta_deg

            # Update the cylinder state
            self.cylinder.update(crank_angle, d_theta_deg, dt)

            # Log data
            self.history['crank_angle'].append(crank_angle)
            self.history['pressure'].append(self.cylinder.state['P'])
            self.history['volume'].append(self.cylinder.get_volume(crank_angle))

        print("Simulation finished.")
        # self.engine_block.calculate_performance()


if __name__ == "__main__":
    sim_config = config.get_default_config()
    simulator = Simulator(sim_config)
    simulator.run()
    print("Simulator execution complete.")
