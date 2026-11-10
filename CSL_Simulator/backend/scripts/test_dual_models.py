"""Bounded adapter/API regression. Requires built corrected executables + a registered case."""
from pathlib import Path
import asyncio
import copy
import json
import sys
import uuid
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app import main
from app.models import SimConfig
from app.simulator.corrected_service import CorrectedService, save

repo = Path(__file__).resolve().parents[3]
source = CorrectedService(repo)
service = CorrectedService(repo)
service.home = repo / "build/dual_model_regression" / uuid.uuid4().hex
service.home.mkdir(parents=True)
entries = source.registry()
assert entries, "Register a case first"
case_id = next(iter(entries))
save(service.home / "cases.json", entries)
client = TestClient(main.app)
checks = []

with patch.object(main, "corrected_service", service):
    assert client.get("/simulate/models").json()["default"] == "legacy"
    assert client.get("/simulate/corrected/last").status_code == 404
    fake = {"model": "legacy", "overall": {"verdict": "synthetic", "score": 0}, "elapsed_sec": 0}
    with patch.object(main.simulation_service, "run_ve_map_generation", AsyncMock(return_value=fake)) as legacy:
        assert client.post("/simulate/run", json=SimConfig().model_dump()).json()["model"] == "legacy"
        assert legacy.await_count == 1
        assert client.post("/simulate/run?model=corrected", json=SimConfig().model_dump()).status_code == 422
        assert legacy.await_count == 1
    checks.append("default legacy dispatch; no corrected-to-legacy fallback")
    for body in [{"case_id": case_id, "model": "unknown"},
                 {"case_id": case_id, "extent": "unbounded"},
                 {"case_id": case_id, "timeout_s": 14401},
                 {"case_id": case_id, "rpm": 3100}]:
        assert client.post("/simulate/corrected/run", json=body).status_code == 422
    assert client.post("/simulate/corrected/run", json={"case_id": "absent"}).status_code == 400
    checks.append("unknown model/case/extent, unbounded time and unsupported condition rejected")
    res = client.post("/simulate/corrected/run", json={"case_id": case_id, "extent": "short", "timeout_s": 60})
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["model"] == "corrected_fv_v6_clock"
    assert result["status"] == "short_check_only" and not result["ivc_all_refreshed"]
    assert client.get("/simulate/corrected/last").json() == result
    assert json.loads((service.home / result["run_id"] / "result.json").read_text()) == result
    checks.append("real C++ short interval; initial equality; budget; API save/reload; retained IVC labelled")
    bad = copy.deepcopy(entries)
    bad[case_id]["files"]["seed.bin"]["sha256"] = "0" * 64
    save(service.home / "cases.json", bad)
    assert client.post("/simulate/corrected/run", json={"case_id": case_id}).status_code == 400
    assert client.get("/simulate/corrected/last").json() == result
    checks.append("tampered input rejected; prior successful result preserved")


async def interruption():
    import psutil
    for cancel in (False, True):
        pidfile = service.home / ("cancel.pid" if cancel else "timeout.pid")
        code = f"import os,time;open({str(pidfile)!r},'w').write(str(os.getpid()));time.sleep(10)"
        task = asyncio.create_task(service.command([sys.executable, "-c", code], .5 if not cancel else 10))
        if cancel:
            for _ in range(100):
                if pidfile.exists(): break
                await asyncio.sleep(.01)
            task.cancel()
        try:
            await task
            raise AssertionError("did not interrupt")
        except (asyncio.CancelledError, TimeoutError):
            pass
        assert pidfile.exists()
        assert not psutil.pid_exists(int(pidfile.read_text()))
    async with service.lock:
        try:
            await service.run(case_id)
            raise AssertionError("duplicate run accepted")
        except ValueError:
            pass


asyncio.run(interruption())
checks.append("timeout and cancellation reap real child; duplicate run rejected")
save(service.home / "verification.json", {"passed": True, "checks": checks, "result_run": result["run_id"],
     "long_solver_runs": 0, "legacy_solver_mocked": True, "corrected_short_solver_real": True})
print(json.dumps({"passed": True, "checks": checks, "evidence": str(service.home)}, indent=2))
