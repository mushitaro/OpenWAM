#!/usr/bin/env python3
# 実測VANOSデータのテスト

from engine_simulator.bmw_e46_m3_config import get_bmw_e46_m3_config, interpolate_vanos_angle
import numpy as np

def test_real_vanos_data():
    print('=== Real VANOS Data Test ===')
    
    config = get_bmw_e46_m3_config()
    
    # テストケース
    test_cases = [
        {'rpm': 600, 'load': 10, 'desc': 'Idle'},
        {'rpm': 2000, 'load': 25, 'desc': 'Low RPM, Light Load'},
        {'rpm': 4000, 'load': 50, 'desc': 'Mid RPM, Medium Load'},
        {'rpm': 6000, 'load': 75, 'desc': 'High RPM, Heavy Load'},
        {'rpm': 7800, 'load': 100, 'desc': 'Redline, Full Load'}
    ]
    
    print('\nIntake VANOS (Advance):')
    print('RPM\tTPS%\tVANOS°\tDescription')
    print('-' * 40)
    
    for case in test_cases:
        intake_angle = interpolate_vanos_angle(case['rpm'], case['load'], config['vanos']['intake'])
        print(f"{case['rpm']}\t{case['load']}%\t{intake_angle:.1f}°\t{case['desc']}")
    
    print('\nExhaust VANOS (Retard):')
    print('RPM\tTPS%\tVANOS°\tDescription')
    print('-' * 40)
    
    for case in test_cases:
        exhaust_angle = interpolate_vanos_angle(case['rpm'], case['load'], config['vanos']['exhaust'])
        print(f"{case['rpm']}\t{case['load']}%\t{exhaust_angle:.1f}°\t{case['desc']}")
    
    # VANOS範囲の確認
    print('\n=== VANOS Range Analysis ===')
    
    rpm_range = np.linspace(600, 7800, 10)
    load_range = np.linspace(10, 100, 5)
    
    intake_min, intake_max = float('inf'), float('-inf')
    exhaust_min, exhaust_max = float('inf'), float('-inf')
    
    for rpm in rpm_range:
        for load in load_range:
            intake_angle = interpolate_vanos_angle(rpm, load, config['vanos']['intake'])
            exhaust_angle = interpolate_vanos_angle(rpm, load, config['vanos']['exhaust'])
            
            intake_min = min(intake_min, intake_angle)
            intake_max = max(intake_max, intake_angle)
            exhaust_min = min(exhaust_min, exhaust_angle)
            exhaust_max = max(exhaust_max, exhaust_angle)
    
    print(f'Intake VANOS Range: {intake_min:.1f}° to {intake_max:.1f}° (span: {intake_max-intake_min:.1f}°)')
    print(f'Exhaust VANOS Range: {exhaust_min:.1f}° to {exhaust_max:.1f}° (span: {exhaust_max-exhaust_min:.1f}°)')

if __name__ == '__main__':
    test_real_vanos_data()