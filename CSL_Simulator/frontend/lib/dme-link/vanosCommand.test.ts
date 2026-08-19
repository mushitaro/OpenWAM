/**
 * Stage 121 — DS2 VANOS write path, verified without a car.
 *
 * Covers the two things that are expensive to get wrong on the road: the exact
 * bytes on the wire (a wrong pin or an unsigned angle would command the wrong
 * cam, or the wrong direction), and the refusal contract (a semantic refusal
 * must arrive as a value so the caller stops, never as something a retry loop
 * could hammer).
 *
 * Run: npx tsx lib/dme-link/vanosCommand.test.ts    Exit 0 = all pass.
 */
import {
    DS2_DEFAULT_ADDRESS, Ds2Control, buildDs2Frame, buildVanosTargetPayload,
    describeVanosAck, ds2Checksum, parseDs2Frame, VanosAckCode, VanosPin,
    VANOS_CMD_MIN_DEG, VANOS_CMD_MAX_DEG, VANOS_STORABLE,
} from './ds2';
import { MockDmeLink } from './mockDmeLink';
import { supportsVanosControl } from './types';

let failures = 0;
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');

function check(name: string, cond: boolean, detail = '') {
    if (cond) console.log(`  ok   ${name}`);
    else { failures++; console.log(`  FAIL ${name}${detail ? ': ' + detail : ''}`); }
}
function expectEq<T>(name: string, got: T, want: T) {
    check(name, Object.is(got, want), `got ${String(got)}, want ${String(want)}`);
}

console.log('\nDS2 frame bytes');
{
    // The reference frame from the disassembly notes: 12 07 0C 07 <angle> 00 <XOR>
    const frame = buildDs2Frame(
        DS2_DEFAULT_ADDRESS, Ds2Control.SET_IO_STATUS,
        buildVanosTargetPayload(VanosPin.INTAKE, 45));
    expectEq('address', frame[0], 0x12);
    expectEq('length byte counts the whole frame', frame[1], 7);
    expectEq('control = SET_IO_STATUS', frame[2], 0x0c);
    expectEq('pin = intake', frame[3], 0x07);
    expectEq('angle 45', frame[4], 45);
    expectEq('period unused', frame[5], 0x00);
    expectEq('checksum = XOR of the rest', frame[6], ds2Checksum(frame.subarray(0, 6)));
    console.log(`       wire: ${hex(frame)}`);

    const ex = buildDs2Frame(
        DS2_DEFAULT_ADDRESS, Ds2Control.SET_IO_STATUS,
        buildVanosTargetPayload(VanosPin.EXHAUST, 41));
    expectEq('pin = exhaust', ex[3], 0x0a);

    // A negative angle must go out as two's complement, or the DME reads a huge
    // positive one and refuses (or worse, accepts the wrong direction).
    const neg = buildVanosTargetPayload(VanosPin.INTAKE, -10);
    expectEq('-10 degKW encodes as 0xF6', neg[1], 0xf6);
}

console.log('\nAngle clamping (the only limit the firmware still applies)');
{
    const rejects = (angle: number) => {
        try { buildVanosTargetPayload(VanosPin.INTAKE, angle); return false; } catch { return true; }
    }
    check(`refuses ${VANOS_CMD_MAX_DEG + 1}`, rejects(VANOS_CMD_MAX_DEG + 1));
    check(`refuses ${VANOS_CMD_MIN_DEG - 1}`, rejects(VANOS_CMD_MIN_DEG - 1));
    check('refuses NaN', rejects(NaN));
    check(`accepts ${VANOS_CMD_MAX_DEG}`, !rejects(VANOS_CMD_MAX_DEG));
    check(`accepts ${VANOS_CMD_MIN_DEG}`, !rejects(VANOS_CMD_MIN_DEG));
    check('storable window sits inside the accept range',
        VANOS_STORABLE.intake.min >= VANOS_CMD_MIN_DEG
        && VANOS_STORABLE.intake.max <= VANOS_CMD_MAX_DEG
        && VANOS_STORABLE.exhaust.max <= VANOS_CMD_MAX_DEG);
}

console.log('\nAck contract — a refusal is a value, and never retryable');
{
    const accepted = describeVanosAck(VanosAckCode.ACCEPTED);
    check('0 = accepted', accepted.accepted);
    for (const code of [VanosAckCode.ABOVE_MAX, VanosAckCode.BELOW_MIN,
                        VanosAckCode.CONDITIONS_NOT_MET, 99]) {
        const a = describeVanosAck(code);
        check(`code ${code} refuses`, !a.accepted);
        check(`code ${code} is not retryable`, a.retryable === false);
        check(`code ${code} explains itself to the driver`, a.message.length > 8);
    }
}

console.log('\nResponse parsing');
{
    // A DME positive response carrying pin + feedback byte.
    const resp = buildDs2Frame(DS2_DEFAULT_ADDRESS, 0xa0, new Uint8Array([0x07, 0x04]));
    const parsed = parseDs2Frame(resp);
    expectEq('feedback byte read from payload[1]',
        describeVanosAck(parsed.payload[1]).code, VanosAckCode.CONDITIONS_NOT_MET);
}

async function mockChecks() {
    console.log('\nMock link drives the cams (so the sweep is testable with no car)');
    {
        const link = new MockDmeLink();
        check('mock advertises the control surface', supportsVanosControl(link));
        await link.connect();

        const ack = await link.setVanosTarget!(VanosPin.INTAKE, 15);
        check('mock accepts a command', ack.accepted);

        // Drive the poll loop and watch `ist` climb toward the commanded target
        // WITHOUT arriving instantly — an arrival gate against a mock that
        // teleports would pass here and stall on the car.
        const first = await link.pollSample([3, 19, 35]);
        const gap = Math.abs((first.evanIst ?? 0) - 15);
        check('actual lags the target at first', gap > 1, `gap ${gap.toFixed(2)}`);

        let last = first;
        for (let i = 0; i < 12; i++) last = await link.pollSample([3, 19, 35]);
        const settled = Math.abs((last.evanIst ?? 0) - 15);
        check('actual reaches the target', settled <= 2, `gap ${settled.toFixed(2)}`);
        expectEq('target reports the commanded angle', Math.round(last.evanSoll ?? -1), 15);

        await link.releaseVanos();
        let reverted = last;
        for (let i = 0; i < 12; i++) reverted = await link.pollSample([3, 19, 35]);
        check('releasing returns the cam to map control',
            Math.round(reverted.evanSoll ?? -1) !== 15
            || Math.abs((reverted.evanSoll ?? 0) - 15) > 0.5,
            `soll ${reverted.evanSoll}`);

        check('keep-alive answers while connected', await link.keepAlive!());
    }
}

mockChecks().then(() => {
    console.log(failures === 0
        ? '\nAll VANOS command checks passed.\n'
        : `\n${failures} check(s) FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
});
