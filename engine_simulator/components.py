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
    Contains the in-cylinder thermodynamic model with VANOS support.
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

        # VANOS parameters
        self.current_intake_vanos = 0.0  # Current intake VANOS angle (degrees)
        self.current_exhaust_vanos = 0.0  # Current exhaust VANOS angle (degrees)
        
        # Initial state
        self.state = {
            'P': 1.013e5,  # Pressure (Pa)
            'T': 293,      # Temperature (K)
            'mass': 0.001, # Mass of gas (kg)
            'composition': {'air': 1.0},
            'burned_fraction': 0.0,
            'air_mass_trapped': 0.0,  # For volumetric efficiency calculation
            'volumetric_efficiency': 0.8  # Current VE
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

    def update_vanos_angles(self, rpm, load):
        """
        Update VANOS angles based on current RPM and load.
        """
        if hasattr(self.engine_block.config, 'vanos'):
            vanos_config = self.engine_block.config['vanos']
            
            if vanos_config['intake']['enabled']:
                self.current_intake_vanos = self._interpolate_vanos_angle(
                    rpm, load, vanos_config['intake']
                )
            
            if vanos_config['exhaust']['enabled']:
                self.current_exhaust_vanos = self._interpolate_vanos_angle(
                    rpm, load, vanos_config['exhaust']
                )

    def _interpolate_vanos_angle(self, rpm, load, vanos_config):
        """
        Interpolate VANOS angle from RPM and load.
        """
        rpm_points = np.array(vanos_config['rpm_points'])
        load_points = np.array(vanos_config['load_points'])
        
        if 'advance_map' in vanos_config:
            angle_map = np.array(vanos_config['advance_map'])
        else:
            angle_map = np.array(vanos_config['retard_map'])
        
        # 2D interpolation using scipy (新しいバージョン対応)
        from scipy.interpolate import RegularGridInterpolator
        
        f = RegularGridInterpolator((rpm_points, load_points), angle_map, 
                                   method='linear', bounds_error=False, fill_value=None)
        
        # 範囲外の値をクランプ
        rpm_clamped = max(rpm_points[0], min(rpm_points[-1], rpm))
        load_clamped = max(load_points[0], min(load_points[-1], load))
        
        return float(f([rpm_clamped, load_clamped]))

    def get_effective_valve_timing(self, valve_type):
        """
        Get effective valve timing considering VANOS adjustment.
        BMW S54エンジン仕様: 最大リフト11.8mm、開度期間260°
        参考スクリプトに基づく正確な計算方式
        """
        valve_duration = 260.0  # BMW S54の実際のバルブ開度期間
        
        if valve_type == 'intake':
            # インテークVANOS角度はATDC（上死点後）でのバルブ全開角度
            # 参考スクリプトでは intakeMaxLiftAngle = intakeAngle (正の値)
            valve_max_lift_angle_atdc = self.current_intake_vanos
            
            # バルブ全開角度を中心に±130°の開度期間（260°）
            opening_angle = valve_max_lift_angle_atdc - valve_duration/2
            closing_angle = valve_max_lift_angle_atdc + valve_duration/2
            
            return opening_angle, closing_angle
        else:
            # エキゾーストVANOS角度はABDC（下死点後）でのバルブ全開角度
            # 参考スクリプトでは exhaustMaxLiftAngle = exhaustAngle (正の値だが、計算で負方向使用)
            valve_max_lift_angle_abdc = self.current_exhaust_vanos
            
            # エキゾーストは正の値のまま使用（参考スクリプトと同じ）
            # 計算時に direction で負方向に調整
            opening_angle = valve_max_lift_angle_abdc - valve_duration/2
            closing_angle = valve_max_lift_angle_abdc + valve_duration/2
            
            return opening_angle, closing_angle

    def calculate_volumetric_efficiency(self, crank_angle_deg, rpm=3000):
        """
        Calculate volumetric efficiency considering VANOS valve timing and RPM.
        BMW S54エンジンの実際の特性を考慮
        """
        intake_opening, intake_closing = self.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = self.get_effective_valve_timing('exhaust')
        
        # 実際のオーバーラップを計算（TDC付近での重複）
        # インテーク: -20°～240°, エキゾースト: -50°～210°
        # 実際のオーバーラップは-20°～15°程度（TDC付近）
        overlap = 35.0  # 固定値として設定（後でより正確な計算に置き換え可能）
        
        # RPMベースの体積効率カーブ（BMW S54エンジンの実際の特性）
        # S54は約5500-6000 RPMで最高体積効率を示す
        def rpm_ve_curve(rpm):
            """BMW S54エンジンのRPM vs 体積効率カーブ"""
            if rpm < 1000:
                return 0.65
            elif rpm < 2000:
                # 低RPM: 線形増加
                return 0.65 + 0.15 * (rpm - 1000) / 1000
            elif rpm < 4000:
                # 中低RPM: 緩やかな増加
                return 0.80 + 0.10 * (rpm - 2000) / 2000
            elif rpm < 6000:
                # 中高RPM: 最高効率に向けて増加
                return 0.90 + 0.05 * (rpm - 4000) / 2000
            elif rpm < 7000:
                # 高RPM: 最高効率付近
                return 0.95 - 0.02 * (rpm - 6000) / 1000
            else:
                # 超高RPM: 効率低下
                return 0.93 - 0.10 * (rpm - 7000) / 1000
        
        # RPMベースの基本体積効率
        base_ve = rpm_ve_curve(rpm)
        
        # VANOS timing factor (実測データ範囲に対応、RPM依存)
        # インテーク: RPMに応じた最適値
        if rpm < 3000:
            optimal_intake = 110.0  # 低RPMでは遅角が有利
        elif rpm < 5000:
            optimal_intake = 100.0  # 中RPMでは中間
        else:
            optimal_intake = 90.0   # 高RPMでは進角が有利
        
        intake_deviation = abs(self.current_intake_vanos - optimal_intake)
        intake_factor = 1.0 - 0.001 * intake_deviation
        
        # エキゾースト: RPMに応じた最適値
        if rpm < 3000:
            optimal_exhaust = 85.0  # 低RPMでは遅角が有利
        elif rpm < 5000:
            optimal_exhaust = 80.0  # 中RPMでは中間
        else:
            optimal_exhaust = 75.0  # 高RPMでは進角が有利
        
        exhaust_deviation = abs(self.current_exhaust_vanos - optimal_exhaust)
        exhaust_factor = 1.0 - 0.0005 * exhaust_deviation
        
        # オーバーラップ効果（RPM依存）
        if rpm < 3000:
            optimal_overlap = 15.0  # 低RPMでは少ないオーバーラップが有利
        elif rpm < 5000:
            optimal_overlap = 25.0  # 中RPMでは中程度
        else:
            optimal_overlap = 35.0  # 高RPMでは多いオーバーラップが有利
        
        overlap_deviation = abs(overlap - optimal_overlap)
        overlap_factor = 1.0 - 0.002 * overlap_deviation
        
        # 最終的な体積効率
        ve = base_ve * intake_factor * exhaust_factor * overlap_factor
        

        
        # 現実的な範囲に制限
        ve = max(0.60, min(0.98, ve))
        
        return ve

    def update(self, crank_angle_deg, d_theta_deg, dt, rpm=3000):
        """
        Updates the cylinder state for one time step with VANOS consideration.
        """
        # Get volume at the beginning and end of the step
        v1 = self.get_volume(crank_angle_deg)
        v2 = self.get_volume(crank_angle_deg + d_theta_deg)
        dV = v2 - v1

        # Get current state
        P1 = self.state['P']
        T1 = self.state['T']
        mass = self.state['mass']

        # Calculate volumetric efficiency with current VANOS settings and RPM
        ve = self.calculate_volumetric_efficiency(crank_angle_deg, rpm)
        self.state['volumetric_efficiency'] = ve
        
        # Calculate trapped air mass during intake stroke
        ca_cycle = crank_angle_deg % 720
        intake_opening, intake_closing = self.get_effective_valve_timing('intake')
        
        # Normalize angles to 0-720 range
        intake_opening_norm = (intake_opening + 720) % 720
        intake_closing_norm = (intake_closing + 720) % 720
        
        # Update trapped air mass at intake valve closing
        if abs(ca_cycle - intake_closing_norm) < 1.0:  # Near IVC
            # Ambient conditions
            R_air = 287  # J/kg·K
            ambient_pressure = 101325  # Pa
            ambient_temperature = 298  # K
            air_density = ambient_pressure / (R_air * ambient_temperature)
            
            # Theoretical air mass that could fill the swept volume
            theoretical_air_mass = air_density * self.swept_volume
            
            # Actual trapped air mass considering volumetric efficiency
            self.state['air_mass_trapped'] = theoretical_air_mass * ve
        
        # Maintain air mass trapped value throughout the cycle
        if not hasattr(self, '_last_air_mass_trapped'):
            self._last_air_mass_trapped = 0.0
        
        if self.state['air_mass_trapped'] > 0:
            self._last_air_mass_trapped = self.state['air_mass_trapped']
        else:
            self.state['air_mass_trapped'] = self._last_air_mass_trapped

        # Calculate work done (using pressure at the start of the step)
        dW = P1 * dV

        # Reset burned fraction at the start of a new combustion event
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
