import asyncio
from typing import List
from fastapi import WebSocket

class LogManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Handle broken pipes
                pass

    def log(self, message: str):
        """
        Sync wrapper to schedule broadcast on the event loop.
        Useful for calling from synchronous code.
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self.broadcast(message))
            else:
                # If no loop (e.g. startup/shutdown), ignore or print
                print(f"[LogManager Fallback] {message}")
        except RuntimeError:
             # Look for running loop
             pass

# Global Instance
log_manager = LogManager()
