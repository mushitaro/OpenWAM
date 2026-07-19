
import os
import random
import json
import pandas as pd
import numpy as np

class MockDataGenerator:
    """
    Generates mock OpenWAM output files (AVG.DAT) for testing the calibration logic.
    Simulates:
    - Torque (ParEfectivo)
    - Power (Potencia)
    - Air Mass (MasaAdmision)
    - Fuel Mass (MasaFuel)
    - RPM (RegimenGiro)
    - VE (RendimientoVolumetrico)
    """
    def __init__(self, output_dir="CSL_Simulator", data_dir="backend/app/data"):
        self.output_dir = output_dir
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            
        # Load ECU Maps
        self.ecu_maps = None
        map_path = os.path.join(data_dir, "csl_ecu_maps.json")
        if os.path.exists(map_path):
            with open(map_path, "r", encoding="utf-8") as f:
                self.ecu_maps = json.load(f)
        else:
            print(f"Warning: ECU Maps not found at {map_path}")

    def get_stock_ve(self, rpm):
        """
        Interpolates stock VE from kf_rf_soll (Alpha-N) at 100% TPS (Last Row).
        """
        if not self.ecu_maps or "kf_rf_soll" not in self.ecu_maps:
             # No silent fabrication: the stock VE target must come from the real
             # MSS54 binary (kf_rf_soll). A previous synthetic Gaussian fallback
             # (0.85 + 0.15*exp(...)) masked missing data with a smooth curve that
             # did NOT match the real, peaky CSL target -- raise instead.
             raise RuntimeError(
                 "kf_rf_soll not loaded from csl_ecu_maps.json / binary; "
                 "cannot return stock VE (refusing to fabricate a curve).")

        map_data = self.ecu_maps["kf_rf_soll"]
        x_axis = map_data["x_axis"] # RPM
        # Assume 100% TPS is the last row for maximum VE
        # Check y_axis for 100.0 or largest value
        # In our json, y_axis last val is 100.00
        # values[last_index] is the row for 100% TPS
        
        ve_row = map_data["values"][-1] 
        
        # Linear Interpolation
        return np.interp(rpm, x_axis, ve_row)

    def _get_config_value(self, config, path, default=None):
        """
        Helper to access deeply nested config values from either Pydantic objects or Dicts.
        path: dot-separated string, e.g. "engine.combustion.duration"
        """
        if not config:
            return default
            
        keys = path.split('.')
        current = config
        
        for key in keys:
            if isinstance(current, dict):
                current = current.get(key)
            else:
                current = getattr(current, key, None)
            
            if current is None:
                return default
                
        return current

    def generate_avg_dat(self, model_name="test", rpm_range=(1000, 8000, 500), config=None):
        """
        Generates a {model_name}AVG.DAT file with mock data.
        """
        filename = f"{model_name}AVG.DAT"
        filepath = os.path.join(self.output_dir, filename)
        
        # Base Parameters
        peak_torque_rpm = 5000
        peak_ve_rpm = 5500
        ve_base = 0.85
        ve_peak_add = 0.15
        
        # Apply Modifiers
        if config:
            # V4.0 Model Access (Robust)
            cam_profile = self._get_config_value(config, "engine.cam_profile", "")
            intake_type = self._get_config_value(config, "intake.type", "")
            exhaust_type = self._get_config_value(config, "exhaust.headers.type", "")
            
            if "Schrick 288" in cam_profile:
                peak_torque_rpm += 500
                peak_ve_rpm += 600
                ve_peak_add += 0.10 # Significantly higher peak flow (0.15 -> 0.25)
                ve_base -= 0.05 # Lopey idle / loss of low end
                
            elif "Schrick 280" in cam_profile:
                peak_torque_rpm += 300
                peak_ve_rpm += 300
                ve_peak_add += 0.03
                
            if "Velocity Stacks" in intake_type or "CSL" in intake_type:
                # Better high end flow, slightly worse low end velocity
                ve_peak_add += 0.02
                peak_ve_rpm += 100
                
            if "Supersprint" in exhaust_type:
                # General efficiency boost
                ve_base += 0.01 
                ve_peak_add += 0.01

        # Columns based on TBloqueMotor::ImprimeResultadosMediosBloqueMotor order
        # ParEfectivo, Potencia, MasaAdmision, MasaFuel, RegimenGiro, RendimientoVolumetrico
        
        data = []
        
        rpms = range(rpm_range[0], rpm_range[1] + 1, rpm_range[2])
        
        for rpm in rpms:
            # Fake Physics
            # Peak torque around peak_torque_rpm
            # Normalized RPM centered at 0
            norm_rpm = (rpm - 1000) / 7000 * np.pi
            
            # Shift phase based on peak_torque_rpm difference from generic 5000
            phase_shift = (peak_torque_rpm - 5000) / 3500 
            
            # Simple sine wave approx
            torque_curve = 300 + 50 * np.sin(norm_rpm - phase_shift) 
            torque = torque_curve + random.uniform(-2, 2)
            
            # Power = Torque * RPM / 9549
            power = torque * rpm / 9549
            
            # VE Curve: Use Stock Map Baseline + Modifiers
            if self.ecu_maps:
                # Get base from map (interpolate 100% TPS)
                ve_base_map = self.get_stock_ve(rpm)
                
                # Hardware Modifiers
                boost = 0.0
                ideal_intake_vanos_offset = 0.0 # deg relative to stock map
                
                if config:
                    cam_profile = self._get_config_value(config, "engine.cam_profile", "")
                    intake_type = self._get_config_value(config, "intake.type", "")
                    
                    if "Schrick 288" in cam_profile:
                        # Schrick 288 needs more advance/overlap to work well
                        ve_peak_add = 0.25 # Derived from previous step
                        # Say ideally we want +5 degrees intake advance at high RPM compared to stock
                        ideal_intake_vanos_offset = 5.0 
                        
                        boost += (ve_peak_add - 0.15) # Relative to stock's 0.15 param

                    elif "Velocity Stacks" in intake_type:
                        boost += 0.02

                # VANOS Sensitivity Logic
                # The simulation "config" can now contain specific VANOS offsets for optimization checking
                # vanos_intake_bias: float (degrees to add to map)
                vanos_intake_bias = float(self._get_config_value(config, "engine.vanos_intake_bias", 0.0))
                
                # Calculate distance from "Ideal"
                # If we are effectively at (StockMap + Bias) and we WANT (StockMap + IdealOffset)
                # The delta is Bias - IdealOffset
                # Perfect tune: Bias = IdealOffset
                delta_vanos = vanos_intake_bias - ideal_intake_vanos_offset
                
                # Penalty: Gaussian dropoff if VANOS is wrong
                # sigma = 10 degrees. If you are 10 deg off, you lose efficiency.
                vanos_efficiency = np.exp(-(delta_vanos**2) / (10**2))
                
                # Apply VANOS efficiency to the Boosted VE
                # If wrong VANOS, we lose some of the Hardware Potential, but maybe not all base VE
                # Let's say it affects the total air mass efficiency
                
                ve_curve = (ve_base_map + boost) * vanos_efficiency

            else:
                # Fallback to Gaussian
                 ve_curve = ve_base + ve_peak_add * np.exp(-((rpm - peak_ve_rpm)**2) / (2000**2))

            ve = ve_curve + random.uniform(-0.005, 0.005)
            
            # Air Mass ~ VE * Displacement * Density * RPM/2
            # Simplified: just proportional to VE * RPM
            air_mass = ve * rpm * 0.0005 
            
            # Fuel (AFR ~ 12.5-13.0)
            fuel_mass = air_mass / 12.8
            
            # Column Order: 
            # Torque(Nm), Power(kW), AirMass(kg/s?), FuelMass(kg/s?), RPM(rpm), VE(0-1)
            # Units in OpenWAM output map be specific, checking TBloqueMotor:
            # PotenciaMED is converted to kW (To_kilo)
            # Weights are usually kg/cycle or kg/s? TBloqueMotor uses "MasaAdmisionMED"
            # It sums "getMasaPorAdmision()" (kg/cycle) then averages.
            # So it's kg/cycle.
            
            row = [
                f"{torque:.4f}",       # ParEfectivo
                f"{power:.4f}",        # Potencia
                f"{air_mass:.6f}",     # MasaAdmision
                f"{fuel_mass:.6f}",    # MasaFuel
                f"{float(rpm):.2f}",   # RegimenGiro
                f"{ve:.4f}"            # RendimientoVolumetrico
            ]
            # OpenWAM writes a leading tab for data rows too (TBloqueMotor lines 929+)
            data.append("\t" + "\t".join(row))
            
        with open(filepath, "w") as f:
            # OpenWAM writes labels first?
            # TBloqueMotor::HeaderAverageResultsBloqueMotor
            # \tEff. Torque (Nm)\tPower (kW)\tAir Mass (kg)\tInd. Fuel Mass (kg)\tEngine Speed (rpm)\tVol. Eff.
            headers = [
                "Eff. Torque (Nm)", "Power (kW)", "Air Mass (kg)", 
                "Ind. Fuel Mass (kg)", "Engine Speed (rpm)", "Vol. Eff."
            ]
            f.write("\t" + "\t".join(headers) + "\n")
            f.write("\n".join(data))
            
        print(f"Generated mock data at {filepath}")
        return filepath

if __name__ == "__main__":
    generator = MockDataGenerator()
    generator.generate_avg_dat()
