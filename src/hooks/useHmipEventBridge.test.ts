import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HmipEvent } from "@/types";
import { listen } from "@/platform/events";
import { isTauri } from "@/platform/tauri";
import { useAlarmStore, useHmipStore } from "@/stores";
import { useHmipEventBridge } from "./useHmipEventBridge";

vi.mock("@/platform/tauri", () => ({
    isTauri: vi.fn(),
}));

vi.mock("@/platform/events", () => ({
    listen: vi.fn(),
}));

describe("useHmipEventBridge", () => {
    type ListenHandler = (event: { payload: HmipEvent }) => void;

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

        // 重置 HMIP 读模型
        useHmipStore.setState({
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

        // 注入可观测的 addAlarm（避免依赖 alarmIdCounter / localStorage）
        useAlarmStore.setState({
            alarms: [],
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,
            addAlarm: vi.fn(),
        } as any);
    });

    it("应订阅 hmip-event，并将事件写入 HmipStore", async () => {
        renderHook(() => useHmipEventBridge());

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                "hmip-event",
                expect.any(Function),
            );
        });

        const event: HmipEvent = {
            type: "message",
            transport: "serial",
            channel: 0,
            seq: 1,
            flags: 0,
            msg_type: 3,
            payload_len: 8,
            payload_crc32: null,
            timestamp_ms: 123,
            summary: { kind: "heartbeat", timestamp_ms: 123 },
        };

        act(() => {
            handler?.({ payload: event });
        });

        expect(useHmipStore.getState().serialMessageCount).toBe(1);
        expect(useHmipStore.getState().hmipEventLog.length).toBe(1);
    });

    it("decode_error：应映射为 warning 告警，并做短窗口去重", async () => {
        const nowSpy = vi
            .spyOn(Date, "now")
            .mockReturnValueOnce(1000)
            .mockReturnValueOnce(1001)
            .mockReturnValueOnce(11_001);

        const addAlarm = useAlarmStore.getState().addAlarm as unknown as ReturnType<
            typeof vi.fn
        >;

        renderHook(() => useHmipEventBridge());

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalled();
        });

        const errEvent: HmipEvent = {
            type: "decode_error",
            transport: "tcp",
            message: "crc mismatch",
            dropped_bytes: 0,
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
            message: "协议解码失败(tcp)：crc mismatch",
        });

        // 超过去重窗口后允许再次告警
        act(() => {
            handler?.({ payload: errEvent });
        });
        expect(addAlarm).toHaveBeenCalledTimes(2);

        nowSpy.mockRestore();
    });

    it("unmount：应释放事件订阅", async () => {
        const { unmount } = renderHook(() => useHmipEventBridge());

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
        });

        unmount();
        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});

