// Minimal ambient types for the WebUSB API (not in TypeScript's default DOM lib).
// Same approach as webSerial.d.ts: cover only what this app uses, so a typo in a
// field name is still a compile error rather than an `any`.

interface USBEndpoint {
    endpointNumber: number;
    direction: 'in' | 'out';
    type: 'bulk' | 'interrupt' | 'isochronous';
    packetSize: number;
}

interface USBAlternateInterface {
    endpoints: USBEndpoint[];
}

interface USBInterface {
    interfaceNumber: number;
    alternate: USBAlternateInterface;
}

interface USBConfiguration {
    interfaces: USBInterface[];
}

interface USBControlTransferParameters {
    requestType: 'standard' | 'class' | 'vendor';
    recipient: 'device' | 'interface' | 'endpoint' | 'other';
    request: number;
    value: number;
    index: number;
}

type USBTransferStatus = 'ok' | 'stall' | 'babble';

interface USBOutTransferResult {
    bytesWritten: number;
    status: USBTransferStatus;
}

interface USBInTransferResult {
    data?: DataView;
    status: USBTransferStatus;
}

interface USBDevice {
    vendorId: number;
    productId: number;
    /** bcdDevice major — the FTDI chip family (AM=2, BM=4, R=6). */
    deviceVersionMajor: number;
    configuration: USBConfiguration | null;
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult>;
    transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
    transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
    clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void>;
}

interface USBConnectionEvent extends Event {
    device: USBDevice;
}

interface USBDeviceFilter {
    vendorId?: number;
    productId?: number;
}

interface USB extends EventTarget {
    getDevices(): Promise<USBDevice[]>;
    requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
    addEventListener(type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void;
    removeEventListener(type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void;
}

interface Navigator {
    readonly usb?: USB;
}
