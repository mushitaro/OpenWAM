#!/usr/bin/env python3
# VANOS効果のデバッグスクリプト

from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
import numpy as np

def debug_vanos_effect():
    print('=== VANOS Effect Debug ===')
    
    sim = BMWE46M3Simulator()
    
    # Test different VANOS settings
    test_cases = [
        {'name': 'Stock', 'intake': 0, 'exhaust': 0},
        {'name': '+20° Intake', 'intake': 20, 'exhaust': 0},
        {'name': '-15° Exhaust', 'intake': 0, 'exhaust': -15},
        {'name': 'Combined', 'intake': 20, 'exhaust': -15}
    ]
    
    for case in test_cases:
        print(f"\n--- {case['name']} ---")
        
        # Set VANOS angles directly
        sim.cylinder.current_intake_vanos = case['intake']
        sim.cylinder.current_exhaust_vanos = case['exhaust']
        
        # Calculate valve timing
        intake_opening, intake_closing = sim.cylinder.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = sim.cylinder.get_effective_valve_timing('exhaust')
        
        print(f"VANOS: Intake {case['intake']}°, Exhaust {case['exhaust']}°")
        print(f"Intake timing: {intake_opening:.1f}° to {intake_closing:.1f}°")
        print(f"Exhaust timing: {exhaust_opening:.1f}° to {exhaust_closing:.1f}°")
        
        # Calculate VE at different crank angles
        test_angles = [0, 180, 360, 540]
        for angle in test_angles:
            ve = sim.cylinder.calculate_volumetric_efficiency(angle)
            print(f"VE at {angle}°: {ve:.3f}")
        
        # Calculate average VE
        angles = np.linspace(0, 720, 100)
        ve_values = [sim.cylinder.calculate_volumetric_efficiency(angle) for angle in angles]
        avg_ve = np.mean(ve_values)
        print(f"Average VE: {avg_ve:.3f}")

if __name__ == '__main__':
    debug_vanos_effect()