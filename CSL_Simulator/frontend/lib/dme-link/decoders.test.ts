/**
 * Decoder unit table (Stage 76): known byte sequences -> expected engineering
 * values, per DmeLiveValueCatalog.cs. Run: npx tsx lib/dme-link/decoders.test.ts
 * Exit 0 = all pass.
 */
import { decodeBlock3, decodeBlock19, decodeBlock35 } from './liveValueBlocks';

let failures = 0;
function expectClose(name: string, got: number | null | undefined, want: number, tol = 1e-6) {
    const ok = got != null && Math.abs(got - want) <= tol;
    if (!ok) { failures++; console.log(`  FAIL ${name}: got ${got}, want ${want}`); }
    else console.log(`  ok   ${name} = ${got}`);
}

// --- block 3 (35 bytes) ------------------------------------------------------
// Craft a payload: n=6900 (0x1AF4), ml=1000kg/h (4000=0x0FA0), rf=104.2% (1042=0x0412),
// tan=32C (80=0x50), tmot=92C (140=0x8C), tumg=25C (73=0x49), ub=13.8V (138=0x8A),
// pumg=995mbar ((995-500)/3=165=0xA5), aq_rel=100% (215=0x00D7), pwg1=55.5% (555=0x022B),
// wdk1=99.8% (998=0x03E6), edk_soll=100.0% (1000=0x03E8)
const b3 = new Uint8Array(35);
const dv3 = new DataView(b3.buffer);
dv3.setUint16(0, 6900);       // n
dv3.setUint16(4, 4000);       // ml   -> 1000 kg/h
dv3.setUint16(8, 1042);       // rf   -> 104.2 %
b3[10] = 80;                  // tan  -> 32 C
b3[11] = 140;                 // tmot -> 92 C
b3[15] = 73;                  // tumg -> 25 C
b3[16] = 138;                 // ub   -> 13.8 V
b3[19] = 165;                 // pumg -> 995 mbar
dv3.setUint16(20, 215);       // aq_rel -> 100.0000000 % (215*0.46511627906976744)
dv3.setInt16(23, 555);        // pwg1 -> 55.5 %
dv3.setInt16(27, 998);        // wdk1 -> 99.8 %
dv3.setInt16(31, 1000);       // edk_soll -> 100.0 %
console.log('block 3:');
const r3 = decodeBlock3(b3);
expectClose('rpm', r3.rpm, 6900);
expectClose('ml', r3.ml, 1000);
expectClose('rf', r3.rf, 104.2);
expectClose('iat', r3.iat, 32);
expectClose('coolant', r3.coolant, 92);
expectClose('ambientTemp', r3.ambientTemp, 25);
expectClose('battV', r3.battV, 13.8);
expectClose('ambientPressure', r3.ambientPressure, 995);
expectClose('ro', r3.ro, 100.0);
expectClose('pedal', r3.pedal, 55.5);
expectClose('throttle', r3.throttle, 99.8);
expectClose('throttleTarget', r3.throttleTarget, 100.0);

// --- block 19 (90 bytes) -----------------------------------------------------
// v=142km/h, tz1=25.3deg (253), tz2=-4.7deg (-47, sign-extension check),
// la_f_regler1=1.0 (32768=0x8000 as uint16), fr_regler=0.5 (16384)
const b19 = new Uint8Array(90);
const dv19 = new DataView(b19.buffer);
dv19.setUint16(0, 142);
dv19.setInt16(22, 253);
dv19.setInt16(24, -47);
dv19.setUint16(40, 32768);
dv19.setUint16(79, 16384);
console.log('block 19:');
const r19 = decodeBlock19(b19);
expectClose('speed', r19.speed, 142);
expectClose('tz1', r19.tz1, 25.3);
expectClose('tz2 (negative/sign-extend)', r19.tz2, -4.7);
expectClose('stft1 (neutral 1.0)', r19.stft1, 1.0);
expectClose('frRegler', r19.frRegler, 0.5);

// --- block 35 (39 bytes) -----------------------------------------------------
// n=3900, evan1_ist=70.4 (704), evan1_soll=70.0 (700), avan1_ist=-12.8 (-128,
// sign check), avan1_soll=87.0 (870), gks=512, psau_local=960mbar (30720=960*32),
// dr_rel=99.5% (32604 -> 32604*0.0030517578125=99.5...), rf_psau=0.95 (950? u8 max 255
// -> use 0.255 max... rf_psau is u8*0.001 so max 0.255; use 200 -> 0.200),
// rf_drrel=1.042 (1042)
const b35 = new Uint8Array(39);
const dv35 = new DataView(b35.buffer);
dv35.setUint16(0, 3900);
dv35.setInt16(2, 704);
dv35.setInt16(4, 700);
dv35.setInt16(6, -128);
dv35.setInt16(8, 870);
dv35.setUint16(18, 512);
dv35.setUint16(22, 30720);
dv35.setUint16(26, 32604);
b35[29] = 200;
dv35.setUint16(30, 1042);
console.log('block 35:');
const r35 = decodeBlock35(b35);
expectClose('rpm35', r35.rpm35, 3900);
expectClose('evanIst', r35.evanIst, 70.4);
expectClose('evanSoll', r35.evanSoll, 70.0);
expectClose('avanIst (negative/sign-extend)', r35.avanIst, -12.8);
expectClose('avanSoll', r35.avanSoll, 87.0);
expectClose('flapPos', r35.flapPos, 512);
expectClose('map', r35.map, 960);
expectClose('drRel', r35.drRel, 32604 * 0.0030517578125);
expectClose('rfPsau', r35.rfPsau, 0.2);
expectClose('rfDrrel', r35.rfDrrel, 1.042);

// short-payload guard: fields past the end must decode to null, not garbage
const short35 = b35.subarray(0, 10);
const rs = decodeBlock35(short35);
if (rs.map !== null) { failures++; console.log('  FAIL short-payload guard: map should be null'); }
else console.log('  ok   short-payload guard (map=null on truncated block)');

if (failures > 0) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('all decoder checks passed');
