#!/usr/bin/env python3
# RPMスイープAPIのテスト

import requests
import json

def test_rpm_sweep_api():
    print('=== RPM Sweep API Test ===')
    
    url = 'http://localhost:5001/bmw-e46-m3/rpm-sweep'
    
    payload = {
        'rpm_min': 2000,
        'rpm_max': 4000,
        'rpm_step': 500,
        'tps': 50,
        'baseline_vanos': None,
        'modified_vanos': {
            'intake': 10,
            'exhaust': -5
        }
    }
    
    try:
        response = requests.post(url, json=payload)
        
        if response.status_code == 200:
            result = response.json()
            
            if result['success']:
                print('✅ API呼び出し成功')
                
                baseline = result['baseline']
                modified = result['modified']
                
                print(f"\nRPM範囲: {min(baseline['rpm'])} - {max(baseline['rpm'])} RPM")
                print(f"データポイント数: {len(baseline['rpm'])}")
                
                print('\n=== ベースライン結果 ===')
                for i, rpm in enumerate(baseline['rpm']):
                    print(f"RPM {rpm}: VE {baseline['volumetric_efficiency'][i]:.3f}, "
                          f"Air {baseline['air_mass_trapped'][i]*1000:.2f}g, "
                          f"I-VANOS {baseline['intake_vanos'][i]:.1f}°, "
                          f"E-VANOS {baseline['exhaust_vanos'][i]:.1f}°")
                
                print('\n=== 変更後結果 ===')
                for i, rpm in enumerate(modified['rpm']):
                    ve_change = ((modified['volumetric_efficiency'][i] - baseline['volumetric_efficiency'][i]) / baseline['volumetric_efficiency'][i]) * 100
                    print(f"RPM {rpm}: VE {modified['volumetric_efficiency'][i]:.3f} ({ve_change:+.1f}%), "
                          f"Air {modified['air_mass_trapped'][i]*1000:.2f}g, "
                          f"I-VANOS {modified['intake_vanos'][i]:.1f}°, "
                          f"E-VANOS {modified['exhaust_vanos'][i]:.1f}°")
                
            else:
                print(f'❌ API エラー: {result["error"]}')
        else:
            print(f'❌ HTTP エラー: {response.status_code}')
            print(response.text)
            
    except requests.exceptions.ConnectionError:
        print('❌ 接続エラー: APIサーバーが起動していません')
    except Exception as e:
        print(f'❌ 予期しないエラー: {e}')

if __name__ == '__main__':
    test_rpm_sweep_api()