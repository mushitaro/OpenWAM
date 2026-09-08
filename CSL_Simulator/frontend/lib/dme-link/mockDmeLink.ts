import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection } from './types';
import { describeVanosAck, VanosAck, VanosAckCode, VanosPin, VanosPinValue } from './ds2';
import {
    STANDARD_ADAPTATIONS_BLOCK, OBSERVATION_ADAPTATIONS_BLOCK, AdaptationSnapshot,
} from './adaptationBlocks';
import { correctDataChecksum } from '../checksum/dmeDataChecksum';

/**
 * Offline telemetry simulator (Stage 76) — same interface as WebSerialDmeLink,
 * no hardware needed. Generates a repeating synthetic drive cycle:
 *   0-10s   idle (~800 rpm, RO ~1.5%)
 *   10-25s  part-load cruise (~2500-3500 rpm, RO 15-35%)
 *   25-40s  WOT pull 2000 -> 7500 rpm (RO ~100%)
 *   40-50s  overrun / decel back to idle
 * Values roughly follow S54 physics (rf rises with RO and rpm resonances;
 * VANOS targets follow plausible map shapes with a small actuator lag on the
 * actuals) so charts, recording, binning and the validation pipeline can all
 * be exercised end-to-end. Numbers are NOT calibrated — this is plumbing test
 * data, clearly stamped as MOCK in the identity.
 *
 * Stage 121 adds a commandable VANOS with first-order actuator tracking and a
 * lambda-integrator response, so the sweep — arrival gate, dwell, coverage and
 * vertex fit — is fully exercisable with no car attached.
 */
export class MockDmeLink implements DmeTelemetryLink {
    private startTime = 0;
    private cycleLength = 50; // s

    /* --- commandable VANOS ------------------------------------------------
     * null = under the DME's own map control; a number = the angle a DS2 0x0C
     * override is holding. Angles here are LIVE degKW (intake 0..60, exhaust
     * 0..45) — the convention block 35 actually reports, NOT the map-table
     * encoding (intake +70 / exhaust 128−x). The mock used to emit the map
     * numbers, which would have made any tolerance tuned against it wrong on
     * the car by 70 and 128 degrees respectively. */
    private cmdIntake: number | null = null;
    private cmdExhaust: number | null = null;
    private istIntake = 0;
    private istExhaust = 41;
    private lastPollAt = 0;
    /** Actuator time constant. Real VANOS slews fast but not instantly; this is
     *  what makes the arrival gate a real gate rather than a formality. */
    private readonly tauS = 0.35;
    private keepAliveCount = 0;

    async connect(): Promise<DmeIdentity> {
        await new Promise(r => setTimeout(r, 300));
        this.startTime = performance.now();
        return { vin: 'MOCK00000000000LN', aif: '7837335MK', softwareVersion: 'MOCK-DS2' };
    }

    async disconnect(): Promise<void> { /* nothing to release */ }

    resetClock(): void {
        this.startTime = performance.now();
    }

    private noise(scale: number): number {
        return (Math.random() - 0.5) * 2 * scale;
    }

    async pollSample(blocks: LiveBlockSelection[]): Promise<LiveSample> {
        // emulate the real link's pacing: ~150ms per polled block at 9600 baud
        await new Promise(r => setTimeout(r, 140 * Math.max(1, blocks.length)));

        const t = (performance.now() - this.startTime) / 1000;
        const p = t % this.cycleLength;

        let rpm: number, ro: number;
        if (p < 10) {           // idle
            rpm = 800 + this.noise(30);
            ro = 1.5 + this.noise(0.3);
        } else if (p < 25) {    // part-load cruise
            const w = (p - 10) / 15;
            rpm = 2500 + 1000 * Math.sin(w * Math.PI) + this.noise(80);
            ro = 22 + 12 * Math.sin(w * 2.2 * Math.PI) + this.noise(2);
        } else if (p < 40) {    // WOT pull
            const w = (p - 25) / 15;
            rpm = 2000 + 5500 * w + this.noise(50);
            ro = 100;
        } else {                // overrun
            const w = (p - 40) / 10;
            rpm = Math.max(800, 7500 - 6700 * w) + this.noise(50);
            ro = 0.5 + this.noise(0.2);
        }
        rpm = Math.max(700, rpm);
        ro = Math.min(100, Math.max(0.1, ro));

        // rf: rises with RO; at WOT add a plausible S54 torque-curve shape
        const wotShape = 0.75 + 0.35 * Math.exp(-Math.pow((rpm - 4300) / 2400, 2))
            - 0.18 * Math.exp(-Math.pow((rpm - 2600) / 500, 2));   // valley dip ~2600
        const rf = ro >= 95 ? 100 * wotShape + this.noise(1.2)
            : Math.min(95, ro * 0.9 + rpm / 400) + this.noise(1);

        // VANOS targets in LIVE degKW. Map control follows a plausible schedule;
        // an override replaces it outright, exactly as the firmware does.
        const mapEvanSoll = ro >= 95 ? (rpm < 3000 ? 10 : rpm < 5000 ? 0 : 18) : Math.max(0, 25 - ro * 0.2);
        const mapAvanSoll = ro >= 95 ? (rpm < 3000 ? 35 : rpm < 5000 ? 41 : 23) : Math.max(0, 18 - ro * 0.1);
        const evanSoll = this.cmdIntake ?? mapEvanSoll;
        const avanSoll = this.cmdExhaust ?? mapAvanSoll;

        // First-order tracking toward the target, integrated over the real time
        // since the previous poll so the lag does not depend on sample rate.
        const now = performance.now();
        const dt = this.lastPollAt ? Math.min(1, (now - this.lastPollAt) / 1000) : 0;
        this.lastPollAt = now;
        const alpha = dt > 0 ? 1 - Math.exp(-dt / this.tauS) : 0;
        this.istIntake += (evanSoll - this.istIntake) * alpha;
        this.istExhaust += (avanSoll - this.istExhaust) * alpha;
        const evanIst = this.istIntake + this.noise(0.3);
        const avanIst = this.istExhaust + this.noise(0.3);

        const map = ro >= 95 ? 960 + this.noise(8) : 300 + ro * 6.5 + this.noise(10);
        const tzBase = ro >= 95 ? (rpm < 2400 ? 20 : rpm < 4400 ? 23 : 26) : 30;

        const sample: LiveSample = { t, rpm: Math.round(rpm) };
        if (blocks.includes(3)) {
            sample.rf = Math.round(rf * 10) / 10;
            sample.ml = Math.round(rf * rpm * 0.0011 * 4) / 4;
            sample.iat = 32 + this.noise(1);
            sample.coolant = 92 + this.noise(1);
            sample.oil = 88 + this.noise(1);
            // EGT climbs with load; 16 degC/LSB on the wire, so quantise it the
            // way the real channel does or the UI's guard looks smoother than it is.
            sample.exhaustTemp = Math.round((ro >= 95 ? 780 + rpm / 30 : 420 + ro * 3) / 16) * 16;
            sample.ambientTemp = 25;
            sample.ambientPressure = 995 + this.noise(2);
            sample.ro = Math.round(ro * 100) / 100;
            sample.pedal = ro >= 95 ? 100 : ro * 1.1;
            sample.throttle = ro >= 95 ? 99.8 : ro * 1.05;
            sample.throttleTarget = sample.throttle;
            sample.battV = 13.8 + this.noise(0.1);
        }
        if (blocks.includes(19)) {
            sample.tz = Array.from({ length: 6 }, () => Math.round((tzBase + this.noise(0.6)) * 10) / 10);
            // The sweep's observable. More real air for the same modelled RF
            // reads lean, so the closed loop adds fuel and the integrator rises.
            // A concave response in intake cam with an rpm-dependent optimum
            // gives the vertex fit a known right answer to recover.
            const optimum = rpm < 3400 ? 12 : rpm < 4200 ? 8 : 4;
            const camGain = ro >= 95
                ? 0.030 - 0.00020 * Math.pow(this.istIntake - optimum, 2)
                : 0;
            sample.stft1 = 1.0 + camGain + this.noise(0.012);
            sample.stft2 = 1.0 + camGain + this.noise(0.012);
            sample.frRegler = 1.0 + this.noise(0.01);
            sample.speed = Math.round(rpm / 40);
        }
        if (blocks.includes(35)) {
            sample.evanIst = Math.round(evanIst * 10) / 10;
            sample.evanSoll = Math.round(evanSoll * 10) / 10;
            sample.avanIst = Math.round(avanIst * 10) / 10;
            sample.avanSoll = Math.round(avanSoll * 10) / 10;
            sample.evan2Ist = sample.evanIst;
            sample.evan2Soll = sample.evanSoll;
            sample.avan2Ist = sample.avanIst;
            sample.avan2Soll = sample.avanSoll;
            sample.map = Math.round(map);
            sample.rfPsau = Math.round(rf) / 100;
            sample.rfDrrel = Math.round(rf) / 100;
            sample.drRel = sample.throttle ?? ro;
            sample.flapPos = 0;   // owner car: flap removed
        }
        return sample;
    }

    /**
     * Same contract as the real link: refusals come back as a verdict, not an
     * exception. Mirrors the firmware's accept gate — the engine must be
     * running (mock: any time after connect) and the angle must be inside the
     * DME's own −20..+80 clamp, which buildVanosTargetPayload enforces before
     * this is reached.
     */
    async setVanosTarget(pin: VanosPinValue, angleDegKw: number): Promise<VanosAck> {
        await new Promise(r => setTimeout(r, 40));
        if (this.startTime === 0) return describeVanosAck(VanosAckCode.CONDITIONS_NOT_MET);
        const angle = Math.round(angleDegKw);
        if (pin === VanosPin.INTAKE) this.cmdIntake = angle;
        else this.cmdExhaust = angle;
        return describeVanosAck(VanosAckCode.ACCEPTED);
    }

    /** Release the override back to map control — what stopping the keep-alive
     *  does on the real car, exposed here so the abort path is testable. */
    async releaseVanos(): Promise<void> {
        this.cmdIntake = null;
        this.cmdExhaust = null;
    }

    async keepAlive(): Promise<boolean> {
        this.keepAliveCount++;
        return this.startTime !== 0;
    }

    /* --- preflight (Stage 122) --------------------------------------------
     * A synthetic 65536-byte image that starts STOCK in exactly the three places
     * the preflight cares about, so the offline run is the interesting one: all
     * three items FAIL, the flash changes them, and the re-read passes. A mock
     * that started patched would exercise nothing but the happy path.
     *
     * Everything else is a fixed pattern rather than zeros, because both data
     * checksums are computed over the whole half — an all-zero image would make
     * `correctDataChecksum` trivially correct and hide a slot-offset mistake. */
    private calibration: Uint8Array | null = null;
    /** Set by writeCalibration, read by the panel's post-flash check. */
    mockFlashCount = 0;

    private ensureCalibration(): Uint8Array {
        if (this.calibration) return this.calibration;
        const image = new Uint8Array(65536);
        for (let i = 0; i < image.length; i++) image[i] = (i * 31 + (i >> 8)) & 0xFF;
        // Stock KF_BZ_WDK_VL: 35-65 % across the 4x4, i.e. the lambda controller
        // really does shut off at full load.
        for (let c = 0; c < 16; c++) {
            const raw = Math.round((35 + (c % 4) * 10) * 10);
            image[0xAC54 + c * 2] = (raw >> 8) & 0xFF;
            image[0xAC54 + c * 2 + 1] = raw & 0xFF;
        }
        image[0xE5E4] = 0x12;              // k_rf_cfg stock: bit 4 set, MAP integral live
        image[0x4824] = 69 + 48;           // K_LAA_TMOT_MIN = 69 degC
        image[0x4825] = 100 + 48;          // K_LAA_TMOT_MAX = 100 degC -> window OPEN
        // A real ECU's image has valid CRCs in both slots, so this one must too — otherwise
        // "checksums were valid before AND after" is untestable, and a patch that forgot to
        // recompute them would still look fine here.
        correctDataChecksum(image);
        this.calibration = image;
        return image;
    }

    async readCalibrationBytes(binOffset: number, length: number): Promise<Uint8Array> {
        const image = this.ensureCalibration();
        if (binOffset < 0 || length <= 0 || binOffset + length > image.length) {
            throw new Error(`BIN 範囲 0x${binOffset.toString(16)}+${length} は範囲外です`);
        }
        await new Promise(r => setTimeout(r, 120));
        return image.slice(binOffset, binOffset + length);
    }

    async readCalibration(onProgress?: (pct: number) => void): Promise<Uint8Array> {
        const image = this.ensureCalibration();
        // Paced so the progress bar and the "this takes about two minutes" copy
        // are things that got looked at, not things that were assumed.
        for (let p = 0; p <= 100; p += 10) {
            onProgress?.(p);
            await new Promise(r => setTimeout(r, 60));
        }
        return image.slice();
    }

    async writeCalibration(opts: {
        image: Uint8Array;
        backup?: Uint8Array;
        onBackup: (currentImage: Uint8Array) => Promise<void>;
        onProgress?: (pct: number, phase: 'backup' | 'erase' | 'write' | 'verify') => void;
    }): Promise<void> {
        const { image, backup, onBackup, onProgress } = opts;
        if (image.length !== 65536) throw new Error(`65536 バイト必要です（${image.length} バイト受領）`);
        const current = backup ?? this.ensureCalibration();
        if (current.length !== 65536) throw new Error(`バックアップが ${current.length} バイトです`);
        // Same ordering contract as the real link: the backup is handed over and
        // AWAITED before anything is destroyed, so a rejecting handler means the
        // image is untouched. Testable here precisely because it is not real flash.
        onProgress?.(0, 'backup');
        await onBackup(current.slice());
        for (const [phase, from, to] of [
            ['erase', 40, 42], ['write', 42, 75], ['verify', 75, 100],
        ] as const) {
            for (let p = from; p <= to; p += Math.max(1, Math.round((to - from) / 6))) {
                onProgress?.(p, phase);
                await new Promise(r => setTimeout(r, 50));
            }
        }
        this.calibration = image.slice();
        this.mockFlashCount++;
    }

    async readEngineRpm(): Promise<number> {
        // Zero, always. The mock has no engine, and the one caller is the guard
        // that refuses to flash a running one — reporting the idle pattern here
        // would make that guard untestable offline for no benefit.
        return 0;
    }

    async clearVanosAdaptations(): Promise<AdaptationSnapshot> {
        await new Promise(r => setTimeout(r, 2200));   // the DME's real EEPROM settle
        return this.mockAdaptations();
    }

    async clearTuneAdaptations(): Promise<AdaptationSnapshot> {
        await new Promise(r => setTimeout(r, 2200));
        return this.mockAdaptations();
    }

    /** Post-clear values: every row at whatever `cleared` says it should read.
     *  Not all zero — two rows are multiplicative trims whose neutral is 1.0. */
    private mockAdaptations(): AdaptationSnapshot {
        const rows = [...STANDARD_ADAPTATIONS_BLOCK.fields, ...OBSERVATION_ADAPTATIONS_BLOCK.fields];
        return {
            at: Date.now(),
            readings: rows.map(f => ({
                symbol: f.symbol, label: f.label, unit: f.unit, group: f.group,
                value: f.cleared, cleared: f.cleared, clearedByTuneReset: f.clearedByTuneReset,
            })),
        };
    }
}
