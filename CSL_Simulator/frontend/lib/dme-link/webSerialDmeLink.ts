import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection, DmeLinkError } from './types';
import { WebSerialTransport } from './webSerialTransport';
import {
    Ds2Frame, Ds2Control, Ds2ReadLayout, DS2_DEFAULT_ADDRESS,
    buildDs2Frame, parseDs2Frame, frameToBytes, isPositiveResponse,
    buildSeedRequestPayload, buildKeyPayload, isAlreadyUnlockedResponse, isSeedResponse, calculateLoginKey,
    buildReadMemoryPayload,
} from './ds2';
import {
    parseSystemAddressTable, findPointer, parseAifEntries, latestPopulatedAifEntry,
    parseZifProgramNumber, AIF_TOTAL_LENGTH,
} from './identity';
import { decodeBlock3, decodeBlock19, decodeBlock35, mergeSample, DecodedBlock } from './liveValueBlocks';

const SYSTEM_ADDRESS_INDEX = { ZIF: 19, AIF: 20 } as const;
const ZIF_LENGTH = 78;
const RESPONSE_TIMEOUT_MS = 2000;

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/**
 * Real MSS54 DME connection over a K-line cable via the Web Serial API — DS2
 * telemetry only (Stage 76). Transport/login/identity ported from the
 * hardware-proven E46M3CSL_TuningTool link; the flash-write path is
 * deliberately absent. Requires Chrome/Edge desktop and a genuine user
 * gesture to open the port picker.
 *
 * Polling budget: each block is one 0x0B round-trip; at 9600 baud expect
 * ~6-7 samples/s with 2 blocks, ~4-5 with 3 blocks.
 */
export class WebSerialDmeLink implements DmeTelemetryLink {
    private transport = new WebSerialTransport();
    private connected = false;
    private startTime = 0;

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

    private async readMemoryChunk(address: number, count: number): Promise<Uint8Array> {
        const frame = await this.exchange(Ds2Control.READ_MEMORY,
            buildReadMemoryPayload(Ds2ReadLayout.readSegment, address, count));
        if (!isPositiveResponse(frame)) throw new DmeLinkError(`Memory read at 0x${address.toString(16)} rejected by DME`);
        return frame.payload;
    }

    private async readRange(address: number, length: number): Promise<Uint8Array> {
        const out = new Uint8Array(length);
        let done = 0;
        while (done < length) {
            const count = Math.min(Ds2ReadLayout.chunkSize, length - done);
            const chunk = await this.readMemoryChunk(address + done, count);
            out.set(chunk.subarray(0, count), done);
            done += count;
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
}
