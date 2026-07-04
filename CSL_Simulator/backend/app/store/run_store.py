"""RunStore -- Phase-A data instrumentation (UX_APP_DEV_SPEC.md §11, SURROGATE_DESIGN.md §3).

Every simulated cell (Run / calibration iteration / optimizer evaluation) appends
ONE record here. This is the embryonic "data lake" that later seeds the fast
tuning surrogate. Design goals:

  * LOCAL-FIRST, zero-setup: a single SQLite file (``data/runs.db``). Compute stays
    on each user's PC, so the owner bears no compute cost.
  * SWAPPABLE: ``RunStore`` is an abstract interface (append / query). The SQLite
    impl can be replaced by a cloud impl (Turso / Cloudflare D1 / Supabase / Neon)
    with NO UI changes -- the cloud goes DB-only.
  * VERSIONED: every row carries ``sim_binary_sig`` + ``sim_code_commit`` + the
    ``calib`` block, so a solver rebuild's data is cleanly separable (a different
    solver is a DIFFERENT function -- never silently mix). See SURROGATE_DESIGN §4.

Raw run.logs are NOT stored here (600 KB-2.4 MB each); only the small (~1 KB)
feature ROW. Keep logs local / in cheap egress-free object storage if needed.
"""
import abc
import json
import os
import sqlite3
import threading

SCHEMA_VERSION = 1


class RunStore(abc.ABC):
    """Abstract append/query interface for the Phase-A data lake."""

    @abc.abstractmethod
    def append(self, record: dict) -> None:
        """Append one feature row. ``record`` follows the SURROGATE_DESIGN §3 schema."""

    @abc.abstractmethod
    def query(self, *, sim_binary_sig=None, run_id=None, has_measured=None,
              limit: int = 1000) -> list:
        """Return matching feature rows (full records), newest first."""

    @abc.abstractmethod
    def count(self) -> int:
        ...


# Columns extracted out of the JSON record for indexed querying. The full record
# is always kept verbatim in the ``record`` JSON blob.
_INDEXED = [
    ("schema_version", "INTEGER"),
    ("sim_binary_sig", "TEXT"),
    ("sim_code_commit", "TEXT"),
    ("run_id", "TEXT"),
    ("ts", "TEXT"),
    ("user_hash", "TEXT"),
    ("engine_hash", "TEXT"),
    ("rpm", "REAL"),
    ("load_tps", "REAL"),
    ("ve", "REAL"),
    ("converged", "INTEGER"),
    ("cyl_collapsed_n", "INTEGER"),
    ("blew_up", "INTEGER"),
    ("measured_ve", "REAL"),
    ("measured_source", "TEXT"),
]


class SQLiteRunStore(RunStore):
    """Single-file SQLite implementation. Thread/async safe via a lock."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL;")
        cols = ",\n  ".join(f"{name} {typ}" for name, typ in _INDEXED)
        self._conn.execute(
            f"CREATE TABLE IF NOT EXISTS runs (\n"
            f"  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  {cols},\n  record TEXT NOT NULL\n);"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_runs_sig ON runs(sim_binary_sig);"
        )
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_run ON runs(run_id);")
        self._conn.commit()

    @staticmethod
    def _extract(record: dict) -> dict:
        sim = record.get("sim", {}) or {}
        meta = record.get("meta", {}) or {}
        op = record.get("op", {}) or {}
        measured = record.get("measured") or {}
        return {
            "schema_version": record.get("schema_version", SCHEMA_VERSION),
            "sim_binary_sig": record.get("sim_binary_sig"),
            "sim_code_commit": record.get("sim_code_commit"),
            "run_id": meta.get("run_id"),
            "ts": meta.get("ts"),
            "user_hash": meta.get("user_hash"),
            "engine_hash": meta.get("engine_hash"),
            "rpm": op.get("rpm"),
            "load_tps": op.get("load_tps"),
            "ve": sim.get("ve"),
            "converged": 1 if sim.get("converged") else 0,
            "cyl_collapsed_n": sim.get("cyl_collapsed_n"),
            "blew_up": 1 if sim.get("blew_up") else 0,
            "measured_ve": (measured or {}).get("ve"),
            "measured_source": (measured or {}).get("source"),
        }

    def append(self, record: dict) -> None:
        cols = self._extract(record)
        names = list(cols.keys()) + ["record"]
        placeholders = ", ".join("?" for _ in names)
        values = [cols[n] for n in cols] + [json.dumps(record, default=str)]
        with self._lock:
            self._conn.execute(
                f"INSERT INTO runs ({', '.join(names)}) VALUES ({placeholders});", values
            )
            self._conn.commit()

    def query(self, *, sim_binary_sig=None, run_id=None, has_measured=None,
              limit: int = 1000) -> list:
        clauses, params = [], []
        if sim_binary_sig is not None:
            clauses.append("sim_binary_sig = ?"); params.append(sim_binary_sig)
        if run_id is not None:
            clauses.append("run_id = ?"); params.append(run_id)
        if has_measured is True:
            clauses.append("measured_ve IS NOT NULL")
        elif has_measured is False:
            clauses.append("measured_ve IS NULL")
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(int(limit))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT record FROM runs{where} ORDER BY id DESC LIMIT ?;", params
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM runs;").fetchone()[0]


_STORE_CACHE = {}
_STORE_LOCK = threading.Lock()


def get_run_store(data_dir: str) -> RunStore:
    """Return the process-wide RunStore. Env CSL_RUNSTORE_PATH overrides the path.

    Swap point for the cloud impl: branch on an env flag here and return a
    CloudRunStore with the same interface -- no caller/UI change needed.
    """
    path = os.environ.get("CSL_RUNSTORE_PATH") or os.path.join(data_dir, "runs.db")
    with _STORE_LOCK:
        store = _STORE_CACHE.get(path)
        if store is None:
            store = SQLiteRunStore(path)
            _STORE_CACHE[path] = store
    return store


def extract_geometry(config) -> dict:
    """Flatten the measured SimConfig geometry into the surrogate's input vector
    (SURROGATE_DESIGN.md §1). Defensive getattr so a partial config never crashes
    instrumentation. Includes the EQ topology selector + rail dims + icv_sigma
    (surrogate features: the rail/ICV change the breathing physics).
    """
    def g(obj, *path, default=None):
        cur = obj
        for p in path:
            cur = getattr(cur, p, None)
            if cur is None:
                return default
        return cur

    eng = getattr(config, "engine", None)
    intake = getattr(config, "intake", None)
    exhaust = getattr(config, "exhaust", None)
    return {
        # intake
        "plenum_vol_l": g(intake, "plenum_vol"),
        "bellmouth_len_mm": g(intake, "bellmouth", "length"),
        "bellmouth_dia_mm": g(intake, "bellmouth", "diameter"),
        "duct_len_mm": g(intake, "inlet", "duct_length"),
        "duct_dia_mm": g(intake, "inlet", "duct_diameter"),
        "duct_exit_w_mm": g(intake, "inlet", "exit_width"),
        "duct_exit_h_mm": g(intake, "inlet", "exit_height"),
        "itb_dia_mm": g(intake, "itb", "diameter"),
        "runner_upper_len_mm": g(intake, "runner", "upper_length", default=15.0),
        "runner_lower_len_mm": g(intake, "runner", "lower_length", default=25.0),
        # EQ system topology (plenum | chain | rail) + rail dims
        "eq_model": g(intake, "eq_tube", "model", default="plenum"),
        "eq_rail_dia_mm": g(intake, "eq_tube", "rail_diameter"),
        "eq_rail_len_mm": g(intake, "eq_tube", "rail_length"),
        "eq_return_dia_mm": g(intake, "eq_tube", "return_pipe_diameter"),
        "eq_return_len_mm": g(intake, "eq_tube", "return_pipe_length"),
        "eq_return_tap": g(intake, "eq_tube", "return_tap"),
        "icv_sigma": g(intake, "eq_tube", "icv_sigma"),
        # head / valvetrain
        "intake_port_len_mm": g(eng, "head", "intake_port", "length"),
        "intake_port_dia_mm": g(eng, "head", "intake_port", "diameter"),
        "exhaust_port_len_mm": g(eng, "head", "exhaust_port", "length"),
        "exhaust_port_dia_mm": g(eng, "head", "exhaust_port", "diameter"),
        "intake_valve_lift_mm": g(eng, "head", "intake_valve", "max_lift"),
        "intake_valve_dur_deg": g(eng, "head", "intake_valve", "duration"),
        "intake_valve_dia_mm": g(eng, "head", "intake_valve", "diameter"),
        "exhaust_valve_lift_mm": g(eng, "head", "exhaust_valve", "max_lift"),
        "exhaust_valve_dur_deg": g(eng, "head", "exhaust_valve", "duration"),
        "exhaust_valve_dia_mm": g(eng, "head", "exhaust_valve", "diameter"),
        # engine core
        "bore_mm": g(eng, "geometry", "bore"),
        "stroke_mm": g(eng, "geometry", "stroke"),
        "rod_mm": g(eng, "geometry", "rod_length"),
        "compression_ratio": g(eng, "geometry", "compression_ratio"),
        # exhaust
        "header_primary_len_mm": g(exhaust, "headers", "primary_length"),
        "header_primary_dia_mm": g(exhaust, "headers", "primary_diameter"),
    }
