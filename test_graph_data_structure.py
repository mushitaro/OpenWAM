#!/usr/bin/env python3
"""
グラフデータ構造のテスト
"""

import requests
import json

def test_graph_data_structure():
    """グラフデータ構造をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== Graph Data Structure Test ===')
            print(f'Total RPM points: {len(result["overlap_analysis"])}')
            
            # 最初の5つのRPMポイントを確認
            for i, item in enumerate(result['overlap_analysis'][:5]):
                rpm = item['rpm']
                overlap_details = item['overlap_details']
                
                print(f'\nRPM {rpm}:')
                print(f'  Intake VANOS: {overlap_details["intake_timing"]["max_lift_angle_atdc"]}°')
                print(f'  Exhaust VANOS: {overlap_details["exhaust_timing"]["max_lift_angle_abdc"]}°')
                print(f'  Overlap duration: {overlap_details["duration"]}°')
                print(f'  Overlap range: {overlap_details["start_angle"]}° ～ {overlap_details["end_angle"]}°')
            
            # RPMの変化を確認
            rpms = [item['rpm'] for item in result['overlap_analysis']]
            print(f'\nAll RPMs: {rpms}')
            print(f'RPM range: {min(rpms)} ～ {max(rpms)}')
            print(f'Unique RPMs: {len(set(rpms))}')
            
            # VANOS角度の変化を確認
            intake_angles = [item['overlap_details']['intake_timing']['max_lift_angle_atdc'] for item in result['overlap_analysis']]
            exhaust_angles = [item['overlap_details']['exhaust_timing']['max_lift_angle_abdc'] for item in result['overlap_analysis']]
            
            print(f'\nIntake VANOS range: {min(intake_angles):.1f}° ～ {max(intake_angles):.1f}°')
            print(f'Exhaust VANOS range: {min(exhaust_angles):.1f}° ～ {max(exhaust_angles):.1f}°')
            
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_graph_data_structure()