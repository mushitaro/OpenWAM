/**
 * Where the calibration that is about to be erased goes first.
 *
 * `writeCalibration` awaits this before it sends an erase, so whatever this promise resolves on IS
 * the safety net — and the resolution has to mean the bytes are durable, not that a request was
 * accepted. IndexedDB will happily report success on a write that a crash a moment later discards;
 * only `transaction.oncomplete` means committed. That distinction is the whole reason this module
 * exists rather than a one-line `put` at the call site.
 *
 * A browser download is offered too, because a backup the owner can see and copy off the phone is
 * worth more than one buried in origin storage — but the download is a convenience and is NEVER
 * what the promise waits on. Downloads can be silently blocked, land in a folder nobody finds, or
 * be cancelled, and none of those may be allowed to look like a stored backup.
 */
const DB_NAME = 'csl-preflight';
const DB_VERSION = 1;
const STORE = 'calibrationBackups';

export interface BackupRecord {
    id: string;
    at: number;
    vin: string;
    /** The 65536-byte image as read from the ECU, before any patch. */
    image: Uint8Array;
    /** Both stored CRCs, so a restore can be matched to the car it came from without a full diff. */
    checksums: { slave: number; master: number };
    note: string;
}

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けませんでした'));
    });
}

/**
 * Stores one backup and resolves only once the transaction has COMMITTED.
 *
 * Rejecting here is the abort signal for the flash — see `writeCalibration`. So every failure path
 * must reject rather than warn: a caller that cannot tell "stored" from "probably stored" would
 * erase an ECU on the strength of a maybe.
 */
export async function storeBackup(record: BackupRecord): Promise<void> {
    const db = await open();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            // oncomplete, not onsuccess: a successful request is not a durable write.
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('バックアップの保存に失敗しました'));
            tx.onabort = () => reject(tx.error ?? new Error('バックアップの保存が中断されました'));
            tx.objectStore(STORE).put(record);
        });
    } finally {
        db.close();
    }
}

/** Newest first. Used by the panel to show that a backup exists and when it was taken. */
export async function listBackups(): Promise<Omit<BackupRecord, 'image'>[]> {
    const db = await open();
    try {
        const all = await new Promise<BackupRecord[]>((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result as BackupRecord[]);
            req.onerror = () => reject(req.error ?? new Error('バックアップを読めませんでした'));
        });
        return all
            .map(({ image: _image, ...rest }) => rest)
            .sort((a, b) => b.at - a.at);
    } finally {
        db.close();
    }
}

export async function getBackup(id: string): Promise<BackupRecord | null> {
    const db = await open();
    try {
        return await new Promise<BackupRecord | null>((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
            req.onsuccess = () => resolve((req.result as BackupRecord | undefined) ?? null);
            req.onerror = () => reject(req.error ?? new Error('バックアップを読めませんでした'));
        });
    } finally {
        db.close();
    }
}

/**
 * Offers the image as a .bin file. Best-effort by contract: it never throws, because a failed
 * download must not be able to abort a flash whose real backup already committed.
 */
export function offerDownload(image: Uint8Array, filename: string): void {
    try {
        // A fresh ArrayBuffer: a Uint8Array view over a larger buffer would otherwise be serialised
        // whole, writing a file that is not the image.
        const blob = new Blob([image.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        // Revoke on the next frame — revoking synchronously can beat the download starting.
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch {
        /* deliberately silent: see the doc comment */
    }
}

/** `csl-base-WBSBL9…-20260908-1432.bin` — VIN and minute, so two backups never collide. */
export function backupFilename(vin: string, at: number): string {
    const d = new Date(at);
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const safeVin = (vin || 'UNKNOWN').replace(/[^A-Za-z0-9]/g, '') || 'UNKNOWN';
    return `csl-base-${safeVin}-${stamp}.bin`;
}
