import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";

const mocks = vi.hoisted(() => ({
    retryTree: vi.fn(),
    retryPreview: vi.fn().mockResolvedValue(undefined),
    info: vi.fn(),
}));

vi.mock("@/hooks", () => ({
    useCanvasScale: () => 1,
    useChartData: () => ({}),
    useFileTree: () => ({
        fileTree: [],
        visibleItems: [],
        treeLoading: false,
        treeError: null,
        logBasePath: "",
        toggleDirectory: vi.fn(),
        retryTree: mocks.retryTree,
    }),
    useFilePreview: () => ({
        preview: {
            selectedFilePath: null,
            selectedFileName: null,
            loading: false,
            error: null,
            content: "",
            csvData: null,
            isCsvFile: false,
        },
        selectFile: vi.fn(),
        retryPreview: mocks.retryPreview,
    }),
    useNotify: () => ({ info: mocks.info }),
}));

import FilesView from "./index";

function Wrapper({ children }: { children: React.ReactNode }) {
    return (
        <ViewCommandProvider>
            <SubViewCommandProvider>{children}</SubViewCommandProvider>
        </ViewCommandProvider>
    );
}

describe("FilesView", () => {
    it("刷新命令应触发 retryTree 与 retryPreview", async () => {
        render(
            <div>
                <CommandPanel currentView="files" />
                <FilesView />
            </div>,
            { wrapper: Wrapper },
        );

        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: "刷新" }),
            ).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "刷新" }));

        expect(mocks.retryTree).toHaveBeenCalledTimes(1);
        expect(mocks.retryPreview).toHaveBeenCalledTimes(1);
        expect(mocks.info).toHaveBeenCalledTimes(1);
    });
});

