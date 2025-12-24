/**
 * 监控视图 - 频谱监测与分析
 *
 * 设计目标：
 * - 将 Monitor 视图拆分为可独立测试的子组件（SpectrumAnalyzer / WaterfallChart / AlarmList）
 * - Tabs 默认 keepMounted，因此子组件需通过 isActive 控制后台订阅与绘制，避免资源浪费
 *
 * 子页说明：
 * - Overview：瀑布图（WaterfallChart）+ 快速告警列表（AlarmList）
 * - Info：监控说明
 * - SpectrumAnalyzer：专业频谱分析仪（uPlot）
 *
 * @module Monitor
 */

import {
    lazy,
    Suspense,
    useMemo,
    useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ErrorBoundary, StatusIndicator, Tabs } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useRegisterViewCommands } from "@/components/layout/ViewCommandContext";
import { useRegisterSubViewCommands } from "@/components/layout/SubViewCommandContext";
import { useNotify } from "@/hooks";
import { useSpectrumAnalyzerStore } from "@/stores";
import { MonitorInfo } from "./MonitorInfo";
import { AlarmList } from "./AlarmList";
import { WaterfallChart } from "./WaterfallChart";
import styles from "../shared.module.css";

// 懒加载频谱分析仪组件（包含 uPlot 库，避免影响主页面加载）
const SpectrumAnalyzer = lazy(() => import("./SpectrumAnalyzer"));

export default function MonitorView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { success, warning, info, error: notifyError } = useNotify();

    // 视图命令配置（刷新、暂停、导出）
    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(
                        t("notification.dataRefreshed"),
                        t("notification.sensorDataUpdated"),
                    ),
            },
            {
                id: "pause",
                labelKey: "common.pause",
                onClick: () =>
                    warning(
                        t("notification.monitoringPaused"),
                        t("notification.dataCollectionPaused"),
                    ),
            },
            {
                id: "export",
                labelKey: "monitor.exportData",
                onClick: () =>
                    success(
                        t("notification.exportComplete"),
                        t("notification.dataExportedToFile"),
                    ),
            },
        ],
        [info, success, t, warning],
    );

    useRegisterViewCommands("monitor", commands, isViewActive);

    const [activeTab, setActiveTab] = useState<
        "overview" | "info" | "spectrum-analyzer"
    >("overview");

    const isSpectrumAnalyzerTabActive =
        isViewActive && activeTab === "spectrum-analyzer";

    const spectrumAnalyzerPaused = useSpectrumAnalyzerStore((s) => s.isPaused);
    const spectrumAnalyzerShowMaxHold = useSpectrumAnalyzerStore(
        (s) => s.showMaxHold,
    );
    const spectrumAnalyzerShowAverage = useSpectrumAnalyzerStore(
        (s) => s.showAverage,
    );
    const setSpectrumAnalyzerPaused = useSpectrumAnalyzerStore(
        (s) => s.setIsPaused,
    );
    const setSpectrumAnalyzerShowMaxHold = useSpectrumAnalyzerStore(
        (s) => s.setShowMaxHold,
    );
    const setSpectrumAnalyzerShowAverage = useSpectrumAnalyzerStore(
        (s) => s.setShowAverage,
    );
    const resetSpectrumAnalyzerMaxHold = useSpectrumAnalyzerStore(
        (s) => s.resetMaxHold,
    );
    const resetSpectrumAnalyzerAverage = useSpectrumAnalyzerStore(
        (s) => s.resetAverage,
    );

    const spectrumAnalyzerSubCommands = useMemo<CommandButtonConfig[]>(() => {
        if (!isSpectrumAnalyzerTabActive) return [];

        return [
            {
                id: spectrumAnalyzerPaused ? "start" : "pause",
                labelKey: spectrumAnalyzerPaused
                    ? "monitor.spectrumAnalyzer.controls.resume"
                    : "monitor.spectrumAnalyzer.controls.pause",
                highlight: spectrumAnalyzerPaused ? "warning" : "none",
                onClick: () => setSpectrumAnalyzerPaused(!spectrumAnalyzerPaused),
            },
            {
                id: "spectrumMaxHold",
                labelKey: "monitor.spectrumAnalyzer.controls.maxHold",
                highlight: spectrumAnalyzerShowMaxHold ? "attention" : "none",
                behavior: "toggle",
                onClick: () =>
                    setSpectrumAnalyzerShowMaxHold(!spectrumAnalyzerShowMaxHold),
            },
            {
                id: "spectrumAverage",
                labelKey: "monitor.spectrumAnalyzer.controls.average",
                highlight: spectrumAnalyzerShowAverage ? "attention" : "none",
                behavior: "toggle",
                onClick: () =>
                    setSpectrumAnalyzerShowAverage(!spectrumAnalyzerShowAverage),
            },
            {
                id: "reset",
                labelKey: "monitor.spectrumAnalyzer.controls.reset",
                highlight: "warning",
                onClick: () => {
                    resetSpectrumAnalyzerMaxHold();
                    resetSpectrumAnalyzerAverage();
                },
            },
        ];
    }, [
        isSpectrumAnalyzerTabActive,
        resetSpectrumAnalyzerAverage,
        resetSpectrumAnalyzerMaxHold,
        setSpectrumAnalyzerPaused,
        setSpectrumAnalyzerShowAverage,
        setSpectrumAnalyzerShowMaxHold,
        spectrumAnalyzerPaused,
        spectrumAnalyzerShowAverage,
        spectrumAnalyzerShowMaxHold,
    ]);

    useRegisterSubViewCommands(
        "monitor",
        spectrumAnalyzerSubCommands,
        isSpectrumAnalyzerTabActive,
    );

    return (
        <div className={styles.view}>
            <Tabs
                activeId={activeTab}
                onChange={setActiveTab}
                tabs={[
                    {
                        id: "overview",
                        label: t("common.tabs.overview"),
                        content: (
                            <ErrorBoundary
                                resetKeys={[activeTab]}
                                onError={(err) =>
                                    notifyError("子视图渲染失败", err.message)
                                }
                                fallback={({ error, reset }) => (
                                    <div style={{ padding: 16 }}>
                                        <StatusIndicator
                                            status="alarm"
                                            label="子视图渲染失败"
                                        />
                                        <p
                                            style={{
                                                marginTop: 8,
                                                color: "var(--text-secondary)",
                                            }}
                                        >
                                            已进入降级模式。你可以点击“重试”或切换到其他标签页。
                                        </p>
                                        <button
                                            type="button"
                                            onClick={reset}
                                        >
                                            {t("common.retry")}
                                        </button>
                                        <details style={{ marginTop: 12 }}>
                                            <summary>查看错误详情</summary>
                                            <pre
                                                style={{
                                                    marginTop: 8,
                                                    whiteSpace: "pre-wrap",
                                                    color: "var(--text-secondary)",
                                                }}
                                            >
                                                {error.stack ?? error.message}
                                            </pre>
                                        </details>
                                    </div>
                                )}
                            >
                                <div
                                    style={{
                                        height: "100%",
                                        minHeight: 0,
                                        display: "grid",
                                        gridTemplateColumns:
                                            "minmax(0, 2fr) minmax(0, 1fr)",
                                        gap: "var(--sp-md)",
                                    }}
                                >
                                    <div style={{ minHeight: 0 }}>
                                        <WaterfallChart
                                            isActive={activeTab === "overview"}
                                        />
                                    </div>
                                    <div
                                        style={{
                                            minHeight: 0,
                                            overflow: "auto",
                                            paddingRight: 2,
                                        }}
                                    >
                                        <AlarmList />
                                    </div>
                                </div>
                            </ErrorBoundary>
                        ),
                    },
                    {
                        id: "info",
                        label: t("common.tabs.info"),
                        content: (
                            <ErrorBoundary
                                resetKeys={[activeTab]}
                                onError={(err) =>
                                    notifyError("子视图渲染失败", err.message)
                                }
                                fallback={({ error, reset }) => (
                                    <div style={{ padding: 16 }}>
                                        <StatusIndicator
                                            status="alarm"
                                            label="子视图渲染失败"
                                        />
                                        <p
                                            style={{
                                                marginTop: 8,
                                                color: "var(--text-secondary)",
                                            }}
                                        >
                                            已进入降级模式。你可以点击“重试”或切换到其他标签页。
                                        </p>
                                        <button
                                            type="button"
                                            onClick={reset}
                                        >
                                            {t("common.retry")}
                                        </button>
                                        <details style={{ marginTop: 12 }}>
                                            <summary>查看错误详情</summary>
                                            <pre
                                                style={{
                                                    marginTop: 8,
                                                    whiteSpace: "pre-wrap",
                                                    color: "var(--text-secondary)",
                                                }}
                                            >
                                                {error.stack ?? error.message}
                                            </pre>
                                        </details>
                                    </div>
                                )}
                            >
                                <MonitorInfo />
                            </ErrorBoundary>
                        ),
                    },
                    {
                        id: "spectrum-analyzer",
                        label: t("monitor.spectrumAnalyzer.title"),
                        content: (
                            <ErrorBoundary
                                resetKeys={[activeTab]}
                                onError={(err) =>
                                    notifyError("子视图渲染失败", err.message)
                                }
                                fallback={({ error, reset }) => (
                                    <div style={{ padding: 16 }}>
                                        <StatusIndicator
                                            status="alarm"
                                            label="子视图渲染失败"
                                        />
                                        <p
                                            style={{
                                                marginTop: 8,
                                                color: "var(--text-secondary)",
                                            }}
                                        >
                                            已进入降级模式。你可以点击“重试”或切换到其他标签页。
                                        </p>
                                        <button
                                            type="button"
                                            onClick={reset}
                                        >
                                            {t("common.retry")}
                                        </button>
                                        <details style={{ marginTop: 12 }}>
                                            <summary>查看错误详情</summary>
                                            <pre
                                                style={{
                                                    marginTop: 8,
                                                    whiteSpace: "pre-wrap",
                                                    color: "var(--text-secondary)",
                                                }}
                                            >
                                                {error.stack ?? error.message}
                                            </pre>
                                        </details>
                                    </div>
                                )}
                            >
                                <Suspense
                                    fallback={
                                        <div
                                            style={{
                                                padding: 16,
                                                display: "flex",
                                                justifyContent: "center",
                                                alignItems: "center",
                                                height: "100%",
                                            }}
                                        >
                                            <StatusIndicator
                                                status="processing"
                                                label={t("monitor.status.loading")}
                                            />
                                        </div>
                                    }
                                >
                                    <SpectrumAnalyzer
                                        isActive={
                                            activeTab === "spectrum-analyzer"
                                        }
                                    />
                                </Suspense>
                            </ErrorBoundary>
                        ),
                    },
                ]}
            />
        </div>
    );
}
