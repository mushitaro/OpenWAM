#!/usr/bin/env python3
"""
体積効率の変化をテスト
"""

import requests
import json

def test_volumetric_efficiency():
    """体積効率の変化をテスト"""
    try:
        response = requests.post('http://localhost:5001/bmw-e46-m3/rpm-sweep', 
                                json={
                                    'rpm_min': 1000,
                                    'rpm_max': 8000,
                                    'rpm_step': 500,
                                    'tps': 45.0,
                                    'baseline_vanos': None,
                                    'modified_vanos': None
                                })
        result = response.json()

        if result['success']:
            print('=== Volumetric Efficiency Test ===')
            
            baseline = result['baseline']
            modified = result['modified']
            
            print(f'RPM points: {len(baseline["rpm"])}')
            print(f'RPM range: {min(baseline["rpm"])} ～ {max(baseline["rpm"])}')
            
            print(f'\nVolumetric Efficiency by RPM:')
            for i, rpm in enumerate(baseline['rpm']):
                ve_baseline = baseline['volumetric_efficiency'][i]
                ve_modified = modified['volumetric_efficiency'][i]
                air_mass_baseline = baseline['air_mass_trapped'][i] * 1000  # g
                air_mass_modified = modified['air_mass_trapped'][i] * 1000  # g
                
                print(f'  RPM {rpm}: VE {ve_baseline:.3f} (Air: {air_mass_baseline:.2f}g)')
            
            # 体積効率の変化範囲を確認
            ve_values = baseline['volumetric_efficiency']
            print(f'\nVolumetric Efficiency Analysis:')
            print(f'  Min VE: {min(ve_values):.3f}')
            print(f'  Max VE: {max(ve_values):.3f}')
            print(f'  Range: {max(ve_values) - min(ve_values):.3f}')
            print(f'  Average: {sum(ve_values) / len(ve_values):.3f}')
            
            # 体積効率が一定かチェック
            if max(ve_values) - min(ve_values) < 0.001:
                print(f'  ⚠️  WARNING: Volumetric efficiency is nearly constant!')
                print(f'  This is not realistic for an engine across RPM range.')
            else:
                print(f'  ✅ Volumetric efficiency varies with RPM (realistic)')
            
            return True
        else:
            print(f'Error: {result["error"]}')
            return False
            
    except Exception as e:
        print(f'Test failed: {e}')
        return False

if __name__ == "__main__":
    test_volumetric_efficiency()