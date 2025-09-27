#!/usr/bin/env python3
"""
体積効率計算のデバッグ
"""

from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator

def debug_ve_calculation():
    """体積効率計算をデバッグ"""
    
    simulator = BMWE46M3Simulator()
    
    print('=== VE Calculation Debug ===')
    
    test_rpms = [1000, 3000, 5000, 7000]
    
    for rpm in test_rpms:
        print(f'\nRPM {rpm}:')
        
        # VANOS角度を設定
        simulator.cylinder.current_intake_vanos = 110.0
        simulator.cylinder.current_exhaust_vanos = 80.0
        
        # 体積効率を直接計算
        ve = simulator.cylinder.calculate_volumetric_efficiency(0, rpm)
        
        print(f'  Calculated VE: {ve:.3f}')
        
        # RPMカーブの基本値を確認
        def rpm_ve_curve(rpm):
            if rpm < 1000:
                return 0.65
            elif rpm < 2000:
                return 0.65 + 0.15 * (rpm - 1000) / 1000
            elif rpm < 4000:
                return 0.80 + 0.10 * (rpm - 2000) / 2000
            elif rpm < 6000:
                return 0.90 + 0.05 * (rpm - 4000) / 2000
            elif rpm < 7000:
                return 0.95 - 0.02 * (rpm - 6000) / 1000
            else:
                return 0.93 - 0.10 * (rpm - 7000) / 1000
        
        base_ve = rpm_ve_curve(rpm)
        print(f'  Base VE from RPM curve: {base_ve:.3f}')
        
        # VANOS補正を確認
        if rpm < 3000:
            optimal_intake = 110.0
        elif rpm < 5000:
            optimal_intake = 100.0
        else:
            optimal_intake = 90.0
        
        intake_deviation = abs(110.0 - optimal_intake)
        intake_factor = 1.0 - 0.001 * intake_deviation
        print(f'  Intake factor: {intake_factor:.3f} (deviation: {intake_deviation:.1f}°)')
        
        if rpm < 3000:
            optimal_exhaust = 85.0
        elif rpm < 5000:
            optimal_exhaust = 80.0
        else:
            optimal_exhaust = 75.0
        
        exhaust_deviation = abs(80.0 - optimal_exhaust)
        exhaust_factor = 1.0 - 0.0005 * exhaust_deviation
        print(f'  Exhaust factor: {exhaust_factor:.3f} (deviation: {exhaust_deviation:.1f}°)')
        
        # オーバーラップファクターを確認
        intake_opening, intake_closing = simulator.cylinder.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = simulator.cylinder.get_effective_valve_timing('exhaust')
        overlap = max(0, min(intake_closing, exhaust_closing) - max(intake_opening, exhaust_opening))
        
        if rpm < 3000:
            optimal_overlap = 15.0
        elif rpm < 5000:
            optimal_overlap = 25.0
        else:
            optimal_overlap = 35.0
        
        overlap_deviation = abs(overlap - optimal_overlap)
        overlap_factor = 1.0 - 0.002 * overlap_deviation
        
        print(f'  Valve timing: Intake {intake_opening:.1f}°～{intake_closing:.1f}°, Exhaust {exhaust_opening:.1f}°～{exhaust_closing:.1f}°')
        print(f'  Overlap: {overlap:.1f}° (optimal: {optimal_overlap:.1f}°)')
        print(f'  Overlap factor: {overlap_factor:.3f} (deviation: {overlap_deviation:.1f}°)')
        
        # 最終計算
        calculated_ve = base_ve * intake_factor * exhaust_factor * overlap_factor
        final_ve = max(0.60, min(0.98, calculated_ve))
        
        print(f'  Calculated before limits: {calculated_ve:.3f}')
        print(f'  Final VE after limits: {final_ve:.3f}')

if __name__ == "__main__":
    debug_ve_calculation()