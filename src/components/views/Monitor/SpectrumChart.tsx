/**
 * 频谱图组件（基于 uPlot）
 *
 * 使用 uPlot 库绘制高性能的频谱图，支持实时数据更新。
 * 核心特性：
 * - 实时曲线：当前频谱幅度曲线
 * - Max Hold 曲线：峰值保持（可选）
 * - Average 曲线：平均值（可选）
 * - 阈值线：可配置阈值线
 * - Marker 功能：鼠标悬停显示频率和幅度
 * - 数据过滤：仅保留 0-10kHz 频段
 * - 主题适配：根据用户设置应用深色/浅色主题
 *
 * @module SpectrumChart
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useCanvasScale, useChartInit } from "@/hooks";
import { useAppStore } from "@/stores";
import { readCssVar, withAlpha } from "@/utils";
import styles from "./SpectrumChart.module.css";

export interface SpectrumChartProps {
    /** 频率数组（Hz） */
    frequencies: number[];
    /** 幅度数组（dBm） */
    amplitudes: number[];
    /** Max Hold 幅度数组（dBm） */
    maxHoldData: number[];
    /** Average 幅度数组（dBm） */
    averageData: number[];
    /** 是否显示 Max Hold 曲线 */
    showMaxHold: boolean;
    /** 是否显示 Average 曲线 */
    showAverage: boolean;
    /** 阈值（dBm） */
    threshold: number;
    /** 是否暂停 */
    isPaused: boolean;
    onMarkerChange?: (pos: { freq: number; amp: number } | null) => void;
}

interface RenderedSpectrumData {
    frequenciesHz: number[];
    amplitudesDbm: number[];
    alignedData: uPlot.AlignedData;
}

function formatMarkerText(freqHz: number, ampDbm: number): string {
    const freqKHz = freqHz / 1000;
    return `Mkr1 ${freqKHz.toFixed(2)} kHz ${ampDbm.toFixed(1)} dBm`;
}

function buildRenderedData(
    frequenciesHz: number[],
    amplitudesDbm: number[],
    maxHoldDbm: number[],
    averageDbm: number[],
    thresholdDbm: number,
): RenderedSpectrumData {
    const count = Math.min(frequenciesHz.length, amplitudesDbm.length);
    const filteredFrequenciesHz: number[] = [];
    const filteredAmplitudesDbm: number[] = [];
    const filteredMaxHoldDbm: Array<number | null> = [];
    const filteredAverageDbm: Array<number | null> = [];

    for (let i = 0; i < count; i += 1) {
        const freqHz = frequenciesHz[i];
        const ampDbm = amplitudesDbm[i];
        if (!Number.isFinite(freqHz) || !Number.isFinite(ampDbm)) continue;
        // 仅保留 0-10kHz 的频段，避免越界数据影响显示
        if (freqHz < 0 || freqHz > 10_000) continue;
        filteredFrequenciesHz.push(freqHz);
        filteredAmplitudesDbm.push(ampDbm)

        const maxHoldValue = maxHoldDbm[i];
        filteredMaxHoldDbm.push(
            Number.isFinite(maxHoldValue) ? maxHoldValue : null,
        );

        const averageValue = averageDbm[i];
        filteredAverageDbm.push(
            Number.isFinite(averageValue) ? averageValue : null,
        );
    }

    // 如果数据为空，提供默认占位数据（两个点），避免 uPlot 初始化失败
    if (filteredFrequenciesHz.length === 0) {
        const defaultX = [0, 10]; // kHz
        const defaultY = [-100, -100]; // dBm（底噪）
        const defaultMaxHold = [-100, -100];
        const defaultAverage = [-100, -100];
        const defaultThreshold = [thresholdDbm, thresholdDbm];
        return {
            frequenciesHz: [0, 10000],
            amplitudesDbm: defaultY,
            alignedData: [
                defaultX,
                defaultY,
                defaultMaxHold,
                defaultAverage,
                defaultThreshold,
            ],
        };
    }

    const xDataKHz = filteredFrequenciesHz.map((freqHz) => freqHz / 1000);
    const thresholdLine = xDataKHz.map(() => thresholdDbm);

    const alignedData: uPlot.AlignedData = [
        xDataKHz,
        filteredAmplitudesDbm,
        filteredMaxHoldDbm,
        filteredAverageDbm,
        thresholdLine,
    ];

    return {
        frequenciesHz: filteredFrequenciesHz,
        amplitudesDbm: filteredAmplitudesDbm,
        alignedData,
    };
}

function xAxisValues(_u: uPlot, splits: number[]): string[] {
    return splits.map((value) => value.toFixed(0));
}

export default function SpectrumChart(props: SpectrumChartProps) {
    const { t } = useTranslation();
    const theme = useAppStore((s) => s.theme);
    const scaleFactor = useCanvasScale(16);
    const { status: initStatus, error: initError, retryToken, run, retry } =
        useChartInit();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const uplotRef = useRef<uPlot | null>(null);
    const renderedRef = useRef<RenderedSpectrumData | null>(null);
    const initStatusRef = useRef(initStatus);
    const onMarkerChangeRef = useRef<SpectrumChartProps["onMarkerChange"]>(
        props.onMarkerChange,
    );
    const latestDataRef = useRef({
        frequencies: props.frequencies,
        amplitudes: props.amplitudes,
        maxHoldData: props.maxHoldData,
        averageData: props.averageData,
        threshold: props.threshold,
    });

    const [markerText, setMarkerText] = useState<string | null>(null);
    const lastEmittedMarkerRef = useRef<{ freq: number; amp: number } | null>(
        null,
    );

    useEffect(() => {
        initStatusRef.current = initStatus;
    }, [initStatus]);

    onMarkerChangeRef.current = props.onMarkerChange;
    latestDataRef.current.frequencies = props.frequencies;
    latestDataRef.current.amplitudes = props.amplitudes;
    latestDataRef.current.maxHoldData = props.maxHoldData;
    latestDataRef.current.averageData = props.averageData;
    latestDataRef.current.threshold = props.threshold;

    const statusText = useMemo(() => {
        const parts: string[] = [];
        if (props.isPaused) {
            parts.push(t("monitor.spectrumAnalyzer.controls.pause"));
        }
        parts.push(
            `${t("monitor.spectrumAnalyzer.settings.threshold")} ${props.threshold.toFixed(0)} dBm`,
        );
        return parts.join(" · ");
    }, [props.isPaused, props.threshold, t]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let disposed = false;
        const observer = new ResizeObserver((entries) => {
            if (disposed) return;
            const entry = entries[0];
            if (!entry) return;

            const nextWidth = Math.floor(entry.contentRect.width);
            const nextHeight = Math.floor(entry.contentRect.height);
            if (nextWidth <= 0 || nextHeight <= 0) return;

            const existing = uplotRef.current;
            if (existing) {
                existing.setSize({ width: nextWidth, height: nextHeight });
                return;
            }

            // 若初始化已失败，等待用户点击“重试”，避免在 ResizeObserver 回调中无限重试
            if (initStatusRef.current === "error") return;

            const computed = getComputedStyle(container);
            const axisStroke = readCssVar(
                computed,
                "--text-secondary",
                "rgba(180, 200, 230, 0.9)",
            );
            const gridStroke = readCssVar(
                computed,
                "--border-subtle",
                "rgba(100, 150, 200, 0.2)",
            );
            const tickStroke = readCssVar(
                computed,
                "--border-color",
                "rgba(100, 150, 200, 0.3)",
            );

            const warningBase = readCssVar(
                computed,
                "--color-warning",
                "#ffcc00",
            );
            const processingBase = readCssVar(
                computed,
                "--color-processing",
                "#0ea5e9",
            );
            const attentionBase = readCssVar(
                computed,
                "--color-attention",
                "#22c55e",
            );
            const alarmBase = readCssVar(computed, "--color-alarm", "#ff3b3b");

            const thresholdStroke = withAlpha(
                alarmBase,
                0.75,
                "rgba(255, 80, 80, 0.75)",
            );
            const fillBottom = withAlpha(
                processingBase,
                0.25,
                "rgba(0, 50, 150, 0.3)",
            );
            const fillMid1 = withAlpha(
                attentionBase,
                0.35,
                "rgba(0, 255, 200, 0.5)",
            );
            const fillMid2 = withAlpha(
                warningBase,
                0.55,
                "rgba(255, 255, 0, 0.7)",
            );
            const fillTop = withAlpha(
                alarmBase,
                0.85,
                "rgba(255, 50, 50, 0.9)",
            );

            const safeScaleFactor =
                Number.isFinite(scaleFactor) && scaleFactor > 0
                    ? scaleFactor
                    : 1;
            const px = (value: number) => Math.round(value * safeScaleFactor);
            const lw = (value: number) => value * safeScaleFactor;
            const axisFontSize = px(12);

            const opts: uPlot.Options = {
                width: nextWidth,
                height: nextHeight,
                scales: {
                    x: { time: false, range: [0, 10] },
                    y: { range: [-100, 0] },
                },
                series: [
                    {},
                    {
                        label: "Spectrum",
                        stroke: warningBase,
                        width: lw(2),
                        points: { show: false },
                        fill: (u, seriesIdx) => {
                            void seriesIdx;
                            // 检查 bbox 是否有效，避免 NaN 导致 createLinearGradient 报错
                            const bboxTop = u.bbox.top;
                            const bboxHeight = u.bbox.height;
                            if (
                                !Number.isFinite(bboxTop) ||
                                !Number.isFinite(bboxHeight) ||
                                bboxHeight <= 0
                            ) {
                                return fillBottom;
                            }
                            const ctx = u.ctx;
                            const gradient = ctx.createLinearGradient(
                                0,
                                bboxTop + bboxHeight,
                                0,
                                bboxTop,
                            );
                            gradient.addColorStop(0, fillBottom);
                            gradient.addColorStop(0.4, fillMid1);
                            gradient.addColorStop(0.7, fillMid2);
                            gradient.addColorStop(1, fillTop);
                            return gradient;
                        },
                    },
                    {
                        label: "Max Hold",
                        stroke: warningBase,
                        width: lw(1.5),
                        dash: [px(4), px(4)],
                        points: { show: false },
                        show: props.showMaxHold,
                    },
                    {
                        label: "Average",
                        stroke: processingBase,
                        width: lw(1.5),
                        points: { show: false },
                        show: props.showAverage,
                    },
                    {
                        label: "Threshold",
                        stroke: thresholdStroke,
                        width: lw(1),
                        dash: [px(6), px(6)],
                        points: { show: false },
                    },
                ],
                axes: [
                    {
                        stroke: axisStroke,
                        grid: { stroke: gridStroke },
                        ticks: { stroke: tickStroke },
                        size: px(40),
                        font: `${axisFontSize}px system-ui, sans-serif`,
                        label: "kHz",
                        values: xAxisValues,
                    },
                    {
                        stroke: axisStroke,
                        grid: { stroke: gridStroke },
                        ticks: { stroke: tickStroke },
                        size: px(60),
                        font: `${axisFontSize}px system-ui, sans-serif`,
                        label: "dBm",
                    },
                ],
                cursor: {
                    show: true,
                    x: true,
                    y: true,
                    drag: { x: false, y: false },
                    points: { show: false },
                },
                hooks: {
                    setCursor: [
                        (u) => {
                            const idx = u.cursor.idx;
                            if (idx == null) {
                                if (lastEmittedMarkerRef.current) {
                                    lastEmittedMarkerRef.current = null;
                                    onMarkerChangeRef.current?.(null);
                                    setMarkerText(null);
                                }
                                return;
                            }

                            const rendered = renderedRef.current;
                            if (!rendered) return;

                            if (idx < 0 || idx >= rendered.frequenciesHz.length)
                                return;

                            const freqHz = rendered.frequenciesHz[idx];
                            const ampDbm = rendered.amplitudesDbm[idx];
                            if (
                                !Number.isFinite(freqHz) ||
                                !Number.isFinite(ampDbm)
                            )
                                return;

                            const nextMarker = { freq: freqHz, amp: ampDbm };
                            const prevMarker = lastEmittedMarkerRef.current;
                            if (
                                !prevMarker ||
                                prevMarker.freq !== nextMarker.freq ||
                                prevMarker.amp !== nextMarker.amp
                            ) {
                                lastEmittedMarkerRef.current = nextMarker;
                                onMarkerChangeRef.current?.(nextMarker);
                            }

                            setMarkerText(formatMarkerText(freqHz, ampDbm));
                        },
                    ],
                },
            };

            const initialRendered = buildRenderedData(
                latestDataRef.current.frequencies,
                latestDataRef.current.amplitudes,
                latestDataRef.current.maxHoldData,
                latestDataRef.current.averageData,
                latestDataRef.current.threshold,
            );

            renderedRef.current = initialRendered;
            const result = run(
                () => new uPlot(opts, initialRendered.alignedData, container),
            );
            if (!result.ok || !result.value) return;
            uplotRef.current = result.value;
        });

        observer.observe(container);

        return () => {
            disposed = true;
            observer.disconnect();
            if (uplotRef.current) {
                uplotRef.current.destroy();
                uplotRef.current = null;
            }
            // uPlot 初始化中途失败时可能留下残余 DOM，这里统一清理
            container.replaceChildren();
        };
    }, [retryToken, run, scaleFactor, theme]);

    useEffect(() => {
        const chart = uplotRef.current;
        if (!chart) return;

        const nextRendered = buildRenderedData(
            props.frequencies,
            props.amplitudes,
            props.maxHoldData,
            props.averageData,
            props.threshold,
        );
        renderedRef.current = nextRendered;
        chart.setData(nextRendered.alignedData);
    }, [
        props.amplitudes,
        props.averageData,
        props.frequencies,
        props.isPaused,
        props.maxHoldData,
        props.threshold,
    ]);

    useEffect(() => {
        const chart = uplotRef.current;
        if (!chart) return;
        chart.setSeries(2, { show: props.showMaxHold });
        chart.setSeries(3, { show: props.showAverage });
    }, [props.showAverage, props.showMaxHold]);

    const handleMouseLeave = () => {
        lastEmittedMarkerRef.current = null;
        onMarkerChangeRef.current?.(null);
        setMarkerText(null);
    };

    const handleRetryInit = useCallback(() => {
        if (uplotRef.current) {
            uplotRef.current.destroy();
            uplotRef.current = null;
        }
        const container = containerRef.current;
        container?.replaceChildren();
        retry();
    }, [retry]);

    return (
        <div className={styles.root} onMouseLeave={handleMouseLeave}>
            {initStatus === "error" && (
                <div
                    role="alert"
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                        background: "var(--overlay-weak)",
                        zIndex: 1,
                    }}
                >
                    <div
                        style={{
                            maxWidth: 520,
                            padding: 16,
                            borderRadius: 12,
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-panel)",
                            color: "var(--text-primary)",
                        }}
                    >
                        <div style={{ fontWeight: 700 }}>
                            {t("dialog.error")}
                        </div>
                        <div
                            style={{
                                marginTop: 8,
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                whiteSpace: "pre-wrap",
                            }}
                        >
                            {initError ?? "--"}
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <button
                                type="button"
                                onClick={handleRetryInit}
                            >
                                {t("common.retry")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className={styles.chart} ref={containerRef} />
            <div className={styles.markerInfo}>
                {markerText ?? "Mkr1 -- kHz -- dBm"}
            </div>
            <div className={styles.statusBar}>{statusText}</div>
        </div>
    );
}
