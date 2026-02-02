import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@/platform/invoke";
import { listen } from "@/platform/events";
import { isTauri } from "@/platform/tauri";
import { useTauriEventStream } from "./useTauriEventStream";

vi.mock("@/platform/tauri", () => ({
    isTauri: vi.fn(),
}));

vi.mock("@/platform/invoke", () => ({
    invoke: vi.fn(),
}));

vi.mock("@/platform/events", () => ({
    listen: vi.fn(),
}));

describe("useTauriEventStream", () => {
    type Payload = { value: number };
    type ListenHandler = (event: { payload: Payload }) => void;

    let handler: ListenHandler | null = null;
    const unlisten = vi.fn();

    beforeEach(() => {
        handler = null;
        unlisten.mockClear();

        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(invoke).mockResolvedValue(undefined);
        vi.mocked(listen).mockImplementation(async (_eventName, cb) => {
            handler = cb as ListenHandler;
            return unlisten;
        });
    });

    it("非 Tauri 环境：enabled=true 时应进入 unavailable", async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const { result } = renderHook(() =>
            useTauriEventStream<Payload>({
                enabled: true,
                eventName: "x",
            }),
        );

        await waitFor(() => {
            expect(result.current.status).toBe("unavailable");
        });
        expect(vi.mocked(listen)).not.toHaveBeenCalled();
        expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    });

    it("收到首事件：应进入 ready，更新 latestRef，触发 onEvent", async () => {
        const onEvent = vi.fn();
        const { result } = renderHook(() =>
            useTauriEventStream<Payload>({
                enabled: true,
                eventName: "demo",
                onEvent,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                "demo",
                expect.any(Function),
            );
        });

        const payload: Payload = { value: 42 };
        act(() => {
            handler?.({ payload });
        });

        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });

        expect(result.current.latestRef.current).toMatchObject(payload);
        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith(payload, {
            paused: false,
            receivedAtMs: expect.any(Number),
        });
    });

    it("暂停时（emitWhenPaused=false）：latestRef 仍更新，但 onEvent 不触发", async () => {
        const onEvent = vi.fn();
        const { result } = renderHook(() =>
            useTauriEventStream<Payload>({
                enabled: true,
                eventName: "demo",
                isPaused: true,
                emitWhenPaused: false,
                onEvent,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalled();
        });

        const payload: Payload = { value: 1 };
        act(() => {
            handler?.({ payload });
        });

        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });

        expect(result.current.latestRef.current).toMatchObject(payload);
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("maxHz 节流：应丢弃过密事件（不影响 latestRef）", async () => {
        const onEvent = vi.fn();
        const nowSpy = vi
            .spyOn(performance, "now")
            .mockReturnValueOnce(1000)
            .mockReturnValueOnce(1500);

        const { result } = renderHook(() =>
            useTauriEventStream<Payload>({
                enabled: true,
                eventName: "demo",
                maxHz: 1,
                onEvent,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalled();
        });

        act(() => {
            handler?.({ payload: { value: 1 } });
        });
        act(() => {
            handler?.({ payload: { value: 2 } });
        });

        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });

        expect(result.current.latestRef.current).toMatchObject({ value: 2 });
        expect(onEvent).toHaveBeenCalledTimes(1);

        nowSpy.mockRestore();
    });

    it("startCommand 失败：应进入 error 并释放 unlisten", async () => {
        vi.mocked(invoke).mockRejectedValue(new Error("start failed"));

        const { result } = renderHook(() =>
            useTauriEventStream<Payload>({
                enabled: true,
                eventName: "demo",
                startCommand: "start_demo",
            }),
        );

        await waitFor(() => {
            expect(result.current.status).toBe("error");
        });

        expect(unlisten).toHaveBeenCalledTimes(1);
        expect(result.current.latestRef.current).toBeNull();
    });

    it("unmount：应调用 unlisten（释放事件订阅）", async () => {
        const { unmount } = renderHook(() =>
            useTauriEventStream<Payload>({
                enabled: true,
                eventName: "demo",
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
        });

        unmount();
        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});

