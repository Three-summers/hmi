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

export type CommTransport = "serial" | "tcp";

export type CommTransportStatus = "disconnected" | "connected" | "reconnecting";

export type CommEvent =
    | {
          type: "connected";
          transport: CommTransport;
          timestamp_ms: number;
      }
    | {
          type: "disconnected";
          transport: CommTransport;
          timestamp_ms: number;
      }
    | {
          type: "reconnecting";
          transport: CommTransport;
          attempt: number;
          delay_ms: number;
          timestamp_ms: number;
      }
    | {
          type: "rx";
          transport: CommTransport;
          data_base64: string;
          text?: string | null;
          size: number;
          timestamp_ms: number;
      }
    | {
          type: "tx";
          transport: CommTransport;
          size: number;
          timestamp_ms: number;
      }
    | {
          type: "error";
          transport: CommTransport;
          message: string;
          timestamp_ms: number;
      };
