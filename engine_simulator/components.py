# Contains the core component classes for the engine simulation.

import numpy as np
from scipy.interpolate import interp1d
from . import thermo

class Valve:
    """
    Models an intake or exhaust valve.
    """
    def __init__(self, config):
        """
        Initializes the valve with lift and discharge coefficient profiles.

        Args:
            config (dict): A dictionary containing valve parameters.
        """
        self.diameter = config['diameter']

        # Create interpolators for lift and Cd
        self._lift_interpolator = interp1d(
            config['lift_profile']['angle'],
            config['lift_profile']['lift'],
            bounds_error=False,
            fill_value=0.0
        )
        self._cd_interpolator = interp1d(
            config['cd_profile']['lift'],
            config['cd_profile']['cd'],
            bounds_error=False,
            fill_value=0.0
        )

    def get_lift(self, crank_angle):
        return self._lift_interpolator(crank_angle)

    def get_cd(self, lift):
        return self._cd_interpolator(lift)

    def get_effective_area(self, crank_angle_deg):
        """
        Calculates the effective flow area of the valve.
        A_eff = A_curtain * Cd

        Args:
            crank_angle_deg (float): The current crank angle in degrees.

        Returns:
            float: The effective flow area in m^2.
        """
        lift = self.get_lift(crank_angle_deg)
        if lift <= 0:
            return 0.0

        cd = self.get_cd(lift)
        curtain_area = np.pi * self.diameter * lift
        return curtain_area * cd

class Cylinder:
    """
    Contains the in-cylinder thermodynamic model.
    """
    def __init__(self, config, engine_block):
        self.config = config
        self.engine_block = engine_block

        # Geometric parameters
        self.bore = config['bore']
        self.stroke = config['stroke']
        self.rod_length = config['rod_length']
        self.compression_ratio = config['compression_ratio']

        # Pre-calculate key geometric values
        self.crank_radius = self.stroke / 2.0
        self.area = (np.pi * self.bore**2) / 4.0
        self.swept_volume = self.area * self.stroke
        self.clearance_volume = self.swept_volume / (self.compression_ratio - 1.0)

        # Initial state
        self.state = {
            'P': 1.013e5,  # Pressure (Pa)
            'T': 293,      # Temperature (K)
            'mass': 0.001, # Mass of gas (kg)
            'composition': {'air': 1.0}
        }

    def get_volume(self, crank_angle_deg):
        """
        Calculates the instantaneous cylinder volume for a given crank angle.
        TDC (Top Dead Center) is at 0/360/720 degrees.

        Args:
            crank_angle_deg (float): The crank angle in degrees.

        Returns:
            float: The instantaneous cylinder volume in m^3.
        """
        theta = np.deg2rad(crank_angle_deg)
        l = self.rod_length
        r = self.crank_radius

        # Distance of piston from crank center
        s = r * np.cos(theta) + np.sqrt(l**2 - (r * np.sin(theta))**2)

        # Distance from TDC
        piston_displacement = (l + r) - s

        return self.clearance_volume + self.area * piston_displacement

    def update(self, crank_angle_deg, d_theta_deg, dt):
        """
        Updates the cylinder state for one time step.
        For now, this only implements the closed-cycle (isentropic) part.
        """
        # Get volume at the beginning and end of the step
        v1 = self.get_volume(crank_angle_deg)
        v2 = self.get_volume(crank_angle_deg + d_theta_deg)
        dV = v2 - v1

        # Get current state
        P1 = self.state['P']
        T1 = self.state['T']
        mass = self.state['mass']

        # Calculate work done (using pressure at the start of the step)
        dW = P1 * dV

        # First law: dU = dQ - dW. For isentropic, dQ = 0.
        # dU = mass * Cv * dT
        # So, dT = -dW / (mass * Cv)
        cv = thermo.Air.get_cv(T1)
        dT = -dW / (mass * cv)

        # Update state
        T2 = T1 + dT
        # Update pressure using ideal gas law P2 = m*R*T2/V2
        P2 = mass * thermo.Air.R * T2 / v2

        self.state['P'] = P2
        self.state['T'] = T2

class EngineBlock:
    """
    Represents the engine block, holding cylinders and global parameters.
    """
    def __init__(self, config):
        self.config = config
        # The main config dict is passed, so we access sub-dicts
        self.intake_valve = Valve(config['intake_valve'])
        self.exhaust_valve = Valve(config['exhaust_valve'])
        self.cylinders = [Cylinder(config['engine']['cylinder'], self) for _ in range(config['engine']['num_cylinders'])]

        # Performance metrics
        self.torque = 0
        self.power = 0
        self.imep = 0
        self.bsfc = 0

    def calculate_performance(self):
        # This method will calculate the final performance metrics.
        pass
