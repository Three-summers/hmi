import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";

const mocks = vi.hoisted(() => ({
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}));

vi.mock("@/hooks", () => ({
    useIntervalWhenActive: () => {},
    useNotify: () => ({
        info: mocks.info,
        success: mocks.success,
        error: mocks.error,
    }),
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
    });

    it("刷新命令应触发数据刷新并更新 UI", async () => {
        const random = vi.spyOn(Math, "random");
        random.mockReturnValue(0.5);

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

        random.mockReturnValue(1);
        fireEvent.click(screen.getByRole("button", { name: "刷新" }));

        await waitFor(() => {
            expect(screen.getByText("50%")).toBeInTheDocument();
        });

        expect(mocks.info).toHaveBeenCalledTimes(1);
    });
});
