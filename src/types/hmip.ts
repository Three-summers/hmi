/**
 * HMIP（HMI Binary Protocol v1）前端类型定义
 *
 * 说明：
 * - 事件由 Rust 端 `src-tauri/src/comm/actor.rs` 解析后通过 Tauri event `hmip-event` 推送到前端
 * - 该类型用于 React/Store 侧做类型约束，避免“字符串拼接协议”
 *
 * @module types/hmip
 */

import type { CommTransport } from "./comm";

export type HmipMessageSummary =
    | {
          kind: "hello";
          role: "client" | "server";
          capabilities: number;
          name: string;
      }
    | {
          kind: "hello_ack";
          capabilities: number;
          name: string;
      }
    | {
          kind: "heartbeat";
          timestamp_ms: number;
      }
    | {
          kind: "request";
          request_id: number;
          method: number;
          body_len: number;
          body_base64: string | null;
          body_truncated: boolean;
      }
    | {
          kind: "response";
          request_id: number;
          status: number;
          body_len: number;
          body_base64: string | null;
          body_truncated: boolean;
      }
    | {
          kind: "event";
          event_id: number;
          timestamp_ms: number;
          body_len: number;
          body_base64: string | null;
          body_truncated: boolean;
      }
    | {
          kind: "error";
          code: number;
          message: string;
      }
    | {
          kind: "raw";
          msg_type: number;
          payload_len: number;
          payload_base64: string | null;
          payload_truncated: boolean;
      };

export type HmipEvent =
    | {
          type: "decode_error";
          transport: CommTransport;
          message: string;
          dropped_bytes: number;
          timestamp_ms: number;
      }
    | {
          type: "message";
          transport: CommTransport;
          channel: number;
          seq: number;
          flags: number;
          msg_type: number;
          payload_len: number;
          payload_crc32: number | null;
          timestamp_ms: number;
          summary: HmipMessageSummary;
      };

/**
 * HMIP 发送帧参数（前端 → Rust → TCP/Serial）
 *
 * 对应 Rust 端命令：
 * - `send_tcp_hmip_frame`
 * - `send_serial_hmip_frame`
 */
export interface HmipSendFrame {
    msgType: number;
    payload: number[] | Uint8Array;
    channel?: number;
    flags?: number;
    seq?: number;
    priority?: "high" | "normal";
}
