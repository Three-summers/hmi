import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileTreePanel } from "../src/components/views/Files/FileTreePanel.tsx";
import { FilePreviewPanel } from "../src/components/views/Files/FilePreviewPanel.tsx";
import { ChartPanel } from "../src/components/views/Files/ChartPanel.tsx";
import { parseCsv } from "../src/hooks/useFilePreview.ts";
import {
    createXAxisValuesFormatter,
    getSeriesColor,
    getSeriesFill,
    getXRange,
} from "../src/hooks/useChartData.ts";

describe("T02 Files 视图拆分（Node SSR）", () => {
    it("FileTreePanel：loading / empty / error 状态可渲染", () => {
        const baseProps = {
            headerText: "LOG",
            items: [],
            selectedPath: null,
            loadingText: "loading",
            emptyText: "empty",
            retryText: "retry",
            onRetry: () => {},
            onToggleDirectory: () => {},
            onSelectFile: () => {},
        };

        const loadingHtml = renderToStaticMarkup(
            React.createElement(FileTreePanel, {
                ...baseProps,
                treeLoading: true,
                treeError: null,
                retryDisabled: true,
            }),
        );
        assert.match(loadingHtml, /loading/);

        const emptyHtml = renderToStaticMarkup(
            React.createElement(FileTreePanel, {
                ...baseProps,
                treeLoading: false,
                treeError: null,
                retryDisabled: false,
            }),
        );
        assert.match(emptyHtml, /empty/);

        const errorHtml = renderToStaticMarkup(
            React.createElement(FileTreePanel, {
                ...baseProps,
                treeLoading: false,
                treeError: "boom",
                retryDisabled: false,
            }),
        );
        assert.match(errorHtml, /boom/);
        assert.match(errorHtml, /retry/);
    });

    it("FileTreePanel：有 items 时应输出 data-* 属性（选中/目录/展开）", () => {
        const items = [
            {
                entry: {
                    name: "dir",
                    path: "/log/dir",
                    isDirectory: true,
                    children: [],
                },
                level: 0,
                isExpanded: true,
            },
            {
                entry: {
                    name: "a.csv",
                    path: "/log/a.csv",
                    isDirectory: false,
                },
                level: 0,
                isExpanded: false,
            },
        ];

        const html = renderToStaticMarkup(
            React.createElement(FileTreePanel, {
                headerText: "LOG",
                items,
                selectedPath: "/log/a.csv",
                treeLoading: false,
                treeError: null,
                loadingText: "loading",
                emptyText: "empty",
                retryText: "retry",
                retryDisabled: false,
                onRetry: () => {},
                onToggleDirectory: () => {},
                onSelectFile: () => {},
            }),
        );

        assert.match(html, /data-directory=\"true\"/);
        assert.match(html, /data-expanded=\"true\"/);
        assert.match(html, /data-selected=\"true\"/);
        assert.match(html, /a\.csv/);
    });

    it("FilePreviewPanel：placeholder / loading / error / text / csv 分支可渲染", () => {
        const base = {
            selectFileText: "select",
            loadingText: "loading",
            showMoreText: "more",
            showLessText: "less",
            resetText: "reset",
            closeText: "close",
            zoomHintText: "hint",
        };

        const placeholderHtml = renderToStaticMarkup(
            React.createElement(FilePreviewPanel, {
                ...base,
                preview: {
                    selectedFilePath: null,
                    selectedFileName: null,
                    loading: false,
                    error: null,
                    content: "",
                    csvData: null,
                    isCsvFile: false,
                },
                chartProps: null,
            }),
        );
        assert.match(placeholderHtml, /select/);

        const loadingHtml = renderToStaticMarkup(
            React.createElement(FilePreviewPanel, {
                ...base,
                preview: {
                    selectedFilePath: "/log/a.txt",
                    selectedFileName: "a.txt",
                    loading: true,
                    error: null,
                    content: "",
                    csvData: null,
                    isCsvFile: false,
                },
                chartProps: null,
            }),
        );
        assert.match(loadingHtml, /loading/);

        const errorHtml = renderToStaticMarkup(
            React.createElement(FilePreviewPanel, {
                ...base,
                preview: {
                    selectedFilePath: "/log/a.txt",
                    selectedFileName: "a.txt",
                    loading: false,
                    error: "boom",
                    content: "",
                    csvData: null,
                    isCsvFile: false,
                },
                chartProps: null,
            }),
        );
        assert.match(errorHtml, /boom/);

        const textHtml = renderToStaticMarkup(
            React.createElement(FilePreviewPanel, {
                ...base,
                preview: {
                    selectedFilePath: "/log/a.txt",
                    selectedFileName: "a.txt",
                    loading: false,
                    error: null,
                    content: "HELLO",
                    csvData: null,
                    isCsvFile: false,
                },
                chartProps: null,
            }),
        );
        assert.match(textHtml, /HELLO/);

        const csvData = {
            headers: ["time", "A", "B", "C", "D", "E"],
            rows: [
                [1, 10, 20, 30, 40, 50],
                [2, 11, 21, 31, 41, 51],
            ],
        };

        const csvHtml = renderToStaticMarkup(
            React.createElement(FilePreviewPanel, {
                ...base,
                preview: {
                    selectedFilePath: "/log/a.csv",
                    selectedFileName: "a.csv",
                    loading: false,
                    error: null,
                    content: "time,A,B\\n1,10,20",
                    csvData,
                    isCsvFile: true,
                },
                chartProps: {
                    visibleCharts: 4,
                    enabledColumns: new Set([1, 2]),
                    sortedEnabledColumns: [1, 2],
                    hasMoreCharts: true,
                    chartColors: ["#00d4ff", "#ff6b6b", "#00ff88", "#ffaa00"],
                    enlargedColumn: null,
                    enlargedChartRef: { current: null },
                    onToggleColumn: () => {},
                    onShowMoreCharts: () => {},
                    onShowLessCharts: () => {},
                    onSetChartRef: () => {},
                    onOpenEnlargedChart: () => {},
                    onCloseEnlargedChart: () => {},
                    onResetEnlargedZoom: () => {},
                },
            }),
        );
        assert.match(csvHtml, /a\.csv/);
        assert.match(csvHtml, />A</);
        assert.match(csvHtml, />B</);
        assert.match(csvHtml, /more/);
    });

    it("ChartPanel：showMore/showLess 与 modal 分支可渲染", () => {
        const csvData = {
            headers: ["time", "A", "B", "C", "D", "E"],
            rows: [
                [1, 10, 20, 30, 40, 50],
                [2, 11, 21, 31, 41, 51],
            ],
        };

        const common = {
            csvData,
            title: "a.csv",
            enabledColumns: new Set([1]),
            sortedEnabledColumns: [1],
            chartColors: ["#00d4ff", "#ff6b6b", "#00ff88", "#ffaa00"],
            enlargedChartRef: { current: null },
            onToggleColumn: () => {},
            onShowMoreCharts: () => {},
            onShowLessCharts: () => {},
            onSetChartRef: () => {},
            onOpenEnlargedChart: () => {},
            onCloseEnlargedChart: () => {},
            onResetEnlargedZoom: () => {},
            showMoreText: "more",
            showLessText: "less",
            resetText: "reset",
            closeText: "close",
            zoomHintText: "hint",
        };

        const showMoreHtml = renderToStaticMarkup(
            React.createElement(ChartPanel, {
                ...common,
                visibleCharts: 4,
                hasMoreCharts: true,
                enlargedColumn: null,
            }),
        );
        assert.match(showMoreHtml, /more/);

        const showLessHtml = renderToStaticMarkup(
            React.createElement(ChartPanel, {
                ...common,
                visibleCharts: 999,
                hasMoreCharts: true,
                enlargedColumn: null,
            }),
        );
        assert.match(showLessHtml, /less/);

        const modalHtml = renderToStaticMarkup(
            React.createElement(ChartPanel, {
                ...common,
                visibleCharts: 4,
                hasMoreCharts: false,
                enlargedColumn: 1,
            }),
        );
        assert.match(modalHtml, /role=\"dialog\"/);
        assert.match(modalHtml, /reset/);
        assert.match(modalHtml, /close/);
        assert.match(modalHtml, /hint/);
    });

    it("useFilePreview.parseCsv：应解析数值与固定时间格式，并过滤全 NaN 行", () => {
        const content = [
            "time,A,B",
            "2024-12-17 08:00:00,1,2",
            "2024-12-17 08:00:01,3,4",
            "invalid, , ",
        ].join("\n");

        const parsed = parseCsv(content);
        assert.ok(parsed);
        assert.deepEqual(parsed.headers, ["time", "A", "B"]);
        assert.equal(parsed.rows.length, 2);
        assert.ok(Number.isFinite(parsed.rows[0][0]));
        assert.deepEqual(parsed.rows[0].slice(1), [1, 2]);
    });

    it("useChartData helpers：getXRange / getSeriesColor / getSeriesFill / createXAxisValuesFormatter", () => {
        assert.deepEqual(getXRange([3, 1, 2]), { min: 1, max: 3 });
        assert.equal(getXRange([Number.NaN, Infinity, -Infinity]), null);
        assert.equal(getXRange([1, 1, 1]), null);

        assert.equal(getSeriesColor(1, ["a", "b"]), "a");
        assert.equal(getSeriesColor(2, ["a", "b"]), "b");
        assert.equal(getSeriesColor(3, ["a", "b"]), "a");

        assert.equal(getSeriesFill("#00d4ff"), "rgba(0, 212, 255, 0.1)");

        const format = createXAxisValuesFormatter(2);
        const values = format({}, [1, 2, 3, 4, 5]);
        assert.notEqual(values[0], ""); // index=0, step=2 -> shown
        assert.equal(values[1], ""); // index=1 -> hidden
        assert.notEqual(values[2], ""); // index=2 -> shown
        assert.equal(values[3], "");
        assert.notEqual(values[4], "");
    });
});
