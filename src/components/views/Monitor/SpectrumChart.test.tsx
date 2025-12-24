import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";

class MockUPlot {
    constructor() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shouldThrow = (globalThis as any).__UPlotShouldThrow;
        if (shouldThrow) {
            throw new Error("init failed");
        }
    }

    setSize() {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData(_data: unknown) {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setSeries(_idx: number, _opts: unknown) {}

    destroy() {}
}

vi.mock("uplot", () => ({
    default: MockUPlot,
}));

import SpectrumChart from "./SpectrumChart";

describe("Monitor/SpectrumChart", () => {
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
});

