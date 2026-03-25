import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TCP_CONNECTION_ID } from "@/types";
import type { CommEvent } from "@/types";

describe("stores/commStore（comm-event 读模型）", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("connected：应更新 transport 状态与连接标记", async () => {
        vi.doMock("@/platform/invoke", () => ({ invoke: vi.fn() }));
        const { useCommStore } = await import("../commStore");

        useCommStore.setState({
            serialConnected: false,
            serialStatus: "disconnected",
            lastError: "x",
            connectionStates: {},
            commEventLog: [],
        } as any);

        const event: CommEvent = {
            type: "connected",
            transport: "serial",
            timestamp_ms: 100,
        };

        useCommStore.getState().handleCommEvent(event);

        const state = useCommStore.getState();
        expect(state.serialStatus).toBe("connected");
        expect(state.serialConnected).toBe(true);
        expect(state.lastError).toBeUndefined();
        expect(state.serialLastEventAtMs).toBe(100);
        expect(state.commEventLog.length).toBe(1);
    });

    it("rx：应累计字节/计数，并记录文本预览", async () => {
        vi.doMock("@/platform/invoke", () => ({ invoke: vi.fn() }));
        const { useCommStore } = await import("../commStore");

        useCommStore.setState({
            tcpRxBytes: 0,
            tcpRxCount: 0,
            tcpLastRxText: null,
            connectionStates: {},
            commEventLog: [],
        } as any);

        const event: CommEvent = {
            type: "rx",
            transport: "tcp",
            data_base64: "AQID",
            text: "hello",
            size: 3,
            timestamp_ms: 9,
        };

        useCommStore.getState().handleCommEvent(event);

        const state = useCommStore.getState();
        expect(state.tcpRxBytes).toBe(3);
        expect(state.tcpRxCount).toBe(1);
        expect(state.tcpLastRxText).toBe("hello");
        expect(state.tcpLastEventAtMs).toBe(9);
    });

    it("error：应写入 lastError，并追加到事件日志", async () => {
        vi.doMock("@/platform/invoke", () => ({ invoke: vi.fn() }));
        const { useCommStore } = await import("../commStore");

        useCommStore.setState({
            lastError: undefined,
            connectionStates: {},
            commEventLog: [],
        } as any);

        const event: CommEvent = {
            type: "error",
            transport: "serial",
            message: "boom",
            timestamp_ms: 1,
        };
        useCommStore.getState().handleCommEvent(event);

        expect(useCommStore.getState().lastError).toBe("[serial] boom");
        expect(useCommStore.getState().commEventLog.length).toBe(1);
    });

    it("事件日志：应限制最大长度（防止无限增长）", async () => {
        vi.doMock("@/platform/invoke", () => ({ invoke: vi.fn() }));
        const { useCommStore } = await import("../commStore");

        useCommStore.setState({ connectionStates: {}, commEventLog: [] } as any);

        for (let i = 0; i < 210; i += 1) {
            useCommStore.getState().handleCommEvent({
                type: "tx",
                transport: "tcp",
                size: 1,
                timestamp_ms: i,
            });
        }

        expect(useCommStore.getState().commEventLog.length).toBe(200);
        expect(useCommStore.getState().commEventLog[0]?.timestamp_ms).toBe(10);
        expect(useCommStore.getState().commEventLog[199]?.timestamp_ms).toBe(209);
    });

    it("非默认连接事件：不应覆盖默认 TCP 连接状态", async () => {
        vi.doMock("@/platform/invoke", () => ({ invoke: vi.fn() }));
        const { useCommStore } = await import("../commStore");

        useCommStore.setState({
            tcpConnected: true,
            tcpStatus: "connected",
            lastError: "keep",
            connectionStates: {
                [DEFAULT_TCP_CONNECTION_ID]: {
                    connectionId: DEFAULT_TCP_CONNECTION_ID,
                    transport: "tcp",
                    connected: true,
                    status: "connected",
                    rxBytes: 0,
                    txBytes: 0,
                    rxCount: 0,
                    txCount: 0,
                    lastRxText: null,
                    lastEventAtMs: 1,
                    lastError: undefined,
                },
            },
            commEventLog: [],
        } as any);

        useCommStore.getState().handleCommEvent({
            type: "disconnected",
            transport: "tcp",
            connection_id: "main-tcp",
            timestamp_ms: 20,
        });
        useCommStore.getState().handleCommEvent({
            type: "error",
            transport: "tcp",
            connection_id: "main-tcp",
            message: "boom",
            timestamp_ms: 21,
        });

        const state = useCommStore.getState();
        expect(state.tcpConnected).toBe(true);
        expect(state.tcpStatus).toBe("connected");
        expect(state.lastError).toBe("keep");
        expect(state.connectionStates["main-tcp"]?.status).toBe("disconnected");
        expect(state.connectionStates["main-tcp"]?.lastError).toBe("[tcp] boom");
        expect(state.connectionStates[DEFAULT_TCP_CONNECTION_ID]?.status).toBe(
            "connected",
        );
    });
});
