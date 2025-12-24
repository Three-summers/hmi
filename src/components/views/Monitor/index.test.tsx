import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { render } from "@/test/utils";

vi.mock("./AlarmList", () => ({
    AlarmList: () => <div data-testid="alarm-list" />,
}));

vi.mock("./MonitorInfo", () => ({
    MonitorInfo: () => <div data-testid="monitor-info" />,
}));

vi.mock("./SpectrumAnalyzer", () => ({
    default: () => <div data-testid="spectrum-analyzer" />,
}));

vi.mock("./WaterfallChart", () => ({
    WaterfallChart: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shouldThrow = (globalThis as any).__WaterfallChartShouldThrow;
        if (shouldThrow) throw new Error("boom");
        return <div data-testid="waterfall-chart" />;
    },
}));

import MonitorView from "./index";

function Wrapper({ children }: { children: React.ReactNode }) {
    return (
        <ViewCommandProvider>
            <SubViewCommandProvider>{children}</SubViewCommandProvider>
        </ViewCommandProvider>
    );
}

describe("MonitorView", () => {
    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__WaterfallChartShouldThrow = false;
    });

    it("默认渲染概览 Tab，并包含瀑布图与告警列表", () => {
        render(<MonitorView />, { wrapper: Wrapper });

        expect(
            screen.getByRole("tab", { name: "概览" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("tab", { name: "说明" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("tab", { name: "频谱分析仪" }),
        ).toBeInTheDocument();

        expect(screen.getByTestId("waterfall-chart")).toBeInTheDocument();
        expect(screen.getByTestId("alarm-list")).toBeInTheDocument();
    });

    it("Overview 子组件抛错时应进入 ErrorBoundary fallback", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__WaterfallChartShouldThrow = true;
        render(<MonitorView />, { wrapper: Wrapper });

        expect(screen.getAllByText("子视图渲染失败")[0]).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    });
});
