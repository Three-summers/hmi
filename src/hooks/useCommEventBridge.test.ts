import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommEvent } from "@/types";
import { listen } from "@/platform/events";
import { isTauri } from "@/platform/tauri";
import { useAlarmStore, useCommStore } from "@/stores";
import { useCommEventBridge } from "./useCommEventBridge";

vi.mock("@/platform/tauri", () => ({
    isTauri: vi.fn(),
}));

vi.mock("@/platform/events", () => ({
    listen: vi.fn(),
}));

describe("useCommEventBridge", () => {
    type ListenHandler = (event: { payload: CommEvent }) => void;

    let handler: ListenHandler | null = null;
    const unlisten = vi.fn();

    beforeEach(() => {
        handler = null;
        unlisten.mockClear();

        vi.useRealTimers();
        localStorage.clear();

        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(listen).mockImplementation(async (_eventName, cb) => {
            handler = cb as ListenHandler;
            return unlisten;
        });

        // 重置 Comm 读模型
        useCommStore.setState({
            serialConnected: false,
            tcpConnected: false,
            serialStatus: "disconnected",
            tcpStatus: "disconnected",
            serialRxBytes: 0,
            serialTxBytes: 0,
            tcpRxBytes: 0,
            tcpTxBytes: 0,
            serialRxCount: 0,
            serialTxCount: 0,
            tcpRxCount: 0,
            tcpTxCount: 0,
            serialLastRxText: null,
            tcpLastRxText: null,
            serialLastEventAtMs: null,
            tcpLastEventAtMs: null,
            commEventLog: [],
            lastError: undefined,
        } as any);

        // 注入可观测的 addAlarm（避免依赖 alarmIdCounter / localStorage）
        useAlarmStore.setState({
            alarms: [],
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,
            addAlarm: vi.fn(),
        } as any);
    });

    it("应订阅 comm-event，并将事件写入 CommStore", async () => {
        renderHook(() => useCommEventBridge());

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                "comm-event",
                expect.any(Function),
            );
        });

        const event: CommEvent = {
            type: "connected",
            transport: "serial",
            timestamp_ms: 123,
        };

        act(() => {
            handler?.({ payload: event });
        });

        expect(useCommStore.getState().serialStatus).toBe("connected");
        expect(useCommStore.getState().serialConnected).toBe(true);
        expect(useCommStore.getState().commEventLog.length).toBe(1);
    });

    it("错误事件：应映射为 warning 告警，并做短窗口去重", async () => {
        const nowSpy = vi
            .spyOn(Date, "now")
            .mockReturnValueOnce(1000)
            .mockReturnValueOnce(1001)
            .mockReturnValueOnce(11_001);

        const addAlarm = useAlarmStore.getState().addAlarm as unknown as ReturnType<
            typeof vi.fn
        >;

        renderHook(() => useCommEventBridge());

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalled();
        });

        const errEvent: CommEvent = {
            type: "error",
            transport: "tcp",
            message: "boom",
            timestamp_ms: 1,
        };

        act(() => {
            handler?.({ payload: errEvent });
        });
        act(() => {
            handler?.({ payload: errEvent });
        });

        expect(addAlarm).toHaveBeenCalledTimes(1);
        expect(addAlarm).toHaveBeenCalledWith({
            severity: "warning",
            message: "通信异常(tcp)：boom",
        });

        // 超过去重窗口后允许再次告警（Date.now 已被控制为 11001ms）
        act(() => {
            handler?.({ payload: errEvent });
        });
        expect(addAlarm).toHaveBeenCalledTimes(2);

        nowSpy.mockRestore();
    });

    it("unmount：应释放事件订阅", async () => {
        const { unmount } = renderHook(() => useCommEventBridge());

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
        });

        unmount();
        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});
