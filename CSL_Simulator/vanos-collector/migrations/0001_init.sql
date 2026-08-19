-- vanos_sweeps: one row per uploaded sweep recording (Stage 121).
-- Denormalized list-view columns + the bulk samples as one gzipped-JSON BLOB,
-- mirroring the tuner's proven sessions-table shape (but in a SEPARATE database).
CREATE TABLE IF NOT EXISTS vanos_sweeps (
  id TEXT PRIMARY KEY,             -- client-minted (idempotent retry via upsert)
  created_at INTEGER NOT NULL,     -- client clock, ms epoch
  synced_at INTEGER NOT NULL,      -- server clock, ms epoch
  client_time TEXT,                -- human-readable client timestamp
  label TEXT,
  vin TEXT,
  decoder_version INTEGER,
  achieved_hz REAL,                -- measured sample rate (protocol step 1)
  sigma_pct REAL,                  -- measured lambda limit-cycle sigma (protocol step 2)
  n_samples INTEGER,
  n_settings INTEGER,
  rpm_min INTEGER,
  rpm_max INTEGER,
  app_build TEXT,
  meta_json_gz BLOB,               -- gzip(JSON: settings table, notes, ambient...)
  samples_json_gz BLOB NOT NULL    -- gzip(JSON: [{t_ms,rpm,evan1_ist,...,cmd_intake,cmd_exhaust},...])
);
CREATE INDEX IF NOT EXISTS vanos_sweeps_created_at ON vanos_sweeps(created_at DESC);
