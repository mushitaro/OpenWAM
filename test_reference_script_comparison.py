#!/usr/bin/env python3
"""
参考スクリプトとの比較テスト
"""

import math
import requests

def calculate_valve_lift_curve_reference(max_lift, duration, max_lift_angle, crank_angles, direction):
    """参考スクリプトと同じ計算方式"""
    start_angle = max_lift_angle - duration / 2
    lift_values = []
    
    for angle in crank_angles:
        adjusted_angle = angle if direction == 'intake' else -angle
        if start_angle <= adjusted_angle <= start_angle + duration:
            lift = max_lift * math.sin(math.pi * (adjusted_angle - start_angle) / duration)
            lift_values.append(lift)
        else:
            lift_values.append(0.0)
    
    return lift_values

def test_reference_script_comparison():
    """参考スクリプトとの比較テスト"""
    
    # 参考スクリプトの値を使用
    max_lift = 11.3  # 参考スクリプトの値
    duration = 260
    crank_angles = list(range(-360, 361))
    
    # テストケース: RPM 600, TPS 50%相当
    intake_angle = 120  # 参考スクリプトの典型的な値
    exhaust_angle = 72  # 参考スクリプトの典型的な値
    
    print('=== Reference Script Comparison Test ===')
    print(f'Test conditions: Intake {intake_angle}°, Exhaust {exhaust_angle}°')
    
    # インテークとエキゾーストのリフトカーブを計算
    intake_lift = calculate_valve_lift_curve_reference(max_lift, duration, intake_angle, crank_angles, 'intake')
    exhaust_lift = calculate_valve_lift_curve_reference(max_lift, duration, exhaust_angle, crank_angles, 'exhaust')
    
    # オーバーラップを計算
    overlap_angles = []
    for i, angle in enumerate(crank_angles):
        if intake_lift[i] > 0.1 and exhaust_lift[i] > 0.1:
            overlap_angles.append(angle)
    
    print(f'\nIntake valve:')
    print(f'  Max lift angle: {intake_angle}°')
    print(f'  Start angle: {intake_angle - duration/2}°')
    print(f'  End angle: {intake_angle + duration/2}°')
    
    print(f'\nExhaust valve:')
    print(f'  Max lift angle: {exhaust_angle}° (but calculated with -angle)')
    print(f'  Effective start angle: {-exhaust_angle - duration/2}°')
    print(f'  Effective end angle: {-exhaust_angle + duration/2}°')
    
    if overlap_angles:
        print(f'\nOverlap:')
        print(f'  Start: {overlap_angles[0]}°')
        print(f'  End: {overlap_angles[-1]}°')
        print(f'  Duration: {len(overlap_angles)}°')
        print(f'  Angles: {overlap_angles[:10]}...{overlap_angles[-10:]}')
    else:
        print(f'\nNo overlap detected')
    
    # 実際のAPIとの比較
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()
        
        if result['success']:
            api_overlap = result['overlap_analysis'][0]['overlap_details']
            print(f'\nAPI comparison (RPM {result["overlap_analysis"][0]["rpm"]}):')
            print(f'  API Intake angle: {api_overlap["intake_timing"]["max_lift_angle_atdc"]}°')
            print(f'  API Exhaust angle: {api_overlap["exhaust_timing"]["max_lift_angle_abdc"]}°')
            print(f'  API Overlap duration: {api_overlap["duration"]}°')
            print(f'  API Overlap start: {api_overlap["start_angle"]}°')
            print(f'  API Overlap end: {api_overlap["end_angle"]}°')
    except Exception as e:
        print(f'API comparison failed: {e}')

if __name__ == "__main__":
    test_reference_script_comparison()