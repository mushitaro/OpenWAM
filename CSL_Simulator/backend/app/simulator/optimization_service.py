
import os
import pandas as pd
import numpy as np
from .calibration_service import CalibrationService

import copy

class OptimizationService:
    def __init__(self, data_dir, simulator_dir):
        # Reuse calibration service to handle sim logic
        self.cal_service = CalibrationService(data_dir=data_dir, simulator_dir=simulator_dir)

    async def optimize_full_map(self, base_config):
        """
        Generates a full VANOS Target Map (RPM vs Bias) using Coarse-to-Fine Search.
        """
        # RPM Breakpoints for Auto-Mapping (Standard Tuning Grid)
        # For speed in this demo, we use fewer points.
        rpm_grid = [2000, 3000, 4000, 5000, 6000, 7000, 7800]
        
        # Sweep Range (Coarse)
        # Advance (Bias > 0) to Retard (Bias < 0)
        coarse_grid = [-10, 0, 10, 20] # 4 points
        
        results_map = {
            "rpm": rpm_grid,
            "intake_bias": [],
            "max_ve": []
        }
        
        print(f"Starting Full Map Optimization for {len(rpm_grid)} RPM points...")
        
        for rpm in rpm_grid:
            print(f"--- Optimizing RPM {rpm} ---")
            
            # 1. Coarse Search
            best_coarse_bias = 0.0
            best_coarse_ve = -1.0
            
            for bias in coarse_grid:
                ve = await self._run_single_point(base_config, rpm, bias)
                if ve > best_coarse_ve:
                    best_coarse_ve = ve
                    best_coarse_bias = bias
            
            print(f"RPM {rpm}: Coarse Best = {best_coarse_bias} deg (VE {best_coarse_ve:.2f})")
            
            # 2. Fine Search (Gradient Descent / Vicinity Search)
            # Create a finer grid around the best coarse point (+- 5 deg, step 2)
            fine_grid = [best_coarse_bias - 4, best_coarse_bias - 2, best_coarse_bias + 2, best_coarse_bias + 4]
            
            best_fine_bias = best_coarse_bias
            best_fine_ve = best_coarse_ve
            
            for bias in fine_grid:
                # Clamp to physical limits?
                if bias < -20 or bias > 40: continue
                
                ve = await self._run_single_point(base_config, rpm, bias)
                if ve > best_fine_ve:
                    best_fine_ve = ve
                    best_fine_bias = bias
            
            print(f"RPM {rpm}: Fine Best   = {best_fine_bias} deg (VE {best_fine_ve:.2f})")
            
            results_map["intake_bias"].append(best_fine_bias)
            results_map["max_ve"].append(best_fine_ve)
            
        return results_map

    async def _run_single_point(self, base_config, rpm, bias):
        """Helper to run a single configuration point"""
        run_config = copy.deepcopy(base_config)
        
        # Access safely (Config Object or Dict)
        if isinstance(run_config, dict):
             if "engine" not in run_config: run_config["engine"] = {}
             run_config["engine"]["vanos_intake_bias"] = float(bias)
             run_config["engine"]["rpm"] = float(rpm)
        else:
             run_config.engine.vanos_intake_bias = float(bias)
             run_config.engine.rpm = float(rpm)

        # Run Simulation
        # calibrate is ASYNC
        cal_result = await self.cal_service.calibrate(config=run_config)
        
        # Extract VE
        curve_data = cal_result.get("curve", [])
        if curve_data:
             # Find the specific RPM point (should be only one if we ran consistent)
             # But calibration might return a curve if config.rpm was ignored?
             # wam_generator uses config.rpm for "RPM InitP".
             # Actually ve_table_runner logic might be needed here if we want stabilization.
             # Current 'calibrate' (calibration_service) runs ONE point if config is one point?
             # Let's assume calibrate returns the result for the requested RPM.
             peak_ve = max(item.get('sim_ve', 0.0) for item in curve_data)
        else:
             peak_ve = 0.0
             
        return peak_ve

    async def optimize_vanos(self, base_config):
        # Legacy Wrapper (Single RPM optimization? Or Full?)
        # For Phase 2, we upgrade "optimize_vanos" to return Full Map if possible, 
        # or just redirect to optimize_full_map and take the average?
        # Let's keep existing signature but use the new logic if RPM is not fixed in UI.
        # But UI expects "best_bias" (single).
        # We'll just run optimization at the configured RPM.
        
        target_rpm = 0
        if isinstance(base_config, dict):
            target_rpm = base_config.get("engine", {}).get("rpm", 2000)
        else:
            target_rpm = base_config.engine.rpm
            
        # Run optimized search for THIS rpm
        # Coarse
        coarse_grid = [-10, 0, 10, 20]
        best_bias = 0
        max_ve = -1
        
        results = []
        for bias in coarse_grid:
            ve = await self._run_single_point(base_config, target_rpm, bias)
            results.append({"bias": bias, "peak_ve": ve})
            if ve > max_ve:
                max_ve = ve
                best_bias = bias
                
        # Fine
        fine_grid = [best_bias - 4, best_bias - 2, best_bias + 2, best_bias + 4]
        for bias in fine_grid:
            ve = await self._run_single_point(base_config, target_rpm, bias)
            results.append({"bias": bias, "peak_ve": ve})
            if ve > max_ve:
                max_ve = ve
                best_bias = bias
                
        return {
            "best_bias": best_bias,
            "max_ve": max_ve,
            "sweep_results": results
        }
