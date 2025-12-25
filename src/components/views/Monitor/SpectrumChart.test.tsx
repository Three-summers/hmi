import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";

type UPlotCtorArgs = {
    opts: unknown;
    data: unknown;
    container: Element;
};

let lastCtorArgs: UPlotCtorArgs | null = null;
let lastInstance: MockUPlot | null = null;

class MockUPlot {
    public readonly setSize = vi.fn();
    public readonly setData = vi.fn();
    public readonly setSeries = vi.fn();
    public readonly destroy = vi.fn();

    constructor() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shouldThrow = (globalThis as any).__UPlotShouldThrow;
        if (shouldThrow) {
            throw new Error("init failed");
        }

        lastInstance = this;
    }
}

vi.mock("uplot", () => {
    return {
        default: function MockUPlotProxy(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this: any,
            opts: unknown,
            data: unknown,
            container: Element,
        ) {
            lastCtorArgs = { opts, data, container };
            return new (MockUPlot as unknown as new () => MockUPlot)();
        },
    };
});

import SpectrumChart from "./SpectrumChart";

describe("Monitor/SpectrumChart", () => {
    beforeEach(() => {
        lastCtorArgs = null;
        lastInstance = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__UPlotShouldThrow = false;
    });

    it("uPlot 初始化失败时应显示错误 overlay，并支持重试", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__UPlotShouldThrow = true;

        render(
            <SpectrumChart
                frequencies={[]}
                amplitudes={[]}
                maxHoldData={[]}
                averageData={[]}
                showMaxHold={false}
                showAverage={false}
                threshold={-80}
                isPaused={false}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText("错误")).toBeInTheDocument();
        });
        expect(screen.getByText("init failed")).toBeInTheDocument();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__UPlotShouldThrow = false;
        fireEvent.click(screen.getByRole("button", { name: "重试" }));

        await waitFor(() => {
            expect(screen.queryByText("init failed")).not.toBeInTheDocument();
        });
    });

    it("应渲染 marker 占位与阈值状态文案", async () => {
        render(
            <SpectrumChart
                frequencies={[0, 1000]}
                amplitudes={[-90, -20]}
                maxHoldData={[]}
                averageData={[]}
                showMaxHold={false}
                showAverage={false}
                threshold={-80}
                isPaused={false}
            />,
        );

        expect(screen.getByText("Mkr1 -- kHz -- dBm")).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText("阈值 -80 dBm")).toBeInTheDocument();
        });
    });

    it("isPaused=true 时应在状态栏显示暂停提示", async () => {
        render(
            <SpectrumChart
                frequencies={[0, 1000]}
                amplitudes={[-90, -20]}
                maxHoldData={[]}
                averageData={[]}
                showMaxHold={false}
                showAverage={false}
                threshold={-80}
                isPaused
            />,
        );

        await waitFor(() => {
            expect(
                screen.getByText("暂停 · 阈值 -80 dBm"),
            ).toBeInTheDocument();
        });
    });

    it("数据过滤：应仅保留 0-10kHz 频段并构建 uPlot alignedData", async () => {
        render(
            <SpectrumChart
                frequencies={[-1, 0, 5000, 20000]}
                amplitudes={[-10, -20, -30, -40]}
                maxHoldData={[-1, -2, -3, -4]}
                averageData={[-5, -6, -7, -8]}
                showMaxHold={false}
                showAverage={false}
                threshold={-80}
                isPaused={false}
            />,
        );

        await waitFor(() => {
            expect(lastCtorArgs).not.toBeNull();
        });
        const aligned = lastCtorArgs?.data as unknown[];
        expect(aligned[0]).toEqual([0, 5]);
        expect(aligned[1]).toEqual([-20, -30]);
        expect(aligned[2]).toEqual([-2, -3]);
        expect(aligned[3]).toEqual([-6, -7]);
        expect(aligned[4]).toEqual([-80, -80]);
    });

    it("showMaxHold/showAverage 变化时应调用 setSeries 切换可见性", async () => {
        const view = render(
            <SpectrumChart
                frequencies={[0, 1000]}
                amplitudes={[-90, -20]}
                maxHoldData={[-90, -20]}
                averageData={[-90, -20]}
                showMaxHold={false}
                showAverage={false}
                threshold={-80}
                isPaused={false}
            />,
        );

        await waitFor(() => {
            expect(lastInstance).not.toBeNull();
        });

        view.rerender(
            <SpectrumChart
                frequencies={[0, 1000]}
                amplitudes={[-90, -20]}
                maxHoldData={[-90, -20]}
                averageData={[-90, -20]}
                showMaxHold
                showAverage
                threshold={-80}
                isPaused={false}
            />,
        );

        await waitFor(() => {
            expect(lastInstance?.setSeries).toHaveBeenCalledWith(2, {
                show: true,
            });
            expect(lastInstance?.setSeries).toHaveBeenCalledWith(3, {
                show: true,
            });
        });
    });

    it("卸载时应 destroy uPlot 实例并清空容器", async () => {
        const view = render(
            <SpectrumChart
                frequencies={[0, 1000]}
                amplitudes={[-90, -20]}
                maxHoldData={[]}
                averageData={[]}
                showMaxHold={false}
                showAverage={false}
                threshold={-80}
                isPaused={false}
            />,
        );

        await waitFor(() => {
            expect(lastInstance).not.toBeNull();
            expect(lastCtorArgs?.container).toBeTruthy();
        });

        const container = lastCtorArgs?.container as HTMLElement;
        view.unmount();

        expect(lastInstance?.destroy).toHaveBeenCalledTimes(1);
        expect(container.childElementCount).toBe(0);
    });

});
