#!/usr/bin/env python3
"""
バルブ設定の修正をテスト
"""

from engine_simulator.bmw_e46_m3_config import get_bmw_e46_m3_config
import numpy as np

def test_valve_config():
    """バルブ設定をテスト"""
    config = get_bmw_e46_m3_config()
    
    print('=== BMW S54 Valve Configuration Test ===')
    
    # インテークバルブ
    intake_valve = config['valves']['intake']
    print(f'\nIntake Valve:')
    print(f'  Diameter: {intake_valve["diameter"]*1000:.1f}mm')
    print(f'  Max Lift: {intake_valve["max_lift"]*1000:.1f}mm')
    print(f'  Duration: {intake_valve["duration"]}°')
    print(f'  Lift Profile Points: {len(intake_valve["lift_profile_values"])}')
    print(f'  Max Lift in Profile: {np.max(intake_valve["lift_profile_values"])*1000:.1f}mm')
    print(f'  Angle Range: {intake_valve["lift_profile_angles"][0]:.1f}° to {intake_valve["lift_profile_angles"][-1]:.1f}°')
    
    # エキゾーストバルブ
    exhaust_valve = config['valves']['exhaust']
    print(f'\nExhaust Valve:')
    print(f'  Diameter: {exhaust_valve["diameter"]*1000:.1f}mm')
    print(f'  Max Lift: {exhaust_valve["max_lift"]*1000:.1f}mm')
    print(f'  Duration: {exhaust_valve["duration"]}°')
    print(f'  Lift Profile Points: {len(exhaust_valve["lift_profile_values"])}')
    print(f'  Max Lift in Profile: {np.max(exhaust_valve["lift_profile_values"])*1000:.1f}mm')
    print(f'  Angle Range: {exhaust_valve["lift_profile_angles"][0]:.1f}° to {exhaust_valve["lift_profile_angles"][-1]:.1f}°')
    
    # リフトプロファイルの確認
    print(f'\n=== Lift Profile Sample (Intake) ===')
    angles = intake_valve["lift_profile_angles"]
    lifts = intake_valve["lift_profile_values"]
    
    # 主要ポイントを表示
    key_indices = [0, len(angles)//4, len(angles)//2, 3*len(angles)//4, -1]
    for i in key_indices:
        print(f'  Angle {angles[i]:6.1f}°: Lift {lifts[i]*1000:5.2f}mm')
    
    return True

if __name__ == "__main__":
    test_valve_config()