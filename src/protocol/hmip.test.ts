import { describe, expect, it } from "vitest";
import {
    encodeErrorPayload,
    encodeHelloPayload,
    encodeRequestPayload,
    toByteArray,
} from "./hmip";

describe("protocol/hmip", () => {
    it("toByteArray：应支持 Uint8Array 与 number[]", () => {
        expect(toByteArray([1, 2, 3])).toEqual([1, 2, 3]);
        expect(toByteArray(new Uint8Array([4, 5]))).toEqual([4, 5]);
    });

    it("encodeHelloPayload：应按 LE 编码 role/capabilities/name", () => {
        const payload = encodeHelloPayload({
            role: "client",
            capabilities: 0x11223344,
            name: "ui",
        });

        // role
        expect(payload[0]).toBe(0);
        // capabilities (LE)
        expect(Array.from(payload.slice(1, 5))).toEqual([0x44, 0x33, 0x22, 0x11]);
        // name_len + name bytes
        expect(payload[5]).toBe(2);
        expect(Array.from(payload.slice(6, 8))).toEqual([0x75, 0x69]); // "ui"
    });

    it("encodeRequestPayload：应包含 reserved(0) 并拼接 body", () => {
        const payload = encodeRequestPayload({
            requestId: 9,
            method: 0x1234,
            body: [1, 2, 3],
        });

        expect(Array.from(payload.slice(0, 4))).toEqual([9, 0, 0, 0]); // request_id
        expect(Array.from(payload.slice(4, 6))).toEqual([0x34, 0x12]); // method
        expect(Array.from(payload.slice(6, 8))).toEqual([0, 0]); // reserved
        expect(Array.from(payload.slice(8))).toEqual([1, 2, 3]); // body
    });

    it("encodeErrorPayload：应包含 msg_len(u16) 并拼接 utf8 bytes", () => {
        const payload = encodeErrorPayload({ code: 0x0102, message: "err" });
        // code (LE)
        expect(Array.from(payload.slice(0, 2))).toEqual([0x02, 0x01]);
        // reserved
        expect(Array.from(payload.slice(2, 4))).toEqual([0, 0]);
        // msg_len
        expect(Array.from(payload.slice(4, 6))).toEqual([3, 0]);
        // bytes
        expect(Array.from(payload.slice(6))).toEqual([0x65, 0x72, 0x72]);
    });
});

