import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { ViewContextProvider } from "@/components/layout/ViewContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";

vi.mock("./AlarmList", () => ({
    AlarmList: () => <div data-testid="alarm-list" />,
}));

vi.mock("./MonitorInfo", () => ({
    MonitorInfo: () => <div data-testid="monitor-info" />,
}));

vi.mock("./SpectrumAnalyzer", () => ({
    default: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shouldThrow = (globalThis as any).__SpectrumAnalyzerShouldThrow;
        if (shouldThrow) throw new Error("boom");
        return <div data-testid="spectrum-analyzer" />;
    },
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

function InactiveWrapper({ children }: { children: React.ReactNode }) {
    return (
        <ViewContextProvider value={{ viewId: "monitor", isActive: false }}>
            <Wrapper>{children}</Wrapper>
        </ViewContextProvider>
    );
}

describe("MonitorView", () => {
    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__WaterfallChartShouldThrow = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__SpectrumAnalyzerShouldThrow = false;
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

    it("视图激活时应注册主命令（refresh/pause/export）到 CommandPanel", async () => {
        render(
            <div>
                <CommandPanel currentView="monitor" />
                <MonitorView />
            </div>,
            { wrapper: Wrapper },
        );

        await waitFor(() => {
            expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "导出数据" })).toBeInTheDocument();
    });

    it("视图未激活时不应注册主命令（CommandPanel 保持空态）", async () => {
        render(
            <div>
                <CommandPanel currentView="monitor" />
                <MonitorView />
            </div>,
            { wrapper: InactiveWrapper },
        );

        await waitFor(() => {
            // 空态仅渲染 icon，没有任何按钮
            expect(
                screen.queryByRole("button", { name: "刷新" }),
            ).not.toBeInTheDocument();
        });
    });

    it("切换到频谱分析仪 Tab：应渲染 SpectrumAnalyzer，并注册子命令", async () => {
        render(
            <div>
                <CommandPanel currentView="monitor" />
                <MonitorView />
            </div>,
            { wrapper: Wrapper },
        );

        fireEvent.click(screen.getByRole("tab", { name: "频谱分析仪" }));

        await waitFor(() => {
            expect(screen.getByTestId("spectrum-analyzer")).toBeInTheDocument();
        });

        // 子命令：暂停/最大保持/平均/重置
        expect(screen.getAllByRole("button", { name: "暂停" }).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByRole("button", { name: "最大保持" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "平均" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();
    });

    it("切换 Tab 时应清理子命令，避免 keepMounted 残留", async () => {
        render(
            <div>
                <CommandPanel currentView="monitor" />
                <MonitorView />
            </div>,
            { wrapper: Wrapper },
        );

        fireEvent.click(screen.getByRole("tab", { name: "频谱分析仪" }));
        await waitFor(() => {
            expect(screen.getByTestId("spectrum-analyzer")).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "最大保持" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("tab", { name: "概览" }));
        await waitFor(() => {
            expect(screen.getByTestId("waterfall-chart")).toBeInTheDocument();
        });
        expect(
            screen.queryByRole("button", { name: "最大保持" }),
        ).not.toBeInTheDocument();
    });

    it("Overview 子组件抛错时应进入 ErrorBoundary fallback", () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__WaterfallChartShouldThrow = true;
        render(<MonitorView />, { wrapper: Wrapper });

        expect(screen.getAllByText("子视图渲染失败")[0]).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it("SpectrumAnalyzer 子组件抛错时应进入 ErrorBoundary fallback，并可重试恢复", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__SpectrumAnalyzerShouldThrow = true;

        render(<MonitorView />, { wrapper: Wrapper });

        fireEvent.click(screen.getByRole("tab", { name: "频谱分析仪" }));
        await waitFor(() => {
            expect(screen.getAllByText("子视图渲染失败")[0]).toBeInTheDocument();
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__SpectrumAnalyzerShouldThrow = false;
        fireEvent.click(screen.getByRole("button", { name: "重试" }));

        await waitFor(() => {
            expect(screen.getByTestId("spectrum-analyzer")).toBeInTheDocument();
        });
        consoleError.mockRestore();
    });
});
