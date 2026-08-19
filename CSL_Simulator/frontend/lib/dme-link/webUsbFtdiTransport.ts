import { DmeLinkError } from './types';

/**
 * K-line transport over an FTDI cable via WebUSB — the Android path.
 *
 * Android Chrome does NOT implement Web Serial, so `webSerialTransport.ts`
 * cannot run on a phone at all. Without this file the whole tool is desktop-only,
 * which is the one place a live VANOS sweep can never happen.
 *
 * Ported from E46M3CSL_TuningTool src/lib/dme-link/webUsbFtdiTransport.ts (that
 * project is not modified by this one), reduced to the surface this app's DS2
 * layer actually uses: open / close / write / purge / readExact. The FTDI
 * specifics below are the parts that are expensive to rediscover.
 *
 * Presents the same contract as WebSerialTransport: a single background pump
 * drains the endpoint into a buffer and `readExact` consumes from it, because a
 * DS2 echo and the start of its response routinely arrive in one USB transfer.
 */

/** FTDI's vendor ID. Also the chooser filter, so a CH340 cable never gets here. */
const FTDI_VENDOR_ID = 0x0403;

const SIO_RESET = 0x00;
const SIO_SET_MODEM_CTRL = 0x01;
const SIO_SET_FLOW_CTRL = 0x02;
const SIO_SET_BAUD_RATE = 0x03;
const SIO_SET_DATA = 0x04;
const SIO_SET_LATENCY_TIMER = 0x09;

const SIO_RESET_SIO = 0;
const SIO_RESET_PURGE_RX = 2;

/** Port A. Single-channel parts accept 1 here. */
const FTDI_PORT_INDEX = 1;

/** 8 data bits, even parity, 1 stop — what DS2 on the MSS54 K-line runs. */
const FTDI_DATA_8E1 = 0x0208;
/** DTR low + RTS low, with both "set" bits, matching the reference tool. */
const FTDI_MODEM_DTR_LOW_RTS_LOW = 0x0300;

/** Latency timer. The default 16 ms adds a whole DS2 round-trip's worth of delay
 *  to a 3 Hz poll; 4 ms is what the tuner measured as safe for logging. */
const FTDI_LATENCY_MS = 4;

/** 16550 line-status bits carried in byte 1 of every FTDI packet header. */
const LSR_OVERRUN = 0x02;
const LSR_PARITY = 0x04;
const LSR_FRAMING = 0x08;
const LSR_BREAK = 0x10;
const LSR_ANY_ERROR = LSR_OVERRUN | LSR_PARITY | LSR_FRAMING | LSR_BREAK;

/** AM=2, BM=4, R=6. H-series and FT-X clock differently and would need another
 *  divisor encoding, so refuse rather than send a wrong baud rate. */
const SUPPORTED_CHIP_VERSIONS = new Set([2, 4, 6]);

/**
 * 9600 baud divisor, precomputed and checked at module load.
 *
 * Encoding: an integer divisor plus a 3-bit fractional code against a 3 MHz
 * base clock, worked in eighths (24 MHz = 3 MHz x 8):
 *   d8 = 24_000_000 / baud;  frac = [0,3,2,4,1,5,6,7][d8 & 7]
 *   encoded = (d8 >> 3) | (frac << 14)
 * 0x4138 also matches FTDI's published AN232B-05 table, which is the independent
 * check that the derivation is right. A wrong divisor is a garbled K-line.
 */
const FTDI_DIVISOR_9600 = { value: 0x4138, index: 0 };

(function assertDivisor(): void {
    const FRAC = [0, 3, 2, 4, 1, 5, 6, 7];
    const d8 = 24_000_000 / 9600;
    const encoded = (d8 >> 3) | (FRAC[d8 & 7] << 14);
    if ((encoded & 0xFFFF) !== FTDI_DIVISOR_9600.value || (encoded >>> 16) !== FTDI_DIVISOR_9600.index) {
        throw new Error('FTDI 9600 divisor constant is wrong');
    }
})();

/** A line fault. The NAME matches the Web Serial backend's spelling so the DS2
 *  layer's messages read the same on both transports. */
class FtdiLineError extends Error {
    constructor(name: string, message: string) {
        super(message);
        this.name = name;
    }
}

export class WebUsbFtdiTransport {
    private device: USBDevice | null = null;
    private interfaceNumber = 0;
    private inEndpoint = 0;
    private outEndpoint = 0;
    private packetSize = 64;
    private buffer: number[] = [];
    private pumpActive = false;
    private pumpExited: Promise<void> = Promise.resolve();
    private pumpError: Error | null = null;
    private deviceGone = false;
    /** The first packet after a reset reports stale line status; honouring it
     *  would fail every connection with a phantom framing error. */
    private skipLineStatusOnce = false;

    static isSupported(): boolean {
        return typeof navigator !== 'undefined' && 'usb' in navigator && navigator.usb !== undefined;
    }

    private onDisconnect = (event: USBConnectionEvent): void => {
        if (this.device && event.device === this.device) {
            this.deviceGone = true;
            this.pumpError = new FtdiLineError('NetworkError', 'ケーブルが外れました');
        }
    };

    private async sio(request: number, value: number, index = FTDI_PORT_INDEX): Promise<void> {
        const device = this.device;
        if (!device) throw new DmeLinkError('USB デバイスが開かれていません');
        const r = await device.controlTransferOut({
            requestType: 'vendor', recipient: 'device', request, value, index,
        });
        if (r.status !== 'ok') {
            throw new DmeLinkError(`FTDI 制御要求 0x${request.toString(16)} に失敗しました (${r.status})`);
        }
    }

    async open(): Promise<void> {
        if (!WebUsbFtdiTransport.isSupported()) {
            throw new DmeLinkError('この端末では WebUSB が使えません（Android は Chrome が必要です）。');
        }
        const usb = navigator.usb!;
        // Already-granted devices first: WebUSB permissions persist, so a
        // returning user should not have to pick the same cable again. It must
        // come BEFORE requestDevice, while the tap's user activation is alive.
        const granted = (await usb.getDevices()).filter(d => d.vendorId === FTDI_VENDOR_ID);
        // requestDevice's rejection is deliberately not wrapped: dismissing the
        // chooser rejects with NotFoundError, and turning "changed their mind"
        // into a red error line would be wrong.
        const device = granted[0] ?? await usb.requestDevice({ filters: [{ vendorId: FTDI_VENDOR_ID }] });
        this.device = device;
        this.deviceGone = false;

        await device.open();
        if (!device.configuration) await device.selectConfiguration(1);
        this.selectEndpoints();
        this.assertSupportedChipFamily();
        await device.claimInterface(this.interfaceNumber);
        usb.addEventListener('disconnect', this.onDisconnect);

        // Order matters: SIO_RESET clears modem-control state, so DTR/RTS follows it.
        await this.sio(SIO_RESET, SIO_RESET_SIO);
        await this.sio(SIO_SET_LATENCY_TIMER, FTDI_LATENCY_MS);
        await this.sio(SIO_SET_FLOW_CTRL, 0, 0x0000 | FTDI_PORT_INDEX);
        await this.sio(SIO_SET_BAUD_RATE, FTDI_DIVISOR_9600.value, FTDI_DIVISOR_9600.index);
        await this.sio(SIO_SET_DATA, FTDI_DATA_8E1);
        await this.sio(SIO_SET_MODEM_CTRL, FTDI_MODEM_DTR_LOW_RTS_LOW);
        await this.sio(SIO_RESET, SIO_RESET_PURGE_RX);

        this.buffer = [];
        this.pumpError = null;
        this.skipLineStatusOnce = true;
        this.pumpActive = true;
        this.startPump();
    }

    /** Endpoint numbers are read from the descriptors, never hardcoded: they are
     *  0x81/0x02 on every FT232R seen so far, but a wrong guess is a dead link
     *  with no error. */
    private selectEndpoints(): void {
        const device = this.device!;
        for (const iface of device.configuration?.interfaces ?? []) {
            const inEp = iface.alternate.endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
            const outEp = iface.alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
            if (inEp && outEp) {
                this.interfaceNumber = iface.interfaceNumber;
                this.inEndpoint = inEp.endpointNumber;
                this.outEndpoint = outEp.endpointNumber;
                this.packetSize = inEp.packetSize || 64;
                return;
            }
        }
        throw new DmeLinkError('バルク転送のエンドポイントが見つかりません。FTDI 製ケーブルか確認してください。');
    }

    private assertSupportedChipFamily(): void {
        const version = this.device!.deviceVersionMajor;
        if (!SUPPORTED_CHIP_VERSIONS.has(version)) {
            throw new DmeLinkError(
                `未対応の FTDI チップです (bcdDevice major ${version})。`
                + 'このトランスポートは FT232AM/BM/R の分周方式にのみ対応しています。');
        }
    }

    private startPump(): void {
        const device = this.device!;
        this.pumpExited = (async () => {
            const scratch = new Uint8Array(8 * this.packetSize);
            while (this.pumpActive) {
                let result: USBInTransferResult;
                try {
                    result = await device.transferIn(this.inEndpoint, 8 * this.packetSize);
                } catch (e: unknown) {
                    if (!this.pumpActive) return;
                    this.pumpError = this.deviceGone
                        ? new FtdiLineError('NetworkError', 'ケーブルが外れました')
                        : (e instanceof Error ? e : new Error(String(e)));
                    return;
                }
                if (!this.pumpActive) return;
                if (result.status === 'stall') {
                    try { await device.clearHalt('in', this.inEndpoint); continue; }
                    catch (e: unknown) { this.pumpError = e instanceof Error ? e : new Error(String(e)); return; }
                }
                const view = result.data;
                if (!view) continue;

                // Every 64-byte packet is prefixed with a 2-byte status header
                // that is NOT payload. Failing to strip it injects two junk bytes
                // into the DS2 frame every packet.
                let payload = 0;
                let fault: number | null = null;
                for (let off = 0; off + 2 <= view.byteLength; off += this.packetSize) {
                    const lineStatus = view.getUint8(off + 1);
                    if ((lineStatus & LSR_ANY_ERROR) !== 0 && !this.skipLineStatusOnce) {
                        fault = lineStatus;
                        break;
                    }
                    const available = Math.min(this.packetSize, view.byteLength - off) - 2;
                    for (let i = 0; i < available; i++) scratch[payload++] = view.getUint8(off + 2 + i);
                }
                this.skipLineStatusOnce = false;
                // Deliver before latching the fault: bytes that arrived cleanly
                // ahead of it in the same transfer are real, and dropping them
                // would desync the frame the link is mid-way through reading.
                for (let i = 0; i < payload; i++) this.buffer.push(scratch[i]);
                if (fault !== null) { this.pumpError = this.classifyLineStatus(fault); return; }
            }
        })();
    }

    private classifyLineStatus(lineStatus: number): Error {
        if (lineStatus & LSR_BREAK) return new FtdiLineError('BreakError', 'ブレーク信号を検出しました');
        if (lineStatus & LSR_FRAMING) return new FtdiLineError('FramingError', 'フレーミングエラー');
        if (lineStatus & LSR_PARITY) return new FtdiLineError('ParityError', 'パリティエラー');
        return new FtdiLineError('BufferOverrunError', '受信バッファのオーバーラン');
    }

    async write(bytes: Uint8Array): Promise<void> {
        const device = this.device;
        if (!device) throw new DmeLinkError('USB デバイスが開かれていません');
        // Copy into a plain ArrayBuffer-backed view: a SharedArrayBuffer-backed
        // one is rejected by WebUSB.
        const out = new Uint8Array(bytes.length);
        out.set(bytes);
        const r = await device.transferOut(this.outEndpoint, out);
        if (r.status !== 'ok') throw new DmeLinkError(`USB 送信に失敗しました (${r.status})`);
    }

    purge(): void {
        this.buffer = [];
    }

    async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
        const deadline = Date.now() + timeoutMs;
        while (this.buffer.length < length) {
            if (this.pumpError) {
                const e = this.pumpError;
                throw new DmeLinkError(`K-line 受信エラー (${e.name}): ${e.message}`, e);
            }
            if (Date.now() > deadline) {
                throw new DmeLinkError(
                    `DME からの応答がありません (${length} バイト待ち、${this.buffer.length} バイト受信)`);
            }
            await new Promise(r => setTimeout(r, 2));
        }
        return new Uint8Array(this.buffer.splice(0, length));
    }

    async close(): Promise<void> {
        this.pumpActive = false;
        navigator.usb?.removeEventListener('disconnect', this.onDisconnect);
        try { await this.pumpExited; } catch { /* the pump's own error is already latched */ }
        try { await this.device?.releaseInterface(this.interfaceNumber); } catch { /* closing anyway */ }
        try { await this.device?.close(); } catch { /* closing anyway */ }
        this.device = null;
        this.buffer = [];
        this.pumpError = null;
    }
}
