import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
