import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectrumData } from "@/types";
import { invoke } from "@/platform/invoke";
import { isTauri } from "@/platform/tauri";
import { listen } from "@tauri-apps/api/event";
import { useSpectrumData } from "./useSpectrumData";

vi.mock("@/platform/tauri", () => ({
    isTauri: vi.fn(),
}));

vi.mock("@/platform/invoke", () => ({
    invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(),
}));

describe("useSpectrumData", () => {
    type ListenHandler = (event: { payload: SpectrumData }) => void;

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
            useSpectrumData({
                enabled: true,
            }),
        );

        await waitFor(() => {
            expect(result.current.status).toBe("unavailable");
        });
        expect(vi.mocked(listen)).not.toHaveBeenCalled();
    });

    it("收到首帧后：应进入 ready，更新 latestRef，触发 onFrame 与 stats", async () => {
        const onFrame = vi.fn();
        const { result } = renderHook(() =>
            useSpectrumData({
                enabled: true,
                statsEnabled: true,
                onFrame,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                "spectrum-data",
                expect.any(Function),
            );
        });

        const frame: SpectrumData = {
            timestamp: Date.now(),
            frequencies: [0, 1000, 2000, 3000],
            amplitudes: [-90, -30, -31, -90],
        };

        act(() => {
            handler?.({ payload: frame });
        });

        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });

        expect(onFrame).toHaveBeenCalledTimes(1);
        expect(result.current.latestRef.current).toMatchObject(frame);
        expect(result.current.stats.peak_frequency).toBe(1000);
        expect(result.current.stats.peak_amplitude).toBe(-30);
        expect(result.current.stats.bandwidth).toBe(1000);
    });

    it("暂停时（emitWhenPaused=false）：应冻结 onFrame 与 stats，但 latestRef 仍更新", async () => {
        const onFrame = vi.fn();
        const { result } = renderHook(() =>
            useSpectrumData({
                enabled: true,
                isPaused: true,
                statsEnabled: true,
                onFrame,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalled();
        });

        const frame: SpectrumData = {
            timestamp: Date.now(),
            frequencies: [0, 1000],
            amplitudes: [-90, -20],
        };

        act(() => {
            handler?.({ payload: frame });
        });

        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });

        expect(onFrame).not.toHaveBeenCalled();
        expect(result.current.latestRef.current).toMatchObject(frame);
        expect(result.current.stats).toMatchObject({
            peak_frequency: 0,
            peak_amplitude: -90,
            average_amplitude: -90,
            bandwidth: 0,
        });
    });

    it("retry：应重新订阅并再次调用 listen", async () => {
        const { result } = renderHook(() =>
            useSpectrumData({
                enabled: true,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
        });

        act(() => {
            result.current.retry();
        });

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledTimes(2);
        });
    });

    it("unmount：应调用 unlisten（释放事件订阅）", async () => {
        const { unmount } = renderHook(() =>
            useSpectrumData({
                enabled: true,
            }),
        );

        await waitFor(() => {
            expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
        });

        unmount();
        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});

