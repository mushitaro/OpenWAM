import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection, DmeLinkError } from './types';
import { WebSerialTransport } from './webSerialTransport';
import { WebUsbFtdiTransport } from './webUsbFtdiTransport';

/** The two byte transports share exactly this surface; the DS2 layer needs no
 *  more and must not learn which one it has. */
interface KLineTransport {
    open(): Promise<void>;
    close(): Promise<void>;
    write(bytes: Uint8Array): Promise<void>;
    purge(): void;
    readExact(length: number, timeoutMs: number): Promise<Uint8Array>;
}

/**
 * Web Serial where it exists, FTDI-over-WebUSB otherwise.
 *
 * Android Chrome has WebUSB but NOT Web Serial, so without this the tool cannot
 * run on the phone that has to be in the car. Desktop Chrome has both; Web
 * Serial is preferred there because it needs no vendor-specific handling.
 */
export function createKLineTransport(): KLineTransport {
    if (WebSerialTransport.isSupported()) return new WebSerialTransport();
    if (WebUsbFtdiTransport.isSupported()) return new WebUsbFtdiTransport();
    throw new DmeLinkError(
        'この端末では K-Line 接続が使えません。'
        + 'PC は Chrome/Edge、Android は Chrome（FTDI ケーブル）が必要です。');
}

/** True when SOME transport can reach the DME here. */
export function kLineAvailable(): boolean {
    return WebSerialTransport.isSupported() || WebUsbFtdiTransport.isSupported();
}

/** Which one would be used — shown in the UI so a failure can be diagnosed. */
export function kLineTransportName(): 'webserial' | 'webusb' | 'none' {
    if (WebSerialTransport.isSupported()) return 'webserial';
    if (WebUsbFtdiTransport.isSupported()) return 'webusb';
    return 'none';
}
import {
    Ds2Frame, Ds2Control, Ds2Status, Ds2ReadLayout, DS2_DEFAULT_ADDRESS,
    buildDs2Frame, parseDs2Frame, frameToBytes, isPositiveResponse,
    buildSeedRequestPayload, buildKeyPayload, isAlreadyUnlockedResponse, isSeedResponse, calculateLoginKey,
    buildReadMemoryPayload,
    buildVanosTargetPayload, describeVanosAck, VanosAck, VanosPinValue,
    Ds2ProgrammingControl, Mss54HpDataTuneLayout, buildWriteMemoryPayload, parseWriteResult,
    describeVerifyByte, parseEncodingChecksum, faultedAreas, DATA_TUNE_CHECKSUM_BITS,
    buildClearAdaptationsPayload, TUNE_ADAPTATION_CLEAR, VANOS_ADAPTATION_CLEAR,
} from './ds2';
import {
    parseSystemAddressTable, findPointer, parseAifEntries, latestPopulatedAifEntry,
    parseZifProgramNumber, AIF_TOTAL_LENGTH,
} from './identity';
import { decodeBlock3, decodeBlock19, decodeBlock35, mergeSample, DecodedBlock } from './liveValueBlocks';
import type { FieldDef } from './blockDecoder';
import {
    STANDARD_ADAPTATIONS_BLOCK, OBSERVATION_ADAPTATIONS_BLOCK, buildAdaptationSnapshot,
    minPayloadLength, AdaptationSnapshot,
} from './adaptationBlocks';

const SYSTEM_ADDRESS_INDEX = { ZIF: 19, AIF: 20 } as const;
const ZIF_LENGTH = 78;
const RESPONSE_TIMEOUT_MS = 2000;

/* Programming and adaptation timing, taken from the tuner's own constants — these are what a real
 * MSS54 was measured needing, not round numbers. A sector erase really does take tens of seconds. */
const WRITE_RESPONSE_TIMEOUT_MS = 15000;
const ERASE_TIMEOUT_MS = 65000;
const CHUNK_RETRY_ATTEMPTS = 5;
const CHUNK_RETRY_DELAY_MS = 300;
const WRITE_CHUNK_RETRY_ATTEMPTS = 5;
const ADAPT_CLEAR_TIMEOUT_MS = 5000;
const ADAPT_SETTLE_MS = 2000;
const ADAPT_RETRY_ATTEMPTS = 3;
const ADAPT_RETRY_DELAY_MS = 300;
const BUSY_POLL_INTERVAL_MS = 150;
const BUSY_POLL_ATTEMPTS = 13;
const DRAIN_QUIET_MS = 150;
const RESYNC_SETTLE_MS = 30;

/** Which phase a calibration write is in, for the progress readout. */
export type WritePhase = 'backup' | 'erase' | 'write' | 'verify';

export interface WriteCalibrationOptions {
    /** The full 65536-byte image to program. Any other length is refused. */
    image: Uint8Array;
    /**
     * What is currently in the ECU, if the caller has just read it. Supplying it saves a second
     * ~123 s read; omitting it makes the link read one itself. Either way a backup is handed to
     * `onBackup` and awaited before any erase — this option changes the cost, never the guarantee.
     */
    backup?: Uint8Array;
    /** Must resolve only once the backup is durable. A rejection aborts before the erase. */
    onBackup: (currentImage: Uint8Array) => Promise<void>;
    onProgress?: (pct: number, phase: WritePhase) => void;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const describeError = (e: unknown) => (e instanceof Error ? e.message : String(e));

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// --- BEGIN VERBATIM isAllErased ---
function isAllErased(bytes: Uint8Array): boolean {
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0xFF) return false;
    return true;
}
// --- END VERBATIM isAllErased ---

// --- BEGIN VERBATIM assertWriteChunkingLegal ---
function assertWriteChunkingLegal(blocks: readonly { address: number; length: number }[]): void {
    const chunk = Mss54HpDataTuneLayout.writeChunkSize;
    if (chunk > 123) throw new DmeLinkError(`Refusing to flash: write chunk ${chunk} exceeds the DS2 write cap of 123`);
    if (chunk <= 0 || chunk % 2 !== 0) throw new DmeLinkError(`Refusing to flash: write chunk ${chunk} is not positive and even`);
    for (const block of blocks) {
        if (block.address % 2 !== 0) {
            throw new DmeLinkError(`Refusing to flash: block base 0x${block.address.toString(16)} is not even`);
        }
        // The final chunk is the remainder, and it must be even too or the last write is misaligned.
        const tail = block.length % chunk;
        if (tail % 2 !== 0) {
            throw new DmeLinkError(`Refusing to flash: block of ${block.length} bytes leaves an odd ${tail}-byte tail at chunk ${chunk}`);
        }
    }
}
// --- END VERBATIM assertWriteChunkingLegal ---

/**
 * Real MSS54 DME connection over a K-line cable — Web Serial on desktop, FTDI
 * over WebUSB on Android. Transport, login and identity are ported from the
 * hardware-proven E46M3CSL_TuningTool link.
 *
 * Three surfaces, in order of what they can cost you:
 *   - **Telemetry** (Stage 76). Block polling, read-only.
 *   - **VANOS command** (Stage 121). DS2 0x0C plus a keep-alive; volatile, and
 *     stopping the keep-alive IS the abort.
 *   - **Calibration** (Stage 122). Reads, adaptation clears, and an erase-and-
 *     rewrite of all 65536 bytes. The last of those can destroy the ECU, which
 *     is why it is fixed at 9600, refuses a turning engine, and hands the
 *     current image to a backup handler it AWAITS before sending the erase.
 *
 * Polling budget: each block is one 0x0B round-trip; at 9600 baud expect
 * ~6-7 samples/s with 2 blocks, ~4-5 with 3 blocks. A full calibration read or
 * write holds the gate for minutes, so the poll loop stalls for its duration —
 * intended: they share one K-line and the flash may not be interleaved.
 */
export class WebSerialDmeLink implements DmeTelemetryLink {
    private transport: KLineTransport = createKLineTransport();
    private connected = false;
    private startTime = 0;

    /* --- CommandGate: one frame in flight on this transport ----------------
     * Without it, the only thing keeping two operations from interleaving
     * frames is UI state — which holds exactly until something that is NOT a
     * user action sends a request. The keep-alive timer and the sweep's cam
     * ramp are both that something.
     *
     * This gate QUEUES rather than throws, which is a deliberate departure from
     * the tuner's (whose callers are all user actions, so refusing is the right
     * answer there). Here the busiest caller is the free-running poll loop, and
     * that loop disconnects after 5 consecutive errors: if a gate collision
     * surfaced as an error, one cam ramp (8 commands, ~150ms apart) would
     * manufacture enough of them to drop the link and lose the run. A poll
     * delayed by one frame is harmless; a poll reported as a failure is not.
     * The keep-alive is the one caller that skips instead of waiting — a
     * tester-present frame is only worth sending when the line is idle. */
    private gateTail: Promise<unknown> = Promise.resolve();
    private gateHeld = false;

    private withGate<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.gateTail.then(async () => {
            this.gateHeld = true;
            try { return await fn(); } finally { this.gateHeld = false; }
        });
        // The queue must survive a rejected turn, or one failure wedges the link.
        this.gateTail = run.catch(() => undefined);
        return run;
    }

    async connect(): Promise<DmeIdentity> {
        await this.transport.open();
        try {
            await this.login();
        } catch (e) {
            await this.transport.close();
            throw e;
        }
        this.connected = true;
        return this.identify();
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        await this.transport.close();
    }

    resetClock(): void {
        this.startTime = performance.now();
    }

    private assertConnected() {
        if (!this.connected) throw new DmeLinkError('Not connected to DME');
    }

    /** Sends a request frame, reads back the mandatory K-line echo, then reads the real response. */
    private async exchange(controlByte: number, payload: Uint8Array, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Ds2Frame> {
        const request = buildDs2Frame(DS2_DEFAULT_ADDRESS, controlByte, payload);
        await this.transport.write(request);

        const echo = await this.transport.readExact(request.length, timeoutMs);
        if (!arraysEqual(echo, request)) {
            throw new DmeLinkError('Unexpected K-line echo — check the cable connection');
        }

        const header = await this.transport.readExact(2, timeoutMs);
        const declaredLength = header[1];
        if (declaredLength < 4) throw new DmeLinkError(`Invalid DS2 response length byte ${declaredLength}`);
        const rest = await this.transport.readExact(declaredLength - 2, timeoutMs);

        const full = new Uint8Array(declaredLength);
        full.set(header, 0);
        full.set(rest, 2);
        return parseDs2Frame(full);
    }

    private async login(accessLevel = 5): Promise<void> {
        const seedFrame = await this.exchange(Ds2Control.REQUEST_LOGIN_SEED, buildSeedRequestPayload(accessLevel));
        if (isAlreadyUnlockedResponse(seedFrame)) return;
        if (!isSeedResponse(seedFrame)) throw new DmeLinkError('Unexpected login seed response from DME');

        const key = calculateLoginKey(accessLevel, frameToBytes(seedFrame));
        const keyFrame = await this.exchange(Ds2Control.SEND_LOGIN_KEY, buildKeyPayload(key));
        if (!isPositiveResponse(keyFrame)) throw new DmeLinkError('DME rejected the login key');
    }

    /**
     * One read telegram, with the returned length ASSERTED.
     *
     * The assertion is not defensive padding. `readRange` advances by the count it asked for, so a
     * short payload used to leave a run of zeros in the middle of the buffer and say nothing — a
     * cosmetic dent while this only read VIN strings, and a catastrophe the moment the same helper
     * feeds a 65536-byte image into a flash write or a read-back comparison. Zeros written into a
     * calibration are not a display bug.
     */
    private async readMemoryChunk(address: number, count: number): Promise<Uint8Array> {
        const frame = await this.exchange(Ds2Control.READ_MEMORY,
            buildReadMemoryPayload(Ds2ReadLayout.readSegment, address, count));
        if (!isPositiveResponse(frame)) throw new DmeLinkError(`Memory read at 0x${address.toString(16)} rejected by DME`);
        if (frame.payload.length !== count) {
            throw new DmeLinkError(
                `Memory read at 0x${address.toString(16)} returned ${frame.payload.length} bytes, expected ${count}`);
        }
        return frame.payload;
    }

    /** Retries a chunk read, purging between attempts to resynchronize. A 538-chunk image read at
     *  9600 will meet a line fault sooner or later, and losing two minutes of reading to one is not
     *  a failure worth reporting to a user. */
    private async readMemoryChunkWithRetry(address: number, count: number): Promise<Uint8Array> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
            try {
                return await this.readMemoryChunk(address, count);
            } catch (e) {
                lastError = e;
                if (attempt < CHUNK_RETRY_ATTEMPTS) {
                    await delay(CHUNK_RETRY_DELAY_MS * attempt);
                    this.transport.purge();
                }
            }
        }
        throw lastError instanceof Error ? lastError : new DmeLinkError(String(lastError));
    }

    private async readRange(
        address: number, length: number, onProgress?: (done: number) => void,
    ): Promise<Uint8Array> {
        const out = new Uint8Array(length);
        let done = 0;
        while (done < length) {
            const count = Math.min(Ds2ReadLayout.chunkSize, length - done);
            const chunk = await this.readMemoryChunkWithRetry(address + done, count);
            out.set(chunk, done);
            done += count;
            onProgress?.(done);
        }
        return out;
    }

    /** VIN / software version via the system address table — best-effort (log provenance). */
    private async identify(): Promise<DmeIdentity> {
        const result: DmeIdentity = { vin: 'UNKNOWN', aif: 'UNKNOWN', softwareVersion: 'UNKNOWN' };
        try {
            const tableFrame = await this.exchange(Ds2Control.READ_SYSTEM_ADDRESSES, new Uint8Array(0));
            if (!isPositiveResponse(tableFrame)) return result;
            const entries = parseSystemAddressTable(tableFrame.payload);

            const zifAddress = findPointer(entries, SYSTEM_ADDRESS_INDEX.ZIF);
            if (zifAddress !== null) {
                try {
                    const zifBytes = await this.readRange(zifAddress, ZIF_LENGTH);
                    const programNumber = parseZifProgramNumber(zifBytes);
                    if (programNumber) result.softwareVersion = programNumber;
                } catch { /* leave UNKNOWN */ }
            }

            const aifAddress = findPointer(entries, SYSTEM_ADDRESS_INDEX.AIF);
            if (aifAddress !== null) {
                try {
                    const aifBytes = await this.readRange(aifAddress, AIF_TOTAL_LENGTH);
                    const entry = latestPopulatedAifEntry(parseAifEntries(aifBytes));
                    if (entry) {
                        result.vin = entry.vin || 'UNKNOWN';
                        result.aif = entry.softwareNumber || 'UNKNOWN';
                    }
                } catch { /* leave UNKNOWN */ }
            }
        } catch { /* identity failed entirely — UNKNOWN fields */ }
        return result;
    }

    private async pollBlock(selection: number): Promise<Uint8Array | null> {
        try {
            const frame = await this.exchange(Ds2Control.READ_IO_STATUS, new Uint8Array([selection]));
            return isPositiveResponse(frame) ? frame.payload : null;
        } catch {
            this.transport.purge();   // resynchronize before the next exchange
            return null;
        }
    }

    async pollSample(blocks: LiveBlockSelection[]): Promise<LiveSample> {
        return this.withGate(() => this.pollSampleInner(blocks));
    }

    private async pollSampleInner(blocks: LiveBlockSelection[]): Promise<LiveSample> {
        this.assertConnected();
        if (this.startTime === 0) this.startTime = performance.now();

        let b3: DecodedBlock | null = null;
        let b19: DecodedBlock | null = null;
        let b35: DecodedBlock | null = null;

        for (const sel of blocks) {
            const payload = await this.pollBlock(sel);
            if (!payload) continue;
            if (sel === 3) b3 = decodeBlock3(payload);
            else if (sel === 19) b19 = decodeBlock19(payload);
            else if (sel === 35) b35 = decodeBlock35(payload);
        }
        if (!b3 && !b35) {
            // rpm comes from block 3 or 35 — without either the sample is useless
            throw new DmeLinkError('All polled DS2 blocks failed — check the connection');
        }
        return mergeSample((performance.now() - this.startTime) / 1000, b3, b19, b35);
    }

    /**
     * Command one VANOS bank to an absolute cam angle (signed whole degKW, the
     * live convention — not the map's +70 / 128−x encoding).
     *
     * Returns the DME's own verdict rather than throwing on refusal: every
     * non-zero ack is SEMANTIC (the DME understood the frame and declined it),
     * so the caller must change something before asking again — re-sending is
     * guaranteed to be declined identically. Transport faults still throw,
     * because those are the ones worth retrying.
     *
     * NOTE the override bypasses K_EVAN1_SOLL_MIN/MAX and KL_EVAN_SOLL_BEGR.
     * The caller owns the rpm/load window and the ramp; see lib/sweep.
     */
    async setVanosTarget(pin: VanosPinValue, angleDegKw: number): Promise<VanosAck> {
        return this.withGate(async () => {
            this.assertConnected();
            const frame = await this.exchange(
                Ds2Control.SET_IO_STATUS, buildVanosTargetPayload(pin, angleDegKw));
            if (!isPositiveResponse(frame)) {
                throw new DmeLinkError(
                    `DME rejected the VANOS command (status 0x${frame.controlOrStatus.toString(16)})`);
            }
            // payload[0] echoes the pin; payload[1] is the I/O feedback code.
            if (frame.payload.length < 2) {
                throw new DmeLinkError('VANOS response carried no feedback byte');
            }
            return describeVanosAck(frame.payload[1]);
        });
    }

    /**
     * Tester-present. Holds the diagnostic session open, which is what keeps a
     * commanded VANOS target from reverting to map control.
     *
     * Best effort by contract: it runs on a timer with nothing to catch it, so
     * it never throws, and it SKIPS when the line is busy rather than queueing
     * behind a poll — a heartbeat that arrives late is worth nothing. Nothing
     * branches on the result; the next real operation reports the link's state.
     *
     * Stopping this is the documented abort: the DME reverts to its own map on
     * the next background cycle.
     */
    async keepAlive(): Promise<boolean> {
        if (!this.connected || this.gateHeld) return false;
        try {
            return await this.withGate(async () => {
                const frame = await this.exchange(Ds2Control.KEEP_ALIVE, new Uint8Array(0));
                return isPositiveResponse(frame);
            });
        } catch {
            return false;
        }
    }

    /* ======================================================================
     * ADAPTATIONS  (control 0x43)
     * ==================================================================== */

    /**
     * Waits for the K-line to go quiet, then purges, so the next exchange's echo read sees only its
     * own request's echo.
     *
     * The tuner's version of this fixed a real-vehicle "Unexpected K-line echo" that recurred on all
     * three retries: something before the reset left the DME streaming a tail, and a plain purge
     * races that tail. Simplified here — the tuner escalates using `transport.hasReadError()`, which
     * this app's two transports do not expose — but the property that matters is kept: purge only
     * after a window in which nothing new arrived.
     */
    private async drainUntilQuiet(): Promise<void> {
        for (let round = 0; round < 4; round++) {
            this.transport.purge();
            await delay(DRAIN_QUIET_MS);
        }
    }

    /**
     * One adaptation exchange, retried, with BUSY handled on its own budget.
     *
     * BUSY is the DME saying "still working", not "no" — an EEPROM commit is slow — so re-asking on
     * a separate counter stops a slow commit from burning the transport retries that exist for line
     * faults. Adapted from the tuner's `adaptationExchangeWithRetry`; same structure, minus the
     * break-detection escalation that needs a transport capability this app does not have.
     */
    private async adaptationExchangeWithRetry(
        control: number, payload: Uint8Array, timeoutMs: number, describe: string,
    ): Promise<Ds2Frame> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= ADAPT_RETRY_ATTEMPTS; attempt++) {
            try {
                this.transport.purge();
                await delay(RESYNC_SETTLE_MS);

                let frame = await this.exchange(control, payload, timeoutMs);
                for (let busy = 0; frame.controlOrStatus === Ds2Status.BUSY && busy < BUSY_POLL_ATTEMPTS; busy++) {
                    await delay(BUSY_POLL_INTERVAL_MS);
                    frame = await this.exchange(control, payload, timeoutMs);
                }

                if (!isPositiveResponse(frame)) {
                    const status = frame.controlOrStatus;
                    throw new DmeLinkError(
                        `${describe} rejected by DME (status 0x${status.toString(16)}`
                        + `${status === Ds2Status.BUSY ? ' — still BUSY after retrying' : ''})`);
                }
                return frame;
            } catch (e) {
                lastError = e;
                if (attempt < ADAPT_RETRY_ATTEMPTS) await delay(ADAPT_RETRY_DELAY_MS * attempt);
            }
        }
        this.transport.purge();
        throw lastError instanceof Error ? lastError : new DmeLinkError(String(lastError));
    }

    /** Reads one adaptation block. Same request shape as a live poll — control 0x0B with a one-byte
     *  selection — just a different block. A short payload that still checksums is named rather than
     *  decoded into a table of dashes and called a reading. */
    private async readAdaptationBlock(block: { selection: number; fields: readonly FieldDef[] }): Promise<Uint8Array> {
        const describe = `アダプテーション ブロック 0x${block.selection.toString(16)} の読み出し`;
        const frame = await this.adaptationExchangeWithRetry(
            Ds2Control.READ_IO_STATUS, new Uint8Array([block.selection]), RESPONSE_TIMEOUT_MS, describe);
        const need = minPayloadLength(block.fields);
        if (frame.payload.length < need) {
            throw new DmeLinkError(
                `${describe}が ${frame.payload.length} バイトしか返しませんでした（${need} バイト必要）`);
        }
        return frame.payload;
    }

    private async readBothAdaptationBlocks(): Promise<AdaptationSnapshot> {
        const std = await this.readAdaptationBlock(STANDARD_ADAPTATIONS_BLOCK);
        const obs = await this.readAdaptationBlock(OBSERVATION_ADAPTATIONS_BLOCK);
        return buildAdaptationSnapshot(std, obs);
    }

    /** Reads the DME's learned adaptation values (blocks 0x06 and 0x16). Both are required: a
     *  half-read snapshot shown beside post-clear values invites the wrong conclusion. */
    async readAdaptations(): Promise<AdaptationSnapshot> {
        return this.withGate(async () => {
            this.assertConnected();
            await this.drainUntilQuiet();
            return this.readBothAdaptationBlocks();
        });
    }

    /**
     * Clears VANOS adaptation only — the prerequisite for this app's whole reason to exist.
     *
     * A learned offset sits between the angle commanded over 0x0C and the angle the cam actually
     * reaches, which does not merely add noise to the sweep: it makes every measured point belong to
     * a cam position nobody recorded. Cleared, and the commanded angle is the angle.
     */
    async clearVanosAdaptations(): Promise<AdaptationSnapshot> {
        return this.withGate(() => this.clearAdaptationsInner(VANOS_ADAPTATION_CLEAR, 'VANOS 学習クリア'));
    }

    /**
     * Clears lambda trim, knock and idle-fuel adaptation — the tuner's RESET ADAPT.
     *
     * Deliberately NOT VANOS (that is its own call above) and deliberately not the reference's
     * "clear all", which also wipes SMG adaptation — the CSL is SMG-II only, so that would force a
     * clutch re-adaptation procedure for nothing.
     */
    async clearTuneAdaptations(): Promise<AdaptationSnapshot> {
        return this.withGate(() => this.clearAdaptationsInner(TUNE_ADAPTATION_CLEAR, 'チューン学習クリア'));
    }

    private async clearAdaptationsInner(
        set: { readonly mask1: number; readonly mask2: number }, describe: string,
    ): Promise<AdaptationSnapshot> {
        this.assertConnected();
        await this.drainUntilQuiet();
        // No login() — control 0x43 needs no seed/key.
        await this.adaptationExchangeWithRetry(
            Ds2Control.CLEAR_ADAPTATIONS, buildClearAdaptationsPayload(set.mask1, set.mask2),
            ADAPT_CLEAR_TIMEOUT_MS, describe);
        // A flat wait, kept deliberately. Polling until the read succeeds does not work: a premature
        // read does not fail, it succeeds and hands back the OLD values.
        await delay(ADAPT_SETTLE_MS);
        return this.readBothAdaptationBlocks();
    }

    /* ======================================================================
     * CALIBRATION READ  (control 0x06, read-only)
     * ==================================================================== */

    /** Engine speed on its own, for deciding whether a programming operation may run. Asks the same
     *  block the telemetry poll uses, but the question is different — "is this engine turning?" —
     *  and it must be answerable without a sweep running. */
    async readEngineRpm(): Promise<number> {
        return this.withGate(async () => {
            this.assertConnected();
            const payload = await this.pollBlock(3);
            if (!payload) throw new DmeLinkError('回転数を読めませんでした（ブロック 3 が応答しません）');
            const rpm = decodeBlock3(payload).rpm;
            if (typeof rpm !== 'number' || !Number.isFinite(rpm)) {
                throw new DmeLinkError('回転数を読めませんでした（ブロック 3 の値が不正です）');
            }
            return rpm;
        });
    }

    /**
     * Reads the whole 65536-byte DataTune image (slave half then master half).
     *
     * ~123 s at 9600. Read-only: it sends nothing but control-0x06 reads.
     */
    async readCalibration(onProgress?: (pct: number) => void): Promise<Uint8Array> {
        return this.withGate(() => this.readCalibrationInner(onProgress));
    }

    private async readCalibrationInner(onProgress?: (pct: number) => void): Promise<Uint8Array> {
        this.assertConnected();
        const { slave, master } = Mss54HpDataTuneLayout;
        const total = slave.length + master.length;
        this.transport.purge();
        await this.login();
        const slaveBytes = await this.readRange(slave.address, slave.length,
            d => onProgress?.(Math.round((d / total) * 100)));
        const masterBytes = await this.readRange(master.address, master.length,
            d => onProgress?.(Math.round(((slave.length + d) / total) * 100)));
        const out = new Uint8Array(total);
        out.set(slaveBytes, 0);
        out.set(masterBytes, slave.length);
        return out;
    }

    /**
     * Reads a small run of calibration bytes addressed by BIN OFFSET (0..65535), not by DS2 address.
     *
     * This is what makes "did I remember to patch?" a measurement instead of a memory. Three of
     * these answer the whole preflight in about a second, against ~123 s for the full image — and
     * unlike the full read they are cheap enough to re-run after a flash without anyone weighing it.
     *
     * Refuses a run that straddles the slave/master boundary: the two halves are different DS2 base
     * addresses, so a straddling read is two requests pretending to be one, and silently returning
     * the wrong bytes for the second half is exactly the failure this method exists to prevent.
     */
    async readCalibrationBytes(binOffset: number, length: number): Promise<Uint8Array> {
        return this.withGate(async () => {
            this.assertConnected();
            const { slave, master } = Mss54HpDataTuneLayout;
            const total = slave.length + master.length;
            if (!Number.isInteger(binOffset) || !Number.isInteger(length) || length <= 0
                || binOffset < 0 || binOffset + length > total) {
                throw new DmeLinkError(
                    `BIN 範囲 0x${binOffset.toString(16)}+${length} は 0..0x${total.toString(16)} の外です`);
            }
            const inSlave = binOffset < slave.length;
            if (inSlave && binOffset + length > slave.length) {
                throw new DmeLinkError('slave/master の境界をまたぐ読み出しはできません');
            }
            const addr = inSlave ? slave.address + binOffset : master.address + (binOffset - slave.length);
            this.transport.purge();
            await this.login();
            return this.readRange(addr, length);
        });
    }

    /* ======================================================================
     * CALIBRATION WRITE  (erase + program + verify)
     *
     * The only thing in this app that can destroy hardware. Fixed at 9600 —
     * see the banner in ds2.ts for why the baud boost is not ported.
     * ==================================================================== */

    /**
     * Erases the data area and writes all 65536 bytes, then proves it by reading every byte back.
     *
     * `onBackup` receives the image currently in the ECU BEFORE anything is erased, and is awaited:
     * if it rejects, no erase is sent. That ordering is enforced here rather than by the caller
     * because this is the layer that issues the erase, and a rule about "not until the backup is
     * safe" is only worth anything where it can actually be obeyed.
     *
     * Not cancellable once the erase has gone out. Honouring a cancel between chunks would abandon a
     * half-programmed ECU, which is strictly worse than finishing.
     */
    async writeCalibration(opts: WriteCalibrationOptions): Promise<void> {
        return this.withGate(() => this.writeCalibrationInner(opts));
    }

    private async writeCalibrationInner(opts: WriteCalibrationOptions): Promise<void> {
        const { image, backup, onBackup, onProgress } = opts;
        this.assertConnected();
        const { slave, master } = Mss54HpDataTuneLayout;
        const total = slave.length + master.length;
        if (image.length !== total) {
            throw new DmeLinkError(`${image.length} バイトの書き込みを拒否しました（${total} バイト必要）`);
        }
        const slaveData = image.subarray(0, slave.length);
        const masterData = image.subarray(slave.length, total);

        // Every precondition before the DME is touched at all. "Validate, then act" is the only
        // ordering that stays obviously correct as this grows.
        assertWriteChunkingLegal([slave, master]);

        // The engine must not be turning. The DME answers 0xA2 to an erase when it is, but finding
        // that out from a rejection means the request was sent; asking first means it was not.
        const rpm = await this.readEngineRpmInner();
        if (rpm > 0) {
            throw new DmeLinkError(
                `エンジンが回転しています（${rpm} rpm）。書き込みはエンジン停止・イグニッション ON で行ってください。`);
        }

        // BACKUP FIRST, and AWAITED. Whatever `onBackup` resolves on is the only copy of what is in
        // the car right now, so the erase below waits on it and a rejection means no erase is sent.
        //
        // `backup` lets the caller supply an image it just read rather than paying for a second
        // ~123 s pass. Nothing else talks to this DME while the gate is held, so an image read
        // moments ago IS what is in the ECU. Absent, we read it here — which is slower but needs
        // nothing of the caller, and this method must not be usable without a backup at all.
        onProgress?.(0, 'backup');
        // How the bar is split, derived from what this call will actually DO rather than fixed.
        // A supplied backup removes a ~123 s read; reserving 40 % for it anyway would leave the bar
        // frozen at 0 for the whole erase and then jump, which reads as a hang during the one phase
        // nobody may interrupt.
        const backupShare = backup ? 0 : 40;
        const current = backup ?? await this.readCalibrationInner(
            p => onProgress?.(Math.round(p * (backupShare / 100)), 'backup'));
        if (current.length !== total) {
            throw new DmeLinkError(`バックアップが ${current.length} バイトです（${total} バイト必要）`);
        }
        await onBackup(current);

        // Refresh the unlock immediately before the protected write; the session can lapse.
        this.transport.purge();
        await this.login();

        // ---- Past this line the ECU's data area is gone until the write completes. ----
        onProgress?.(backupShare, 'erase');
        try {
            await this.sendProgrammingControl(
                Ds2ProgrammingControl.EraseSegment,
                Ds2ProgrammingControl.DataProgrammingSessionAddress, ERASE_TIMEOUT_MS, true);
        } catch (eraseError) {
            // Only on failure do we send the pre-clean and retry once — the prepare consumes an
            // extra flash-counter slot, so the normal flow must not pay it.
            await this.sendProgrammingControl(
                Ds2ProgrammingControl.FinishSegment,
                Ds2ProgrammingControl.DataProgrammingSessionAddress, WRITE_RESPONSE_TIMEOUT_MS, false);
            try {
                await this.sendProgrammingControl(
                    Ds2ProgrammingControl.EraseSegment,
                    Ds2ProgrammingControl.DataProgrammingSessionAddress, ERASE_TIMEOUT_MS, true);
            } catch (retryError) {
                throw new DmeLinkError(
                    `消去が 2 回とも失敗しました。1 回目: ${describeError(eraseError)} / `
                    + `プリクリーン後: ${describeError(retryError)}`);
            }
        }

        // The write is ~66 s and the read-back ~123 s, so the remainder splits roughly 1:2.
        const writeStart = backupShare + 2;
        const remaining = 100 - writeStart;
        const writeShare = Math.round(remaining / 3);
        onProgress?.(writeStart, 'write');
        await this.writeBlock(slave.address, slaveData, 0, total,
            (w, t) => onProgress?.(writeStart + Math.round((w / t) * writeShare), 'write'));
        await this.writeBlock(master.address, masterData, slave.length, total,
            (w, t) => onProgress?.(writeStart + Math.round((w / t) * writeShare), 'write'));

        await this.sendProgrammingControl(
            Ds2ProgrammingControl.FinishSegment, 0, WRITE_RESPONSE_TIMEOUT_MS, true);

        // FULL read-back, always. The tuner offers a quick mode because it flashes repeatedly during
        // a tune; this flashes once, before a drive, so there is no case for the weaker proof — and
        // the checksum byte alone cannot tell "programmed" from "politely ignored", since the old
        // image has valid checksums too.
        const verifyStart = writeStart + writeShare;
        const verifyShare = 100 - verifyStart;
        onProgress?.(verifyStart, 'verify');
        const backSlave = await this.readRange(slave.address, slave.length,
            d => onProgress?.(verifyStart + Math.round((d / total) * verifyShare), 'verify'));
        const backMaster = await this.readRange(master.address, master.length,
            d => onProgress?.(verifyStart + Math.round(((slave.length + d) / total) * verifyShare), 'verify'));
        if (!arraysEqual(backSlave, slaveData) || !arraysEqual(backMaster, masterData)) {
            throw new DmeLinkError(
                '書き込み検証に失敗しました：読み戻した内容が書いた内容と一致しません。'
                + 'ECU の状態は不明として扱ってください。電源を落とさず、接続したまま再書き込みしてください。');
        }

        // The DME's own verdict, as a second opinion. The read-back already proved the bytes, so a
        // fault here is recorded, not fatal — but it is not dropped either.
        try {
            const frame = await this.exchange(Ds2Control.QUERY_ENCODING_CHECKSUM, new Uint8Array(0));
            const checksum = parseEncodingChecksum(frame);
            const faults = faultedAreas(checksum, DATA_TUNE_CHECKSUM_BITS);
            this.lastWriteChecksumNote = faults.length === 0
                ? 'DME 自身のチェックサムも正常です。'
                : `読み戻しは一致しましたが、DME は ${faults.map(a => a.name).join(' と ')} に`
                    + 'チェックサム異常を報告しています。';
        } catch (e) {
            this.lastWriteChecksumNote = `DME のチェックサム照会には応答がありませんでした（${describeError(e)}）。`
                + '全バイト読み戻しは一致しているので、書き込み自体は証明されています。';
        }
        onProgress?.(100, 'verify');
    }

    /** The encoding-checksum note from the last write, for the UI to show verbatim. */
    lastWriteChecksumNote: string | null = null;

    /** rpm without taking the gate — the write path already holds it. */
    private async readEngineRpmInner(): Promise<number> {
        const payload = await this.pollBlock(3);
        if (!payload) throw new DmeLinkError('回転数を読めませんでした（ブロック 3 が応答しません）');
        const rpm = decodeBlock3(payload).rpm;
        if (typeof rpm !== 'number' || !Number.isFinite(rpm)) {
            throw new DmeLinkError('回転数を読めませんでした（ブロック 3 の値が不正です）');
        }
        return rpm;
    }

    /**
     * One write telegram, retried on TRANSPORT failure only.
     *
     * Re-sending is safe: a DS2 write is one telegram, so the DME either processed it or did not,
     * and re-writing the same bytes to the same address is idempotent. The `nextAddress` check in
     * `writeMemoryChunk` catches any desync afterwards. Adapted from the tuner's version — same
     * budget and same idempotence argument, without the break-detection escalation.
     */
    private async writeChunkTelegramWithRetry(
        address: number, data: Uint8Array, timeoutMs = WRITE_RESPONSE_TIMEOUT_MS,
    ): Promise<Ds2Frame> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= WRITE_CHUNK_RETRY_ATTEMPTS; attempt++) {
            try {
                return await this.exchange(
                    Ds2Control.WRITE_MEMORY,
                    buildWriteMemoryPayload(Ds2ProgrammingControl.WriteSegment, address, data),
                    timeoutMs);
            } catch (e) {
                lastError = e;
                if (attempt < WRITE_CHUNK_RETRY_ATTEMPTS) {
                    await delay(CHUNK_RETRY_DELAY_MS * attempt);
                    this.transport.purge();
                }
            }
        }
        throw lastError instanceof Error ? lastError : new DmeLinkError(String(lastError));
    }

// --- BEGIN VERBATIM writeBlock ---
    private async writeBlock(address: number, data: Uint8Array, doneBefore: number, grandTotal: number, onProgress?: (writtenSoFar: number, total: number) => void, timeoutMs = WRITE_RESPONSE_TIMEOUT_MS): Promise<void> {
        let offset = 0;
        while (offset < data.length) {
            const chunkSize = Math.min(Mss54HpDataTuneLayout.writeChunkSize, data.length - offset);
            const chunk = data.subarray(offset, offset + chunkSize);
            if (!isAllErased(chunk)) {
                await this.writeMemoryChunk(address + offset, chunk, timeoutMs);
            }
            offset += chunkSize;
            onProgress?.(doneBefore + offset, grandTotal);
        }
    }
// --- END VERBATIM writeBlock ---

// --- BEGIN VERBATIM writeMemoryChunk ---
    private async writeMemoryChunk(address: number, data: Uint8Array, timeoutMs = WRITE_RESPONSE_TIMEOUT_MS): Promise<void> {
        const frame = await this.writeChunkTelegramWithRetry(address, data, timeoutMs);
        if (!isPositiveResponse(frame)) throw new DmeLinkError(`Memory write at 0x${address.toString(16)} rejected by DME`);
        const result = parseWriteResult(frame);
        if (!result) throw new DmeLinkError(`Memory write at 0x${address.toString(16)} returned no verify data`);
        if (result.segment !== Ds2ProgrammingControl.WriteSegment) {
            throw new DmeLinkError(`Memory write at 0x${address.toString(16)} returned segment 0x${result.segment.toString(16)}, expected 0x02`);
        }
        if (result.nextAddress24 !== address + data.length) {
            throw new DmeLinkError(`Memory write at 0x${address.toString(16)} returned next address 0x${result.nextAddress24.toString(16)}, expected 0x${(address + data.length).toString(16)}`);
        }
        if (result.writtenCount !== data.length) {
            throw new DmeLinkError(`Memory write at 0x${address.toString(16)} wrote ${result.writtenCount} bytes, expected ${data.length} — ${describeVerifyByte(result.verifyByte)}`);
        }
        if (result.verifyByte !== 1) {
            throw new DmeLinkError(`Memory write at 0x${address.toString(16)} failed: ${describeVerifyByte(result.verifyByte)}`);
        }
    }
// --- END VERBATIM writeMemoryChunk ---

// --- BEGIN VERBATIM sendProgrammingControl ---
    private async sendProgrammingControl(segment: number, address: number, timeoutMs: number, requireProgrammingOk: boolean): Promise<void> {
        const frame = await this.exchange(
            Ds2Control.WRITE_MEMORY,
            buildWriteMemoryPayload(segment, address, new Uint8Array(0)),
            timeoutMs,
        );
        if (!isPositiveResponse(frame)) throw new DmeLinkError(`Programming control (segment 0x${segment.toString(16)}) rejected by DME`);
        const result = parseWriteResult(frame);
        if (result) {
            if (result.segment !== segment) {
                throw new DmeLinkError(`Programming control returned segment 0x${result.segment.toString(16)}, expected 0x${segment.toString(16)}`);
            }
            if (requireProgrammingOk && result.verifyByte !== 1 && result.verifyByte !== 8) {
                throw new DmeLinkError(`Programming control (segment 0x${segment.toString(16)}) failed: ${describeVerifyByte(result.verifyByte)}`);
            }
        }
    }
// --- END VERBATIM sendProgrammingControl ---
}
