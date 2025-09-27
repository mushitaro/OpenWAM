#!/usr/bin/env python3
"""
VANOS値の変化をデバッグ
"""

import requests
import json

def debug_vanos_values():
    """VANOS値の変化をデバッグ"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/vanos-table', 
                                json={'tps': 50})
        result = response.json()

        if result['success']:
            print('=== VANOS Values Debug ===')
            
            # インテークVANOS値の変化
            print('\nIntake VANOS values:')
            for item in result['intake_table'][:10]:
                print(f'RPM {item["rpm"]}: {item["vanos_angle"]:.1f}°')
            
            # エキゾーストVANOS値の変化
            print('\nExhaust VANOS values:')
            for item in result['exhaust_table'][:10]:
                print(f'RPM {item["rpm"]}: {item["vanos_angle"]:.1f}°')
            
            # オーバーラップ分析でのVANOS値
            print('\nOverlap analysis VANOS values:')
            for item in result['overlap_analysis'][:10]:
                print(f'RPM {item["rpm"]}: Intake {item["intake_vanos"]:.1f}°, Exhaust {item["exhaust_vanos"]:.1f}°')
                
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Debug failed: {e}')
        return False

if __name__ == "__main__":
    debug_vanos_values()