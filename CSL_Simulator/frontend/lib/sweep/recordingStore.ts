/**
 * Crash-recovery store for a live recording.
 *
 * A drive's samples live in memory until the driver stops and saves. On a phone
 * that is a bet: a background tab reload, an OOM kill, or a fumbled swipe ends
 * the run and the data with it. This writes them down as they arrive.
 *
 * Idioms taken from the tuner's src/lib/db/liveRunRepository.ts, including the
 * two that are easy to get wrong:
 *   - chunks are APPENDED, never rewritten. Re-putting the whole array each
 *     flush is O(n) per flush and O(n^2) across a run; at 3 Hz a 40-minute
 *     sweep is ~7000 samples and the last flush alone would rewrite all of them.
 *   - a transaction resolves on `oncomplete`, NOT on the last request's success:
 *     the data is not durable until the transaction commits, and resolving early
 *     lets a caller believe a sample is saved that a crash would still lose.
 */
import { LiveSample } from '../dme-link/types';

export const DB_NAME = 'csl-sim-live';
export const DB_VERSION = 1;
const RUNS = 'runs';
const CHUNKS = 'chunks';

export interface RunRecord {
    runId: string;
    startedAt: number;
    updatedAt: number;
    sampleCount: number;
    mock: boolean;
    endedAt?: number;
    uploadedAt?: number;
    label?: string;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        // `blocked` is not terminal: the SAME request stays live and fires
        // onsuccess once the other tab closes. Settling once keeps that late
        // handover from resolving a promise nobody is waiting on any more.
        let settled = false;
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'runId' });
            if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['runId', 'seq'] });
        };
        req.onsuccess = () => {
            const db = req.result;
            // Never wedge another tab's upgrade.
            db.onversionchange = () => db.close();
            if (settled) { db.close(); return; }
            settled = true;
            resolve(db);
        };
        req.onerror = () => { if (!settled) { settled = true; reject(req.error); } };
        req.onblocked = () => { if (!settled) { settled = true; reject(new Error('IndexedDB upgrade blocked by another tab')); } };
    });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode,
               work: (t: IDBTransaction) => T): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let out: T;
        try { out = work(t); } catch (e) { t.abort(); reject(e); return; }
        // Commit, not request-success: only oncomplete means durable.
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    });
}

export async function beginRun(meta: { mock: boolean; label?: string }): Promise<string> {
    const runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const db = await openDb();
    try {
        await tx(db, [RUNS], 'readwrite', t => {
            t.objectStore(RUNS).put({
                runId, startedAt: Date.now(), updatedAt: Date.now(),
                sampleCount: 0, mock: meta.mock, label: meta.label,
            } satisfies RunRecord);
        });
        return runId;
    } finally { db.close(); }
}

export async function appendChunk(runId: string, seq: number, samples: LiveSample[]): Promise<void> {
    if (!samples.length) return;
    const db = await openDb();
    try {
        await tx(db, [RUNS, CHUNKS], 'readwrite', t => {
            t.objectStore(CHUNKS).put({ runId, seq, samples });
            const runs = t.objectStore(RUNS);
            const get = runs.get(runId);
            get.onsuccess = () => {
                const rec = get.result as RunRecord | undefined;
                // Only if the run still exists: a discard racing an in-flight
                // flush must not resurrect it.
                if (!rec) return;
                rec.sampleCount += samples.length;
                rec.updatedAt = Date.now();
                runs.put(rec);
            };
        });
    } finally { db.close(); }
}

export async function endRun(runId: string, patch: Partial<RunRecord> = {}): Promise<void> {
    const db = await openDb();
    try {
        await tx(db, [RUNS], 'readwrite', t => {
            const runs = t.objectStore(RUNS);
            const get = runs.get(runId);
            get.onsuccess = () => {
                const rec = get.result as RunRecord | undefined;
                if (!rec) return;
                runs.put({ ...rec, ...patch, endedAt: patch.endedAt ?? Date.now() });
            };
        });
    } finally { db.close(); }
}

export async function discardRun(runId?: string): Promise<void> {
    const db = await openDb();
    try {
        await tx(db, [RUNS, CHUNKS], 'readwrite', t => {
            if (!runId) { t.objectStore(RUNS).clear(); t.objectStore(CHUNKS).clear(); return; }
            t.objectStore(RUNS).delete(runId);
            // Infinity is not a valid IndexedDB key.
            t.objectStore(CHUNKS).delete(
                IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]));
        });
    } finally { db.close(); }
}

/** The newest run that still holds samples and was never uploaded. */
export async function findRecoverableRun(): Promise<RunRecord | null> {
    const db = await openDb();
    try {
        const all = await tx(db, [RUNS], 'readonly', t => {
            const req = t.objectStore(RUNS).getAll();
            return req;
        });
        const runs = (all.result as RunRecord[]).filter(r => r.sampleCount > 0 && !r.uploadedAt);
        runs.sort((a, b) => b.updatedAt - a.updatedAt);
        return runs[0] ?? null;
    } catch { return null; } finally { db.close(); }
}

export async function loadRunSamples(runId: string): Promise<LiveSample[]> {
    const db = await openDb();
    try {
        const req = await tx(db, [CHUNKS], 'readonly', t =>
            t.objectStore(CHUNKS).getAll(
                IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])));
        const chunks = (req.result as { seq: number; samples: LiveSample[] }[])
            .sort((a, b) => a.seq - b.seq);
        return chunks.flatMap(c => c.samples);
    } catch { return []; } finally { db.close(); }
}
