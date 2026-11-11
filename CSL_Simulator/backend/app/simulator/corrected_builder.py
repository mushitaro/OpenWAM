"""Builder -> finite-volume inputs. No stored 3900 rpm state or native run.

Capture the *emitted* Builder tables, including its rounding and study overrides.
The corrected kernel uses its own EOS, sources and cold initialization; this is
not a claim of equivalence to the legacy thermal/combustion model.
"""
import contextlib
from collections import Counter
import io
import json
import math
import os
import re
from pathlib import Path

from .wam_generator import WAMGenerator
from .corrected_service import sha, save


class CapturedBuilder(WAMGenerator):
    def __init__(self, config, output_dir):
        super().__init__(config, str(output_dir))
        self.captured_valves = {}
        self.captured_volumes = {}

    def _capture(self, method, vid, *args, **kwargs):
        start = len(self.wam_lines_valves)
        method(vid, *args, **kwargs)
        self.captured_valves[vid] = self.wam_lines_valves[start:]

    def _add_valve_def(self, vid, *args, **kwargs):
        self._capture(super()._add_valve_def, vid, *args, **kwargs)

    def _add_valve_fixed_cd(self, vid, *args, **kwargs):
        self._capture(super()._add_valve_fixed_cd, vid, *args, **kwargs)

    def _add_valve_throttle_mariposa(self, vid, *args, **kwargs):
        self._capture(super()._add_valve_throttle_mariposa, vid, *args, **kwargs)

    def _add_plenum(self, plid, label, *args, **kwargs):
        super()._add_plenum(plid, label, *args, **kwargs)
        self.captured_volumes[plid] = (label, list(map(float, self.wam_lines_plenums[-1].split())))


def generate(config, folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    e, env = config.engine, config.environment
    geo, cmb = e.geometry, e.combustion
    values = config.model_dump(mode="json")
    # Reject NaN throughout, not only in the three visible operating controls.
    json.dumps(values, allow_nan=False)
    if e.cylinders != 6 or e.head.valves_per_cyl != 4:
        raise ValueError("Builder corrected model supports six cylinders / four valves per cylinder")
    if not (0 < e.rpm <= 20000 and 0 <= e.throttle_position <= 1):
        raise ValueError("RPM must be positive and <=20000; RO must be 0..100")
    if not (geo.bore > 0 and geo.stroke > 0 and geo.rod_length > geo.stroke/2 and geo.compression_ratio > 1):
        raise ValueError("Invalid engine geometry")
    if not (200 <= env.ambient_temp <= 6000 and env.ambient_pressure > 0):
        raise ValueError("Ambient state outside corrected EOS domain")
    if not (0 < cmb.duration < 720 and cmb.shape_parameter_m >= 0 and cmb.efficiency_a > 0):
        raise ValueError("Invalid combustion law")
    if config.fuel.lcv != 44000000 or float(os.environ.get("OPENWAM_FUEL_LHV", "44000000")) != 44000000:
        raise ValueError("Corrected reaction contract requires LHV=44000000 J/kg")
    from . import calibration_constants as calib
    sigma_points = calib.thr_sigma_points(calib.load(str(Path(__file__).parents[1] / "data")))
    capture = io.StringIO()
    with contextlib.redirect_stdout(capture):
        g = CapturedBuilder(config, folder)
        # Same RO -> throttle opening as the legacy path: simulation_service
        # injects the calibrated sigma(pedal) table (calibration.json, sigma =
        # RO/100 since Stage 77). Without it the generator falls back to the
        # geometric pedal law and the SAME RO opens the throttles far less
        # (2400 rpm / RO 7.5 %: total area 2.0e-5 vs 8.1e-4 m2), so the two
        # selectable models would not be run at the same operating point.
        g._sigma_bp = sigma_points
        # Builder edits start_angle; ignition_timing is a legacy sweep field.
        deck = g.generate(ignition_timing=-cmb.start_angle)
    (folder / "builder.wam").write_text(deck, encoding="utf-8")
    (folder / "generation.log").write_text(capture.getvalue(), encoding="utf-8")
    save(folder / "config.json", values)
    lines = [f"THERMAL_INTAKE_V1 {len(g.pipes)} {len(g.connections)} {len(g.captured_volumes)}"]
    for pid, p in g.pipes.items():
        if min(p['length'], p['d_start'], p['d_end'], p['dx_mesh']) <= 0:
            raise ValueError(f"Invalid pipe geometry {pid}")
        cells = max(2, math.ceil(p['length']/p['dx_mesh']))
        if cells > 100000:
            raise ValueError("Pipe mesh exceeds supported size")
        lines.append(f"{pid} {p['length']:.17g} {p['d_start']:.17g} {p['d_end']:.17g} {cells} {p['left_node']+1} {p['right_node']+1}")
    degrees = Counter(p[side] for p in g.pipes.values() for side in ('left_node','right_node'))
    conversions = []
    for cid, (kind, data) in g.connections.items():
        if kind == 12 and degrees[cid] == 2:
            conversions.append({"node":cid,"from":12,"to":6,"reason":"two-ended Builder junction -> area-change interface"})
            kind = 6
        target = valve = 0
        if kind in (7, 8, 11):
            target = int(data[0].split()[1]); valve = int(data[1])
        elif kind == 10 and len(data) == 1 and float(data[0]) < 0:
            valve = -int(float(data[0]))
        elif kind not in (6, 12):
            raise ValueError(f"Unsupported Builder boundary {cid}: type {kind}, {data}")
        lines.append(f"{cid+1} {kind} {target} {valve}")
    for vid, (_, v) in g.captured_volumes.items():
        if v[0] <= 0:
            raise ValueError(f"Builder rounded volume {vid} to zero")
        lines.append(f"{vid} {v[0]:.17g}")
    (folder / "geometry.txt").write_text('\n'.join(lines)+'\n', encoding="ascii")
    # Ordered compact stream with explicit counts; parsed without a JSON dependency.
    lam = float(os.environ.get("OPENWAM_LAMBDA_WOT", "1"))
    if not math.isfinite(lam) or lam <= 0:
        raise ValueError("Invalid lambda override")
    phi = float(f"{1/lam:.4f}") if e.throttle_position >= .85 else 1.
    efficiency = .98 if phi <= 1 else round(.98-.30*(1-lam), 4)
    params = ["BUILDER_FV_V1", f"{e.rpm} {env.ambient_pressure} {env.ambient_temp}",
              f"{geo.bore/1000} {geo.stroke/1000} {geo.rod_length/1000} {geo.compression_ratio}",
              f"{cmb.start_angle} {cmb.duration} {cmb.shape_parameter_m} {cmb.efficiency_a} {phi} {efficiency}",
              str(len(g.captured_valves))]
    for vid, data in sorted(g.captured_valves.items()):
        kind = int(data[0]); params.append(f"{vid} {kind}")
        if kind == 0:
            params.append(' '.join(data[1].split()[:2]))
        elif kind == 1:
            h = data[1].split()
            params.append(f"{h[0]} {h[1]} {h[2]} {h[3]}")
            params.extend(data[2:6])
        elif kind == 10:
            n = int(data[1].split()[0])
            params.extend(data[1:2+n+1])
        else:
            raise ValueError(f"Unsupported valve type {kind}")
    params.append(str(len(g.captured_volumes)))
    for vid, (label, v) in sorted(g.captured_volumes.items()):
        # Open ambient boundaries only. H junctions retain Builder's explicit volume.
        ambient = 'ambient' in label.lower() or 'atmos' in label.lower()
        params.append(f"{vid} {int(ambient)} {env.ambient_pressure if ambient else v[1]*1e5} {env.ambient_temp}")
    params.append(str(len(g.pipes)))
    for pid, p in sorted(g.pipes.items()):
        pressure = p.get('init_p')
        params.append(f"{pid} {env.ambient_pressure if pressure is None else pressure*1e5} {env.ambient_temp} {p['friction']}")
    (folder / "controls.txt").write_text('\n'.join(params)+'\n', encoding="ascii")
    generator_path = Path(__file__).with_name('wam_generator.py')
    known_overrides = set(re.findall(r'[\"\'](OPENWAM_[A-Z0-9_]+)[\"\']', generator_path.read_text(encoding='utf-8')))
    manifest = {"schema": "builder_fv_v1", "rpm": e.rpm, "ro": 100*e.throttle_position,
                "initialization": "Builder pipe/plenum pressure and ambient T; open cylinders ambient; closed cylinders polytropic pV^1.36 anchored at ambient IVC; no prior seed or initial fuel",
                "pipes": g.pipes, "volumes": g.captured_volumes, "valves": g.captured_valves, "boundary_conversions":conversions,
                "throttle_sigma_points": sigma_points,
                "environment_overrides": {k:os.environ[k] for k in sorted(known_overrides) if k in os.environ},
                "generator_sources": {str(p):sha(p) for p in (Path(__file__),generator_path,Path(__file__).parents[1]/'models.py')},
                "closures": {"cylinder_wall_temperature_k":333.15, "pipe_heat":"adiabatic (retained corrected closure)",
                             "pipe_friction":"Builder roughness mm -> Darcy via Reynolds number (laminar 64/Re, turbulent Haaland)", "fuel_temperature_k":333.15,
                             "h_storage":"Builder explicit volumes retained; not the historical zero-storage H topology",
                             "reference":"ambient NASA dry-air density times per-cylinder displacement"},
                "files": {n:sha(folder/n) for n in ('geometry.txt','controls.txt','config.json','builder.wam')}}
    save(folder / "input_manifest.json", manifest)
    return manifest
