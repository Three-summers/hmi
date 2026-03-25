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
    connectionStates: Record<string, CommConnectionState>;
}

export type CommTransport = "serial" | "tcp";

export type CommTransportStatus = "disconnected" | "connected" | "reconnecting";

export const DEFAULT_SERIAL_CONNECTION_ID = "__default_serial__";
export const DEFAULT_TCP_CONNECTION_ID = "__default_tcp__";

export interface CommConnectionState {
    connectionId: string;
    transport: CommTransport;
    connected: boolean;
    status: CommTransportStatus;
    rxBytes: number;
    txBytes: number;
    rxCount: number;
    txCount: number;
    lastRxText: string | null;
    lastEventAtMs: number | null;
    lastError?: string;
}

export type CommEvent =
    | {
          type: "connected";
          transport: CommTransport;
          connection_id?: string;
          timestamp_ms: number;
      }
    | {
          type: "disconnected";
          transport: CommTransport;
          connection_id?: string;
          timestamp_ms: number;
      }
    | {
          type: "reconnecting";
          transport: CommTransport;
          connection_id?: string;
          attempt: number;
          delay_ms: number;
          timestamp_ms: number;
      }
    | {
          type: "rx";
          transport: CommTransport;
          connection_id?: string;
          data_base64: string;
          text?: string | null;
          size: number;
          timestamp_ms: number;
      }
    | {
          type: "tx";
          transport: CommTransport;
          connection_id?: string;
          size: number;
          timestamp_ms: number;
      }
    | {
          type: "error";
          transport: CommTransport;
          connection_id?: string;
          message: string;
          timestamp_ms: number;
      };
