#!/usr/bin/env python3
"""
グラフ修正のテスト
"""

import requests
import json

def test_graph_fix():
    """グラフ修正をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== Graph Fix Test ===')
            
            # 最初の数ポイントのデータを詳細表示
            for i, item in enumerate(result['overlap_analysis'][:3]):
                rpm = item['rpm']
                overlap_details = item['overlap_details']
                
                print(f'\nRPM {rpm}:')
                print(f'  Intake: {overlap_details["intake_timing"]["opening"]:.1f}° ～ {overlap_details["intake_timing"]["closing"]:.1f}°')
                print(f'  Exhaust: {overlap_details["exhaust_timing"]["opening"]:.1f}° ～ {overlap_details["exhaust_timing"]["closing"]:.1f}°')
                print(f'  Overlap: {overlap_details["start_angle"]:.1f}° ～ {overlap_details["end_angle"]:.1f}° (Duration: {overlap_details["duration"]:.1f}°)')
                
                # 720°をまたぐかチェック
                intake_crosses = overlap_details["intake_timing"]["opening"] > overlap_details["intake_timing"]["closing"]
                exhaust_crosses = overlap_details["exhaust_timing"]["opening"] > overlap_details["exhaust_timing"]["closing"]
                overlap_crosses = overlap_details["start_angle"] > overlap_details["end_angle"]
                
                if intake_crosses:
                    print(f'  ⚠️  Intake crosses 720° boundary')
                if exhaust_crosses:
                    print(f'  ⚠️  Exhaust crosses 720° boundary')
                if overlap_crosses:
                    print(f'  ⚠️  Overlap crosses 720° boundary')
                
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_graph_fix()