/**
 * 频谱分析仪组件
 *
 * 提供专业的频谱分析功能，基于 uPlot 绘制实时频谱图和瀑布图。
 * 核心特性：
 * - 双图显示：频谱图（Spectrum Chart）+ 瀑布图（Waterfall）
 * - Max Hold / Average 功能：显示峰值保持和平均值曲线
 * - 可配置参数：阈值、历史深度、刷新率、配色方案
 * - 截图功能：支持导出当前分析结果
 * - 性能优化：刷新率控制、数据节流、视图激活判断
 *
 * @module SpectrumAnalyzer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useIsViewActive } from "@/components/layout/ViewContext";
import {
    ChartIcon,
    PauseIcon,
    PlayIcon,
    ResetIcon,
    SaveIcon,
    SettingsIcon,
} from "@/components/common/Icons";
import { useSpectrumAnalyzerStore } from "@/stores";
import { invoke } from "@/platform/invoke";
import { isTauri } from "@/platform/tauri";
import { captureSpectrumAnalyzer } from "@/utils/screenshot";
import SpectrumChart from "./SpectrumChart";
import WaterfallCanvas from "./WaterfallCanvas";
import styles from "./SpectrumAnalyzer.module.css";

interface SpectrumData {
    timestamp: number;
    frequencies: number[];
    amplitudes: number[];
}

export interface SpectrumAnalyzerProps {
    /** Tabs 默认 keepMounted，为避免后台占用资源，需要由父组件告知当前是否处于激活状态 */
    isActive: boolean;
}

function formatHz(value: number): string {
    if (!Number.isFinite(value)) return "--";
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(3)} MHz`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(3)} kHz`;
    return `${value.toFixed(0)} Hz`;
}

function formatSpan(valueHz: number): string {
    if (!Number.isFinite(valueHz)) return "--";
    const abs = Math.abs(valueHz);
    if (abs >= 1_000_000) return `${(valueHz / 1_000_000).toFixed(3)} MHz`;
    if (abs >= 1_000) return `${(valueHz / 1_000).toFixed(2)} kHz`;
    return `${valueHz.toFixed(0)} Hz`;
}

function formatSweep(refreshRateHz: number): string {
    if (!Number.isFinite(refreshRateHz) || refreshRateHz <= 0) return "--";
    const ms = 1000 / refreshRateHz;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${ms.toFixed(0)} ms`;
}

export default function SpectrumAnalyzer({ isActive }: SpectrumAnalyzerProps) {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const shouldSubscribe = isActive && isViewActive;

    const threshold = useSpectrumAnalyzerStore((s) => s.threshold);
    const historyDepth = useSpectrumAnalyzerStore((s) => s.historyDepth);
    const refreshRate = useSpectrumAnalyzerStore((s) => s.refreshRate);
    const colorScheme = useSpectrumAnalyzerStore((s) => s.colorScheme);
    const isPaused = useSpectrumAnalyzerStore((s) => s.isPaused);
    const maxHoldData = useSpectrumAnalyzerStore((s) => s.maxHoldData);
    const averageData = useSpectrumAnalyzerStore((s) => s.averageData);
    const showMaxHold = useSpectrumAnalyzerStore((s) => s.showMaxHold);
    const showAverage = useSpectrumAnalyzerStore((s) => s.showAverage);

    const setThreshold = useSpectrumAnalyzerStore((s) => s.setThreshold);
    const setHistoryDepth = useSpectrumAnalyzerStore((s) => s.setHistoryDepth);
    const setRefreshRate = useSpectrumAnalyzerStore((s) => s.setRefreshRate);
    const setColorScheme = useSpectrumAnalyzerStore((s) => s.setColorScheme);
    const setIsPaused = useSpectrumAnalyzerStore((s) => s.setIsPaused);
    const setShowMaxHold = useSpectrumAnalyzerStore((s) => s.setShowMaxHold);
    const setShowAverage = useSpectrumAnalyzerStore((s) => s.setShowAverage);
    const resetMaxHold = useSpectrumAnalyzerStore((s) => s.resetMaxHold);
    const resetAverage = useSpectrumAnalyzerStore((s) => s.resetAverage);

    const [frequencies, setFrequencies] = useState<number[]>([]);
    const [amplitudes, setAmplitudes] = useState<number[]>([]);
    const [status, setStatus] = useState<
        "unavailable" | "loading" | "ready" | "error"
    >("loading");
    const [errorText, setErrorText] = useState<string | null>(null);

    const [configOpen, setConfigOpen] = useState(false);
    const [marker, setMarker] = useState<{ freq: number; amp: number } | null>(
        null,
    );

    const chartHostRef = useRef<HTMLDivElement | null>(null);
    const waterfallHostRef = useRef<HTMLDivElement | null>(null);

    const isPausedRef = useRef(isPaused);
    const refreshRateRef = useRef(refreshRate);
    const lastAcceptedAtRef = useRef<number>(0);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        refreshRateRef.current = refreshRate;
    }, [refreshRate]);

    const derivedStatus = useMemo(() => {
        let minHz = Number.POSITIVE_INFINITY;
        let maxHz = Number.NEGATIVE_INFINITY;

        for (const freq of frequencies) {
            if (!Number.isFinite(freq)) continue;
            minHz = Math.min(minHz, freq);
            maxHz = Math.max(maxHz, freq);
        }

        if (
            !Number.isFinite(minHz) ||
            !Number.isFinite(maxHz) ||
            frequencies.length < 2
        ) {
            return {
                centerHz: Number.NaN,
                spanHz: Number.NaN,
                rbwHz: Number.NaN,
                vbwHz: Number.NaN,
            };
        }

        const spanHz = maxHz - minHz;
        const centerHz = minHz + spanHz / 2;
        const rbwHz = spanHz / Math.max(1, frequencies.length - 1);
        const vbwHz = rbwHz;

        return { centerHz, spanHz, rbwHz, vbwHz };
    }, [frequencies]);

    useEffect(() => {
        if (!shouldSubscribe) return;

        if (!isTauri()) {
            setStatus("unavailable");
            setErrorText(null);
            return;
        }

        setStatus("loading");
        setErrorText(null);
        lastAcceptedAtRef.current = 0;

        let unlisten: (() => void) | null = null;
        let cancelled = false;

        const setup = async () => {
            try {
                const unlistenFn = await listen<SpectrumData>(
                    "spectrum-data",
                    (event) => {
                        if (cancelled) return;
                        if (isPausedRef.current) return;

                        const now = performance.now();
                        const desiredRate = Math.max(1, refreshRateRef.current);
                        const minInterval = 1000 / desiredRate;
                        const lastAcceptedAt = lastAcceptedAtRef.current;
                        if (
                            lastAcceptedAt &&
                            now - lastAcceptedAt < minInterval
                        )
                            return;
                        lastAcceptedAtRef.current = now;

                        const payload = event.payload;
                        setFrequencies(payload.frequencies);
                        setAmplitudes(payload.amplitudes);
                        setStatus("ready");

                        const store = useSpectrumAnalyzerStore.getState();
                        store.updateMaxHold(payload.amplitudes);
                        store.updateAverage(payload.amplitudes);
                    },
                );

                if (cancelled) {
                    unlistenFn();
                    return;
                }

                unlisten = unlistenFn;
                await invoke("start_sensor_simulation");
            } catch (err) {
                console.error("Failed to setup spectrum analyzer:", err);
                if (cancelled) return;
                setStatus("error");
                setErrorText(err instanceof Error ? err.message : String(err));
                setFrequencies([]);
                setAmplitudes([]);
            }
        };

        setup();

        return () => {
            cancelled = true;
            if (isTauri()) {
                invoke("stop_sensor_simulation").catch(console.error);
            }
            unlisten?.();
        };
    }, [shouldSubscribe]);

    const handleScreenshot = useCallback(async () => {
        const chartHost = chartHostRef.current;
        const waterfallHost = waterfallHostRef.current;
        if (!chartHost || !waterfallHost) return;

        const chartCanvasCandidate =
            chartHost.querySelector("canvas.u-canvas") ??
            chartHost.querySelector("canvas");
        const waterfallCanvasCandidate = waterfallHost.querySelector("canvas");

        if (
            !(chartCanvasCandidate instanceof HTMLCanvasElement) ||
            !(waterfallCanvasCandidate instanceof HTMLCanvasElement)
        ) {
            return;
        }

        await captureSpectrumAnalyzer(
            chartCanvasCandidate,
            waterfallCanvasCandidate,
        );
    }, []);

    const handleResetTraces = () => {
        resetMaxHold();
        resetAverage();
    };

    useEffect(() => {
        // 键盘快捷键：仅在当前视图激活时生效，避免全局误触
        if (!isActive || !isViewActive) return;

        const shouldIgnoreTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            if (target.isContentEditable) return true;
            const tag = target.tagName;
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.repeat) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (shouldIgnoreTarget(event.target)) return;

            const key = event.key;
            if (key === "p" || key === "P") {
                event.preventDefault();
                setIsPaused(!isPausedRef.current);
                return;
            }

            if (key === "s" || key === "S") {
                event.preventDefault();
                void handleScreenshot();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [handleScreenshot, isActive, isViewActive, setIsPaused]);

    const markerText = useMemo(() => {
        if (!marker) return "--";
        if (!Number.isFinite(marker.freq) || !Number.isFinite(marker.amp))
            return "--";
        return `${formatHz(marker.freq)} ${marker.amp.toFixed(1)} dBm`;
    }, [marker]);

    const settingsTitle = useMemo(() => {
        return `${t("monitor.spectrumAnalyzer.title")} ${t("monitor.spectrumAnalyzer.controls.settings")}`;
    }, [t]);

    return (
        <div className={styles.root}>
            <div className={styles.statusBar}>
                <div className={styles.statusItem} data-priority="secondary">
                    <span className={styles.statusLabel}>
                        {t("monitor.spectrumAnalyzer.statusBar.rbw")}
                    </span>
                    <span className={styles.statusValue}>
                        {formatHz(derivedStatus.rbwHz)}
                    </span>
                </div>
                <div className={styles.statusItem} data-priority="secondary">
                    <span className={styles.statusLabel}>
                        {t("monitor.spectrumAnalyzer.statusBar.vbw")}
                    </span>
                    <span className={styles.statusValue}>
                        {formatHz(derivedStatus.vbwHz)}
                    </span>
                </div>
                <div className={styles.statusItem} data-priority="secondary">
                    <span className={styles.statusLabel}>
                        {t("monitor.spectrumAnalyzer.statusBar.sweep")}
                    </span>
                    <span className={styles.statusValue}>
                        {formatSweep(refreshRate)}
                    </span>
                </div>
                <div className={styles.statusItem}>
                    <span className={styles.statusLabel}>
                        {t("monitor.spectrumAnalyzer.statusBar.center")}
                    </span>
                    <span className={styles.statusValue}>
                        {formatHz(derivedStatus.centerHz)}
                    </span>
                </div>
                <div className={styles.statusItem}>
                    <span className={styles.statusLabel}>
                        {t("monitor.spectrumAnalyzer.statusBar.span")}
                    </span>
                    <span className={styles.statusValue}>
                        {formatSpan(derivedStatus.spanHz)}
                    </span>
                </div>
                <div className={styles.statusItem}>
                    <span className={styles.statusLabel}>
                        {t("monitor.spectrumAnalyzer.marker")}
                    </span>
                    <span className={styles.statusValue}>{markerText}</span>
                </div>
            </div>

            <div className={styles.charts}>
                <div className={styles.spectrumPane} ref={chartHostRef}>
                    <SpectrumChart
                        frequencies={frequencies}
                        amplitudes={amplitudes}
                        maxHoldData={maxHoldData}
                        averageData={averageData}
                        showMaxHold={showMaxHold}
                        showAverage={showAverage}
                        threshold={threshold}
                        isPaused={isPaused}
                        onMarkerChange={setMarker}
                    />
                </div>

                <div className={styles.waterfallPane} ref={waterfallHostRef}>
                    <WaterfallCanvas
                        amplitudes={amplitudes}
                        threshold={threshold}
                        historyDepth={historyDepth}
                        isPaused={isPaused}
                        colorScheme={colorScheme}
                    />
                </div>

                {status !== "ready" && (
                    <div className={styles.overlay}>
                        <div className={styles.overlayCard}>
                            {status === "unavailable"
                                ? t("monitor.info.browserModeTip")
                                : status === "error"
                                  ? `${t("monitor.status.error")}: ${errorText ?? "--"}`
                                  : t("monitor.canvas.waiting")}
                        </div>
                    </div>
                )}
            </div>

            <div className={styles.controls}>
                <button
                    type="button"
                    className={styles.controlBtn}
                    data-active={isPaused}
                    onClick={() => setIsPaused(!isPaused)}
                >
                    {isPaused ? (
                        <PlayIcon className={styles.controlIcon} />
                    ) : (
                        <PauseIcon className={styles.controlIcon} />
                    )}
                    <span className={styles.controlText}>
                        {isPaused
                            ? t("monitor.spectrumAnalyzer.controls.resume")
                            : t("monitor.spectrumAnalyzer.controls.pause")}
                    </span>
                </button>
                <button
                    type="button"
                    className={styles.controlBtn}
                    data-active={showMaxHold}
                    onClick={() => setShowMaxHold(!showMaxHold)}
                >
                    <ChartIcon className={styles.controlIcon} />
                    <span className={styles.controlText}>
                        {t("monitor.spectrumAnalyzer.controls.maxHold")}
                    </span>
                </button>
                <button
                    type="button"
                    className={styles.controlBtn}
                    data-active={showAverage}
                    onClick={() => setShowAverage(!showAverage)}
                >
                    <ChartIcon className={styles.controlIcon} />
                    <span className={styles.controlText}>
                        {t("monitor.spectrumAnalyzer.controls.average")}
                    </span>
                </button>
                <button
                    type="button"
                    className={styles.controlBtn}
                    onClick={handleResetTraces}
                >
                    <ResetIcon className={styles.controlIcon} />
                    <span className={styles.controlText}>
                        {t("monitor.spectrumAnalyzer.controls.reset")}
                    </span>
                </button>
                <button
                    type="button"
                    className={styles.controlBtn}
                    onClick={handleScreenshot}
                    aria-label={t(
                        "monitor.spectrumAnalyzer.controls.screenshot",
                    )}
                >
                    <SaveIcon className={styles.controlIcon} />
                    <span className={styles.controlText}>
                        {t("monitor.spectrumAnalyzer.controls.screenshot")}
                    </span>
                </button>
                <button
                    type="button"
                    className={styles.controlBtn}
                    data-active={configOpen}
                    data-icon-only="true"
                    onClick={() => setConfigOpen((prev) => !prev)}
                    aria-expanded={configOpen}
                    aria-controls="spectrum-analyzer-config"
                    aria-label={t("monitor.spectrumAnalyzer.controls.settings")}
                >
                    <SettingsIcon className={styles.controlIcon} />
                    <span className={styles.controlText}>
                        {t("monitor.spectrumAnalyzer.controls.settings")}
                    </span>
                </button>
            </div>

            {configOpen && (
                <button
                    type="button"
                    className={styles.backdrop}
                    onClick={() => setConfigOpen(false)}
                    aria-label={t("common.close")}
                />
            )}

            <aside
                id="spectrum-analyzer-config"
                className={styles.drawer}
                data-open={configOpen}
            >
                <div className={styles.drawerHeader}>
                    <div className={styles.drawerTitle}>{settingsTitle}</div>
                    <button
                        type="button"
                        className={styles.drawerClose}
                        onClick={() => setConfigOpen(false)}
                    >
                        {t("common.close")}
                    </button>
                </div>

                <div className={styles.drawerBody}>
                    <label className={styles.field}>
                        <div className={styles.fieldHeader}>
                            <span className={styles.fieldLabel}>
                                {t(
                                    "monitor.spectrumAnalyzer.settings.threshold",
                                )}
                            </span>
                            <span className={styles.fieldValue}>
                                {threshold.toFixed(0)} dBm
                            </span>
                        </div>
                        <input
                            type="range"
                            min={-100}
                            max={0}
                            step={1}
                            value={threshold}
                            className={styles.slider}
                            onChange={(e) =>
                                setThreshold(Number(e.target.value))
                            }
                        />
                    </label>

                    <label className={styles.field}>
                        <div className={styles.fieldHeader}>
                            <span className={styles.fieldLabel}>
                                {t(
                                    "monitor.spectrumAnalyzer.settings.historyDepth",
                                )}
                            </span>
                        </div>
                        <select
                            className={styles.select}
                            value={historyDepth}
                            onChange={(e) =>
                                setHistoryDepth(Number(e.target.value))
                            }
                        >
                            {[50, 100, 200, 500].map((v) => (
                                <option key={v} value={v}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <div className={styles.fieldHeader}>
                            <span className={styles.fieldLabel}>
                                {t(
                                    "monitor.spectrumAnalyzer.settings.refreshRate",
                                )}
                            </span>
                        </div>
                        <select
                            className={styles.select}
                            value={refreshRate}
                            onChange={(e) =>
                                setRefreshRate(Number(e.target.value))
                            }
                        >
                            {[10, 30, 60].map((v) => (
                                <option key={v} value={v}>
                                    {v} Hz
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <div className={styles.fieldHeader}>
                            <span className={styles.fieldLabel}>
                                {t(
                                    "monitor.spectrumAnalyzer.settings.colorScheme",
                                )}
                            </span>
                        </div>
                        <select
                            className={styles.select}
                            value={colorScheme}
                            onChange={(e) => setColorScheme(e.target.value)}
                        >
                            {(
                                [
                                    "turbo",
                                    "viridis",
                                    "jet",
                                    "grayscale",
                                ] as const
                            ).map((v) => (
                                <option key={v} value={v}>
                                    {t(
                                        `monitor.spectrumAnalyzer.colorSchemes.${v}`,
                                    )}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </aside>
        </div>
    );
}
