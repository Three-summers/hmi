import { useTranslation } from "react-i18next";
import { StatusIndicator } from "@/components/common";
import sharedStyles from "../shared.module.css";
import monitorStyles from "./Monitor.module.css";

/** 频谱状态（用于 UI 显示） */
type SpectrumStatus = "unavailable" | "loading" | "ready" | "error";

/** 频谱统计信息 */
interface SpectrumStats {
    peak_frequency: number;
    peak_amplitude: number;
    average_amplitude: number;
    bandwidth: number;
}

/** 监控概览组件属性 */
export interface MonitorOverviewProps {
    /** 频谱统计数据 */
    stats: SpectrumStats;
    /** 显示模式（柱状图/填充/线条） */
    displayMode: "bars" | "fill" | "line";
    /** 切换显示模式回调 */
    onChangeDisplayMode: (mode: "bars" | "fill" | "line") => void;
    /** 是否暂停 */
    isPaused: boolean;
    /** 切换暂停回调 */
    onTogglePaused: () => void;
    /** 清空数据回调 */
    onClearData: () => void;
    /** 频谱状态 */
    spectrumStatus: SpectrumStatus;
    /** 频谱错误信息 */
    spectrumError: string | null;
    /** 重试回调 */
    onRetrySpectrum: () => void;
    /** Canvas 容器引用 */
    containerRef: React.RefObject<HTMLDivElement>;
    /** Canvas 元素引用 */
    canvasRef: React.RefObject<HTMLCanvasElement>;
}

/**
 * Monitor 概览子页（拆分自 Monitor/index.tsx）
 *
 * 设计说明：
 * - 保留所有状态与副作用在父组件，仅在此处负责渲染与触发回调，降低拆分回归风险
 * - 展示三个统计卡片：峰值频率、峰值幅度、带宽
 * - 实时频谱图（Canvas 绘制，由父组件控制）
 * - 控制面板：显示模式切换、暂停/恢复、清空数据
 */
export function MonitorOverview({
    stats,
    displayMode,
    onChangeDisplayMode,
    isPaused,
    onTogglePaused,
    onClearData,
    spectrumStatus,
    spectrumError,
    onRetrySpectrum,
    containerRef,
    canvasRef,
}: MonitorOverviewProps) {
    const { t } = useTranslation();

    // 格式化频率显示（Hz -> kHz）
    const formatFrequency = (freq: number) => {
        if (freq >= 1000) {
            return `${(freq / 1000).toFixed(2)} kHz`;
        }
        return `${freq.toFixed(0)} Hz`;
    };

    return (
        <>
            <div className={monitorStyles.statsGrid}>
                <div className={monitorStyles.statCard} data-type="peak-freq">
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status="normal"
                        >
                            {t("monitor.badges.peak")}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>
                        {t("monitor.stats.peakFrequency")}
                    </span>
                    <span className={monitorStyles.statValue}>
                        {formatFrequency(stats.peak_frequency)}
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>
                            {t("monitor.stats.centerFrequencyAnalysis")}
                        </span>
                    </div>
                </div>

                <div className={monitorStyles.statCard} data-type="peak-amp">
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status={
                                stats.peak_amplitude > -30
                                    ? "warning"
                                    : "normal"
                            }
                        >
                            {stats.peak_amplitude > -30
                                ? t("monitor.badges.high")
                                : t("monitor.badges.normal")}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>
                        {t("monitor.stats.peakAmplitude")}
                    </span>
                    <span className={monitorStyles.statValue}>
                        {stats.peak_amplitude.toFixed(1)} dB
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>{t("monitor.stats.signalStrength")}</span>
                    </div>
                </div>

                <div className={monitorStyles.statCard} data-type="bandwidth">
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 5v14h18V5H3zm16 12H5V7h14v10zM7 9h2v6H7zm4 0h2v6h-2zm4 0h2v6h-2z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status="normal"
                        >
                            {t("monitor.badges.bandwidth")}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>
                        {t("monitor.stats.bandwidth")}
                    </span>
                    <span className={monitorStyles.statValue}>
                        {formatFrequency(stats.bandwidth)}
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>
                            {t("monitor.stats.averageAmplitude", {
                                value: stats.average_amplitude.toFixed(1),
                            })}
                        </span>
                    </div>
                </div>
            </div>

            <div className={monitorStyles.chartContainer}>
                <div className={monitorStyles.chartHeader}>
                    <div className={monitorStyles.chartTitle}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
                        </svg>
                        {t("monitor.spectrum.title")}
                    </div>
                    <div className={monitorStyles.chartControls}>
                        <div className={monitorStyles.timeRangeGroup}>
                            {(["fill", "bars", "line"] as const).map(
                                (mode) => (
                                    <button
                                        key={mode}
                                        className={monitorStyles.timeRangeBtn}
                                        data-active={displayMode === mode}
                                        onClick={() =>
                                            onChangeDisplayMode(mode)
                                        }
                                    >
                                        {mode === "fill"
                                            ? t("monitor.displayMode.fill")
                                            : mode === "bars"
                                              ? t("monitor.displayMode.bars")
                                              : t("monitor.displayMode.line")}
                                    </button>
                                ),
                            )}
                        </div>
                        <button
                            className={monitorStyles.controlBtn}
                            data-active={isPaused}
                            onClick={onTogglePaused}
                        >
                            {isPaused ? (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                </svg>
                            )}
                            {isPaused ? t("common.resume") : t("common.pause")}
                        </button>
                        <button
                            className={monitorStyles.controlBtn}
                            onClick={onClearData}
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                            {t("common.clear")}
                        </button>
                    </div>
                </div>
                <div ref={containerRef} className={monitorStyles.chart}>
                    {spectrumStatus === "ready" ? (
                        <canvas
                            ref={canvasRef}
                            className={monitorStyles.spectrumCanvas}
                        />
                    ) : (
                        <div
                            className={sharedStyles.emptyState}
                            style={{ height: "100%" }}
                        >
                            <StatusIndicator
                                status={
                                    spectrumStatus === "error"
                                        ? "alarm"
                                        : spectrumStatus === "unavailable"
                                          ? "idle"
                                          : "processing"
                                }
                                label={
                                    spectrumStatus === "error"
                                        ? t("monitor.status.error")
                                        : spectrumStatus === "unavailable"
                                          ? t("monitor.status.unavailable")
                                          : t("monitor.status.loading")
                                }
                            />
                            {spectrumError && (
                                <div
                                    style={{
                                        marginTop: 8,
                                        fontSize: 12,
                                        color: "var(--text-secondary)",
                                        textAlign: "center",
                                        maxWidth: 520,
                                    }}
                                >
                                    {spectrumError}
                                </div>
                            )}
                            {spectrumStatus === "error" && (
                                <button
                                    className={monitorStyles.controlBtn}
                                    onClick={onRetrySpectrum}
                                    style={{ marginTop: 12 }}
                                >
                                    {t("common.retry")}
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className={monitorStyles.chartLegend}>
                    <div
                        className={monitorStyles.legendItem}
                        data-type="spectrum"
                    >
                        <span className={monitorStyles.legendDot} />
                        {t("monitor.legend.spectrumAmplitude")}
                    </div>
                    <div className={monitorStyles.legendItem} data-type="peak">
                        <span className={monitorStyles.legendDot} />
                        {t("monitor.legend.peakMarker")}
                    </div>
                    <div className={monitorStyles.legendItem} data-type="noise">
                        <span className={monitorStyles.legendDot} />
                        {t("monitor.legend.noiseFloor")}
                    </div>
                </div>
            </div>
        </>
    );
}

