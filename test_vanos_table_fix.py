#!/usr/bin/env python3
"""
VANOSテーブルのオーバーラップ修正をテスト
"""

import requests
import json

def test_vanos_table():
    """VANOSテーブル取得テスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== VANOS Table Analysis Results ===')
            print(f'TPS: {result["tps"]}%')
            print(f'Intake RPM points: {len(result["intake_table"])} points')
            print(f'Exhaust RPM points: {len(result["exhaust_table"])} points')
            print(f'Overlap analysis points: {len(result["overlap_analysis"])} points')
            print(f'All RPM points: {result["all_rpm_points"]}')
            
            print('\n=== Intake RPM Points ===')
            intake_rpms = [item["rpm"] for item in result["intake_table"]]
            print(f'Intake: {intake_rpms}')
            
            print('\n=== Exhaust RPM Points ===')
            exhaust_rpms = [item["rpm"] for item in result["exhaust_table"]]
            print(f'Exhaust: {exhaust_rpms}')
            
            print('\n=== Overlap Analysis Sample ===')
            for i, item in enumerate(result['overlap_analysis'][:8]):  # 最初の8ポイント
                overlap_duration = item["overlap_details"]["duration"]
                print(f'RPM {item["rpm"]}: Overlap {overlap_duration:.1f}°')
                
            if len(result["overlap_analysis"]) > 8:
                print(f'... and {len(result["overlap_analysis"]) - 8} more points')
                
            # 連続性チェック
            overlap_rpms = [item["rpm"] for item in result["overlap_analysis"]]
            print(f'\n=== RPM Continuity Check ===')
            print(f'Overlap RPM points: {overlap_rpms}')
            print(f'Is continuous: {overlap_rpms == sorted(overlap_rpms)}')
            
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_vanos_table()