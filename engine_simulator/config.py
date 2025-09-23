# Contains the configuration for a simulation run.

import numpy as np

def get_default_config():
    """
    Returns a dictionary containing the default simulation parameters.
    """
    config = {
        'simulation': {
            'num_cycles': 10,
        },
        'engine': {
            'num_cylinders': 1,
            'rpm': 2000,
            'fuel': {
                'lhv': 44.0e6,  # J/kg
                'density': 750, # kg/m^3
                'efficiency': 0.98,
                'injected_mass_per_cycle': 20.0e-6 # kg
            },
            'cylinder': {
                'bore': 0.086,
                'stroke': 0.090,
                'rod_length': 0.150,
                'compression_ratio': 10.5,
            },
            'combustion': {
                # Wiebe function parameters
                'shape_param_m': 2.0,
                'duration_param_C': 5.0,
                'duration_angle': 60.0,
                'start_angle': -10.0,
            },
            'heat_transfer': {
                # Woschni model constants
                'woschni_c1': 2.28,
                'woschni_c2': 0.0,
                'coolant_temp': 363, # K
            }
        },
        'intake_valve': {
            'diameter': 0.035,
            'open_angle': -10,
            'close_angle': 210,
            'lift_profile': {
                'angle': np.linspace(0, 220, 23),
                'lift': 0.010 * np.sin(np.pi * np.linspace(0, 220, 23) / 220)
            },
            'cd_profile': {
                'lift': np.linspace(0, 0.010, 11),
                'cd': np.linspace(0.1, 0.6, 11) # Simplified linear profile
            }
        },
        'exhaust_valve': {
            'diameter': 0.032,
            'open_angle': 140,
            'close_angle': 370,
            'lift_profile': {
                'angle': np.linspace(0, 230, 24),
                'lift': 0.009 * np.sin(np.pi * np.linspace(0, 230, 24) / 230)
            },
            'cd_profile': {
                'lift': np.linspace(0, 0.009, 10),
                'cd': np.linspace(0.1, 0.65, 10) # Simplified linear profile
            }
        },
        'intake_pipe': {
            'length': 0.4,
            'diameter': 0.04,
            'num_cells': 20
        },
        'exhaust_pipe': {
            'length': 0.8,
            'diameter': 0.04,
            'num_cells': 40
        }
    }
    return config
