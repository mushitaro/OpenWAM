"""Measurable-parameter manifest — the single source of truth for the real-engine
measurement sheet (download template + import).

Only *physically measurable* quantities live here: geometry you can put a caliper
on, plus ambient conditions and fuel spec. Calibration / boundary-condition knobs
(wall temps, Wiebe combustion, Chen-Flynn friction, Woschni) are deliberately
excluded — those are tuned to match dyno data, not measured, and stay in the JSON
project / tuner workflow.

Every `path` is a dotted path into the *live frontend SimConfig object*
(see frontend/components/VehicleBuilder.tsx default config), which is also what
gets POSTed to /simulate/run. All paths were verified to exist in the backend
Pydantic SimConfig (backend/app/models.py) as well, so current-value lookup and
downstream validation both work.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Any


@dataclass(frozen=True)
class Param:
    path: str                 # "engine.geometry.bore"
    label_ja: str             # "ボア"
    unit: str                 # "mm" (empty string when dimensionless)
    group: str                # sheet section, e.g. "エンジン本体"
    kind: str                 # "float" | "int" | "bool"
    vmin: Optional[float]     # advisory lower bound (Excel warning, not hard reject)
    vmax: Optional[float]     # advisory upper bound
    how_to: str               # measurement hint shown in the sheet


# Order here == row order in the sheet. Grouped by system; the sheet writes a
# banner row whenever `group` changes.
MEASURABLE: list[Param] = [
    # --- 環境 -------------------------------------------------------------
    Param("environment.ambient_temp", "外気温", "K", "環境", "float", 250.0, 330.0,
          "温度計。K = ℃ + 273.15"),
    Param("environment.ambient_pressure", "外気圧", "Pa", "環境", "float", 90000.0, 105000.0,
          "気圧計。1013 hPa = 101325 Pa"),

    # --- 燃料 -------------------------------------------------------------
    Param("fuel.lcv", "低位発熱量 (LCV)", "J/kg", "燃料", "float", 40.0e6, 46.0e6,
          "燃料スペックシート（ガソリン ≈ 44.0e6）"),
    Param("fuel.density", "燃料密度", "kg/m³", "燃料", "float", 700.0, 800.0,
          "15℃での密度（ガソリン ≈ 750）"),

    # --- エンジン本体 ------------------------------------------------------
    Param("engine.cylinders", "気筒数", "", "エンジン本体", "int", 1.0, 12.0,
          "気筒数を数える"),
    Param("engine.geometry.bore", "ボア", "mm", "エンジン本体", "float", 60.0, 110.0,
          "ボアゲージで上/中/下 3点を計測し平均"),
    Param("engine.geometry.stroke", "ストローク", "mm", "エンジン本体", "float", 60.0, 110.0,
          "クランク行程（ダイヤルゲージ TDC-BDC）または諸元値"),
    Param("engine.geometry.rod_length", "コンロッド長", "mm", "エンジン本体", "float", 100.0, 180.0,
          "コンロッド大端-小端の芯間距離"),
    Param("engine.geometry.compression_ratio", "圧縮比", "", "エンジン本体", "float", 8.0, 15.0,
          "(行程容積＋隙間容積)/隙間容積。ビュレット水置換で燃焼室容積を計測して算出"),

    # --- 吸気系 -----------------------------------------------------------
    Param("intake.plenum_vol", "プレナム容積", "L", "吸気系", "float", 1.0, 20.0,
          "水置換 または CAD 容積"),
    Param("intake.inlet.duct_length", "吸気ダクト長", "mm", "吸気系", "float", 0.0, 1000.0,
          "エアダクト/スノーケル長"),
    Param("intake.inlet.duct_diameter", "吸気ダクト内径", "mm", "吸気系", "float", 30.0, 200.0,
          "ダクト内径"),
    Param("intake.bellmouth.length", "ベルマウス長", "mm", "吸気系", "float", 0.0, 400.0,
          "ファンネル（ベルマウス）長"),
    Param("intake.bellmouth.diameter", "ベルマウス開口径", "mm", "吸気系", "float", 20.0, 120.0,
          "ファンネル開口（小径側）内径"),
    Param("intake.bellmouth.taper_angle", "ベルマウステーパ角", "deg", "吸気系", "float", 0.0, 30.0,
          "(入口径-開口径)/2 と長さから算出した半角"),
    Param("intake.itb.fitted", "独立スロットル(ITB) 装着", "", "吸気系", "bool", None, None,
          "気筒ごとの独立スロットルの有無"),
    Param("intake.itb.diameter", "スロットルボア径", "mm", "吸気系", "float", 20.0, 90.0,
          "スロットルボア内径"),
    Param("intake.itb.plate_thickness", "バタフライ板厚", "mm", "吸気系", "float", 0.5, 6.0,
          "スロットルバルブ板の厚み"),
    Param("intake.runner.upper_length", "ランナー上流長", "mm", "吸気系", "float", 0.0, 300.0,
          "スロットル→EQチューブ分岐 の管長"),
    Param("intake.runner.lower_length", "ランナー下流長", "mm", "吸気系", "float", 0.0, 300.0,
          "EQチューブ分岐→ポート合流 の管長"),
    Param("intake.runner.entry_diameter", "ランナー入口径", "mm", "吸気系", "float", 20.0, 120.0,
          "ランナー入口（ベロシティスタック口）内径"),
    Param("intake.eq_tube.enabled", "イコライズ管 装着", "", "吸気系", "bool", None, None,
          "バランス（イコライゼーション）チューブの有無"),
    Param("intake.eq_tube.stub_diameter", "EQスタブ径", "mm", "吸気系", "float", 5.0, 80.0,
          "EQチューブ・スタブの径"),
    Param("intake.eq_tube.stub_length", "EQスタブ長", "mm", "吸気系", "float", 10.0, 300.0,
          "EQチューブ・スタブ基部長"),

    # --- ヘッド・バルブ ----------------------------------------------------
    Param("engine.head.valves_per_cyl", "1気筒バルブ数", "", "ヘッド・バルブ", "int", 2.0, 5.0,
          "1気筒あたりの吸排気バルブ総数（4バルブ=4）"),
    Param("engine.head.intake_port.diameter", "吸気ポート径", "mm", "ヘッド・バルブ", "float", 20.0, 80.0,
          "吸気ポート径（ポートボアゲージ）"),
    Param("engine.head.intake_port.length", "吸気ポート長", "mm", "ヘッド・バルブ", "float", 30.0, 250.0,
          "吸気ポート通路長"),
    Param("engine.head.exhaust_port.diameter", "排気ポート径", "mm", "ヘッド・バルブ", "float", 20.0, 80.0,
          "排気ポート径"),
    Param("engine.head.exhaust_port.length", "排気ポート長", "mm", "ヘッド・バルブ", "float", 30.0, 250.0,
          "排気ポート通路長"),
    Param("engine.head.intake_valve.diameter", "吸気バルブ傘径", "mm", "ヘッド・バルブ", "float", 20.0, 60.0,
          "吸気バルブ傘（ヘッド）径"),
    Param("engine.head.intake_valve.max_lift", "吸気バルブ最大リフト", "mm", "ヘッド・バルブ", "float", 5.0, 16.0,
          "吸気最大リフト（ダイヤルゲージ or カム諸元）"),
    Param("engine.head.intake_valve.duration", "吸気作動角", "deg", "ヘッド・バルブ", "float", 180.0, 320.0,
          "吸気作動角（カムロブ表 or 諸元）"),
    Param("engine.head.exhaust_valve.diameter", "排気バルブ傘径", "mm", "ヘッド・バルブ", "float", 20.0, 55.0,
          "排気バルブ傘（ヘッド）径"),
    Param("engine.head.exhaust_valve.max_lift", "排気バルブ最大リフト", "mm", "ヘッド・バルブ", "float", 5.0, 16.0,
          "排気最大リフト"),
    Param("engine.head.exhaust_valve.duration", "排気作動角", "deg", "ヘッド・バルブ", "float", 180.0, 320.0,
          "排気作動角"),

    # --- 排気系 -----------------------------------------------------------
    Param("exhaust.headers.primary_length", "一次パイプ長", "mm", "排気系", "float", 100.0, 1000.0,
          "エキマニ一次パイプ長（集合部まで）"),
    Param("exhaust.headers.primary_diameter", "一次パイプ内径", "mm", "排気系", "float", 25.0, 80.0,
          "一次パイプ内径"),
    Param("exhaust.headers.collector_count", "集合部の数", "", "排気系", "int", 1.0, 4.0,
          "集合部（コレクタ）の数。6気筒 3-into-1×2 なら 2"),
    Param("exhaust.headers.collector_dia", "集合部内径", "mm", "排気系", "float", 40.0, 120.0,
          "集合部内径"),
    Param("exhaust.headers.collector_vol", "集合部容積", "L", "排気系", "float", 0.1, 5.0,
          "集合部容積（水置換）"),
    Param("exhaust.catalyst.installed", "触媒 装着", "", "排気系", "bool", None, None,
          "触媒の有無"),
    Param("exhaust.catalyst.cpsi", "触媒セル密度", "cpsi", "排気系", "float", 50.0, 900.0,
          "セル密度（諸元 or 端面のセル数から算出）"),
    Param("exhaust.catalyst.length", "触媒担体長", "mm", "排気系", "float", 50.0, 400.0,
          "触媒担体（モノリス）長"),
    Param("exhaust.catalyst.diameter", "触媒担体径", "mm", "排気系", "float", 50.0, 200.0,
          "触媒担体径"),
    Param("exhaust.section1_1.length", "セクション1 全長", "mm", "排気系", "float", 100.0, 3000.0,
          "セクション1（触媒前後含む）全長"),
    Param("exhaust.section1_1.diameter", "セクション1 内径", "mm", "排気系", "float", 40.0, 120.0,
          "セクション1 パイプ内径"),
    Param("exhaust.section2.length", "セクション2 全長", "mm", "排気系", "float", 100.0, 3000.0,
          "セクション2（H/Xパイプ含む）全長"),
    Param("exhaust.section2.diameter", "セクション2 内径", "mm", "排気系", "float", 40.0, 120.0,
          "セクション2 パイプ内径"),
    Param("exhaust.section3.volume", "マフラー容積", "L", "排気系", "float", 1.0, 40.0,
          "マフラー容積（水置換 or CAD）"),
    Param("exhaust.section3.tailpipe_length", "テールパイプ長", "mm", "排気系", "float", 30.0, 1000.0,
          "テールパイプ長"),
    Param("exhaust.section3.diameter", "マフラー/テール径", "mm", "排気系", "float", 40.0, 120.0,
          "マフラー/テールパイプ径"),
]

# Fast lookup by path (used by the import parser).
BY_PATH: dict[str, Param] = {p.path: p for p in MEASURABLE}

SHEET_SCHEMA = 1  # bump when the sheet layout / column contract changes


def get_by_path(d: Any, path: str) -> Any:
    """Read a dotted path out of a nested dict; None if any segment is missing."""
    cur = d
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def set_by_path(d: dict, path: str, value: Any) -> None:
    """Set a dotted path into a nested dict, creating intermediate dicts."""
    cur = d
    keys = path.split(".")
    for k in keys[:-1]:
        nxt = cur.get(k)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[k] = nxt
        cur = nxt
    cur[keys[-1]] = value
