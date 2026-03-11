import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";

const mocks = vi.hoisted(() => ({
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    isTauri: vi.fn(),
    getSystemOverview: vi.fn(),
}));

vi.mock("@/hooks", () => ({
    useIntervalWhenActive: () => {},
    useNotify: () => ({
        info: mocks.info,
        success: mocks.success,
        error: mocks.error,
    }),
}));

vi.mock("@/platform/tauri", () => ({
    isTauri: mocks.isTauri,
}));

vi.mock("@/platform/system", () => ({
    getSystemOverview: mocks.getSystemOverview,
}));

import SystemView from "./index";

function Wrapper({ children }: { children: React.ReactNode }) {
    return (
        <ViewCommandProvider>
            <SubViewCommandProvider>{children}</SubViewCommandProvider>
        </ViewCommandProvider>
    );
}

describe("SystemView", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mocks.isTauri.mockReset();
        mocks.getSystemOverview.mockReset();
    });

    it("刷新命令应触发数据刷新并更新 UI", async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.getSystemOverview
            .mockResolvedValueOnce({
                uptime: 86400,
                cpuUsage: 45,
                memoryUsage: 62,
                diskUsage: 35,
                temperature: 48,
            })
            .mockResolvedValueOnce({
                uptime: 86460,
                cpuUsage: 50,
                memoryUsage: 63,
                diskUsage: 36,
                temperature: 49,
            });

        render(
            <div>
                <CommandPanel currentView="system" />
                <SystemView />
            </div>,
            { wrapper: Wrapper },
        );

        await waitFor(() => {
            expect(screen.getByText("45%")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "刷新" }));

        await waitFor(() => {
            expect(screen.getByText("50%")).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(mocks.info).toHaveBeenCalledTimes(1);
        });
    });

    it("浏览器模式下不应伪造系统数据，应显示不可用提示", async () => {
        mocks.isTauri.mockReturnValue(false);

        render(
            <div>
                <CommandPanel currentView="system" />
                <SystemView />
            </div>,
            { wrapper: Wrapper },
        );

        await waitFor(() => {
            expect(
                within(screen.getByRole("tabpanel")).getByText(
                    "浏览器环境不可用（请在 Tauri 中运行）",
                    { selector: "span" },
                ),
            ).toBeInTheDocument();
        });

        expect(mocks.getSystemOverview).not.toHaveBeenCalled();
    });
});
