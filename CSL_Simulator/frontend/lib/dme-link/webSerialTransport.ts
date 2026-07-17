import { DmeLinkError } from './types';

/**
 * Thin wrapper isolating all navigator.serial calls. Ported verbatim from
 * E46M3CSL_TuningTool (hardware-proven against a real MSS54 at 9600 8E1).
 *
 * Received bytes are drained by a single background pump into an internal
 * buffer, and readExact() consumes from that buffer: the Web Serial reader
 * delivers bytes at arbitrary chunk boundaries, so a DS2 echo and the start of
 * its response frequently arrive in the SAME chunk — buffering never drops a
 * byte, keeping echo/response framing aligned across thousands of exchanges.
 */
export class WebSerialTransport {
    private port: SerialPort | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private buffer: number[] = [];
    private pumpActive = false;
    private pumpError: Error | null = null;

    static isSupported(): boolean {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    async open(): Promise<void> {
        if (!WebSerialTransport.isSupported()) {
            throw new DmeLinkError('Web Serial API is not available in this browser (Chrome/Edge desktop required).');
        }
        // Must be called from within a real user gesture (e.g. a button click handler).
        this.port = await navigator.serial!.requestPort();
        await this.port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' });
        this.writer = this.port.writable!.getWriter();
        this.reader = this.port.readable!.getReader();
        this.buffer = [];
        this.pumpError = null;
        this.pumpActive = true;
        this.startPump();
    }

    private startPump(): void {
        const reader = this.reader!;
        (async () => {
            try {
                while (this.pumpActive) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        for (let i = 0; i < value.length; i++) this.buffer.push(value[i]);
                    }
                }
            } catch (e: unknown) {
                this.pumpError = e instanceof Error ? e : new Error(String(e));
            }
        })();
    }

    async close(): Promise<void> {
        this.pumpActive = false;
        try { await this.reader?.cancel(); } catch { }
        try { this.reader?.releaseLock(); } catch { }
        try { this.writer?.releaseLock(); } catch { }
        try { await this.port?.close(); } catch { }
        this.reader = null;
        this.writer = null;
        this.port = null;
        this.buffer = [];
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (!this.writer) throw new DmeLinkError('Serial port is not open');
        await this.writer.write(bytes);
    }

    /** Discards any buffered received bytes — used to resynchronize after a timeout before retrying. */
    purge(): void {
        this.buffer = [];
    }

    /**
     * Reads exactly `length` bytes, waiting up to `timeoutMs`. Surplus bytes received alongside are
     * retained in the buffer for the next call — never dropped.
     */
    async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
        const deadline = Date.now() + timeoutMs;
        while (this.buffer.length < length) {
            if (this.pumpError) throw new DmeLinkError('Serial read failed: ' + this.pumpError.message);
            if (Date.now() >= deadline) {
                throw new DmeLinkError(`Timed out waiting for ${length} byte(s) (received ${this.buffer.length})`);
            }
            await new Promise(r => setTimeout(r, 2));
        }
        return Uint8Array.from(this.buffer.splice(0, length));
    }
}
