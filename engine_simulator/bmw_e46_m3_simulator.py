# BMW E46 M3 VANOS Simulator
import numpy as np
import math
from engine_simulator.bmw_e46_m3_config import get_bmw_e46_m3_config
from engine_simulator.components import EngineBlock, Cylinder
from engine_simulator.thermo import Air

class BMWE46M3Simulator:
    def __init__(self, config=None):
        """
        BMW E46 M3専用シミュレーター
        """
        if config is None:
            config = get_bmw_e46_m3_config()
        
        self.config = config
        self.history = {
            'crank_angle': [],
            'pressure': [],
            'volume': [],
            'air_mass_trapped': [],
            'volumetric_efficiency': [],
            'intake_vanos_angle': [],
            'exhaust_vanos_angle': [],
            'intake_valve_timing': [],
            'exhaust_valve_timing': [],
            'valve_overlap': [],
            'valve_overlap_details': []
        }
        
        self._setup_components()

    def _setup_components(self):
        """
        コンポーネントのセットアップ
        """
        # シンプルなエンジンブロック設定
        engine_config = {
            'engine': {
                'cylinder': {
                    'bore': self.config['engine']['bore'],
                    'stroke': self.config['engine']['stroke'],
                    'rod_length': self.config['engine']['connecting_rod_length'],
                    'compression_ratio': self.config['engine']['compression_ratio']
                },
                'combustion': {
                    'enabled': True,
                    'start_angle': -10,  # BTDC
                    'duration_angle': 60,
                    'shape_param_m': 2.0,
                    'duration_param_C': 6.9
                },
                'fuel': {
                    'injected_mass_per_cycle': self.config['fuel']['mass_per_cycle'],
                    'lhv': self.config['fuel']['heating_value']
                },
                'heat_transfer': {
                    'woschni_c1': 2.28,
                    'coolant_temp': 363  # 90°C
                },
                'num_cylinders': self.config['engine']['cylinders']
            },
            'intake_valve': {
                'diameter': self.config['valves']['intake']['diameter'],
                'lift_profile': {
                    'angle': self.config['valves']['intake']['lift_profile_angles'],
                    'lift': self.config['valves']['intake']['lift_profile_values']
                },
                'cd_profile': {
                    'lift': np.linspace(0, 0.012, 10),
                    'cd': np.full(10, 0.6)
                }
            },
            'exhaust_valve': {
                'diameter': self.config['valves']['exhaust']['diameter'],
                'lift_profile': {
                    'angle': self.config['valves']['exhaust']['lift_profile_angles'],
                    'lift': self.config['valves']['exhaust']['lift_profile_values']
                },
                'cd_profile': {
                    'lift': np.linspace(0, 0.010, 10),
                    'cd': np.full(10, 0.6)
                }
            },
            'vanos': self.config['vanos']
        }
        
        self.engine_block = EngineBlock(engine_config)
        # 1気筒のみをシミュレート
        self.cylinder = self.engine_block.cylinders[0]

    def run_simulation(self, rpm=3000, load=50, vanos_modifications=None):
        """
        シミュレーション実行
        
        Args:
            rpm: エンジン回転数
            load: 負荷 (%)
            vanos_modifications: VANOS角度の変更 {'intake': delta, 'exhaust': delta}
        """
        print(f"BMW E46 M3 シミュレーション開始: {rpm} RPM, {load}% 負荷")
        
        # DME制御VANOSテーブルから角度を取得
        from engine_simulator.bmw_e46_m3_config import interpolate_vanos_angle
        
        base_intake_vanos = interpolate_vanos_angle(rpm, load, self.config['vanos']['intake'])
        base_exhaust_vanos = interpolate_vanos_angle(rpm, load, self.config['vanos']['exhaust'])
        
        # VANOS角度を設定
        self.cylinder.current_intake_vanos = base_intake_vanos
        self.cylinder.current_exhaust_vanos = base_exhaust_vanos
        
        # VANOS変更を適用
        if vanos_modifications:
            if 'intake' in vanos_modifications:
                self.cylinder.current_intake_vanos = base_intake_vanos + vanos_modifications['intake']
            if 'exhaust' in vanos_modifications:
                self.cylinder.current_exhaust_vanos = base_exhaust_vanos + vanos_modifications['exhaust']
        
        print(f"DME制御テーブル: インテーク {base_intake_vanos:.1f}°, エキゾースト {base_exhaust_vanos:.1f}°")
        print(f"最終VANOS設定: インテーク {self.cylinder.current_intake_vanos:.1f}°, エキゾースト {self.cylinder.current_exhaust_vanos:.1f}°")
        
        # シミュレーション設定
        d_theta_deg = self.config['simulation']['crank_angle_step']
        num_cycles = self.config['simulation']['num_cycles']
        num_steps = int(num_cycles * 720 / d_theta_deg)
        
        # 時間ステップ計算
        dt = d_theta_deg / (rpm * 6.0)
        
        # 履歴をクリア
        for key in self.history:
            self.history[key] = []
        
        # バルブオーバーラップを計算
        intake_opening, intake_closing = self.cylinder.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = self.cylinder.get_effective_valve_timing('exhaust')
        valve_overlap_details = self.calculate_valve_overlap(intake_opening, intake_closing, exhaust_opening, exhaust_closing)
        
        # シミュレーションループ
        for i in range(num_steps):
            crank_angle = i * d_theta_deg
            
            # シリンダー状態を更新（VANOS角度を考慮した体積効率計算を含む）
            self.cylinder.update(crank_angle, d_theta_deg, dt, rpm)
            
            # バルブタイミングを取得
            intake_opening, intake_closing = self.cylinder.get_effective_valve_timing('intake')
            exhaust_opening, exhaust_closing = self.cylinder.get_effective_valve_timing('exhaust')
            
            # データを記録
            self.history['crank_angle'].append(crank_angle)
            self.history['pressure'].append(self.cylinder.state['P'])
            self.history['volume'].append(self.cylinder.get_volume(crank_angle))
            self.history['air_mass_trapped'].append(self.cylinder.state['air_mass_trapped'])
            self.history['volumetric_efficiency'].append(self.cylinder.state['volumetric_efficiency'])
            self.history['intake_vanos_angle'].append(self.cylinder.current_intake_vanos)
            self.history['exhaust_vanos_angle'].append(self.cylinder.current_exhaust_vanos)
            self.history['intake_valve_timing'].append([intake_opening, intake_closing])
            self.history['exhaust_valve_timing'].append([exhaust_opening, exhaust_closing])
            self.history['valve_overlap'].append(valve_overlap_details['duration'])
            self.history['valve_overlap_details'].append(valve_overlap_details)
        
        print("シミュレーション完了")
        return self.history

    def compare_vanos_settings(self, rpm=3000, load=50, vanos_changes_list=None):
        """
        複数のVANOS設定を比較
        
        Args:
            rpm: エンジン回転数
            load: 負荷 (%)
            vanos_changes_list: VANOS変更のリスト
                例: [
                    {'name': 'Stock', 'changes': None},
                    {'name': '+10deg Intake', 'changes': {'intake': 10}},
                    {'name': '-5deg Exhaust', 'changes': {'exhaust': -5}}
                ]
        """
        if vanos_changes_list is None:
            vanos_changes_list = [
                {'name': 'Stock', 'changes': None},
                {'name': '+10deg Intake Advance', 'changes': {'intake': 10}},
                {'name': '+20deg Intake Advance', 'changes': {'intake': 20}},
                {'name': '-10deg Exhaust Retard', 'changes': {'exhaust': -10}}
            ]
        
        results = {}
        
        for setting in vanos_changes_list:
            print(f"\n=== {setting['name']} ===")
            history = self.run_simulation(rpm, load, setting['changes'])
            
            # 最後のサイクルの平均値を計算
            last_cycle_start = len(history['crank_angle']) - int(720 / self.config['simulation']['crank_angle_step'])
            
            avg_ve = np.mean(history['volumetric_efficiency'][last_cycle_start:])
            avg_air_mass = np.mean(history['air_mass_trapped'][last_cycle_start:])
            max_pressure = np.max(history['pressure'][last_cycle_start:])
            
            results[setting['name']] = {
                'history': history,
                'avg_volumetric_efficiency': avg_ve,
                'avg_air_mass_trapped': avg_air_mass,
                'max_cylinder_pressure': max_pressure,
                'intake_vanos': history['intake_vanos_angle'][-1],
                'exhaust_vanos': history['exhaust_vanos_angle'][-1]
            }
            
            print(f"平均体積効率: {avg_ve:.3f}")
            print(f"平均充填空気量: {avg_air_mass*1000:.2f} g")
            print(f"最大筒内圧力: {max_pressure/1000:.1f} kPa")
            print(f"インテークVANOS: {history['intake_vanos_angle'][-1]:.1f}°")
            print(f"エキゾーストVANOS: {history['exhaust_vanos_angle'][-1]:.1f}°")
        
        return results

    def get_performance_summary(self, results):
        """
        パフォーマンス比較サマリーを生成
        """
        summary = {}
        baseline_name = list(results.keys())[0]  # 最初の設定をベースラインとする
        baseline = results[baseline_name]
        
        for name, result in results.items():
            ve_change = (result['avg_volumetric_efficiency'] - baseline['avg_volumetric_efficiency']) * 100
            air_mass_change = (result['avg_air_mass_trapped'] - baseline['avg_air_mass_trapped']) * 1000
            
            summary[name] = {
                'volumetric_efficiency_change_percent': ve_change,
                'air_mass_change_grams': air_mass_change,
                'volumetric_efficiency': result['avg_volumetric_efficiency'],
                'air_mass_trapped_grams': result['avg_air_mass_trapped'] * 1000
            }
        
        return summary

    def calculate_valve_overlap(self, intake_opening, intake_closing, exhaust_opening, exhaust_closing):
        """
        バルブオーバーラップを計算
        参考スクリプトに基づく正確な方式：sin関数カーブの重複部分を計算
        """
        # 参考スクリプトに基づくバルブリフトカーブ計算
        def calculate_valve_lift_curve(max_lift, duration, max_lift_angle, crank_angles, direction):
            """参考スクリプトと同じ計算方式"""
            start_angle = max_lift_angle - duration / 2
            lift_values = []
            
            for angle in crank_angles:
                # 参考スクリプト: adjustedAngle = direction === 'intake' ? angle : -angle;
                adjusted_angle = angle if direction == 'intake' else -angle
                
                # 参考スクリプト: if (adjustedAngle >= startAngle && adjustedAngle <= startAngle + duration)
                if start_angle <= adjusted_angle <= start_angle + duration:
                    # 参考スクリプト: return maxLift * Math.sin(Math.PI * (adjustedAngle - startAngle) / duration);
                    lift = max_lift * math.sin(math.pi * (adjusted_angle - start_angle) / duration)
                    lift_values.append(lift)
                else:
                    lift_values.append(0.0)
            
            return lift_values
        
        # -360°～360°の角度範囲を生成（参考スクリプトと同じ）
        crank_angles = list(range(-360, 361))
        max_lift = 11.8  # 参考スクリプトでは11.3だが、BMW S54は11.8mm
        duration = 260.0
        
        # インテークとエキゾーストのVANOS角度を取得
        intake_max_lift_angle = self.cylinder.current_intake_vanos
        exhaust_max_lift_angle = self.cylinder.current_exhaust_vanos
        
        # バルブリフトカーブを計算
        intake_lift = calculate_valve_lift_curve(max_lift, duration, intake_max_lift_angle, crank_angles, 'intake')
        exhaust_lift = calculate_valve_lift_curve(max_lift, duration, exhaust_max_lift_angle, crank_angles, 'exhaust')
        
        # オーバーラップ期間を計算（両バルブが同時に開いている角度）
        overlap_angles = []
        overlap_duration = 0
        
        for i, angle in enumerate(crank_angles):
            # 両バルブが0.1mm以上開いている場合をオーバーラップとする
            if intake_lift[i] > 0.1 and exhaust_lift[i] > 0.1:
                overlap_angles.append(angle)
        
        # 連続するオーバーラップ期間を計算
        if overlap_angles:
            overlap_duration = len(overlap_angles)
            overlap_start = overlap_angles[0]
            overlap_end = overlap_angles[-1]
        else:
            overlap_start = 0
            overlap_end = 0
        
        # 0°～720°範囲に変換
        def convert_to_720_range(angle):
            while angle < 0:
                angle += 720
            while angle >= 720:
                angle -= 720
            return angle
        
        return {
            'duration': overlap_duration,
            'start_angle': convert_to_720_range(overlap_start),
            'end_angle': convert_to_720_range(overlap_end),
            'intake_timing': {
                'opening': convert_to_720_range(intake_opening),
                'closing': convert_to_720_range(intake_closing),
                'duration': 260.0,
                'max_lift_angle_atdc': intake_max_lift_angle
            },
            'exhaust_timing': {
                'opening': convert_to_720_range(exhaust_opening),
                'closing': convert_to_720_range(exhaust_closing),
                'duration': 260.0,
                'max_lift_angle_abdc': exhaust_max_lift_angle
            }
        }

if __name__ == "__main__":
    # テスト実行
    simulator = BMWE46M3Simulator()
    
    # 複数のVANOS設定を比較
    results = simulator.compare_vanos_settings(rpm=4000, load=75)
    
    # サマリーを表示
    summary = simulator.get_performance_summary(results)
    print("\n=== パフォーマンス比較サマリー ===")
    for name, data in summary.items():
        print(f"{name}:")
        print(f"  体積効率: {data['volumetric_efficiency']:.3f} ({data['volumetric_efficiency_change_percent']:+.1f}%)")
        print(f"  充填空気量: {data['air_mass_trapped_grams']:.2f}g ({data['air_mass_change_grams']:+.2f}g)")