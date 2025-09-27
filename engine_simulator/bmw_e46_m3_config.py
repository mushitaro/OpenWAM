# BMW E46 M3 (S54 Engine) specific configuration
import numpy as np

def get_bmw_e46_m3_config():
    """
    BMW E46 M3 S54エンジンの設定
    - 直列6気筒
    - 排気量: 3.2L
    - ボア: 87mm
    - ストローク: 91mm
    - 圧縮比: 11.5:1
    - VANOS: インテーク・エキゾースト両方
    """
    
    config = {
        'engine': {
            'name': 'BMW S54 (E46 M3)',
            'cylinders': 6,
            'bore': 0.087,  # 87mm
            'stroke': 0.091,  # 91mm
            'connecting_rod_length': 0.135,  # 135mm (推定)
            'compression_ratio': 11.5,
            'displacement': 3.246,  # L
            'rpm': 3000,  # デフォルト回転数
            'firing_order': [1, 5, 3, 6, 2, 4]
        },
        
        'vanos': {
            # インテークVANOS設定（DME制御パラメータ）
            'intake': {
                'enabled': True,
                'max_advance': 130,  # 最大進角 (度)
                'max_retard': 70,    # 最大遅角 (度)
                # RPM軸（DME制御ポイント）
                'rpm_points': [600, 900, 1100, 1400, 1600, 1800, 2200, 2700, 2900, 3100, 4000, 5000, 5800, 6800, 7000, 7800],
                # TPS軸（DME制御ポイント、スロットル開度 %）
                'load_points': [0.15, 0.40, 0.80, 1.20, 1.60, 2.40, 4.80, 7.60, 11.00, 15.00, 20.00, 25.00, 30.00, 45.00, 65.00, 85.00],
                # DME制御VANOSマップ (進角値、クランク角度)
                'advance_map': [
                    [130, 130, 130, 130, 130, 130, 130, 130, 130, 130, 130, 130, 120, 120, 120, 120],  # 0.15
                    [130, 130, 130, 130, 130, 130, 130, 130, 130, 130, 130, 130, 120, 120, 120, 120],  # 0.40
                    [125, 120, 120, 120, 130, 130, 130, 130, 130, 130, 130, 130, 120, 120, 120, 120],  # 0.80
                    [120, 120, 120, 120, 125, 125, 125, 125, 125, 125, 130, 130, 120, 120, 120, 120],  # 1.20
                    [115, 115, 115, 115, 117, 120, 120, 120, 120, 120, 125, 120, 120, 120, 120, 120],  # 1.60
                    [110, 115, 115, 115, 110, 115, 115, 115, 115, 115, 120, 115, 115, 115, 120, 120],  # 2.40
                    [105, 110, 110, 110, 105, 110, 110, 110, 110, 110, 115, 110, 110, 115, 115, 120],  # 4.80
                    [100, 105, 105, 105, 100, 105, 105, 105, 105, 105, 105, 105, 105, 110, 110, 120],  # 7.60
                    [94, 100, 105, 100, 95, 100, 100, 100, 100, 100, 100, 100, 105, 110, 110, 120],   # 11.00
                    [88, 97, 105, 94, 95, 95, 95, 95, 100, 100, 100, 100, 100, 110, 110, 120],        # 15.00
                    [82, 97, 100, 89, 89, 90, 90, 90, 95, 95, 95, 95, 100, 110, 110, 120],            # 20.00
                    [76, 97, 95, 84, 82, 85, 85, 85, 90, 90, 90, 95, 100, 110, 110, 120],             # 25.00
                    [76, 97, 95, 79, 75, 80, 80, 85, 85, 85, 85, 90, 100, 110, 110, 120],             # 30.00
                    [76, 97, 97, 70, 70, 75, 75, 80, 85, 78, 78, 88, 98, 111, 111, 120],              # 45.00
                    [76, 97, 97, 70, 70, 75, 75, 80, 80, 70, 70, 88, 96, 111, 111, 120],              # 65.00
                    [76, 97, 97, 70, 70, 75, 75, 80, 80, 70, 70, 88, 96, 111, 111, 120]               # 85.00
                ]
            },
            
            # エキゾーストVANOS設定（DME制御パラメータ）
            'exhaust': {
                'enabled': True,
                'max_advance': 52,   # 最大進角 (度)
                'max_retard': 97,    # 最大遅角 (度)
                # RPM軸（エキゾースト専用、DME制御ポイント）
                'rpm_points': [900, 1300, 2100, 2400, 2700, 2900, 3000, 3100, 3800, 4500, 5400, 6200, 6400, 7200, 7400, 7800],
                # TPS軸（インテークと同じ、スロットル開度 %）
                'load_points': [0.15, 0.40, 0.80, 1.20, 1.60, 2.40, 4.80, 7.60, 11.00, 15.00, 20.00, 25.00, 30.00, 45.00, 65.00, 85.00],
                # DME制御VANOSマップ (遅角値、クランク角度) - エキゾースト専用RPMポイント
                'retard_map': [
                    [52, 52, 52, 52, 52, 52, 52, 72, 72, 72, 72, 72, 72, 72, 72, 72],  # 0.15
                    [57, 52, 57, 64, 64, 64, 64, 72, 72, 72, 72, 72, 72, 72, 72, 72],  # 0.40
                    [62, 72, 77, 77, 72, 72, 69, 72, 72, 72, 72, 72, 72, 72, 72, 72],  # 0.80
                    [67, 82, 82, 82, 77, 77, 77, 72, 72, 72, 72, 72, 72, 72, 72, 72],  # 1.20
                    [72, 82, 82, 82, 82, 82, 84, 72, 72, 72, 72, 72, 77, 77, 77, 77],  # 1.60
                    [77, 82, 87, 87, 87, 87, 89, 77, 77, 77, 77, 77, 77, 77, 77, 77],  # 2.40
                    [80, 87, 92, 92, 87, 87, 89, 77, 82, 82, 82, 82, 82, 82, 82, 82],  # 4.80
                    [80, 87, 92, 92, 87, 92, 92, 82, 87, 82, 82, 82, 82, 82, 82, 82],  # 7.60
                    [80, 87, 97, 92, 87, 92, 92, 82, 87, 82, 82, 82, 82, 82, 82, 82],  # 11.00
                    [80, 87, 97, 92, 87, 92, 92, 82, 82, 82, 77, 77, 77, 77, 77, 77],  # 15.00
                    [80, 87, 97, 92, 87, 87, 92, 82, 82, 82, 77, 77, 77, 77, 77, 77],  # 20.00
                    [80, 92, 97, 92, 87, 87, 92, 82, 82, 77, 77, 77, 77, 77, 77, 77],  # 25.00
                    [80, 97, 97, 92, 87, 87, 93, 79, 80, 77, 72, 72, 72, 73, 73, 73],  # 30.00
                    [80, 97, 97, 90, 87, 87, 93, 76, 75, 75, 72, 72, 72, 73, 73, 73],  # 45.00
                    [80, 97, 97, 87, 87, 87, 93, 76, 75, 72, 72, 69, 69, 73, 73, 73],  # 65.00
                    [80, 97, 97, 87, 87, 87, 93, 76, 75, 72, 72, 69, 69, 73, 73, 73]   # 85.00
                ]
            }
        },
        
        'valves': {
            'intake': {
                'diameter': 0.0335,  # 33.5mm
                'max_lift': 0.0118,  # 11.8mm（BMW S54実測値）
                'duration': 260,     # 260°開度期間
                # バルブリフトプロファイル (角度 vs リフト)
                'lift_profile_angles': np.linspace(-130, 130, 261),  # 260°期間
                'lift_profile_values': None  # 後で計算
            },
            'exhaust': {
                'diameter': 0.029,   # 29mm
                'max_lift': 0.0118,  # 11.8mm（BMW S54実測値）
                'duration': 260,     # 260°開度期間
                # バルブリフトプロファイル
                'lift_profile_angles': np.linspace(-130, 130, 261),  # 260°期間
                'lift_profile_values': None  # 後で計算
            }
        },
        
        'simulation': {
            'num_cycles': 10,
            'crank_angle_step': 0.5,  # 度
            'ambient_pressure': 101325,  # Pa
            'ambient_temperature': 298,  # K
        },
        
        'fuel': {
            'mass_per_cycle': 0.00015,  # kg (推定)
            'heating_value': 44000000,  # J/kg
            'air_fuel_ratio': 14.7
        }
    }
    
    # バルブリフトプロファイルを生成
    config = _generate_valve_lift_profiles(config)
    
    return config

def _generate_valve_lift_profiles(config):
    """
    BMW S54エンジンのバルブリフトプロファイルを生成
    最大リフト: 11.8mm、開度期間: 260°、sin関数ベース
    """
    # インテークバルブ
    intake_angles = config['valves']['intake']['lift_profile_angles']
    max_lift_intake = config['valves']['intake']['max_lift']  # 11.8mm
    
    # sin関数ベースのリフトプロファイル（260°期間）
    intake_lift = []
    for angle in intake_angles:
        # -130°～130°の範囲を0～πにマッピング
        normalized_angle = (angle + 130) / 260 * np.pi
        if 0 <= normalized_angle <= np.pi:
            lift = max_lift_intake * np.sin(normalized_angle)
        else:
            lift = 0
        intake_lift.append(max(0, lift))
    
    config['valves']['intake']['lift_profile_values'] = np.array(intake_lift)
    
    # エキゾーストバルブ（同じプロファイル）
    exhaust_angles = config['valves']['exhaust']['lift_profile_angles']
    max_lift_exhaust = config['valves']['exhaust']['max_lift']  # 11.8mm
    
    exhaust_lift = []
    for angle in exhaust_angles:
        # -130°～130°の範囲を0～πにマッピング
        normalized_angle = (angle + 130) / 260 * np.pi
        if 0 <= normalized_angle <= np.pi:
            lift = max_lift_exhaust * np.sin(normalized_angle)
        else:
            lift = 0
        exhaust_lift.append(max(0, lift))
    
    config['valves']['exhaust']['lift_profile_values'] = np.array(exhaust_lift)
    
    return config

def interpolate_vanos_angle(rpm, load_percent, vanos_config):
    """
    RPMとTPS（スロットル開度）からVANOS角度を補間
    rpm: エンジン回転数 (rpm)
    load_percent: スロットル開度 (TPS %) - DME制御テーブルの負荷軸に対応
    """
    rpm_points = np.array(vanos_config['rpm_points'])
    tps_points = np.array(vanos_config['load_points'])  # これはTPS (%)
    
    if 'advance_map' in vanos_config:
        angle_map = np.array(vanos_config['advance_map'])
    else:
        angle_map = np.array(vanos_config['retard_map'])
    
    # 2D補間（新しいSciPy対応）
    from scipy.interpolate import RegularGridInterpolator
    
    # RegularGridInterpolatorは(rpm, tps)の順序で期待する
    f = RegularGridInterpolator((rpm_points, tps_points), angle_map, 
                               method='linear', bounds_error=False, fill_value=None)
    
    # 範囲外の値をクランプ
    rpm_clamped = max(rpm_points[0], min(rpm_points[-1], rpm))
    tps_clamped = max(tps_points[0], min(tps_points[-1], load_percent))
    
    return float(f([rpm_clamped, tps_clamped]))