#!/usr/bin/env python3
"""
バルブタイミングチャートのデータ構造をテスト
"""

import requests
import json

def test_valve_timing_data():
    """バルブタイミングデータの構造をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== Valve Timing Data Structure Test ===')
            
            # 最初の数ポイントのデータを詳細表示
            for i, item in enumerate(result['overlap_analysis'][:5]):
                rpm = item['rpm']
                overlap_details = item['overlap_details']
                
                print(f'\nRPM {rpm}:')
                print(f'  Intake Timing:')
                print(f'    Opening: {overlap_details["intake_timing"]["opening"]:.1f}°')
                print(f'    Closing: {overlap_details["intake_timing"]["closing"]:.1f}°')
                print(f'    Duration: {overlap_details["intake_timing"]["duration"]:.1f}°')
                
                print(f'  Exhaust Timing:')
                print(f'    Opening: {overlap_details["exhaust_timing"]["opening"]:.1f}°')
                print(f'    Closing: {overlap_details["exhaust_timing"]["closing"]:.1f}°')
                print(f'    Duration: {overlap_details["exhaust_timing"]["duration"]:.1f}°')
                
                print(f'  Overlap: {overlap_details["duration"]:.1f}°')
                
            # バルブ開度期間の変化をチェック
            print('\n=== Valve Duration Variation Check ===')
            intake_durations = []
            exhaust_durations = []
            
            for item in result['overlap_analysis']:
                overlap_details = item['overlap_details']
                intake_durations.append(overlap_details["intake_timing"]["duration"])
                exhaust_durations.append(overlap_details["exhaust_timing"]["duration"])
            
            print(f'Intake duration range: {min(intake_durations):.1f}° - {max(intake_durations):.1f}°')
            print(f'Exhaust duration range: {min(exhaust_durations):.1f}° - {max(exhaust_durations):.1f}°')
            print(f'Intake duration variation: {max(intake_durations) - min(intake_durations):.1f}°')
            print(f'Exhaust duration variation: {max(exhaust_durations) - min(exhaust_durations):.1f}°')
            
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_valve_timing_data()