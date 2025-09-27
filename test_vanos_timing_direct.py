#!/usr/bin/env python3
"""
VANOS値とバルブタイミングの関係を直接テスト
"""

from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
from engine_simulator.bmw_e46_m3_config import interpolate_vanos_angle, get_bmw_e46_m3_config

def test_vanos_timing_direct():
    """VANOS値とバルブタイミングの関係を直接テスト"""
    
    simulator = BMWE46M3Simulator()
    config = get_bmw_e46_m3_config()
    
    print('=== Direct VANOS Timing Test ===')
    
    test_rpms = [600, 1800, 3000, 5000, 7000]
    tps = 50
    
    for rpm in test_rpms:
        # VANOS角度を取得
        intake_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['intake'])
        exhaust_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['exhaust'])
        
        # シミュレーターに設定
        simulator.cylinder.current_intake_vanos = intake_vanos
        simulator.cylinder.current_exhaust_vanos = exhaust_vanos
        
        # バルブタイミングを計算
        intake_opening, intake_closing = simulator.cylinder.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = simulator.cylinder.get_effective_valve_timing('exhaust')
        
        print(f'\nRPM {rpm}:')
        print(f'  VANOS: Intake {intake_vanos:.1f}°, Exhaust {exhaust_vanos:.1f}°')
        print(f'  Intake Timing: {intake_opening:.1f}° ～ {intake_closing:.1f}° (Duration: {intake_closing - intake_opening:.1f}°)')
        print(f'  Exhaust Timing: {exhaust_opening:.1f}° ～ {exhaust_closing:.1f}° (Duration: {exhaust_closing - exhaust_opening:.1f}°)')

if __name__ == "__main__":
    test_vanos_timing_direct()