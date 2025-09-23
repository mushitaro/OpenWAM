# Contains helper functions and classes for thermodynamic calculations.

class Air:
    """
    A simple model for the thermodynamic properties of air.
    """
    gamma = 1.4
    R = 287.0  # J/kgK

    @staticmethod
    def get_cp(T):
        # In a real model, this would be a function of temperature.
        return 1005.0 # J/kgK

    @staticmethod
    def get_cv(T):
        return Air.get_cp(T) - Air.R
