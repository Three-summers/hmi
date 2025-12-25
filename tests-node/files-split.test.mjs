import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, it } from "vitest";
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

const projectRoot = process.cwd();

async function readFileSafe(filePath) {
    try {
        return await fs.readFile(filePath);
    } catch {
        return null;
    }
}

async function readText(filePath) {
    const buf = await fs.readFile(filePath);
    return buf.toString("utf8");
}

async function getDistIndexHtml() {
    return readText(path.join(projectRoot, "dist", "index.html"));
}

function getEntryAssetFromIndexHtml(indexHtml) {
    const scriptIndex = indexHtml.indexOf('<script type="module"');
    assert.ok(scriptIndex >= 0, 'dist/index.html missing <script type="module"...>');

    const srcMarker = 'src="/assets/';
    const srcIndex = indexHtml.indexOf(srcMarker, scriptIndex);
    assert.ok(srcIndex >= 0, 'dist/index.html missing entry src="/assets/..."');

    const after = indexHtml.slice(srcIndex + srcMarker.length);
    const end = after.indexOf('.js"');
    assert.ok(end >= 0, 'dist/index.html entry src does not end with .js"');

    return after.slice(0, end + 3);
}

function getModulepreloadAssetsFromIndexHtml(indexHtml) {
    const assets = [];
    const hrefMarker = 'href="/assets/';
    let cursor = 0;
    while (true) {
        const preloadIndex = indexHtml.indexOf('rel="modulepreload"', cursor);
        if (preloadIndex < 0) break;

        const hrefIndex = indexHtml.indexOf(hrefMarker, preloadIndex);
        assert.ok(hrefIndex >= 0, 'modulepreload link missing href="/assets/..."');
        const after = indexHtml.slice(hrefIndex + hrefMarker.length);
        const end = after.indexOf('"');
        assert.ok(end >= 0, "modulepreload href missing closing quote");
        assets.push(after.slice(0, end));

        cursor = hrefIndex + hrefMarker.length;
    }
    return assets;
}

async function findFirstAssetContaining(assetsDir, marker) {
    const entries = await fs.readdir(assetsDir);
    const jsFiles = entries.filter((name) => name.endsWith(".js"));
    for (const name of jsFiles) {
        const content = await readText(path.join(assetsDir, name));
        if (content.includes(marker)) return name;
    }
    return null;
}

function getFirstAssetByPrefix(assetNames, prefix) {
    return assetNames.find((name) => name.startsWith(prefix)) ?? null;
}

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

describe("T02 Files 视图拆分（构建产物代码分割）", () => {
    it("代码分割：Files 视图不应打包到主 bundle（dist/assets entry）", async () => {
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const assetsDir = path.join(projectRoot, "dist", "assets");

        const filesChunk = await findFirstAssetContaining(
            assetsDir,
            "files.selectFile",
        );
        assert.ok(filesChunk, "cannot locate Files view chunk by marker");
        assert.notEqual(filesChunk, entryAsset);

        const entryCode = await readText(path.join(assetsDir, entryAsset));
        assert.ok(!entryCode.includes("files.selectFile"));
        assert.ok(!entryCode.includes("files.title"));

        const filesCode = await readText(path.join(assetsDir, filesChunk));
        assert.ok(filesCode.includes("files.selectFile"));
        assert.ok(filesCode.includes("files.title"));
    });

    it("懒加载：主 bundle 应引用 Files chunk，但 index.html 不应 modulepreload Files chunk", async () => {
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const assetsDir = path.join(projectRoot, "dist", "assets");

        const filesChunk = await findFirstAssetContaining(
            assetsDir,
            "files.selectFile",
        );
        assert.ok(filesChunk, "cannot locate Files view chunk by marker");

        const entryCode = await readText(path.join(assetsDir, entryAsset));
        assert.ok(
            entryCode.includes(filesChunk),
            `entry bundle should reference ${filesChunk}`,
        );

        const preloads = getModulepreloadAssetsFromIndexHtml(indexHtml);
        assert.ok(!preloads.includes(filesChunk));
    });

    it("依赖：Files chunk 应通过独立 uPlot vendor chunk 引入（避免进入主 bundle）", async () => {
        const assetsDir = path.join(projectRoot, "dist", "assets");
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);

        const entries = await fs.readdir(assetsDir);
        const uplotVendor = getFirstAssetByPrefix(entries, "uPlot.min-");
        assert.ok(uplotVendor, "missing uPlot vendor chunk in dist/assets");

        const filesChunk = await findFirstAssetContaining(
            assetsDir,
            "files.selectFile",
        );
        assert.ok(filesChunk, "cannot locate Files view chunk by marker");

        const filesCode = await readText(path.join(assetsDir, filesChunk));
        assert.match(filesCode, /uPlot\.min-[A-Za-z0-9_-]+\.js/);
        assert.ok(filesCode.includes(uplotVendor));

        // uPlot 不应被 index.html 首屏 preload（否则会破坏按需加载收益）
        const preloads = getModulepreloadAssetsFromIndexHtml(indexHtml);
        assert.ok(!preloads.includes(uplotVendor));

        // entry 允许“引用”懒加载依赖（例如预加载映射），但不应等同于首屏强制加载
        assert.notEqual(entryAsset, uplotVendor);
    });

    it("大小：entry 与 Files chunk 体积应符合预期（避免回退到整包）", async () => {
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const assetsDir = path.join(projectRoot, "dist", "assets");

        const filesChunk = await findFirstAssetContaining(
            assetsDir,
            "files.selectFile",
        );
        assert.ok(filesChunk, "cannot locate Files view chunk by marker");

        const entrySize = (await fs.stat(path.join(assetsDir, entryAsset))).size;
        const filesSize = (await fs.stat(path.join(assetsDir, filesChunk))).size;

        assert.ok(entrySize < 120_000, `entry too large: ${entrySize} bytes`);
        assert.ok(filesSize < 50_000, `Files chunk too large: ${filesSize} bytes`);
    });

    it("性能：首次加载（index.html + entry + modulepreload）应 <200ms", async () => {
        const distDir = path.join(projectRoot, "dist");
        const assetsDir = path.join(distDir, "assets");
        const indexHtmlPath = path.join(distDir, "index.html");
        const indexHtmlBuf = await readFileSafe(indexHtmlPath);
        assert.ok(indexHtmlBuf, "dist/index.html missing");

        const indexHtml = indexHtmlBuf.toString("utf8");
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const preloads = getModulepreloadAssetsFromIndexHtml(indexHtml);

        const toRead = Array.from(new Set([entryAsset, ...preloads])).map(
            (name) => path.join(assetsDir, name),
        );

        const start = performance.now();
        await Promise.all(toRead.map((p) => fs.readFile(p)));
        const elapsed = performance.now() - start;

        assert.ok(
            elapsed < 200,
            `initial bundle read took ${elapsed.toFixed(1)}ms`,
        );
    });
});
