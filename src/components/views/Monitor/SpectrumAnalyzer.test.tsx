import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectrumData } from "@/types";
import { render } from "@/test/utils";
import { useSpectrumAnalyzerStore } from "@/stores";
import { useSpectrumData } from "@/hooks";

vi.mock("@/utils/screenshot", () => ({
    captureSpectrumAnalyzer: vi.fn(),
}));

vi.mock("./WaterfallCanvas", () => ({
    default: () => <div data-testid="waterfall-canvas" />,
}));

vi.mock("./SpectrumChart", async () => {
    const React = await import("react");
    return {
        default: (props: {
            onMarkerChange?: (pos: { freq: number; amp: number } | null) => void;
        }) => {
            React.useEffect(() => {
                props.onMarkerChange?.({ freq: 1000, amp: -50 });
            }, [props]);
            return <div data-testid="spectrum-chart" />;
        },
    };
});

vi.mock("@/hooks", async () => {
    const actual = await vi.importActual<typeof import("@/hooks")>("@/hooks");
    return {
        ...actual,
        useSpectrumData: vi.fn(),
    };
});

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
        expect(screen.getByText("1.000 kHz")).toBeInTheDocument();
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
});

