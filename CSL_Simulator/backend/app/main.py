import os
import json

from fastapi import FastAPI, HTTPException, File, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .models import SimConfig
from .log_manager import log_manager
from .simulator.simulation_service import SimulationService

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
    optimization_service = OptimizationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
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


# NOTE: calibration + optimization are M4-scope (UX_APP_DEV_SPEC §7). The legacy
# implementations spawn unmanaged solver subprocesses (orphan-on-error) and use a
# stale exe path. Disabled in M1 so they can't be triggered from the UI; the
# surrogate-proposes/sim-disposes optimizer lands in M4.
@app.post("/simulate/calibration")
async def run_calibration(config: SimConfig):
    raise HTTPException(status_code=501, detail="Calibration loop lands in Milestone 2/4 (not enabled in M1)")


@app.post("/simulate/optimization")
async def run_optimization(config: SimConfig):
    raise HTTPException(status_code=501, detail="VANOS optimizer lands in Milestone 4 (not enabled in M1)")


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
@app.post("/binary/upload")
async def binary_upload(file: UploadFile = File(...)):
    if binary_service is None:
        raise HTTPException(status_code=503, detail="BinaryService unavailable")
    data = await file.read()
    with open(UPLOADED_BIN, "wb") as f:
        f.write(data)
    return {"status": "ok", "filename": file.filename, "bytes": len(data)}


@app.post("/binary/patch")
async def binary_patch(payload: dict):
    raise HTTPException(status_code=501, detail="Binary patch wiring lands in M4")


@app.get("/binary/download")
async def binary_download():
    if not os.path.exists(UPLOADED_BIN):
        raise HTTPException(status_code=404, detail="no uploaded binary")
    return FileResponse(UPLOADED_BIN, filename="patched_mss54.bin")


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
