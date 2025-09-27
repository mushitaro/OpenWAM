#!/usr/bin/env python3
"""
グラフ表示の修正をテスト
"""

import requests
import json

def test_graph_display():
    """グラフ表示をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== Graph Display Test ===')
            
            # 最初の数ポイントのデータを詳細表示
            for i, item in enumerate(result['overlap_analysis'][:3]):
                rpm = item['rpm']
                overlap_details = item['overlap_details']
                
                print(f'\nRPM {rpm}:')
                
                # 元の0-720範囲の値
                intake_opening_720 = overlap_details["intake_timing"]["opening"]
                intake_closing_720 = overlap_details["intake_timing"]["closing"]
                exhaust_opening_720 = overlap_details["exhaust_timing"]["opening"]
                exhaust_closing_720 = overlap_details["exhaust_timing"]["closing"]
                
                print(f'  Original (0-720°):')
                print(f'    Intake: {intake_opening_720:.1f}° ～ {intake_closing_720:.1f}°')
                print(f'    Exhaust: {exhaust_opening_720:.1f}° ～ {exhaust_closing_720:.1f}°')
                
                # -360～360範囲に変換
                def convert_to_graph_range(angle):
                    if angle > 360:
                        return angle - 720
                    return angle
                
                intake_opening_graph = convert_to_graph_range(intake_opening_720)
                intake_closing_graph = convert_to_graph_range(intake_closing_720)
                exhaust_opening_graph = convert_to_graph_range(exhaust_opening_720)
                exhaust_closing_graph = convert_to_graph_range(exhaust_closing_720)
                
                print(f'  Graph Range (-360～360°):')
                print(f'    Intake: {intake_opening_graph:.1f}° ～ {intake_closing_graph:.1f}°')
                print(f'    Exhaust: {exhaust_opening_graph:.1f}° ～ {exhaust_closing_graph:.1f}°')
                
                # オーバーラップ
                overlap_start_720 = overlap_details["start_angle"]
                overlap_end_720 = overlap_details["end_angle"]
                overlap_start_graph = convert_to_graph_range(overlap_start_720)
                overlap_end_graph = convert_to_graph_range(overlap_end_720)
                
                print(f'    Overlap: {overlap_start_graph:.1f}° ～ {overlap_end_graph:.1f}° (Duration: {overlap_details["duration"]:.1f}°)')
                
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_graph_display()