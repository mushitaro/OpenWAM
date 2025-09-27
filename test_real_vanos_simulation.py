#!/usr/bin/env python3
# 実測VANOSデータを使ったシミュレーションテスト

from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
import numpy as np

def test_real_vanos_simulation():
    print('=== Real VANOS Simulation Test ===')
    
    simulator = BMWE46M3Simulator()
    
    # 実測データに基づくテストケース
    test_cases = [
        {'rpm': 1000, 'load': 20, 'desc': 'Low RPM, Light Load'},
        {'rpm': 3000, 'load': 50, 'desc': 'Mid RPM, Medium Load'},
        {'rpm': 5000, 'load': 75, 'desc': 'High RPM, Heavy Load'},
        {'rpm': 7000, 'load': 90, 'desc': 'High RPM, Full Load'}
    ]
    
    print('\nReal VANOS Table Results:')
    print('RPM\tLoad%\tIntake°\tExhaust°\tVE\tAir Mass(g)\tDescription')
    print('-' * 80)
    
    for case in test_cases:
        # 実測VANOSテーブルを使用してシミュレーション
        history = simulator.run_simulation(
            rpm=case['rpm'], 
            load=case['load'], 
            vanos_modifications=None  # 実測テーブルをそのまま使用
        )
        
        # 最後のサイクルの平均値を計算
        last_cycle_start = len(history['crank_angle']) - int(720 / simulator.config['simulation']['crank_angle_step'])
        
        avg_ve = np.mean(history['volumetric_efficiency'][last_cycle_start:])
        avg_air_mass = np.mean(history['air_mass_trapped'][last_cycle_start:])
        intake_vanos = history['intake_vanos_angle'][-1]
        exhaust_vanos = history['exhaust_vanos_angle'][-1]
        
        print(f"{case['rpm']}\t{case['load']}%\t{intake_vanos:.1f}°\t{exhaust_vanos:.1f}°\t{avg_ve:.3f}\t{avg_air_mass*1000:.2f}g\t{case['desc']}")
    
    # VANOS変更の効果をテスト
    print('\n=== VANOS Modification Effects ===')
    
    base_rpm = 4000
    base_load = 60
    
    # ベースライン（実測テーブル）
    base_history = simulator.run_simulation(base_rpm, base_load, None)
    base_cycle_start = len(base_history['crank_angle']) - int(720 / simulator.config['simulation']['crank_angle_step'])
    base_ve = np.mean(base_history['volumetric_efficiency'][base_cycle_start:])
    base_air_mass = np.mean(base_history['air_mass_trapped'][base_cycle_start:])
    base_intake = base_history['intake_vanos_angle'][-1]
    base_exhaust = base_history['exhaust_vanos_angle'][-1]
    
    print(f"Baseline (Real Table): Intake {base_intake:.1f}°, Exhaust {base_exhaust:.1f}°, VE {base_ve:.3f}, Air {base_air_mass*1000:.2f}g")
    
    # 変更テスト
    modifications = [
        {'name': '+10° Intake', 'changes': {'intake': 10}},
        {'name': '-10° Intake', 'changes': {'intake': -10}},
        {'name': '+10° Exhaust', 'changes': {'exhaust': 10}},
        {'name': '-10° Exhaust', 'changes': {'exhaust': -10}}
    ]
    
    for mod in modifications:
        mod_history = simulator.run_simulation(base_rpm, base_load, mod['changes'])
        mod_cycle_start = len(mod_history['crank_angle']) - int(720 / simulator.config['simulation']['crank_angle_step'])
        mod_ve = np.mean(mod_history['volumetric_efficiency'][mod_cycle_start:])
        mod_air_mass = np.mean(mod_history['air_mass_trapped'][mod_cycle_start:])
        mod_intake = mod_history['intake_vanos_angle'][-1]
        mod_exhaust = mod_history['exhaust_vanos_angle'][-1]
        
        ve_change = ((mod_ve - base_ve) / base_ve) * 100
        air_change = (mod_air_mass - base_air_mass) * 1000
        
        print(f"{mod['name']:15}: Intake {mod_intake:.1f}°, Exhaust {mod_exhaust:.1f}°, VE {mod_ve:.3f} ({ve_change:+.1f}%), Air {mod_air_mass*1000:.2f}g ({air_change:+.2f}g)")

if __name__ == '__main__':
    test_real_vanos_simulation()