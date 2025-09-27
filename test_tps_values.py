#!/usr/bin/env python3
"""
TPS値での変化をテスト
"""

import requests
import json

def test_tps_values():
    """異なるTPS値での変化をテスト"""
    
    tps_values = [0.15, 15.00, 45.00, 85.00]  # 低負荷、中負荷、高負荷、最大負荷
    
    print('=== TPS Values Test ===')
    
    for tps in tps_values:
        try:
            response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                    json={'tps': tps})
            result = response.json()

            if result['success']:
                print(f'\nTPS {tps}%:')
                
                # 特定のRPMポイントでの値を確認
                test_rpms = [1800, 3000, 5000]
                
                for test_rpm in test_rpms:
                    for item in result['overlap_analysis']:
                        if item['rpm'] == test_rpm:
                            overlap_details = item['overlap_details']
                            print(f'  RPM {test_rpm}: Intake {overlap_details["intake_timing"]["max_lift_angle_atdc"]:.1f}°, Exhaust {overlap_details["exhaust_timing"]["max_lift_angle_abdc"]:.1f}°, Overlap {overlap_details["duration"]}°')
                            break
            else:
                print(f'TPS {tps}% - Error: {result["error"]}')
                
        except Exception as e:
            print(f'TPS {tps}% - Test failed: {e}')

if __name__ == "__main__":
    test_tps_values()