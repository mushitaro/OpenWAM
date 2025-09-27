#!/usr/bin/env python3
"""
VANOS値の変化をテスト
"""

import requests
import json

def test_vanos_variation():
    """VANOS値の変化をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== VANOS Variation Test ===')
            
            # 変化があるRPMポイントを探す
            prev_intake = None
            prev_exhaust = None
            changes = []
            
            for item in result['overlap_analysis']:
                rpm = item['rpm']
                intake_angle = item['overlap_details']['intake_timing']['max_lift_angle_atdc']
                exhaust_angle = item['overlap_details']['exhaust_timing']['max_lift_angle_abdc']
                
                if prev_intake is not None:
                    intake_change = abs(intake_angle - prev_intake)
                    exhaust_change = abs(exhaust_angle - prev_exhaust)
                    
                    if intake_change > 0.1 or exhaust_change > 0.1:
                        changes.append({
                            'rpm': rpm,
                            'intake': intake_angle,
                            'exhaust': exhaust_angle,
                            'intake_change': intake_change,
                            'exhaust_change': exhaust_change
                        })
                
                prev_intake = intake_angle
                prev_exhaust = exhaust_angle
            
            print(f'Found {len(changes)} RPM points with VANOS changes:')
            for change in changes[:10]:  # 最初の10個を表示
                print(f'  RPM {change["rpm"]}: Intake {change["intake"]:.1f}° (Δ{change["intake_change"]:.1f}°), Exhaust {change["exhaust"]:.1f}° (Δ{change["exhaust_change"]:.1f}°)')
            
            if len(changes) > 10:
                print(f'  ... and {len(changes) - 10} more changes')
            
            # 特定のRPMポイントでの詳細確認
            test_rpms = [1800, 3000, 5000, 7000]
            print(f'\nDetailed check for specific RPMs:')
            
            for test_rpm in test_rpms:
                for item in result['overlap_analysis']:
                    if item['rpm'] == test_rpm:
                        overlap_details = item['overlap_details']
                        print(f'  RPM {test_rpm}:')
                        print(f'    Intake VANOS: {overlap_details["intake_timing"]["max_lift_angle_atdc"]}°')
                        print(f'    Exhaust VANOS: {overlap_details["exhaust_timing"]["max_lift_angle_abdc"]}°')
                        print(f'    Overlap: {overlap_details["duration"]}° ({overlap_details["start_angle"]}° ～ {overlap_details["end_angle"]}°)')
                        break
            
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_vanos_variation()