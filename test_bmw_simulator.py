#!/usr/bin/env python3
# BMW E46 M3 Simulator Test Script

from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
import numpy as np

def main():
    print('=== BMW E46 M3 VANOS Simulator Test ===')
    
    # Create simulator
    sim = BMWE46M3Simulator()
    print('Simulator created successfully')
    
    # Test simulation at 4000 RPM, 75% load
    print('\nRunning test simulation at 4000 RPM, 75% load...')
    
    try:
        results = sim.compare_vanos_settings(rpm=4000, load=75)
        
        # Show summary
        summary = sim.get_performance_summary(results)
        print('\n=== Performance Summary ===')
        
        for name, data in summary.items():
            print(f'{name}:')
            print(f'  Volumetric Efficiency: {data["volumetric_efficiency"]:.3f} ({data["volumetric_efficiency_change_percent"]:+.1f}%)')
            print(f'  Air Mass Trapped: {data["air_mass_trapped_grams"]:.2f}g ({data["air_mass_change_grams"]:+.2f}g)')
            print()
        
        print('Test completed successfully!')
        
        # Test single simulation
        print('\n=== Single Simulation Test ===')
        single_result = sim.run_simulation(rpm=5000, load=80, vanos_modifications={'intake': 15, 'exhaust': -5})
        
        # Show some key metrics from the last cycle
        last_cycle_start = len(single_result['crank_angle']) - int(720 / sim.config['simulation']['crank_angle_step'])
        avg_ve = np.mean(single_result['volumetric_efficiency'][last_cycle_start:])
        avg_air_mass = np.mean(single_result['air_mass_trapped'][last_cycle_start:])
        max_pressure = np.max(single_result['pressure'][last_cycle_start:])
        
        print(f'5000 RPM, 80% load, +15° intake, -5° exhaust:')
        print(f'  Average Volumetric Efficiency: {avg_ve:.3f}')
        print(f'  Average Air Mass Trapped: {avg_air_mass*1000:.2f}g')
        print(f'  Maximum Cylinder Pressure: {max_pressure/1000:.1f} kPa')
        print(f'  Final Intake VANOS: {single_result["intake_vanos_angle"][-1]:.1f}°')
        print(f'  Final Exhaust VANOS: {single_result["exhaust_vanos_angle"][-1]:.1f}°')
        
    except Exception as e:
        print(f'Error during simulation: {e}')
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()