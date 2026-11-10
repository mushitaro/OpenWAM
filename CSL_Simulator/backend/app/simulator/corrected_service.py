"""Explicit prepared-case adapter for the verified finite-volume C++ model.

No legacy solver fallback, implicit geometry conversion, or global model switch.
Inputs are registered by a local tool and snapshotted before launching.
"""
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import time
import uuid

MODEL = "corrected_fv_v6_clock"
REQUIRED = {"inputs/ports.txt", "inputs/network.txt", "inputs/geometry.txt",
            "native_cycle/thermal_drive_cycle_2_5us.txt", "seed.bin"}


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def save(path, value):
    path = Path(path)
    pending = path.with_suffix(".pending")
    pending.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    os.replace(pending, path)


class CorrectedService:
    def __init__(self, repo):
        self.repo = Path(repo)
        self.home = self.repo / "build" / "corrected_ve_evaluations"
        self.home.mkdir(parents=True, exist_ok=True)
        self.tasks = set()
        self.lock = asyncio.Lock()

    def executables(self):
        folder = self.repo / "build" / "corrected_ve" / "Release"
        paths = [folder / "corrected_ve.exe", folder / "corrected_ve_inspect.exe"]
        if not all(p.is_file() for p in paths):
            raise ValueError("修正モデルが未ビルドです。Source/CorrectedVEをビルドしてください。")
        return paths

    def registry(self):
        path = self.home / "cases.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def catalogue(self):
        available = all((self.repo / "build/corrected_ve/Release" / n).exists()
                        for n in ("corrected_ve.exe", "corrected_ve_inspect.exe"))
        return {"default": "legacy", "corrected_available": available,
                "cases": [{"id": k, "label": v["label"], "conditions": v["conditions"]}
                          for k, v in self.registry().items()]}

    async def command(self, args, timeout):
        proc = await asyncio.create_subprocess_exec(
            *map(str, args), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            **({"creationflags": 0x08000000} if os.name == "nt" else {}))
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout)
            if proc.returncode:
                raise ValueError(f"修正モデル終了コード {proc.returncode}: {err.decode(errors='replace')[-2000:]}")
            return out.decode(), err.decode(errors="replace")
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    def cancel(self):
        for task in list(self.tasks):
            task.cancel()
        return len(self.tasks)

    def last(self):
        path = self.home / "last.json"
        if not path.exists():
            raise FileNotFoundError("修正モデルの保存結果はありません")
        return json.loads(path.read_text(encoding="utf-8"))

    async def run(self, case_id, extent="short", timeout_s=60):
        if extent not in ("short", "cycle"):
            raise ValueError("extent must be short|cycle")
        if not 1 <= timeout_s <= 14400:
            raise ValueError("timeout_s must be 1..14400")
        if self.lock.locked():
            raise ValueError("修正モデルは実行中です。完了または中断後に実行してください。")
        async with self.lock:
            task = asyncio.current_task()
            self.tasks.add(task)
            run_dir = self.home / uuid.uuid4().hex
            run_dir.mkdir()
            started = time.monotonic()
            try:
                case = self.registry().get(case_id)
                if case is None:
                    raise ValueError("未登録の検証ケースです")
                if set(case["files"]) != REQUIRED:
                    raise ValueError("登録入力の集合が不正です")
                if case["conditions"]["rpm"] != 3900:
                    raise ValueError("現在の修正モデルは3900 rpmの登録ケース専用です")
                mref = float(case["reference_air_mass_kg"])
                if not math.isfinite(mref) or mref <= 0:
                    raise ValueError("参照空気質量が不正です")
                exe, inspect = self.executables()
                provenance = {"model": MODEL, "case_id": case_id,
                              "conditions": case["conditions"], "files": case["files"],
                              "binary_sha256": sha(exe), "inspector_sha256": sha(inspect),
                              "reference_air_mass_kg": mref, "extent": extent,
                              "reference_definition": case["reference_definition"],
                              "timeout_s": timeout_s}
                for name, item in case["files"].items():
                    dest = run_dir / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(item["path"], dest)
                    if sha(dest) != item["sha256"]:
                        raise ValueError(f"入力SHA不一致: {name}")
                # The C++ checkpoint reader stages .decode beside its input.
                # Inspect only private snapshots, never historical originals.
                seed = json.loads((await self.command([inspect, run_dir / "seed.bin"], 30))[0])
                target = float(case["short_target"] if extent == "short" else case["cycle_target"])
                if not seed["time"] < target <= seed["time"] + 120 / 3900 + 1e-14:
                    raise ValueError("評価区間が保存状態から1周期以内ではありません")
                args = [exe, run_dir, "E", repr(target), "0.0375", run_dir / "out",
                        run_dir / "seed.bin", str(seed["workers"])]
                provenance.update(command=list(map(str, args)), start_time_s=seed["time"], target_time_s=target)
                save(run_dir / "request.json", provenance)
                out, err = await self.command(args, timeout_s)
                (run_dir / "stdout.txt").write_text(out, encoding="utf-8")
                (run_dir / "stderr.txt").write_text(err, encoding="utf-8")
                if sha(run_dir / "out.initial.bin") != sha(run_dir / "seed.bin"):
                    raise ValueError("再開初期状態がseedと不一致です")
                final = json.loads((await self.command([inspect, run_dir / "out.final.bin"], 30))[0])
                if sha(exe) != provenance["binary_sha256"] or sha(inspect) != provenance["inspector_sha256"]:
                    raise ValueError("実行中にモデルバイナリが変更されました")
                if abs(final["time"] - target) > 1e-14:
                    raise ValueError("要求した終端へ達していません")
                import csv
                with (run_dir / "out.csv").open() as f:
                    rows = list(csv.DictReader(f))
                budget = max(float(row["budget"]) for row in rows)
                if not math.isfinite(budget) or budget > 2e-8:
                    raise ValueError("保存収支基準未達")
                cylinders = []
                for i, (a, b) in enumerate(zip(seed["cylinders"], final["cylinders"])):
                    cylinders.append({**b, "cylinder": i + 1,
                                      "ivc_refreshed": b["ordinal"] > a["ordinal"],
                                      "ve_oxygen_percent": 100 * b["ivc_air_kg"] / mref})
                complete = all(c["ivc_refreshed"] for c in cylinders)
                result = {**provenance, "run_id": run_dir.name,
                          "status": "evaluated" if complete else "short_check_only",
                          "ve_definition": "IVC oxygen-equivalent air / stated reference air mass",
                          "ivc_all_refreshed": complete, "cylinders": cylinders,
                          "elapsed_sec": time.monotonic() - started, "end_time_s": final["time"],
                          "budget_max": budget, "final_sha256": sha(run_dir / "out.final.bin"),
                          "csv_sha256": sha(run_dir / "out.csv"),
                          "strict_convergence_passed": False, "vehicle_accuracy_confirmed": False,
                          "limits": "格子・周期基準未達。実車精度未証明。未更新IVC値はseedからの保持値。Builder条件は適用されません。"}
                save(run_dir / "result.json", result)
                save(self.home / "last.json", result)
                return result
            except BaseException as e:
                save(run_dir / "failure.json", {"model": MODEL, "case_id": case_id,
                     "error": type(e).__name__ + ": " + str(e), "elapsed_sec": time.monotonic() - started})
                raise
            finally:
                self.tasks.discard(task)
