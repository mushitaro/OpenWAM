from fastapi import FastAPI, HTTPException, File, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from .models import SimConfig
from .simulator.simulation_service import SimulationService

# Service Instance
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
SIM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(BASE_DIR))), "CSL_Simulator")

calibration_service = CalibrationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
optimization_service = OptimizationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
simulation_service = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
binary_service = BinaryService()

# ... (omitted code) ...

@app.post("/simulate/run")
async def run_simulation(config: SimConfig):
    """
    Performance Simulation (Full VE Map Generation).
    Runs 20x24 Grid (480 Points) using CSL Breakpoints.
    Uses accurate VANOS lookup for each point.
    """
    try:
        await log_manager.broadcast("INFO: Starting Full VE Map Simulation (20x24 Grid)...")
        result = await simulation_service.run_ve_map_generation(config)
        await log_manager.broadcast("INFO: Simulation Run Completed.")
        return result
    except Exception as e:
        err_msg = f"Sim Error: {str(e)}"
        await log_manager.broadcast(f"ERROR: {err_msg}")
        raise HTTPException(status_code=500, detail=err_msg)

@app.post("/simulate/calibration")
async def run_calibration(config: SimConfig):
    """
    Triggers the Full Calibration Loop:
    1. Iterates 20x24 Table
    2. Compares with Stock Target
    3. Auto-Adjusts Model Coefficients (Self-Learning)
    """
    try:
        await log_manager.broadcast("INFO: Starting Calibration Loop (Heavy Process)...")
        # ... implementation to be updated ...
        # For now, we return dummy success or call the old logic BUT we know it needs update
        # We will keep the endpoint active but User knows it needs work
        # Let's call calibration_service.calibrate (which we will refactor to be the loop)
        results = await calibration_service.calibrate(config, binary_service, log_manager.broadcast)
        return results
    except Exception as e:
        # ... error handling ...
        raise HTTPException(status_code=500, detail=str(e))
@app.post("/simulate/optimization")
async def run_optimization(config: SimConfig):
    """
    Triggers Auto-Optimization (VANOS Sweep).
    Returns Full Map Optimization Results.
    """
    try:
        await log_manager.broadcast("INFO: Starting Optimization Loop (Full Map)...")
        
        # Call the new async full map optimization
        results = await optimization_service.optimize_full_map(config)
        
        await log_manager.broadcast("INFO: Optimization Completed.")
        return results
    except Exception as e:
        err_msg = f"Optimization API Error: {str(e)}"
        await log_manager.broadcast(f"ERROR: {err_msg}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await log_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, maybe receive commands (optional)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except Exception:
        log_manager.disconnect(websocket)

# Legacy Debug Run (keep for compatibility or remove if replaced)
@app.websocket("/ws/debug/run")
async def websocket_run_simulation(websocket: WebSocket):
    await websocket.accept()
    try:
        # Wait for Config JSON
        data = await websocket.receive_text()
        import json
        config_dict = json.loads(data)
        config = SimConfig(**config_dict) # Parse Pydantic
        
        # Stream Log
        async for line in calibration_service.run_simulation_async(config):
            await websocket.send_text(line)
            
        await websocket.send_text("END_OF_STREAM")
        await websocket.close()
            
    except Exception as e:
        # If connection open, send error
        try:
             await websocket.send_text(f"ERROR: {str(e)}")
             await websocket.close()
        except:
             pass
