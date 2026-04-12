import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";

const mocks = vi.hoisted(() => ({
    shouldThrow: false,
    renderCount: 0,
}));

vi.mock("./FilesChartPreview", () => ({
    default: ({ isActive }: { isActive: boolean }) => {
        mocks.renderCount += 1;

        if (mocks.shouldThrow) {
            throw new Error("chart subtree failed");
        }

        return (
            <div data-testid="files-chart-preview" data-active={String(isActive)}>
                chart ready
            </div>
        );
    },
}));

import { LazyFilesChartPreview } from "./LazyFilesChartPreview";

const csvData = {
    headers: ["time", "value"],
    rows: [
        [0, 1],
        [1, 2],
    ],
};

describe("LazyFilesChartPreview", () => {
    beforeEach(() => {
        mocks.shouldThrow = false;
        mocks.renderCount = 0;
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("本地图表渲染失败后可通过重试按钮恢复子树", async () => {
        mocks.shouldThrow = true;

        render(
            <LazyFilesChartPreview
                isActive
                loadingText="加载中"
                chartInitErrorText="图表初始化失败"
                title="demo.csv"
                csvData={csvData}
                showMoreText="更多"
                showLessText="收起"
                resetText="重置"
                closeText="关闭"
                zoomHintText="缩放提示"
                retryText="重试"
                chartEmptyDataText="无数据"
                chartEmptySelectionText="未选择列"
            />,
        );

        expect(await screen.findByText("图表初始化失败")).toBeInTheDocument();

        const retryButton = screen.getByRole("button", { name: "重试" });

        mocks.shouldThrow = false;
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByTestId("files-chart-preview")).toBeInTheDocument();
        });
        expect(screen.getByTestId("files-chart-preview")).toHaveAttribute(
            "data-active",
            "true",
        );
        expect(mocks.renderCount).toBeGreaterThan(1);
    });
});
