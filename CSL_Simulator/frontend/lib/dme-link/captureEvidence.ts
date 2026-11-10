/** Host receipt times bracket the transaction, not the ECU's internal sampling instant. */
export interface BlockEvidence {
    block: number;
    requestStartMs: number;
    responseEndMs: number;
    requestHex: string;
    echoHex: string;
    responseHex: string;
    payloadHex?: string;
    outcome: 'ok' | 'rejected' | 'error';
    error?: string;
}

export interface CalibrationEvidence {
    sha256: string;
    byteLength: number;
    imageHex: string;
    source: 'ecu_read';
    readAt: string;
    connectionId: string;
    layout: 'mss54hp-0401-slave-master-64k';
}

export const CAPTURE_SCHEMA_VERSION = 1;
export const hexBytes = (b: Uint8Array): string =>
    Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export async function calibrationEvidence(image: Uint8Array, connectionId: string): Promise<CalibrationEvidence> {
    if (image.length !== 65536) throw new Error('Calibration must be the complete 65536-byte image');
    const copy = new Uint8Array(image);
    return {
        sha256: hexBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', copy))),
        byteLength: copy.length, imageHex: hexBytes(copy), source: 'ecu_read',
        readAt: new Date().toISOString(), connectionId, layout: 'mss54hp-0401-slave-master-64k',
    };
}
