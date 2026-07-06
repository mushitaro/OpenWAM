@echo off
rem CSL_Simulator launcher -- double-click to start both servers and open the app.
rem Backend: FastAPI on http://localhost:8000  (fixed port; frontend hardcodes it)
rem Frontend: Next.js on http://localhost:3000
rem Close the two console windows to stop the servers.

echo Stopping any previous CSL_Simulator servers...

rem Kill whatever is listening on 3000/8000 (a closed console window does NOT
rem always kill its child node/python process on Windows -- the old server can
rem keep running invisibly, holding the port AND open handles inside .next,
rem which is what causes "Port 3000 in use -> falls back to 3001" and
rem "Unable to write meta file ... Access denied" on the next start).
rem NOTE: wmic (used here previously) is REMOVED on newer Windows builds
rem (silently "command not found" -> the old cleanup loop was a no-op). Use
rem PowerShell's Get-NetTCPConnection instead, which is always present.
powershell -NoProfile -Command ^
  "Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

rem Also sweep any node.exe still running this frontend's "next dev" (e.g. a
rem build worker like postcss.js that holds file locks but isn't the one
rem listening on the port).
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*CSL_Simulator\frontend*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

rem give Windows a moment to release file handles before touching .next
rem (ping, not timeout: timeout errors out as "Input redirection is not
rem supported" whenever stdin isn't a real console -- ping has no such issue)
ping -n 3 127.0.0.1 >nul

rem stale client chunks / a locked dev cache cause "old UI after update" or
rem "Access denied" errors on the next start
if exist "%~dp0frontend\.next" rmdir /s /q "%~dp0frontend\.next"

start "CSL backend (close to stop)" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --port 8000"
start "CSL frontend (close to stop)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Waiting for the app to come up...
ping -n 13 127.0.0.1 >nul
start http://localhost:3000
echo If the page is blank, wait a few seconds and reload (first compile takes a moment).
