/** Communication Type Definitions */

export interface SerialConfig {
    port: string;
    baudRate: number;
    dataBits: 5 | 6 | 7 | 8;
    stopBits: 1 | 2;
    parity: "none" | "odd" | "even";
}

export interface TcpConfig {
    host: string;
    port: number;
    timeoutMs: number;
}

export interface CommState {
    serialConnected: boolean;
    tcpConnected: boolean;
    serialConfig?: SerialConfig;
    tcpConfig?: TcpConfig;
    lastError?: string;
}
