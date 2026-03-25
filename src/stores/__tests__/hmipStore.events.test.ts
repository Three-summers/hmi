import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TCP_CONNECTION_ID } from "@/types";
import type { HmipEvent } from "@/types";

describe("stores/hmipStore（hmip-event 读模型）", () => {
    beforeEach(async () => {
        const { useHmipStore } = await import("../hmipStore");
        useHmipStore.setState({
            connectionStates: {},
            serialLastEventAtMs: null,
            tcpLastEventAtMs: null,
            serialMessageCount: 0,
            tcpMessageCount: 0,
            serialDecodeErrorCount: 0,
            tcpDecodeErrorCount: 0,
            serialLastDecodeError: null,
            tcpLastDecodeError: null,
            serialLastMessage: null,
            tcpLastMessage: null,
            lastError: undefined,
            hmipEventLog: [],
        } as any);
    });

    it("decode_error：应累计计数并写入 lastError/lastDecodeError", async () => {
        const { useHmipStore } = await import("../hmipStore");

        const event: HmipEvent = {
            type: "decode_error",
            transport: "serial",
            message: "bad magic",
            dropped_bytes: 3,
            timestamp_ms: 10,
        };

        useHmipStore.getState().handleHmipEvent(event);

        const state = useHmipStore.getState();
        expect(state.serialDecodeErrorCount).toBe(1);
        expect(state.serialLastDecodeError).toBe("bad magic");
        expect(state.lastError).toBe("[serial] bad magic");
        expect(state.hmipEventLog.length).toBe(1);
        expect(state.serialLastEventAtMs).toBe(10);
    });

    it("message：应累计计数并写入 lastMessage", async () => {
        const { useHmipStore } = await import("../hmipStore");

        const event: HmipEvent = {
            type: "message",
            transport: "tcp",
            channel: 1,
            seq: 42,
            flags: 0,
            msg_type: 1,
            payload_len: 9,
            payload_crc32: null,
            timestamp_ms: 123,
            summary: {
                kind: "hello",
                role: "client",
                capabilities: 0,
                name: "ui",
            },
        };

        useHmipStore.getState().handleHmipEvent(event);

        const state = useHmipStore.getState();
        expect(state.tcpMessageCount).toBe(1);
        expect(state.tcpLastMessage?.type).toBe("message");
        expect(state.hmipEventLog.length).toBe(1);
        expect(state.tcpLastEventAtMs).toBe(123);
    });

    it("事件日志：应限制最大长度（防止无限增长）", async () => {
        const { useHmipStore } = await import("../hmipStore");

        for (let i = 0; i < 210; i += 1) {
            useHmipStore.getState().handleHmipEvent({
                type: "decode_error",
                transport: "tcp",
                message: `e${i}`,
                dropped_bytes: 0,
                timestamp_ms: i,
            });
        }

        const state = useHmipStore.getState();
        expect(state.hmipEventLog.length).toBe(200);
        expect(state.hmipEventLog[0]?.timestamp_ms).toBe(10);
        expect(state.hmipEventLog[199]?.timestamp_ms).toBe(209);
    });

    it("非默认连接 HMIP 事件：不应覆盖默认 TCP 读模型", async () => {
        const { useHmipStore } = await import("../hmipStore");

        useHmipStore.setState({
            connectionStates: {
                [DEFAULT_TCP_CONNECTION_ID]: {
                    connectionId: DEFAULT_TCP_CONNECTION_ID,
                    transport: "tcp",
                    lastEventAtMs: 1,
                    messageCount: 1,
                    decodeErrorCount: 0,
                    lastDecodeError: null,
                    lastMessage: {
                        type: "message",
                        transport: "tcp",
                        connection_id: DEFAULT_TCP_CONNECTION_ID,
                        channel: 0,
                        seq: 1,
                        flags: 0,
                        msg_type: 3,
                        payload_len: 8,
                        payload_crc32: null,
                        timestamp_ms: 1,
                        summary: { kind: "heartbeat", timestamp_ms: 1 },
                    },
                    lastError: undefined,
                },
            },
            tcpLastEventAtMs: 1,
            tcpMessageCount: 1,
            tcpDecodeErrorCount: 0,
            tcpLastDecodeError: null,
            tcpLastMessage: {
                type: "message",
                transport: "tcp",
                connection_id: DEFAULT_TCP_CONNECTION_ID,
                channel: 0,
                seq: 1,
                flags: 0,
                msg_type: 3,
                payload_len: 8,
                payload_crc32: null,
                timestamp_ms: 1,
                summary: { kind: "heartbeat", timestamp_ms: 1 },
            },
            lastError: "keep",
            hmipEventLog: [],
        } as any);

        useHmipStore.getState().handleHmipEvent({
            type: "message",
            transport: "tcp",
            connection_id: "main-tcp",
            channel: 1,
            seq: 42,
            flags: 0,
            msg_type: 1,
            payload_len: 9,
            payload_crc32: null,
            timestamp_ms: 123,
            summary: {
                kind: "hello",
                role: "client",
                capabilities: 0,
                name: "ui",
            },
        });
        useHmipStore.getState().handleHmipEvent({
            type: "decode_error",
            transport: "tcp",
            connection_id: "main-tcp",
            message: "crc mismatch",
            dropped_bytes: 0,
            timestamp_ms: 124,
        });

        const state = useHmipStore.getState();
        expect(state.tcpMessageCount).toBe(1);
        expect(state.tcpLastMessage?.connection_id).toBe(
            DEFAULT_TCP_CONNECTION_ID,
        );
        expect(state.lastError).toBe("keep");
        expect(state.connectionStates["main-tcp"]?.messageCount).toBe(1);
        expect(state.connectionStates["main-tcp"]?.decodeErrorCount).toBe(1);
        expect(state.connectionStates["main-tcp"]?.lastError).toBe(
            "[tcp] crc mismatch",
        );
    });
});
