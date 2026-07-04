---
name: csl-simulator-run
description: Launch, run, and verify the CSL_Simulator app (the OpenWAM engine-simulation UX — Next.js frontend + FastAPI backend — in this repo). Use whenever asked to run, start, launch, preview, or verify/test the CSL Simulator, CSL SIM UX, VehicleBuilder, or the OpenWAM UX app, including after any code change under CSL_Simulator/frontend or CSL_Simulator/backend — even if the request is as short as "動作確認して" or "動かして" without naming the app. Also consult this BEFORE claiming a CSL_Simulator change works, since the embedded preview tool alone cannot verify anything that calls the backend and a false "it works" claim is worse than admitting you couldn't check.
---

# CSL_Simulator — launch & verify

CSL_Simulator (`CSL_Simulator/`) is a Next.js frontend (`frontend/`, port 3000) + FastAPI backend (`backend/`, port 8000) that drives the OpenWAM solver to tune/simulate a BMW S54/CSL engine. This skill exists mainly to record one hard limitation of the embedded preview in this environment — re-discovering it by trial and error costs a full debugging cycle every time, so read the gotcha section even if you skim the rest.

## Launch

`.claude/launch.json` at the repo root already has both server configs — use `preview_start` with `name: "backend"` and `name: "frontend"` rather than hand-rolling the commands.

### Always stop what's already running first, then start fresh

Make a clean restart the default every time you launch — don't start a second instance on top of a leftover one. This repo accumulates orphaned dev servers: a `next dev` from a prior session that still holds `.next/dev/lock` (so a fresh start fails with "port already in use" or "Unable to acquire lock ... is another instance of next dev running?"), and — more insidiously — a backend that's been up for hours from an unrelated session (we've seen one running 8+ hours). A stale backend is the dangerous one: it carries its own in-memory run/cancel state, so a Run you trigger can collide with whatever that old process was doing and come back as **`run cancelled — finished cells are cached; re-run to resume`** even though you never touched Cancel. That symptom almost always means "a leftover backend is confusing things," not a real bug — the fix is the clean restart below, not debugging the solver.

Before `preview_start`:

1. If this session is tracking a preview server, `preview_stop` it (check with `preview_list`).
2. Kill whatever still holds either port — target the port owners, don't blanket-kill `node`/`python` by name (that risks unrelated work):
   ```powershell
   Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue |
     Select-Object -ExpandProperty OwningProcess -Unique |
     ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
   ```
   Ports 3000 and 8000 only ever serve this app in this repo, so clearing them here is safe. If you want to see what you're about to kill first, `Get-NetTCPConnection -LocalPort 3000,8000 -State Listen` and inspect the owning PIDs' `StartTime`/`CommandLine`.
3. Now `preview_start` both, fresh.

**After a code change, a plain restart is not enough — clear `.next` too.** A `next dev` server can regenerate its server-side (SSR) chunks on restart while serving **stale client static chunks** from `.next/dev/static/` — so the browser keeps showing the OLD UI even though the source and `git` are correct and the server was restarted after the change landed. If someone reports "my change isn't showing" and the source on disk is right, this is almost certainly it. Fix: stop the frontend, `rm -rf CSL_Simulator/frontend/.next`, restart, and have them hard-refresh (Ctrl+Shift+R). This is worth doing as a matter of course whenever you restart the frontend to pick up a change, not only after it's already gone wrong.

**Preview viewport note:** the embedded preview's headless browser can report `window.innerWidth === 0`, which collapses `flex-1` panes to width 0 and makes layout/position measurements meaningless. Before measuring geometry, `preview_resize` to an explicit width/height (e.g. 1440×900) — DOM reads via `preview_eval` are reliable, but `preview_screenshot` may time out in this environment, so lean on `preview_eval`/`preview_snapshot` for proof.

### Server configs

- **backend** — `python -m uvicorn app.main:app --port 8000`, cwd `CSL_Simulator/backend`. No venv / `pip install` step needed: fastapi/uvicorn resolve from the global `python` already. Port 8000 is **not** flexible — `CSL_Simulator/frontend/app/api.ts` hardcodes `const API_BASE_URL = "http://localhost:8000"` (and `WS_BASE_URL` the same way), which is why `launch.json` pins `autoPort: false` for this one. Leave that alone.
- **frontend** — `npm run dev`, cwd `CSL_Simulator/frontend`, Next.js on port 3000 (`autoPort: true`, since nothing else hardcodes this port).

## The gotcha: the embedded preview cannot reach the backend

Confirmed by actually running both servers end-to-end and testing which interactions work through `preview_*` tools versus which don't.

**Works fine through `preview_*` tools** — anything that's pure frontend React state: clicking the Builder-mode topology diagram, checking which parameter panel appears for a given selection, editing input fields, verifying layout. None of it touches the backend, so `preview_eval` / `preview_snapshot` / `preview_click` verify it correctly and the result can be trusted.

**Does NOT work through `preview_*` tools** — anything that calls the FastAPI backend: "Run WOT Quick", "Run Full Map", "Run VANOS Tuning", anything hitting `/simulate/*` or the `/ws/logs` websocket. The sandboxed preview's network isolation only reaches the frontend's own port; a fetch from inside that sandbox to `localhost:8000` fails with "Failed to fetch" even when the backend is running and healthy. This is a property of the sandbox, not a bug in the app or the backend — don't go debugging the backend when you see it.

If a feature you need to verify calls the backend, there is no way to check it through the embedded preview in this environment, full stop. Say that explicitly, start both servers, and ask the person to open **their own real browser** at `http://localhost:3000` to confirm it. Don't report a backend-calling feature as "verified" off the back of an embedded-preview click that never actually reached the backend — that's a false positive waiting to be discovered later.

## Solver binary

The backend shells out to `OpenWAM.exe`, resolved in this order: `build_ux/bin/release/` → `build/bin/release/` → `bin/release/`. The committed root-level `OpenWAM.exe` and the `bin/release/` copy are stale — they're missing the env-var gates (`OPENWAM_HLLC`, `THR_CHOKE`, `MOUTH_RAD`, `VEDIAG`, etc.) the app relies on for determinism and correct WOT behavior.

**Check this before trusting any simulation result, not just when something looks wrong**: a fresh checkout of this repo has no `build_ux/` directory at all, so right now the backend silently falls back to the stale `build/bin/release/OpenWAM.exe` — it will run without error, it'll just be quietly wrong (non-deterministic WOT, no damping gates). This doesn't matter for pure UI/diagram verification (nothing calls the solver), but it matters the moment you — or the person you hand off to — actually click Run and look at the numbers. Confirm `build_ux/bin/release/OpenWAM.exe` exists first; if not, build it:

```
cmake -S . -B build_ux -G "Visual Studio 17 2022" -A x64
cmake --build build_ux --config Release
```

Success looks like a `Build succeeded` tail and a new `build_ux/bin/release/OpenWAM.exe`; this is a full C++ solver build, so budget several minutes, not seconds — a long silence isn't necessarily stuck.

## If you're actually running a simulation (not just clicking through the UI)

Solver cells are only bitwise-reproducible at `OMP_NUM_THREADS=1` — the OpenMP build is non-deterministic at WOT. The app's own request handling in `simulation_service.py` should already set this correctly for anything driven through the UI/API; this is only a concern if you're tempted to invoke the solver directly, outside the app.
