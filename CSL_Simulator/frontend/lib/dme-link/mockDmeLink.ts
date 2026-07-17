import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection } from './types';

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
 */
export class MockDmeLink implements DmeTelemetryLink {
    private startTime = 0;
    private cycleLength = 50; // s

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

        // VANOS: plausible map-following targets with first-order actuator lag noise
        const evanSoll = ro >= 95 ? (rpm < 3000 ? 80 : rpm < 5000 ? 70 : 88) : 95 - ro * 0.2;
        const avanSoll = ro >= 95 ? (rpm < 3000 ? 93 : rpm < 5000 ? 87 : 105) : 110 - ro * 0.1;
        const evanIst = evanSoll + this.noise(0.8);
        const avanIst = avanSoll + this.noise(0.8);

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
            sample.stft1 = 1.0 + this.noise(0.03);
            sample.stft2 = 1.0 + this.noise(0.03);
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
}
