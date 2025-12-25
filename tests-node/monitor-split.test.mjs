import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// 初始化 i18n：确保 useTranslation 在 SSR 下可用
import "@/i18n";

import { AlarmList } from "@/components/views/Monitor/AlarmList.tsx";
import { SpectrumAnalyzerView } from "@/components/views/Monitor/SpectrumAnalyzer.tsx";
import { WaterfallChartView } from "@/components/views/Monitor/WaterfallChart.tsx";
import { ErrorBoundary } from "@/components/common/ErrorBoundary.tsx";
import { useAlarmStore } from "@/stores";
import {
    DEFAULT_SPECTRUM_STATS,
    calculateSpectrumBandwidth,
    computeSpectrumStats,
} from "@/hooks/useSpectrumData.ts";
import { runChartFactory } from "@/hooks/useChartInit.ts";

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

describe("T03 Monitor 视图拆分（Node SSR）", () => {
    it("WaterfallChartView：loading/error/ready 分支可渲染", () => {
        const common = {
            amplitudes: [],
            threshold: -80,
            historyDepth: 100,
            isPaused: false,
            colorScheme: "turbo",
            loadingLabel: "loading",
            unavailableLabel: "unavailable",
            errorLabel: "error",
            retryText: "retry",
            onRetry: () => {},
        };

        const loadingHtml = renderToStaticMarkup(
            React.createElement(WaterfallChartView, {
                ...common,
                status: "loading",
                error: null,
            }),
        );
        assert.match(loadingHtml, /loading/);

        const errorHtml = renderToStaticMarkup(
            React.createElement(WaterfallChartView, {
                ...common,
                status: "error",
                error: "boom",
            }),
        );
        assert.match(errorHtml, /error/);
        assert.match(errorHtml, /boom/);
        assert.match(errorHtml, /retry/);

        const readyHtml = renderToStaticMarkup(
            React.createElement(WaterfallChartView, {
                ...common,
                status: "ready",
                error: null,
                amplitudes: [-90, -20],
            }),
        );
        assert.match(readyHtml, /<canvas/);
    });

    it("SpectrumAnalyzerView：可渲染 ready 与 error 分支（含 marker/configOpen）", () => {
        const base = {
            threshold: -80,
            historyDepth: 100,
            refreshRate: 30,
            colorScheme: "turbo",
            isPaused: false,
            showMaxHold: false,
            showAverage: false,
            maxHoldData: [],
            averageData: [],
            chartHostRef: { current: null },
            waterfallHostRef: { current: null },
            onTogglePaused: () => {},
            onToggleMaxHold: () => {},
            onToggleAverage: () => {},
            onResetTraces: () => {},
            onScreenshot: () => {},
            onSetThreshold: () => {},
            onSetHistoryDepth: () => {},
            onSetRefreshRate: () => {},
            onSetColorScheme: () => {},
        };

        const readyHtml = renderToStaticMarkup(
            React.createElement(SpectrumAnalyzerView, {
                ...base,
                status: "ready",
                errorText: null,
                frequencies: [0, 1000],
                amplitudes: [-90, -20],
                initialConfigOpen: true,
                initialMarker: { freq: 1000, amp: -50 },
            }),
        );
        assert.match(readyHtml, /33 ms/);
        assert.match(readyHtml, /500 Hz/);
        assert.match(readyHtml, /1\.00 kHz/);
        assert.match(readyHtml, /1\.000 kHz/);
        assert.match(readyHtml, /-50\.0 dBm/);
        assert.match(readyHtml, /spectrum-analyzer-config/);

        const errorHtml = renderToStaticMarkup(
            React.createElement(SpectrumAnalyzerView, {
                ...base,
                status: "error",
                errorText: "boom",
                frequencies: [],
                amplitudes: [],
            }),
        );
        assert.match(errorHtml, /数据获取失败/);
        assert.match(errorHtml, /boom/);
    });

    it("AlarmList：空态分支可渲染（SSR）", () => {
        const store = useAlarmStore.getState();
        store.clearAll();

        const emptyHtml = renderToStaticMarkup(React.createElement(AlarmList));
        assert.match(emptyHtml, /报警列表/);
        assert.match(emptyHtml, /无报警/);
    });

    it("useSpectrumData helpers：calculateSpectrumBandwidth / computeSpectrumStats", () => {
        assert.equal(
            calculateSpectrumBandwidth([0, 1000, 2000], [-90, -30, -31], -30),
            1000,
        );

        const stats = computeSpectrumStats({
            timestamp: 0,
            frequencies: [0, 1000, 2000, 3000],
            amplitudes: [-90, -30, -31, -90],
        });

        assert.equal(stats.peak_frequency, 1000);
        assert.equal(stats.peak_amplitude, -30);
        assert.equal(stats.bandwidth, 1000);
        assert.notDeepEqual(stats, DEFAULT_SPECTRUM_STATS);
    });

    it("useChartInit helper：runChartFactory success/error", () => {
        const ok = runChartFactory(() => 42);
        assert.equal(ok.ok, true);
        assert.equal(ok.value, 42);

        const bad = runChartFactory(() => {
            throw new Error("boom");
        });
        assert.equal(bad.ok, false);
        assert.match(bad.message ?? "", /boom/);
    });

    it("ErrorBoundary：手动置入错误状态后 render 应输出默认降级 UI", () => {
        const boundary = new ErrorBoundary({
            children: React.createElement("div", null, "ok"),
        });

        boundary.state = { hasError: true, error: new Error("boom") };
        const html = renderToStaticMarkup(boundary.render());

        assert.match(html, /页面渲染失败/);
        assert.match(html, /boom/);
    });
});

describe("T03 Monitor 视图拆分（构建产物代码分割）", () => {
    it("代码分割：Monitor 视图不应打包到主 bundle（dist/assets entry）", async () => {
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const assetsDir = path.join(projectRoot, "dist", "assets");

        const monitorChunk = await findFirstAssetContaining(
            assetsDir,
            "monitor.exportData",
        );
        assert.ok(monitorChunk, "cannot locate Monitor view chunk by marker");
        assert.notEqual(monitorChunk, entryAsset);

        const entryCode = await readText(path.join(assetsDir, entryAsset));
        assert.ok(!entryCode.includes("monitor.exportData"));
        assert.ok(!entryCode.includes("monitor.spectrumAnalyzer.controls.pause"));

        const monitorCode = await readText(path.join(assetsDir, monitorChunk));
        assert.ok(monitorCode.includes("monitor.exportData"));
    });

    it("懒加载：主 bundle 应引用 Monitor chunk，但 index.html 不应 modulepreload Monitor chunk", async () => {
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const assetsDir = path.join(projectRoot, "dist", "assets");

        const monitorChunk = await findFirstAssetContaining(
            assetsDir,
            "monitor.exportData",
        );
        assert.ok(monitorChunk, "cannot locate Monitor view chunk by marker");

        const entryCode = await readText(path.join(assetsDir, entryAsset));
        assert.ok(
            entryCode.includes(monitorChunk),
            `entry bundle should reference ${monitorChunk}`,
        );

        const preloads = getModulepreloadAssetsFromIndexHtml(indexHtml);
        assert.ok(!preloads.includes(monitorChunk));
    });

    it("懒加载：SpectrumAnalyzer 应为独立 chunk，仅由 Monitor chunk 引用", async () => {
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const assetsDir = path.join(projectRoot, "dist", "assets");

        const monitorChunk = await findFirstAssetContaining(
            assetsDir,
            "monitor.exportData",
        );
        assert.ok(monitorChunk, "cannot locate Monitor view chunk by marker");

        const spectrumChunk = await findFirstAssetContaining(
            assetsDir,
            "spectrum-analyzer-config",
        );
        assert.ok(
            spectrumChunk,
            "cannot locate SpectrumAnalyzer chunk by marker",
        );
        assert.notEqual(spectrumChunk, entryAsset);
        assert.notEqual(spectrumChunk, monitorChunk);

        const entryCode = await readText(path.join(assetsDir, entryAsset));
        assert.ok(!entryCode.includes(spectrumChunk));

        const monitorCode = await readText(path.join(assetsDir, monitorChunk));
        assert.ok(
            monitorCode.includes(spectrumChunk),
            `Monitor chunk should reference ${spectrumChunk}`,
        );
    });

    it("依赖：SpectrumAnalyzer chunk 应通过独立 uPlot vendor chunk 引入（避免进入主 bundle）", async () => {
        const assetsDir = path.join(projectRoot, "dist", "assets");
        const indexHtml = await getDistIndexHtml();
        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);

        const entries = await fs.readdir(assetsDir);
        const uplotVendor = getFirstAssetByPrefix(entries, "uPlot.min-");
        assert.ok(uplotVendor, "missing uPlot vendor chunk in dist/assets");

        const spectrumChunk = await findFirstAssetContaining(
            assetsDir,
            "spectrum-analyzer-config",
        );
        assert.ok(spectrumChunk, "cannot locate SpectrumAnalyzer chunk by marker");

        const spectrumCode = await readText(path.join(assetsDir, spectrumChunk));
        assert.match(spectrumCode, /uPlot\.min-[A-Za-z0-9_-]+\.js/);
        assert.ok(spectrumCode.includes(uplotVendor));

        // uPlot 不应被 index.html 首屏 preload（否则会破坏按需加载收益）
        const preloads = getModulepreloadAssetsFromIndexHtml(indexHtml);
        assert.ok(!preloads.includes(uplotVendor));

        assert.notEqual(entryAsset, uplotVendor);
    });

    it("大小/性能：entry 与 Monitor 相关 chunk 体积应合理，首次加载 <200ms", async () => {
        const distDir = path.join(projectRoot, "dist");
        const assetsDir = path.join(distDir, "assets");
        const indexHtmlPath = path.join(distDir, "index.html");

        const indexHtmlBuf = await readFileSafe(indexHtmlPath);
        assert.ok(indexHtmlBuf, "dist/index.html missing");
        const indexHtml = indexHtmlBuf.toString("utf8");

        const entryAsset = getEntryAssetFromIndexHtml(indexHtml);
        const monitorChunk = await findFirstAssetContaining(
            assetsDir,
            "monitor.exportData",
        );
        const spectrumChunk = await findFirstAssetContaining(
            assetsDir,
            "spectrum-analyzer-config",
        );
        assert.ok(monitorChunk, "cannot locate Monitor chunk by marker");
        assert.ok(spectrumChunk, "cannot locate SpectrumAnalyzer chunk by marker");

        const entrySize = (await fs.stat(path.join(assetsDir, entryAsset))).size;
        const monitorSize = (await fs.stat(path.join(assetsDir, monitorChunk)))
            .size;
        const spectrumSize = (await fs.stat(path.join(assetsDir, spectrumChunk)))
            .size;

        assert.ok(entrySize < 120_000, `entry too large: ${entrySize} bytes`);
        assert.ok(monitorSize < 50_000, `Monitor chunk too large: ${monitorSize} bytes`);
        assert.ok(
            spectrumSize < 60_000,
            `SpectrumAnalyzer chunk too large: ${spectrumSize} bytes`,
        );

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
