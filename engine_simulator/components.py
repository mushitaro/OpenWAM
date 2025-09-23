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

        # Combustion parameters
        self.comb_config = self.engine_block.config['engine']['combustion']
        self.fuel_config = self.engine_block.config['engine']['fuel']
        self.ht_config = self.engine_block.config['engine']['heat_transfer']

        # Initial state
        self.state = {
            'P': 1.013e5,  # Pressure (Pa)
            'T': 293,      # Temperature (K)
            'mass': 0.001, # Mass of gas (kg)
            'composition': {'air': 1.0},
            'burned_fraction': 0.0
        }

    def _calculate_combustion(self, crank_angle_deg):
        """
        Calculates the cumulative mass fraction burned using a Wiebe function.
        """
        if not self.comb_config['enabled']:
            return 0.0

        # Normalize crank angle to the current cycle (0-720 degrees)
        ca_cycle = crank_angle_deg % 720

        # Combustion starts relative to TDC of compression stroke (360 deg)
        ca_start_abs = 360.0 + self.comb_config['start_angle']
        ca_dur = self.comb_config['duration_angle']
        m = self.comb_config['shape_param_m']
        C = self.comb_config['duration_param_C']

        if ca_cycle < ca_start_abs:
            return 0.0

        # Normalize crank angle from start of combustion
        x = (ca_cycle - ca_start_abs) / ca_dur

        if x > 1.0:
            return 1.0

        burned_fraction = 1.0 - np.exp(-C * (x ** (m + 1)))
        return burned_fraction

    def _calculate_heat_loss(self, P, T, V, dt):
        """
        Calculates heat loss to the walls using the Woschni correlation.
        """
        # Mean piston speed
        mean_piston_speed = 2 * self.stroke * self.engine_block.config['engine']['rpm'] / 60.0

        # Woschni correlation for gas velocity
        # This is a simplified version; a full model would change C2 during combustion
        w = self.ht_config['woschni_c1'] * mean_piston_speed

        # Heat transfer coefficient
        h = 130 * (P**0.8) * (T**-0.53) * (w**0.8) * (self.bore**-0.2)

        # Exposed area (simplified: head + piston + liner area at this crank angle)
        # This is not fully accurate but a good starting point.
        exposed_liner_area = self.area * (self.get_volume(0) - self.get_volume(180)) / self.stroke
        A_wall = 2 * self.area + exposed_liner_area

        # Heat loss
        dQ_loss = h * A_wall * (T - self.ht_config['coolant_temp']) * dt
        return dQ_loss

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

        # Reset burned fraction at the start of a new combustion event
        ca_cycle = crank_angle_deg % 720
        # A bit before TDC compression
        if 340 < ca_cycle < 350 and self.state['burned_fraction'] > 0.5:
            self.state['burned_fraction'] = 0.0

        # Calculate heat release from combustion
        x_burned1 = self.state['burned_fraction']
        x_burned2 = self._calculate_combustion(crank_angle_deg + d_theta_deg)
        dx_burned = max(0, x_burned2 - x_burned1) # Ensure it doesn't go negative on cycle reset
        dQ_comb = dx_burned * self.fuel_config['injected_mass_per_cycle'] * self.fuel_config['lhv']

        # Calculate heat loss
        dQ_loss = 0.0 # self._calculate_heat_loss(P1, T1, v1, dt)

        # First law: dU = dQ_comb - dQ_loss - dW
        # dU = mass * Cv * dT
        cv = thermo.Air.get_cv(T1)
        dT = (dQ_comb - dW - dQ_loss) / (mass * cv)

        # Update state
        T2 = T1 + dT
        # Update pressure using ideal gas law P2 = m*R*T2/V2
        P2 = mass * thermo.Air.R * T2 / v2

        self.state['P'] = P2
        self.state['T'] = T2
        self.state['burned_fraction'] = x_burned2

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
