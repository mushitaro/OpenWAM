
import asyncio
import aiohttp
import json

async def verify():
    async with aiohttp.ClientSession() as session:
        # 1. Connect WS
        async with session.ws_connect('http://localhost:8000/ws/logs') as ws:
            print("Connected to WS")
            
            # 2. Trigger API (Background task)
            async def trigger_api():
                print("Triggering API...")
                url = 'http://localhost:8000/simulate/calibration'
                # Minimal Config
                payload = {
                    "engine": {"displacement": 3.2, "cylinders": 6},
                    "intake": {
                        "plenum_vol": 10.0,
                        "bellmouth": {"length": 100, "diameter": 50, "taper_angle": 0},
                        "itb": {"fitted": False, "diameter": 50, "plate_thickness": 2, "discharge_coeff_map": "default"},
                        "inlet": {"duct_length": 0, "duct_diameter": 0},
                        "type": "stock"
                    },
                    "exhaust": {"type": "stock_csl"},
                    "valvetrain": {"type": "stock"},
                    "simulation": {"rpm_start": 2000, "rpm_end": 2500, "rpm_step": 500} # Small range
                }
                async with session.post(url, json=payload) as resp:
                    print(f"API Status: {resp.status}")
                    txt = await resp.text()
                    # print(f"API Response: {txt[:100]}...")

            asyncio.create_task(trigger_api())

            # 3. Listen
            print("Listening for logs...")
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    print(f"LOG: {msg.data}")
                    if "Calibration Logic Complete" in msg.data or "ERROR" in msg.data:
                        break
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    break
                    
if __name__ == "__main__":
    asyncio.run(verify())
