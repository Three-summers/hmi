import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectrumData } from "@/types";
import { render } from "@/test/utils";
import { useSpectrumAnalyzerStore } from "@/stores";
import { useSpectrumData } from "@/hooks";
import { captureSpectrumAnalyzer } from "@/utils/screenshot";

vi.mock("@/utils/screenshot", () => ({
    captureSpectrumAnalyzer: vi.fn(),
}));

vi.mock("./WaterfallCanvas", () => ({
    default: () => <canvas data-testid="waterfall-canvas" />,
}));

vi.mock("./SpectrumChart", () => ({
    default: (props: {
        onMarkerChange?: (pos: { freq: number; amp: number } | null) => void;
    }) => {
        // 仅在首次渲染时模拟一次 marker 更新，避免 setState 导致的渲染循环
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flagKey = "__SpectrumChartDidEmitMarker";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const didEmit = (globalThis as any)[flagKey] as boolean | undefined;
        if (!didEmit) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any)[flagKey] = true;
            queueMicrotask(() => {
                props.onMarkerChange?.({ freq: 1000, amp: -50 });
            });
        }

        return (
            <div data-testid="spectrum-chart">
                <canvas className="u-canvas" data-testid="spectrum-canvas" />
            </div>
        );
    },
}));

vi.mock("@/hooks", () => ({
    useSpectrumData: vi.fn(),
}));

import SpectrumAnalyzer from "./SpectrumAnalyzer";

function resetSpectrumAnalyzerStore() {
    const store = useSpectrumAnalyzerStore.getState();
    store.setThreshold(-80);
    store.setHistoryDepth(100);
    store.setRefreshRate(30);
    store.setColorScheme("turbo");
    store.setIsPaused(false);
    store.setShowMaxHold(false);
    store.setShowAverage(false);
    store.resetMaxHold();
    store.resetAverage();
    store.clearWaterfallBuffer();
}

describe("Monitor/SpectrumAnalyzer", () => {
    beforeEach(() => {
        resetSpectrumAnalyzerStore();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__SpectrumChartDidEmitMarker = false;
    });

    it("status=ready：应渲染状态栏与 Marker 文本，并可消费 onFrame 更新派生值", async () => {
        let onFrame: ((frame: SpectrumData) => void) | undefined;

        vi.mocked(useSpectrumData).mockImplementation((options) => {
            onFrame = options.onFrame;
            return {
                status: "ready",
                error: null,
                latestRef: { current: null },
                stats: {
                    peak_frequency: 0,
                    peak_amplitude: -90,
                    average_amplitude: -90,
                    bandwidth: 0,
                },
                clear: vi.fn(),
                retry: vi.fn(),
            };
        });

        render(<SpectrumAnalyzer isActive />);

        expect(screen.getByTestId("spectrum-chart")).toBeInTheDocument();
        expect(screen.getByTestId("waterfall-canvas")).toBeInTheDocument();

        await waitFor(() => {
            expect(
                screen.getByText("1.000 kHz -50.0 dBm"),
            ).toBeInTheDocument();
        });

        act(() => {
            onFrame?.({
                timestamp: Date.now(),
                frequencies: [0, 1000],
                amplitudes: [-90, -20],
            });
        });

        expect(screen.getByText("33 ms")).toBeInTheDocument();
        expect(screen.getByText("500 Hz")).toBeInTheDocument();
        expect(screen.getByText("1.00 kHz")).toBeInTheDocument();
        expect(screen.getAllByText("1.000 kHz").length).toBeGreaterThanOrEqual(
            1,
        );
        expect(useSpectrumAnalyzerStore.getState().maxHoldData).toEqual([
            -90,
            -20,
        ]);
        expect(useSpectrumAnalyzerStore.getState().averageData).toEqual([
            -90,
            -20,
        ]);
    });

    it("暂停按钮：点击后应切换为恢复", () => {
        vi.mocked(useSpectrumData).mockReturnValue({
            status: "ready",
            error: null,
            latestRef: { current: null },
            stats: {
                peak_frequency: 0,
                peak_amplitude: -90,
                average_amplitude: -90,
                bandwidth: 0,
            },
            clear: vi.fn(),
            retry: vi.fn(),
        });

        render(<SpectrumAnalyzer isActive />);
        fireEvent.click(screen.getByRole("button", { name: "暂停" }));
        expect(screen.getByRole("button", { name: "恢复" })).toBeInTheDocument();
    });

    it("status=loading：应显示 overlay 等待提示", () => {
        vi.mocked(useSpectrumData).mockReturnValue({
            status: "loading",
            error: null,
            latestRef: { current: null },
            stats: {
                peak_frequency: 0,
                peak_amplitude: -90,
                average_amplitude: -90,
                bandwidth: 0,
            },
            clear: vi.fn(),
            retry: vi.fn(),
        });

        render(<SpectrumAnalyzer isActive />);
        expect(screen.getByText("等待数据...")).toBeInTheDocument();
    });

    it("status=error：应显示 overlay 错误信息", () => {
        vi.mocked(useSpectrumData).mockReturnValue({
            status: "error",
            error: "boom",
            latestRef: { current: null },
            stats: {
                peak_frequency: 0,
                peak_amplitude: -90,
                average_amplitude: -90,
                bandwidth: 0,
            },
            clear: vi.fn(),
            retry: vi.fn(),
        });

        render(<SpectrumAnalyzer isActive />);
        expect(screen.getByText("数据获取失败: boom")).toBeInTheDocument();
    });

    it("status=unavailable：应提示浏览器模式不可用", () => {
        vi.mocked(useSpectrumData).mockReturnValue({
            status: "unavailable",
            error: null,
            latestRef: { current: null },
            stats: {
                peak_frequency: 0,
                peak_amplitude: -90,
                average_amplitude: -90,
                bandwidth: 0,
            },
            clear: vi.fn(),
            retry: vi.fn(),
        });

        render(<SpectrumAnalyzer isActive />);
        expect(
            screen.getByText("浏览器模式下无法获取实时数据，请在 Tauri 中运行"),
        ).toBeInTheDocument();
    });

    it("键盘快捷键 P：在视图激活时应切换暂停；在输入框内应忽略", () => {
        vi.mocked(useSpectrumData).mockReturnValue({
            status: "ready",
            error: null,
            latestRef: { current: null },
            stats: {
                peak_frequency: 0,
                peak_amplitude: -90,
                average_amplitude: -90,
                bandwidth: 0,
            },
            clear: vi.fn(),
            retry: vi.fn(),
        });

        render(
            <div>
                <input aria-label="dummy-input" />
                <SpectrumAnalyzer isActive />
            </div>,
        );

        // 触发 window keydown：应切换暂停
        fireEvent.keyDown(window, { key: "p" });
        expect(useSpectrumAnalyzerStore.getState().isPaused).toBe(true);

        // 在 input 上触发：应被忽略（不改变状态）
        const input = screen.getByRole("textbox", { name: "dummy-input" });
        fireEvent.keyDown(input, { key: "p" });
        expect(useSpectrumAnalyzerStore.getState().isPaused).toBe(true);
    });

    it("截图按钮：当两张图都存在 canvas 时应调用 captureSpectrumAnalyzer", async () => {
        vi.mocked(useSpectrumData).mockReturnValue({
            status: "ready",
            error: null,
            latestRef: { current: null },
            stats: {
                peak_frequency: 0,
                peak_amplitude: -90,
                average_amplitude: -90,
                bandwidth: 0,
            },
            clear: vi.fn(),
            retry: vi.fn(),
        });

        render(<SpectrumAnalyzer isActive />);
        fireEvent.click(screen.getByRole("button", { name: "截图" }));

        await waitFor(() => {
            expect(vi.mocked(captureSpectrumAnalyzer)).toHaveBeenCalledTimes(1);
        });
    });
});
