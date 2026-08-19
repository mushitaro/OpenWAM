import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection } from './types';
import { describeVanosAck, VanosAck, VanosAckCode, VanosPin, VanosPinValue } from './ds2';

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
}
