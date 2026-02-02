/**
 * HMIP（HMI Binary Protocol v1）前端编码工具
 *
 * 说明：
 * - Rust 端负责帧封装（magic/version/len/crc32 等），前端主要负责 payload 编码与命令调用参数构造
 * - 该模块提供“payload 编码”与“字节数组转换”能力，确保与 Rust 端 `src-tauri/src/comm/proto.rs` 一致
 *
 * @module protocol/hmip
 */

export const HMIP_VERSION = 1 as const;
export const HMIP_FLAG_CRC32 = 0x01 as const;

export const HMIP_MSG_TYPE = {
    HELLO: 0x01,
    HELLO_ACK: 0x02,
    HEARTBEAT: 0x03,
    REQUEST: 0x10,
    RESPONSE: 0x11,
    EVENT: 0x20,
    ERROR: 0x7f,
} as const;

export type HmipRole = "client" | "server";

function clampU8(value: number): number {
    const v = Number.isFinite(value) ? Math.floor(value) : 0;
    return Math.max(0, Math.min(255, v));
}

function clampU16(value: number): number {
    const v = Number.isFinite(value) ? Math.floor(value) : 0;
    return Math.max(0, Math.min(0xffff, v));
}

function clampU32(value: number): number {
    const v = Number.isFinite(value) ? Math.floor(value) : 0;
    // >>> 0 将其规范为 uint32
    return (v >>> 0) as unknown as number;
}

function pushU16LE(out: number[], value: number) {
    const v = clampU16(value);
    out.push(v & 0xff, (v >> 8) & 0xff);
}

function pushU32LE(out: number[], value: number) {
    const v = clampU32(value);
    out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}

function pushU64LE(out: number[], value: number) {
    const v = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    let x = BigInt(v);
    for (let i = 0; i < 8; i += 1) {
        out.push(Number(x & 0xffn));
        x >>= 8n;
    }
}

function encodeUtf8(text: string): Uint8Array {
    // TextEncoder 在浏览器与 Vitest(jsdom) 下均可用；若未来运行环境缺失，可在此处做降级。
    return new TextEncoder().encode(text);
}

export function toByteArray(input: number[] | Uint8Array): number[] {
    return input instanceof Uint8Array ? Array.from(input) : input;
}

export function encodeHelloPayload(params: {
    role: HmipRole;
    capabilities: number;
    name: string;
}): Uint8Array {
    const out: number[] = [];
    out.push(params.role === "server" ? 1 : 0);
    pushU32LE(out, params.capabilities);

    const nameBytes = encodeUtf8(params.name ?? "");
    const nameLen = Math.min(255, nameBytes.length);
    out.push(clampU8(nameLen));
    for (let i = 0; i < nameLen; i += 1) out.push(nameBytes[i] ?? 0);

    return new Uint8Array(out);
}

export function encodeHelloAckPayload(params: {
    capabilities: number;
    name: string;
}): Uint8Array {
    const out: number[] = [];
    pushU32LE(out, params.capabilities);

    const nameBytes = encodeUtf8(params.name ?? "");
    const nameLen = Math.min(255, nameBytes.length);
    out.push(clampU8(nameLen));
    for (let i = 0; i < nameLen; i += 1) out.push(nameBytes[i] ?? 0);

    return new Uint8Array(out);
}

export function encodeHeartbeatPayload(params: { timestampMs: number }): Uint8Array {
    const out: number[] = [];
    pushU64LE(out, params.timestampMs);
    return new Uint8Array(out);
}

export function encodeRequestPayload(params: {
    requestId: number;
    method: number;
    body: number[] | Uint8Array;
}): Uint8Array {
    const out: number[] = [];
    pushU32LE(out, params.requestId);
    pushU16LE(out, params.method);
    pushU16LE(out, 0); // reserved
    out.push(...toByteArray(params.body));
    return new Uint8Array(out);
}

export function encodeResponsePayload(params: {
    requestId: number;
    status: number;
    body: number[] | Uint8Array;
}): Uint8Array {
    const out: number[] = [];
    pushU32LE(out, params.requestId);
    pushU16LE(out, params.status);
    pushU16LE(out, 0); // reserved
    out.push(...toByteArray(params.body));
    return new Uint8Array(out);
}

export function encodeEventPayload(params: {
    eventId: number;
    timestampMs: number;
    body: number[] | Uint8Array;
}): Uint8Array {
    const out: number[] = [];
    pushU16LE(out, params.eventId);
    pushU16LE(out, 0); // reserved
    pushU64LE(out, params.timestampMs);
    out.push(...toByteArray(params.body));
    return new Uint8Array(out);
}

export function encodeErrorPayload(params: { code: number; message: string }): Uint8Array {
    const out: number[] = [];
    pushU16LE(out, params.code);
    pushU16LE(out, 0); // reserved

    const messageBytes = encodeUtf8(params.message ?? "");
    const msgLen = Math.min(0xffff, messageBytes.length);
    pushU16LE(out, msgLen);
    for (let i = 0; i < msgLen; i += 1) out.push(messageBytes[i] ?? 0);

    return new Uint8Array(out);
}

