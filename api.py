from flask import Flask, request, jsonify
from flask_cors import CORS
from engine_simulator.main import Simulator
from engine_simulator.config import get_default_config
from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
import numpy as np
import json
import collections.abc

app = Flask(__name__)
CORS(app) # Enable CORS for all routes

# Custom JSON encoder to handle NumPy arrays
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)

app.json_encoder = NumpyEncoder

def update_config(d, u):
    """
    Recursively update a dictionary.
    """
    for k, v in u.items():
        if isinstance(v, collections.abc.Mapping):
            d[k] = update_config(d.get(k, {}), v)
        else:
            d[k] = v
    return d

@app.route('/simulate', methods=['POST'])
def simulate():
    """
    Runs a simulation with parameters from the request body.
    The request body should be a JSON object with the same structure as the default config.
    """
    try:
        # Get the default configuration
        config = get_default_config()

        # Get parameters from the request
        params = request.get_json()
        if not params:
            return jsonify({"error": "Invalid request: no JSON body found"}), 400

        # Update the config with provided parameters
        config = update_config(config, params)

        # Create and run the simulator
        simulator = Simulator(config)
        simulator.run()

        # Return the results
        return jsonify(simulator.history)

    except KeyError as e:
        return jsonify({"error": f"Invalid parameter provided: {e}"}), 400
    except Exception as e:
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500

@app.route('/bmw-e46-m3/simulate', methods=['POST'])
def bmw_e46_m3_simulate():
    """
    BMW E46 M3専用シミュレーション
    """
    try:
        params = request.get_json() or {}
        
        # パラメータ取得
        rpm = params.get('rpm', 3000)
        load = params.get('load', 50)
        vanos_modifications = params.get('vanos_modifications', None)
        
        # シミュレーター作成・実行
        simulator = BMWE46M3Simulator()
        history = simulator.run_simulation(rpm, load, vanos_modifications)
        
        return jsonify({
            'success': True,
            'data': history,
            'parameters': {
                'rpm': rpm,
                'load': load,
                'vanos_modifications': vanos_modifications
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/bmw-e46-m3/compare-vanos', methods=['POST'])
def bmw_e46_m3_compare_vanos():
    """
    BMW E46 M3 VANOS設定比較
    """
    try:
        params = request.get_json() or {}
        
        # パラメータ取得
        rpm = params.get('rpm', 3000)
        load = params.get('load', 50)
        vanos_changes_list = params.get('vanos_changes_list', None)
        
        # シミュレーター作成・実行
        simulator = BMWE46M3Simulator()
        results = simulator.compare_vanos_settings(rpm, load, vanos_changes_list)
        summary = simulator.get_performance_summary(results)
        
        return jsonify({
            'success': True,
            'results': results,
            'summary': summary,
            'parameters': {
                'rpm': rpm,
                'load': load,
                'vanos_changes_list': vanos_changes_list
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/bmw-e46-m3/vanos-map', methods=['GET'])
def bmw_e46_m3_vanos_map():
    """
    BMW E46 M3のVANOSマップを取得
    """
    try:
        from engine_simulator.bmw_e46_m3_config import get_bmw_e46_m3_config, interpolate_vanos_angle
        config = get_bmw_e46_m3_config()
        
        return jsonify({
            'success': True,
            'vanos_config': config['vanos']
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/bmw-e46-m3/vanos-table', methods=['POST'])
def bmw_e46_m3_vanos_table():
    """
    指定TPSでのインテーク・エキゾースト別VANOSテーブルとオーバーラップ情報を取得
    """
    try:
        from engine_simulator.bmw_e46_m3_config import get_bmw_e46_m3_config, interpolate_vanos_angle
        from engine_simulator.bmw_e46_m3_simulator import BMWE46M3Simulator
        
        params = request.get_json() or {}
        tps = params.get('tps', 50)
        
        config = get_bmw_e46_m3_config()
        
        # インテークとエキゾーストのRPMポイントを別々に処理
        intake_rpm_points = config['vanos']['intake']['rpm_points']
        exhaust_rpm_points = config['vanos']['exhaust']['rpm_points']
        
        # インテークVANOSテーブル
        intake_table = []
        for rpm in intake_rpm_points:
            intake_angle = interpolate_vanos_angle(rpm, tps, config['vanos']['intake'])
            intake_table.append({
                'rpm': rpm,
                'vanos_angle': intake_angle
            })
        
        # エキゾーストVANOSテーブル
        exhaust_table = []
        for rpm in exhaust_rpm_points:
            exhaust_angle = interpolate_vanos_angle(rpm, tps, config['vanos']['exhaust'])
            exhaust_table.append({
                'rpm': rpm,
                'vanos_angle': exhaust_angle
            })
        
        # オーバーラップ分析用（全RPMポイントを線形補間で統一）
        all_rpm_points = sorted(list(set(intake_rpm_points + exhaust_rpm_points)))
        overlap_analysis = []
        simulator = BMWE46M3Simulator()
        
        for rpm in all_rpm_points:
            # 線形補間でVANOS角度を取得
            intake_angle = interpolate_vanos_angle(rpm, tps, config['vanos']['intake'])
            exhaust_angle = interpolate_vanos_angle(rpm, tps, config['vanos']['exhaust'])
            
            # オーバーラップ情報を計算
            simulator.cylinder.current_intake_vanos = intake_angle
            simulator.cylinder.current_exhaust_vanos = exhaust_angle
            
            intake_opening, intake_closing = simulator.cylinder.get_effective_valve_timing('intake')
            exhaust_opening, exhaust_closing = simulator.cylinder.get_effective_valve_timing('exhaust')
            overlap_details = simulator.calculate_valve_overlap(intake_opening, intake_closing, exhaust_opening, exhaust_closing)
            
            overlap_analysis.append({
                'rpm': rpm,
                'intake_vanos': intake_angle,
                'exhaust_vanos': exhaust_angle,
                'overlap_details': overlap_details
            })
        
        return jsonify({
            'success': True,
            'intake_table': intake_table,
            'exhaust_table': exhaust_table,
            'overlap_analysis': overlap_analysis,
            'tps': tps,
            'intake_rpm_points': intake_rpm_points,
            'exhaust_rpm_points': exhaust_rpm_points,
            'all_rpm_points': all_rpm_points
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/bmw-e46-m3/rpm-sweep', methods=['POST'])
def bmw_e46_m3_rpm_sweep():
    """
    RPM範囲での体積効率スイープ分析（拡張版）
    """
    try:
        params = request.get_json() or {}
        
        # パラメータ取得
        rpm_min = params.get('rpm_min', 1000)
        rpm_max = params.get('rpm_max', 8000)
        rpm_step = params.get('rpm_step', 200)
        tps = params.get('tps', 50)  # スロットル開度
        
        # VANOS変更設定
        baseline_vanos = params.get('baseline_vanos', None)
        modified_vanos = params.get('modified_vanos', None)
        rpm_specific_vanos = params.get('rpm_specific_vanos', None)  # RPMポイント別調整
        
        # シミュレーター作成
        simulator = BMWE46M3Simulator()
        
        # RPM範囲を生成
        rpm_range = list(range(rpm_min, rpm_max + rpm_step, rpm_step))
        
        # ベースライン結果
        baseline_results = {
            'rpm': [],
            'volumetric_efficiency': [],
            'air_mass_trapped': [],
            'intake_vanos': [],
            'exhaust_vanos': [],
            'valve_overlap': [],
            'valve_overlap_details': []
        }
        
        # 変更後結果
        modified_results = {
            'rpm': [],
            'volumetric_efficiency': [],
            'air_mass_trapped': [],
            'intake_vanos': [],
            'exhaust_vanos': [],
            'valve_overlap': [],
            'valve_overlap_details': []
        }
        
        # 各RPMでシミュレーション実行
        for rpm in rpm_range:
            # ベースライン
            baseline_history = simulator.run_simulation(rpm, tps, baseline_vanos)
            last_cycle_start = len(baseline_history['crank_angle']) - int(720 / simulator.config['simulation']['crank_angle_step'])
            
            baseline_ve = np.mean(baseline_history['volumetric_efficiency'][last_cycle_start:])
            baseline_air_mass = np.mean(baseline_history['air_mass_trapped'][last_cycle_start:])
            baseline_overlap = baseline_history['valve_overlap'][-1] if baseline_history['valve_overlap'] else 0
            baseline_overlap_details = baseline_history['valve_overlap_details'][-1] if baseline_history['valve_overlap_details'] else {}
            
            baseline_results['rpm'].append(rpm)
            baseline_results['volumetric_efficiency'].append(baseline_ve)
            baseline_results['air_mass_trapped'].append(baseline_air_mass)
            baseline_results['intake_vanos'].append(baseline_history['intake_vanos_angle'][-1])
            baseline_results['exhaust_vanos'].append(baseline_history['exhaust_vanos_angle'][-1])
            baseline_results['valve_overlap'].append(baseline_overlap)
            baseline_results['valve_overlap_details'].append(baseline_overlap_details)
            
            # 変更後（RPMポイント別調整対応）
            current_modified_vanos = modified_vanos
            if rpm_specific_vanos and str(rpm) in rpm_specific_vanos:
                current_modified_vanos = rpm_specific_vanos[str(rpm)]
            
            modified_history = simulator.run_simulation(rpm, tps, current_modified_vanos)
            last_cycle_start = len(modified_history['crank_angle']) - int(720 / simulator.config['simulation']['crank_angle_step'])
            
            modified_ve = np.mean(modified_history['volumetric_efficiency'][last_cycle_start:])
            modified_air_mass = np.mean(modified_history['air_mass_trapped'][last_cycle_start:])
            modified_overlap = modified_history['valve_overlap'][-1] if modified_history['valve_overlap'] else 0
            modified_overlap_details = modified_history['valve_overlap_details'][-1] if modified_history['valve_overlap_details'] else {}
            
            modified_results['rpm'].append(rpm)
            modified_results['volumetric_efficiency'].append(modified_ve)
            modified_results['air_mass_trapped'].append(modified_air_mass)
            modified_results['intake_vanos'].append(modified_history['intake_vanos_angle'][-1])
            modified_results['exhaust_vanos'].append(modified_history['exhaust_vanos_angle'][-1])
            modified_results['valve_overlap'].append(modified_overlap)
            modified_results['valve_overlap_details'].append(modified_overlap_details)
        
        return jsonify({
            'success': True,
            'baseline': baseline_results,
            'modified': modified_results,
            'parameters': {
                'rpm_min': rpm_min,
                'rpm_max': rpm_max,
                'rpm_step': rpm_step,
                'tps': tps,
                'baseline_vanos': baseline_vanos,
                'modified_vanos': modified_vanos,
                'rpm_specific_vanos': rpm_specific_vanos
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)
