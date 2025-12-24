import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CsvData } from "@/types";

let shouldThrow = false;

vi.mock("uplot", () => {
    class MockUPlot {
        static instances: MockUPlot[] = [];

        series: Array<{ label?: string }> = [{}, { label: "" }];

        constructor() {
            if (shouldThrow) {
                throw new Error("uplot crash");
            }
            MockUPlot.instances.push(this);
        }

        destroy = vi.fn();
        setSize = vi.fn();
        setData = vi.fn();
        setScale = vi.fn();
        posToVal = vi.fn();
        setSelect = vi.fn();
        select = { left: 0, width: 0 };
    }

    return { default: MockUPlot };
});

describe("hooks/useChartData", () => {
    const rafCallbacks: FrameRequestCallback[] = [];

    const flushRaf = () => {
        // 拷贝后执行，避免执行过程中 push 新回调导致死循环
        const batch = rafCallbacks.splice(0, rafCallbacks.length);
        batch.forEach((cb) => cb(0));
    };

    beforeEach(async () => {
        shouldThrow = false;
        rafCallbacks.length = 0;
        const uPlotMod = await import("uplot");
        (uPlotMod.default as any).instances.length = 0;
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal("cancelAnimationFrame", () => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const buildCsv = (): CsvData => ({
        headers: ["t", "a"],
        rows: [
            [0, 1],
            [1, 2],
        ],
    });

    it("数据与容器就绪时应创建 uPlot 实例", async () => {
        const { useChartData } = await import("./useChartData");
        const csvData = buildCsv();

        const { result } = renderHook(() =>
            useChartData({
                csvData,
                theme: "dark",
                scaleFactor: 1,
                isChartsVisible: true,
            }),
        );

        const container = document.createElement("div");
        Object.defineProperty(container, "clientWidth", {
            value: 400,
            configurable: true,
        });

        act(() => {
            result.current.setChartRef(1, container);
        });

        await act(async () => {
            flushRaf();
        });

        const uPlotMod = await import("uplot");
        expect((uPlotMod.default as any).instances.length).toBeGreaterThan(0);
        expect(result.current.chartError).toBeNull();
    });

    it("uPlot 初始化异常时应进入 chartError，并支持 retryCharts 恢复", async () => {
        const { useChartData } = await import("./useChartData");
        const csvData = buildCsv();

        shouldThrow = true;

        const { result } = renderHook(() =>
            useChartData({
                csvData,
                theme: "dark",
                scaleFactor: 1,
                isChartsVisible: true,
            }),
        );

        const container = document.createElement("div");
        Object.defineProperty(container, "clientWidth", {
            value: 400,
            configurable: true,
        });

        act(() => {
            result.current.setChartRef(1, container);
        });

        await act(async () => {
            flushRaf();
        });

        expect(result.current.chartError?.message).toBe("uplot crash");

        shouldThrow = false;
        act(() => {
            result.current.retryCharts();
        });

        await act(async () => {
            flushRaf();
        });

        expect(result.current.chartError).toBeNull();
    });

    it("放大图初始化异常时应进入 enlargedChartError，并支持 retryEnlargedChart 恢复", async () => {
        const { useChartData } = await import("./useChartData");
        const csvData = buildCsv();

        shouldThrow = true;

        const { result } = renderHook(() =>
            useChartData({
                csvData,
                theme: "dark",
                scaleFactor: 1,
                isChartsVisible: true,
            }),
        );

        const enlargedContainer = document.createElement("div");
        Object.defineProperty(enlargedContainer, "clientWidth", {
            value: 800,
            configurable: true,
        });
        Object.defineProperty(enlargedContainer, "clientHeight", {
            value: 520,
            configurable: true,
        });

        act(() => {
            result.current.enlargedChartRef.current = enlargedContainer;
            result.current.setEnlargedColumn(1);
        });

        await act(async () => {
            flushRaf();
        });

        expect(result.current.enlargedChartError?.message).toBe("uplot crash");

        shouldThrow = false;
        act(() => {
            result.current.retryEnlargedChart();
        });

        await act(async () => {
            flushRaf();
        });

        expect(result.current.enlargedChartError).toBeNull();
    });
});
