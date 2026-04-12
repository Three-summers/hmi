import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { ViewContextProvider } from "@/components/layout/ViewContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";
import type { PreviewConfig } from "@/types";

const mocks = vi.hoisted(() => ({
    createPreview: (): PreviewConfig => ({
        selectedFilePath: null,
        selectedFileName: null,
        loading: false,
        error: null,
        content: "",
        csvData: null,
        isCsvFile: false,
    }),
    preview: null as PreviewConfig | null,
    retryTree: vi.fn(),
    retryPreview: vi.fn().mockResolvedValue(undefined),
    info: vi.fn(),
    selectFile: vi.fn(),
    toggleDirectory: vi.fn(),
    retryCharts: vi.fn(),
    retryEnlargedChart: vi.fn(),
    toggleColumn: vi.fn(),
    showMoreCharts: vi.fn(),
    showLessCharts: vi.fn(),
    setChartRef: vi.fn(),
    setEnlargedColumn: vi.fn(),
    closeEnlargedChart: vi.fn(),
    resetEnlargedZoom: vi.fn(),
}));

vi.mock("@/hooks/useCanvasScale", () => ({
    useCanvasScale: () => 1,
}));

vi.mock("@/hooks/useChartData", () => ({
    getSeriesColor: (_colIndex: number, chartColors: string[]) =>
        chartColors[0] ?? "#00a86b",
    useChartData: () => ({
        visibleCharts: 1,
        enabledColumns: new Set([1]),
        sortedEnabledColumns: [1],
        hasMoreCharts: false,
        chartColors: ["#00a86b"],
        chartError: null,
        retryCharts: mocks.retryCharts,
        enlargedColumn: null,
        enlargedChartRef: { current: null },
        enlargedChartError: null,
        retryEnlargedChart: mocks.retryEnlargedChart,
        toggleColumn: mocks.toggleColumn,
        showMoreCharts: mocks.showMoreCharts,
        showLessCharts: mocks.showLessCharts,
        setChartRef: mocks.setChartRef,
        setEnlargedColumn: mocks.setEnlargedColumn,
        closeEnlargedChart: mocks.closeEnlargedChart,
        resetEnlargedZoom: mocks.resetEnlargedZoom,
    }),
}));

vi.mock("@/hooks/useFileTree", () => ({
    useFileTree: () => ({
        fileTree: [],
        visibleItems: [],
        treeLoading: false,
        treeError: null,
        logBasePath: "",
        toggleDirectory: mocks.toggleDirectory,
        retryTree: mocks.retryTree,
    }),
}));

vi.mock("@/hooks/useFilePreview", () => ({
    useFilePreview: () => ({
        preview: mocks.preview ?? mocks.createPreview(),
        selectFile: mocks.selectFile,
        retryPreview: mocks.retryPreview,
    }),
}));

vi.mock("@/hooks/useNotify", () => ({
    useNotify: () => ({ info: mocks.info }),
}));

vi.mock("./LazyFilesChartPreview", () => ({
    LazyFilesChartPreview: () => <div data-testid="lazy-chart-preview" />,
}));

import FilesView from "./index";

function Wrapper({
    children,
    isActive = true,
}: {
    children: ReactNode;
    isActive?: boolean;
}) {
    return (
        <ViewContextProvider value={{ viewId: "files", isActive }}>
            <ViewCommandProvider>
                <SubViewCommandProvider>{children}</SubViewCommandProvider>
            </ViewCommandProvider>
        </ViewContextProvider>
    );
}

function renderFilesView(isActive = true) {
    return render(
        <div>
            <CommandPanel currentView="files" />
            <FilesView />
        </div>,
        {
            wrapper: ({ children }) => (
                <Wrapper isActive={isActive}>{children}</Wrapper>
            ),
        },
    );
}

describe("FilesView", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preview = mocks.createPreview();
        mocks.retryPreview.mockResolvedValue(undefined);
    });

    it("刷新命令应触发 retryTree 与 retryPreview", async () => {
        renderFilesView();

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

    it("CSV 预览在激活视图的总览标签中渲染懒加载图表子树", () => {
        mocks.preview = {
            selectedFilePath: "/logs/demo.csv",
            selectedFileName: "demo.csv",
            loading: false,
            error: null,
            content: "time,value\n0,1\n1,2",
            csvData: {
                headers: ["time", "value"],
                rows: [
                    [0, 1],
                    [1, 2],
                ],
            },
            isCsvFile: true,
        };

        renderFilesView(true);

        expect(screen.getByTestId("lazy-chart-preview")).toBeInTheDocument();
    });

    it("CSV 预览在非激活视图中跳过图表子树并保留原始文本", () => {
        mocks.preview = {
            selectedFilePath: "/logs/demo.csv",
            selectedFileName: "demo.csv",
            loading: false,
            error: null,
            content: "time,value\n0,1\n1,2",
            csvData: {
                headers: ["time", "value"],
                rows: [
                    [0, 1],
                    [1, 2],
                ],
            },
            isCsvFile: true,
        };

        renderFilesView(false);

        expect(screen.queryByTestId("lazy-chart-preview")).not.toBeInTheDocument();
        expect(
            screen.getByText(
                (_, element) =>
                    element?.tagName === "PRE" &&
                    element.textContent === "time,value\n0,1\n1,2",
            ),
        ).toBeInTheDocument();
    });
});
