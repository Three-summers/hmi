/**
 * 文件视图 - 文件管理与数据查看
 *
 * 提供文件浏览、数据文件查看、图表绘制等功能。
 * 核心特性：
 * - 文件浏览器：目录树导航
 * - 数据文件查看：支持 CSV/TXT 等格式
 * - 图表绘制：基于 uPlot 绘制 CSV 时间序列图
 *
 * 结构拆分（T02）：
 * - FileTreePanel：左侧文件树渲染
 * - FilePreviewPanel：右侧预览渲染（文本/CSV）
 * - ChartPanel：CSV 图表区域渲染
 * - useFileTree/useFilePreview/useChartData：状态与副作用
 *
 * @module Files
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "uplot/dist/uPlot.min.css";
import { useAppStore } from "@/stores";
import { Tabs } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useRegisterViewCommands } from "@/components/layout/ViewCommandContext";
import { FILES_CONFIG } from "@/constants";
import {
    useCanvasScale,
    useChartData,
    useFilePreview,
    useFileTree,
    useNotify,
} from "@/hooks";
import styles from "../shared.module.css";
import filesStyles from "./Files.module.css";
import { FileTreePanel } from "./FileTreePanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
export default function FilesView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { info } = useNotify();
    const theme = useAppStore((s) => s.theme);
    const scaleFactor = useCanvasScale(16);
    const [activeTab, setActiveTab] = useState<"overview" | "info">("overview");

    const fileTree = useFileTree(t);
    const { preview, selectFile, retryPreview } = useFilePreview(t);

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "refresh",
                labelKey: "common.refresh",
                disabled: fileTree.treeLoading || preview.loading,
                onClick: () => {
                    fileTree.retryTree();
                    void retryPreview();
                    info(
                        t("notification.helpRefreshed"),
                        t("notification.fileListRefreshed"),
                    );
                },
            },
        ],
        [
            fileTree.retryTree,
            fileTree.treeLoading,
            info,
            preview.loading,
            retryPreview,
            t,
        ],
    );

    useRegisterViewCommands("files", commands, isViewActive);

    const charts = useChartData({
        csvData: preview.csvData,
        theme,
        scaleFactor,
        isChartsVisible: isViewActive && activeTab === "overview",
    });

    const showMoreText = preview.csvData
        ? t("files.showMore", {
              count: Math.max(
                  0,
                  preview.csvData.headers.length -
                      1 -
                      FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
              ),
          })
        : "";

    const chartProps = preview.csvData
        ? {
              visibleCharts: charts.visibleCharts,
              enabledColumns: charts.enabledColumns,
              sortedEnabledColumns: charts.sortedEnabledColumns,
              hasMoreCharts: charts.hasMoreCharts,
              chartColors: charts.chartColors,
              chartError: charts.chartError,
              onRetryCharts: charts.retryCharts,
              enlargedColumn: charts.enlargedColumn,
              enlargedChartRef: charts.enlargedChartRef,
              enlargedChartError: charts.enlargedChartError,
              onRetryEnlargedChart: charts.retryEnlargedChart,
              onToggleColumn: charts.toggleColumn,
              onShowMoreCharts: charts.showMoreCharts,
              onShowLessCharts: charts.showLessCharts,
              onSetChartRef: charts.setChartRef,
              onOpenEnlargedChart: (colIndex: number) =>
                  charts.setEnlargedColumn(colIndex),
              onCloseEnlargedChart: charts.closeEnlargedChart,
              onResetEnlargedZoom: charts.resetEnlargedZoom,
          }
        : null;

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
                            <>
                                <div className={filesStyles.container}>
                                    <FileTreePanel
                                        headerText={t("files.logFolder")}
                                        items={fileTree.visibleItems}
                                        selectedPath={preview.selectedFilePath}
                                        treeLoading={fileTree.treeLoading}
                                        treeError={fileTree.treeError}
                                        loadingText={t("files.loading")}
                                        emptyText={t("files.empty")}
                                        retryText={t("common.retry")}
                                        retryDisabled={fileTree.treeLoading}
                                        onRetry={fileTree.retryTree}
                                        onToggleDirectory={fileTree.toggleDirectory}
                                        onSelectFile={selectFile}
                                    />

                                    <FilePreviewPanel
                                        preview={preview}
                                        selectFileText={t("files.selectFile")}
                                        loadingText={t("files.loading")}
                                        retryText={t("common.retry")}
                                        retryDisabled={preview.loading}
                                        onRetryPreview={retryPreview}
                                        showMoreText={showMoreText}
                                        showLessText={t("files.showLess")}
                                        resetText={t("common.reset")}
                                        closeText={t("common.close")}
                                        zoomHintText={t("files.chart.zoomHint")}
                                        chartInitErrorText={t(
                                            "files.chart.initError",
                                        )}
                                        chartEmptyDataText={t(
                                            "files.chart.emptyData",
                                        )}
                                        chartEmptySelectionText={t(
                                            "files.chart.emptySelection",
                                        )}
                                        chartProps={chartProps}
                                    />
                                </div>
                            </>
                        ),
                    },
                    {
                        id: "info",
                        label: t("common.tabs.info"),
                        content: (
                            <div className={filesStyles.filesInfo}>
                                <h3 className={filesStyles.filesInfoTitle}>
                                    {t("files.title")}
                                </h3>
                                <ul className={filesStyles.filesInfoList}>
                                    <li>{t("files.selectFile")}</li>
                                    <li>{t("files.info.zoomTip")}</li>
                                    <li>{t("files.info.refreshTip")}</li>
                                </ul>
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
