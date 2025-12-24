/**
 * Monitor 瀑布图子组件
 *
 * 说明：
 * - 与 SpectrumAnalyzer 解耦：仅负责“瀑布图”本身的订阅与渲染
 * - 数据订阅复用 useSpectrumData，避免重复实现 listen/invoke/错误处理
 * - Tabs 默认 keepMounted，因此通过 isActive 控制后台资源占用
 *
 * @module Monitor/WaterfallChart
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusIndicator } from "@/components/common";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useSpectrumData } from "@/hooks";
import { useSpectrumAnalyzerStore } from "@/stores";
import type { ColorScheme, SpectrumStatus } from "@/types";
import WaterfallCanvas from "./WaterfallCanvas";
import sharedStyles from "../shared.module.css";

export interface WaterfallChartProps {
    /** Tabs 默认 keepMounted，为避免后台占用资源，需要由父组件告知当前是否处于激活状态 */
    isActive: boolean;
}

export interface WaterfallChartViewProps {
    status: SpectrumStatus;
    error: string | null;
    amplitudes: number[];
    threshold: number;
    historyDepth: number;
    isPaused: boolean;
    colorScheme: ColorScheme;
    loadingLabel: string;
    unavailableLabel: string;
    errorLabel: string;
    retryText: string;
    onRetry: () => void;
}

export function WaterfallChartView({
    status,
    error,
    amplitudes,
    threshold,
    historyDepth,
    isPaused,
    colorScheme,
    loadingLabel,
    unavailableLabel,
    errorLabel,
    retryText,
    onRetry,
}: WaterfallChartViewProps) {
    const indicator = useMemo(() => {
        const safeStatus: SpectrumStatus = status;
        return (
            <StatusIndicator
                status={
                    safeStatus === "error"
                        ? "alarm"
                        : safeStatus === "unavailable"
                          ? "idle"
                          : "processing"
                }
                label={
                    safeStatus === "error"
                        ? errorLabel
                        : safeStatus === "unavailable"
                          ? unavailableLabel
                          : loadingLabel
                }
            />
        );
    }, [errorLabel, loadingLabel, status, unavailableLabel]);

    if (status !== "ready") {
        return (
            <div
                className={sharedStyles.emptyState}
                style={{ height: "100%" }}
            >
                {indicator}
                {error && (
                    <div
                        style={{
                            marginTop: 8,
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            textAlign: "center",
                            maxWidth: 520,
                        }}
                    >
                        {error}
                    </div>
                )}
                {status === "error" && (
                    <button
                        type="button"
                        onClick={onRetry}
                        style={{ marginTop: 12 }}
                    >
                        {retryText}
                    </button>
                )}
            </div>
        );
    }

    return (
        <WaterfallCanvas
            amplitudes={amplitudes}
            threshold={threshold}
            historyDepth={historyDepth}
            isPaused={isPaused}
            colorScheme={colorScheme}
        />
    );
}

export function WaterfallChart({ isActive }: WaterfallChartProps) {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const shouldSubscribe = isActive && isViewActive;

    const threshold = useSpectrumAnalyzerStore((s) => s.threshold);
    const historyDepth = useSpectrumAnalyzerStore((s) => s.historyDepth);
    const refreshRate = useSpectrumAnalyzerStore((s) => s.refreshRate);
    const colorScheme = useSpectrumAnalyzerStore((s) => s.colorScheme);
    const isPaused = useSpectrumAnalyzerStore((s) => s.isPaused);

    const [amplitudes, setAmplitudes] = useState<number[]>([]);

    const { status, error, retry } = useSpectrumData({
        enabled: shouldSubscribe,
        isPaused,
        maxHz: refreshRate,
        onFrame: (frame) => {
            setAmplitudes(frame.amplitudes);
        },
    });

    return (
        <WaterfallChartView
            status={status}
            error={error}
            amplitudes={amplitudes}
            threshold={threshold}
            historyDepth={historyDepth}
            isPaused={isPaused}
            colorScheme={colorScheme}
            loadingLabel={t("monitor.status.loading")}
            unavailableLabel={t("monitor.status.unavailable")}
            errorLabel={t("monitor.status.error")}
            retryText={t("common.retry")}
            onRetry={retry}
        />
    );
}
