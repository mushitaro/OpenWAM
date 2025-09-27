#!/usr/bin/env python3
"""
バルブタイミングの詳細テスト
"""

import requests
import json

def test_valve_timing_detailed():
    """バルブタイミングの詳細をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== Valve Timing Detailed Test ===')
            
            # 最初のポイントを詳細分析
            item = result['overlap_analysis'][0]
            rpm = item['rpm']
            overlap_details = item['overlap_details']
            
            print(f'\nRPM {rpm} 詳細分析:')
            
            # 元の0-720範囲の値
            intake_opening_720 = overlap_details["intake_timing"]["opening"]
            intake_closing_720 = overlap_details["intake_timing"]["closing"]
            exhaust_opening_720 = overlap_details["exhaust_timing"]["opening"]
            exhaust_closing_720 = overlap_details["exhaust_timing"]["closing"]
            
            print(f'  Original (0-720°):')
            print(f'    Intake: {intake_opening_720:.1f}° ～ {intake_closing_720:.1f}°')
            print(f'    Exhaust: {exhaust_opening_720:.1f}° ～ {exhaust_closing_720:.1f}°')
            
            # 720°をまたぐかチェック
            intake_spans = intake_opening_720 > intake_closing_720
            exhaust_spans = exhaust_opening_720 > exhaust_closing_720
            
            print(f'  Spans 720°:')
            print(f'    Intake: {intake_spans} (期間: {overlap_details["intake_timing"]["duration"]:.1f}°)')
            print(f'    Exhaust: {exhaust_spans} (期間: {overlap_details["exhaust_timing"]["duration"]:.1f}°)')
            
            # 実際の期間計算
            if intake_spans:
                intake_actual_duration = (720 - intake_opening_720) + intake_closing_720
                print(f'    Intake actual duration: (720 - {intake_opening_720:.1f}) + {intake_closing_720:.1f} = {intake_actual_duration:.1f}°')
            else:
                intake_actual_duration = intake_closing_720 - intake_opening_720
                print(f'    Intake actual duration: {intake_closing_720:.1f} - {intake_opening_720:.1f} = {intake_actual_duration:.1f}°')
            
            if exhaust_spans:
                exhaust_actual_duration = (720 - exhaust_opening_720) + exhaust_closing_720
                print(f'    Exhaust actual duration: (720 - {exhaust_opening_720:.1f}) + {exhaust_closing_720:.1f} = {exhaust_actual_duration:.1f}°')
            else:
                exhaust_actual_duration = exhaust_closing_720 - exhaust_opening_720
                print(f'    Exhaust actual duration: {exhaust_closing_720:.1f} - {exhaust_opening_720:.1f} = {exhaust_actual_duration:.1f}°')
            
            # オーバーラップ
            overlap_start_720 = overlap_details["start_angle"]
            overlap_end_720 = overlap_details["end_angle"]
            overlap_duration = overlap_details["duration"]
            
            print(f'  Overlap:')
            print(f'    Start: {overlap_start_720:.1f}°, End: {overlap_end_720:.1f}°')
            print(f'    Duration: {overlap_duration:.1f}°')
            
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_valve_timing_detailed()