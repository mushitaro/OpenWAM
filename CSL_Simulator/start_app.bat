@echo off
rem CSL_Simulator launcher -- double-click to start both servers and open the app.
rem Backend: FastAPI on http://localhost:8000  (fixed port; frontend hardcodes it)
rem Frontend: Next.js on http://localhost:3000
rem Close the two console windows to stop the servers.

rem kill zombie "next dev" processes holding .next\dev\lock (a stale lock blocks startup)
for /f "tokens=2 delims=," %%p in ('wmic process where "name='node.exe' and commandline like '%%next%%'" get processid /format:csv 2^>nul ^| findstr /r "[0-9]"') do taskkill /pid %%p /f >nul 2>&1

rem stale client chunks cause "old UI after update" -- clear the dev cache
if exist "%~dp0frontend\.next" rmdir /s /q "%~dp0frontend\.next"

start "CSL backend (close to stop)" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --port 8000"
start "CSL frontend (close to stop)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Waiting for the app to come up...
timeout /t 12 /nobreak >nul
start http://localhost:3000
echo If the page is blank, wait a few seconds and reload (first compile takes a moment).
