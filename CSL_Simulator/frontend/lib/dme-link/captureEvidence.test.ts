import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { WebSerialDmeLink, KLineTransport } from './webSerialDmeLink';
import { buildDs2Frame, parseDs2Frame } from './ds2';
import { DmeLinkError } from './types';
import { decodeBlock3, decodeBlock35, DECODER_VERSION } from './liveValueBlocks';
import { beginRun, appendChunk, findRecoverableRun, loadRunSamples, discardRun } from '../sweep/recordingStore';
import { uploadSweep } from '../sweep/collector';
import { gunzipSync } from 'node:zlib';

class FixtureTransport implements KLineTransport {
    image = new Uint8Array(65536);
    queue: Uint8Array[] = [];
    requests: Uint8Array[] = [];
    fault: 'none' | 'checksum' | 'reject' | 'short' | 'timeout' = 'none';
    constructor() {
        const v = new DataView(this.image.buffer);
        for (const x of [0x18d0,0x1bf6]) for (let i=0;i<16;i++) v.setUint16(x+2*i,600+i*500);
        for (const y of [0x18f0,0x1c16]) for (let i=0;i<16;i++) v.setUint16(y+2*i,i*2000);
    }
    async open() {} async close() {} purge() { this.queue=[]; }
    async write(request: Uint8Array) {
        this.requests.push(new Uint8Array(request));
        const f = parseDs2Frame(request);
        let payload = new Uint8Array([0]); let status = 0xa0;
        if (f.controlOrStatus === 0x0d) status=0xa2;
        if (f.controlOrStatus === 0x06) {
            const addr=(f.payload[1]<<16)|(f.payload[2]<<8)|f.payload[3];
            const offset=addr>=0xa00000 ? addr-0xa00000 : addr-0x200000+32768;
            payload=this.image.slice(offset,offset+f.payload[4]);
        }
        if (f.controlOrStatus === 0x0b) {
            assert.ok([3,19,35].includes(f.payload[0]));
            payload=new Uint8Array(f.payload[0]===3 ? 35 : f.payload[0]===19 ? 90 : 39);
            if (f.payload[0]!==19) { payload[0]=0x0f; payload[1]=0x3c; }
            if (f.payload[0]===35) { payload[2]=0xff; payload[3]=0xf7; payload[6]=1; payload[7]=0x9a; }
            if (this.fault==='reject') status=0xa2;
            if (this.fault==='short') payload=new Uint8Array([1]);
        }
        const response=buildDs2Frame(0x12,status,payload);
        if (this.fault==='checksum' && f.controlOrStatus===0x0b) response[response.length-1]^=1;
        this.queue=[new Uint8Array(request),response.slice(0,2),response.slice(2)];
        if (this.fault==='timeout' && f.controlOrStatus===0x0b) this.queue=[new Uint8Array(request),response.slice(0,2)];
    }
    async readExact(n: number) {
        const b=this.queue.shift(); if (!b) throw new Error('fixture timeout');
        assert.equal(b.length,n); return b;
    }
}

async function main() {
    const transport=new FixtureTransport(); const link=new WebSerialDmeLink(transport);
    await link.connect(); assert.equal(link.getCalibrationEvidence(),null);
    await link.readCalibration(); const calibration=link.getCalibrationEvidence()!;
    assert.equal(calibration.imageHex.length,131072); assert.equal(calibration.sha256.length,64);
    calibration.sha256='modified copy'; assert.notEqual(link.getCalibrationEvidence()!.sha256,calibration.sha256);
    const evidence=link.getCalibrationEvidence()!;
    link.resetClock();
    const before=transport.requests.length;
    const sample=await link.pollSample([3,19,35]);
    assert.equal(transport.requests.length-before,3,'no extra polling exchanges');
    const records=sample.acquisition!.blocks;
    assert.equal(sample.rpm,3900); assert.equal(sample.evanIst,-0.9); assert.equal(sample.avanIst,41);
    assert.equal(records.length,3);
    assert.ok(records.every((r,i)=>r.requestStartMs<=r.responseEndMs && (!i || r.requestStartMs>=records[i-1].responseEndMs)));
    assert.equal(decodeBlock3(Uint8Array.from(Buffer.from(records[0].payloadHex!,'hex'))).rpm,sample.rpm);
    assert.equal(decodeBlock35(Uint8Array.from(Buffer.from(records[2].payloadHex!,'hex'))).evanIst,sample.evanIst);
    const samples=[sample];
    for (const fault of ['checksum','reject','short','timeout'] as const) {
        transport.fault=fault;
        try { await link.pollSample([3,35]); assert.fail('fault should reject'); }
        catch (e) {
            assert.ok(e instanceof DmeLinkError && e.capturedSample);
            const failed=e.capturedSample!; samples.push(failed);
            assert.equal(failed.acquisitionFailed,true); assert.equal(failed.acquisition!.blocks.length,2);
            assert.ok(failed.acquisition!.blocks[0].responseHex.length>0);
            assert.equal(failed.acquisition!.blocks[0].outcome,fault==='reject' ? 'rejected':'error');
        }
    }
    const meta={ source:'webserial' as const, capture_schema_version:1, decoder_version:DECODER_VERSION,
        calibration:evidence, time_origin_ms:sample.acquisition!.timeOriginMs,
        recording_started_at:new Date().toISOString(), vin:'TEST-SYNTHETIC' };
    const run=await beginRun({mock:false,capture:meta});
    await appendChunk(run,0,samples.slice(0,2)); await appendChunk(run,1,samples.slice(2));
    const recovered=await findRecoverableRun(); assert.equal(recovered?.runId,run);
    assert.deepEqual(recovered?.meta,meta); assert.deepEqual(await loadRunSamples(run),samples);
    const wire=JSON.parse(JSON.stringify({meta:recovered!.meta,samples:await loadRunSamples(run)}));
    assert.deepEqual(wire,{meta,samples:JSON.parse(JSON.stringify(samples))});
    const originalFetch=globalThis.fetch;
    let uploads=0;
    globalThis.fetch=async (_url,init) => {
        uploads++;
        const body=JSON.parse(String(init?.body));
        assert.deepEqual(body.meta.capture,meta);
        const rows=JSON.parse(gunzipSync(Buffer.from(body.samples_gz_b64,'base64')).toString());
        assert.deepEqual(rows.map((s:{capture_sample:unknown})=>s.capture_sample),wire.samples);
        return new Response(JSON.stringify({id:body.id,n_samples:rows.length}),{status:200});
    };
    try {
        assert.equal((await uploadSweep(samples,{id:'synthetic-test',capture:meta},{baseUrl:'https://fixture.invalid',token:'synthetic'})).ok,true);
        assert.equal(uploads,1);
    } finally {globalThis.fetch=originalFetch;}
    if(process.env.CAPTURE_FIXTURE_OUT) writeFileSync(process.env.CAPTURE_FIXTURE_OUT,JSON.stringify(wire));
    await discardRun(run); assert.equal(await findRecoverableRun(),null);
    transport.fault='none'; await link.disconnect(); assert.equal(link.getCalibrationEvidence(),null);
    await link.connect(); await link.readCalibration();
    // Invalid write is rejected before programming but still invalidates capture provenance.
    await assert.rejects(link.writeCalibration({image:new Uint8Array(1),onBackup:async()=>{}}));
    assert.equal(link.getCalibrationEvidence(),null);
    assert.ok(transport.requests.every(b=>[0x90,0x0d,0x06,0x0b].includes(b[2])),'no actuator or write telegrams');
    console.log('PASS: calibration SHA/session invalidation, raw replay, transaction timing, four failures, IndexedDB recovery and JSON roundtrip. Synthetic transport only.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
