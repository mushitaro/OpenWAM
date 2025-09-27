#!/usr/bin/env python3
"""
オーバーラップ計算のデバッグ
"""

from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
from engine_simulator.bmw_e46_m3_config import interpolate_vanos_angle, get_bmw_e46_m3_config

def debug_overlap_calculation():
    """オーバーラップ計算をデバッグ"""
    
    simulator = BMWE46M3Simulator()
    config = get_bmw_e46_m3_config()
    
    print('=== Overlap Calculation Debug ===')
    
    rpm = 600
    tps = 50
    
    # VANOS角度を取得
    intake_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['intake'])
    exhaust_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['exhaust'])
    
    # シミュレーターに設定
    simulator.cylinder.current_intake_vanos = intake_vanos
    simulator.cylinder.current_exhaust_vanos = exhaust_vanos
    
    # バルブタイミングを計算
    intake_opening, intake_closing = simulator.cylinder.get_effective_valve_timing('intake')
    exhaust_opening, exhaust_closing = simulator.cylinder.get_effective_valve_timing('exhaust')
    
    print(f'RPM {rpm}, TPS {tps}%:')
    print(f'  VANOS: Intake {intake_vanos:.1f}°, Exhaust {exhaust_vanos:.1f}°')
    print(f'  Raw Timing:')
    print(f'    Intake: {intake_opening:.1f}° ～ {intake_closing:.1f}°')
    print(f'    Exhaust: {exhaust_opening:.1f}° ～ {exhaust_closing:.1f}°')
    
    # 正規化
    def normalize_to_720(angle):
        while angle < 0:
            angle += 720
        while angle >= 720:
            angle -= 720
        return angle
    
    intake_open_norm = normalize_to_720(intake_opening)
    intake_close_norm = normalize_to_720(intake_closing)
    exhaust_open_norm = normalize_to_720(exhaust_opening)
    exhaust_close_norm = normalize_to_720(exhaust_closing)
    
    print(f'  Normalized (0-720°):')
    print(f'    Intake: {intake_open_norm:.1f}° ～ {intake_close_norm:.1f}°')
    print(f'    Exhaust: {exhaust_open_norm:.1f}° ～ {exhaust_close_norm:.1f}°')
    
    # 720°をまたぐかチェック
    intake_crosses = intake_open_norm > intake_close_norm
    exhaust_crosses = exhaust_open_norm > exhaust_close_norm
    
    print(f'  Crosses 720° boundary:')
    print(f'    Intake: {intake_crosses}')
    print(f'    Exhaust: {exhaust_crosses}')
    
    # 期間分割
    if intake_crosses:
        intake_periods = [(intake_open_norm, 720), (0, intake_close_norm)]
        print(f'    Intake periods: {intake_periods}')
    else:
        intake_periods = [(intake_open_norm, intake_close_norm)]
        print(f'    Intake periods: {intake_periods}')
    
    if exhaust_crosses:
        exhaust_periods = [(exhaust_open_norm, 720), (0, exhaust_close_norm)]
        print(f'    Exhaust periods: {exhaust_periods}')
    else:
        exhaust_periods = [(exhaust_open_norm, exhaust_close_norm)]
        print(f'    Exhaust periods: {exhaust_periods}')
    
    # オーバーラップ計算
    overlap_periods = []
    total_overlap_duration = 0
    
    print(f'  Overlap calculation:')
    for i, (intake_start, intake_end) in enumerate(intake_periods):
        for j, (exhaust_start, exhaust_end) in enumerate(exhaust_periods):
            overlap_start = max(intake_start, exhaust_start)
            overlap_end = min(intake_end, exhaust_end)
            
            print(f'    Intake[{i}] vs Exhaust[{j}]: {overlap_start:.1f}° ～ {overlap_end:.1f}°', end='')
            
            if overlap_start < overlap_end:
                duration = overlap_end - overlap_start
                overlap_periods.append((overlap_start, overlap_end))
                total_overlap_duration += duration
                print(f' → Overlap: {duration:.1f}°')
            else:
                print(f' → No overlap')
    
    print(f'  Total overlap duration: {total_overlap_duration:.1f}°')
    print(f'  Overlap periods: {overlap_periods}')

if __name__ == "__main__":
    debug_overlap_calculation()