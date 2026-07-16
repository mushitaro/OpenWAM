import os
import json

from fastapi import FastAPI, HTTPException, File, UploadFile, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .models import SimConfig
from .log_manager import log_manager
from .simulator.simulation_service import SimulationService
from .parameters.sheet import build_sheet, parse_sheet

# --- Paths ------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))          # .../CSL_Simulator/backend/app
DATA_DIR = os.path.join(BASE_DIR, "data")
SIM_DIR = os.path.dirname(os.path.dirname(BASE_DIR))           # .../CSL_Simulator

# --- Services ---------------------------------------------------------------
simulation_service = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)

# Optional services (not on the M1 Run path). Import defensively so a broken
# calibration/optimization module can never block the server from starting.
try:
    from .simulator.calibration_service import CalibrationService
    calibration_service = CalibrationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
except Exception as e:           # pragma: no cover
    print(f"WARN: CalibrationService unavailable: {e}")
    calibration_service = None
try:
    from .simulator.optimization_service import OptimizationService
    # share the SimulationService so the optimizer uses the same orphan-safe
    # _run_solver, exe resolution and deck cache as the Run path.
    optimization_service = OptimizationService(
        data_dir=DATA_DIR, simulator_dir=SIM_DIR, sim_service=simulation_service)
except Exception as e:           # pragma: no cover
    print(f"WARN: OptimizationService unavailable: {e}")
    optimization_service = None
try:
    from .binary_patcher.binary_service import BinaryService
    binary_service = BinaryService()
except Exception as e:           # pragma: no cover
    print(f"WARN: BinaryService unavailable: {e}")
    binary_service = None

# --- App --------------------------------------------------------------------
app = FastAPI(title="CSL Simulator API", version="m1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOADED_BIN = os.path.join(DATA_DIR, "uploaded_mss54.bin")


@app.get("/")
async def root():
    return {"status": "ok", "service": "CSL Simulator API", "version": "m1"}


@app.get("/meta")
async def get_meta():
    """Current backend provenance (Stage 74): the frontend compares a loaded
    result's sim_binary_sig / schema_version against this to flag STALE runs
    (e.g. the pre-Stage-74 last_run files are legacy-unit x1.0573 low)."""
    from .simulator import metrics as M
    try:
        sig = simulation_service._sim_binary_sig()
    except Exception:
        sig = "unknown"
    return {
        "app_version": app.version,
        "sim_binary_sig": sig,
        "schema_version": M.SCHEMA_VERSION,
        "unit": M.mref_mode(),
        "m_ref_mg": round(M.m_ref_mg(87.0, 91.0, 101325.0, 298.0), 2),
        "model_limits": M.MODEL_LIMITS,
    }


@app.get("/maps")
async def get_maps():
    """OEM ECU maps (VE / VANOS) used for axes + VANOS lookup."""
    try:
        with open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), "r") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"maps load error: {e}")


@app.post("/simulate/run")
async def run_simulation(config: SimConfig, mode: str = "wot_quick"):
    """VE map run. mode="wot_quick" (20 WOT cells) | "full_map" (480 cells).

    Returns the structured + instrumented response (axes/cells/rows/overall/
    stock_curve) and appends one Phase-A record per cell to the RunStore.
    """
    if mode not in ("wot_quick", "full_map"):
        raise HTTPException(status_code=400, detail="mode must be wot_quick|full_map")
    try:
        await log_manager.broadcast(f"INFO: Starting VE Map ({mode})...")
        result = await simulation_service.run_ve_map_generation(config, mode=mode)
        await log_manager.broadcast(
            f"INFO: Run done — {result['overall']['verdict']} "
            f"(score {result['overall']['score']}, {result['elapsed_sec']}s)")
        return result
    except Exception as e:
        msg = f"Sim Error: {e}"
        await log_manager.broadcast(f"ERROR: {msg}")
        raise HTTPException(status_code=500, detail=msg)


@app.post("/simulate/cancel")
async def cancel_runs():
    """M5: cancel every in-flight simulation task (map run / tuning / waveform).

    Task cancellation reaches _run_solver's finally, which kills the solver
    child — no orphans, CPU freed immediately. Finished cells remain in the
    deck cache, so re-running the same request RESUMES from where it stopped.
    """
    n = simulation_service.cancel_active()
    await log_manager.broadcast(f"INFO: Cancel requested — {n} in-flight sim task(s) cancelled.")
    return {"cancelled_tasks": n}


@app.get("/simulate/last")
async def last_run(mode: str = "full_map"):
    """Return the last assembled run of `mode` persisted by run_ve_map_generation.

    Lets the UI recover a long full_map whose HTTP response was lost (browser
    'Failed to fetch' on an hours-long request) without re-running -- the per-cell
    solver work is cached, and the assembled map is saved on completion.
    """
    if mode not in ("wot_quick", "full_map", "optimization"):
        raise HTTPException(status_code=400, detail="mode must be wot_quick|full_map|optimization")
    path = os.path.join(DATA_DIR, f"last_run_{mode}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"no saved {mode} run yet")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"could not read saved run: {e}")


@app.post("/simulate/waveform")
async def run_waveform(config: SimConfig, rpm: float, load: float = 100.0):
    """Crank-angle waveform for ONE cell (UX_APP_DEV_SPEC §6.B-2(ii)).

    Runs a single full-pipe-monitoring sim (FAST_OUTPUT off, to natural end) and
    returns last-complete-cycle in-cylinder pressure + curated intake/exhaust
    pipe pressure & velocity traces. First call for a (config,rpm,load) is a real
    sim (~2-3 min); repeats hit the parsed-waveform cache and are instant.
    """
    if rpm <= 0:
        raise HTTPException(status_code=400, detail="rpm must be > 0")
    if not (0.0 < load <= 100.0):
        raise HTTPException(status_code=400, detail="load must be in (0, 100] %TPS")
    try:
        await log_manager.broadcast(f"INFO: Waveform run rpm={int(rpm)} load={load}...")
        result = await simulation_service.run_waveform_trace(config, rpm=rpm, load=load)
        await log_manager.broadcast(
            f"INFO: Waveform done — {result['status']} "
            f"({len(result.get('cylinders', []))} cyl, {len(result.get('pipes', []))} pipes, "
            f"{result['elapsed_sec']}s)")
        return result
    except Exception as e:
        msg = f"Waveform Error: {e}"
        await log_manager.broadcast(f"ERROR: {msg}")
        raise HTTPException(status_code=500, detail=msg)


# NOTE: the legacy calibration loop spawns unmanaged solver subprocesses
# (orphan-on-error) and uses a stale exe path -- still 501-guarded. The VANOS
# optimizer was REWRITTEN in M4 (below) on the orphan-safe _run_solver path.
@app.post("/simulate/calibration")
async def run_calibration(config: SimConfig):
    raise HTTPException(status_code=501, detail="Calibration loop lands in Milestone 2/4 (not enabled in M1)")


@app.post("/simulate/optimization")
async def run_optimization(config: SimConfig, preference: str = "max_ve",
                           rpms: str = "", budget: int = 16):
    """M4 WOT VANOS tuning (UX_APP_DEV_SPEC §7).

    preference: "max_ve" | "smooth" (user preference -> internal objective).
    rpms: optional comma-separated rpm subset (fast iteration / testing).
    budget: max sim evaluations per rpm cell (deck-cached -> re-runs resume).
    Returns per-rpm stock vs optimized cams + exportable ECU tables; persists
    to last_run_optimization.json (recover via GET /simulate/last?mode=optimization).
    """
    if optimization_service is None:
        raise HTTPException(status_code=503, detail="OptimizationService unavailable")
    if preference not in ("max_ve", "smooth"):
        raise HTTPException(status_code=400, detail="preference must be max_ve|smooth")
    if not (2 <= budget <= 64):
        raise HTTPException(status_code=400, detail="budget must be in [2, 64]")
    rpm_list = None
    if rpms.strip():
        try:
            rpm_list = [float(x) for x in rpms.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="rpms must be a comma-separated number list")
        if not rpm_list:
            raise HTTPException(status_code=400,
                                detail="rpms was given but contains no values")
    try:
        await log_manager.broadcast(
            f"INFO: Starting VANOS tuning ({preference}, budget {budget}/rpm)...")
        result = await optimization_service.optimize_wot(
            config, preference=preference, rpms=rpm_list, budget=budget)
        await log_manager.broadcast(
            f"INFO: Tuning done — {result['n_evals_total']} evals, "
            f"{result['elapsed_sec']}s")
        return result
    except ValueError as e:
        # invalid request surfaced by the service (e.g. rpms off-axis) -> 400,
        # never a silent full-axis run.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        msg = f"Tuning Error: {e}"
        await log_manager.broadcast(f"ERROR: {msg}")
        raise HTTPException(status_code=500, detail=msg)


@app.post("/simulate/topology")
async def get_topology(config: SimConfig):
    """Topology preview for the debug panel. Stubbed in M1 (full build in M3)."""
    try:
        from .simulator.wam_generator import WAMGenerator
        gen = WAMGenerator(config, SIM_DIR)
        pipes = getattr(gen, "pipes", {}) if hasattr(gen, "pipes") else {}
        return {"status": "ok", "n_pipes": len(pipes),
                "pipes": [{"id": pid, **{k: v for k, v in pd.items() if k in ("length",)}}
                          for pid, pd in (pipes.items() if isinstance(pipes, dict) else [])]}
    except Exception:
        return {"status": "not_implemented", "pipes": []}


# --- Binary patcher (not on the M1 path; minimal upload/download) -----------
def _extract_bin_ve_map():
    """Extract the uploaded BIN's base VE map (KF_RF_SOLL, 0xD356, 24x20,
    fractional rl-ratio) and pair it with the canonical axes from
    csl_ecu_maps.json. The BIN's *values* are the per-vehicle ground truth;
    the axes are fixed for the MSS54 CSL platform, so we reuse the repo axes
    (avoids depending on the BIN axis-word scaling). Shape matches the repo
    kf_rf_soll object so the frontend treats both identically."""
    data = binary_service.read_binary(UPLOADED_BIN)
    values = binary_service.read_table_generic(
        data, binary_service.ADDR_VE_MAP, 24, 20, binary_service.VE_FACTOR)
    with open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), "r") as f:
        ax = json.load(f).get("kf_rf_soll", {})
    return {"x_axis": ax.get("x_axis", []), "y_axis": ax.get("y_axis", []), "values": values}


@app.post("/binary/upload")
async def binary_upload(file: UploadFile = File(...)):
    if binary_service is None:
        raise HTTPException(status_code=503, detail="BinaryService unavailable")
    data = await file.read()
    with open(UPLOADED_BIN, "wb") as f:
        f.write(data)
    # Extract the base VE map so the frontend can use THIS BIN as the base
    # reference immediately (falls back to None -> repo kf_rf_soll on the client).
    ve_map = None
    try:
        ve_map = _extract_bin_ve_map()
    except Exception as e:
        print(f"WARN: BIN VE-map extraction failed: {e}")
    return {"status": "ok", "filename": file.filename, "bytes": len(data), "ve_map": ve_map}


@app.get("/binary/ve_map")
async def binary_ve_map():
    """Base VE map (KF_RF_SOLL) extracted from the currently-uploaded BIN.
    Lets the frontend restore the BIN-sourced base after a reload. 404 when no
    BIN has been uploaded -> client falls back to the repo kf_rf_soll."""
    if binary_service is None:
        raise HTTPException(status_code=503, detail="BinaryService unavailable")
    if not os.path.exists(UPLOADED_BIN):
        raise HTTPException(status_code=404, detail="no uploaded binary")
    try:
        return _extract_bin_ve_map()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BIN VE-map extraction failed: {e}")


@app.post("/binary/patch")
async def binary_patch(payload: dict):
    raise HTTPException(status_code=501, detail="Binary patch wiring lands in M4")


@app.get("/binary/download")
async def binary_download():
    if not os.path.exists(UPLOADED_BIN):
        raise HTTPException(status_code=404, detail="no uploaded binary")
    return FileResponse(UPLOADED_BIN, filename="patched_mss54.bin")


# --- Measurement parameter sheet (real-engine values: download / import) ----
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@app.post("/parameters/sheet")
async def parameters_sheet(request: Request):
    """Build an .xlsx fill-in sheet of the physically measurable parameters,
    seeded with the current values from the POSTed (raw) config. Accepts the
    frontend config verbatim (no Pydantic coercion) so the 'current value'
    column mirrors exactly what the user has on screen."""
    try:
        config = await request.json()
    except Exception:
        config = {}
    if not isinstance(config, dict):
        config = {}
    data = build_sheet(config)
    return Response(
        content=data,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="csl_measurement_sheet.xlsx"'},
    )


@app.post("/parameters/import")
async def parameters_import(file: UploadFile = File(...)):
    """Parse a filled measurement sheet into {applied, skipped, warnings}. The
    frontend merges `applied` (path/value pairs) into its live config. Stateless:
    nothing is persisted server-side."""
    data = await file.read()
    try:
        return parse_sheet(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"記入シートを読み取れません: {e}")


# --- WebSockets -------------------------------------------------------------
@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await log_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except Exception:
        log_manager.disconnect(websocket)


@app.websocket("/ws/debug/run")
async def websocket_run_simulation(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_text()
        config = SimConfig(**json.loads(data))
        if calibration_service is None or not hasattr(calibration_service, "run_simulation_async"):
            await websocket.send_text("ERROR: debug run unavailable")
        else:
            async for line in calibration_service.run_simulation_async(config):
                await websocket.send_text(line)
        await websocket.send_text("END_OF_STREAM")
        await websocket.close()
    except Exception as e:
        try:
            await websocket.send_text(f"ERROR: {e}")
            await websocket.close()
        except Exception:
            pass
