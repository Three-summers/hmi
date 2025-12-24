import type { RefObject } from "react";
import { FILES_CONFIG } from "@/constants";
import { StatusIndicator } from "@/components/common";
import type { CsvData } from "@/types";
import { getSeriesColor } from "@/hooks/useChartData";
import filesStyles from "./Files.module.css";

export interface ChartPanelProps {
    title: string;
    csvData: CsvData;
    visibleCharts: number;
    enabledColumns: Set<number>;
    sortedEnabledColumns: number[];
    hasMoreCharts: boolean;
    chartColors: string[];
    enlargedColumn: number | null;
    enlargedChartRef: RefObject<HTMLDivElement>;
    showMoreText: string;
    showLessText: string;
    resetText: string;
    closeText: string;
    zoomHintText: string;
    retryText: string;
    chartInitErrorText: string;
    chartEmptyDataText: string;
    chartEmptySelectionText: string;
    chartError: Error | null;
    onRetryCharts: () => void;
    enlargedChartError: Error | null;
    onRetryEnlargedChart: () => void;
    onToggleColumn: (colIndex: number) => void;
    onShowMoreCharts: () => void;
    onShowLessCharts: () => void;
    onSetChartRef: (colIndex: number, el: HTMLDivElement | null) => void;
    onOpenEnlargedChart: (colIndex: number) => void;
    onCloseEnlargedChart: () => void;
    onResetEnlargedZoom: () => void;
}

/**
 * Files 图表面板（CSV 预览子区域）
 *
 * 设计说明：
 * - 该组件仅负责渲染与事件分发，图表实例生命周期由 useChartData 负责
 */
export function ChartPanel({
    title,
    csvData,
    visibleCharts,
    enabledColumns,
    sortedEnabledColumns,
    hasMoreCharts,
    chartColors,
    enlargedColumn,
    enlargedChartRef,
    showMoreText,
    showLessText,
    resetText,
    closeText,
    zoomHintText,
    retryText,
    chartInitErrorText,
    chartEmptyDataText,
    chartEmptySelectionText,
    chartError,
    onRetryCharts,
    enlargedChartError,
    onRetryEnlargedChart,
    onToggleColumn,
    onShowMoreCharts,
    onShowLessCharts,
    onSetChartRef,
    onOpenEnlargedChart,
    onCloseEnlargedChart,
    onResetEnlargedZoom,
}: ChartPanelProps) {
    const showAll = visibleCharts > FILES_CONFIG.DEFAULT_VISIBLE_CHARTS;

    return (
        <>
            <div className={filesStyles.csvPreview}>
                <div className={filesStyles.csvHeader}>
                    <span className={filesStyles.csvTitle}>{title}</span>
                    <div className={filesStyles.columnToggle}>
                        {csvData.headers
                            .slice(1, visibleCharts + 1)
                            .map((header, idx) => (
                                <button
                                    key={idx + 1}
                                    className={filesStyles.columnBtn}
                                    data-active={enabledColumns.has(idx + 1)}
                                    onClick={() => onToggleColumn(idx + 1)}
                                    style={{
                                        borderColor: getSeriesColor(
                                            idx + 1,
                                            chartColors,
                                        ),
                                    }}
                                >
                                    {header}
                                </button>
                            ))}
                    </div>
                    {hasMoreCharts && (
                        <button
                            className={filesStyles.moreBtn}
                            onClick={showAll ? onShowLessCharts : onShowMoreCharts}
                        >
                            {showAll ? showLessText : showMoreText}
                        </button>
                    )}
                </div>
                <div className={filesStyles.chartsContainer}>
                    {chartError ? (
                        <div className={filesStyles.error}>
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: 12,
                                }}
                            >
                                <StatusIndicator
                                    status="alarm"
                                    label={chartInitErrorText}
                                />
                                <button
                                    className={filesStyles.refreshBtn}
                                    onClick={onRetryCharts}
                                    type="button"
                                >
                                    {retryText}
                                </button>
                                <details style={{ maxWidth: 520 }}>
                                    <summary>查看错误详情</summary>
                                    <pre
                                        style={{
                                            marginTop: 8,
                                            whiteSpace: "pre-wrap",
                                            color: "var(--text-secondary)",
                                        }}
                                    >
                                        {chartError.stack ?? chartError.message}
                                    </pre>
                                </details>
                            </div>
                        </div>
                    ) : csvData.rows.length < 2 ? (
                        <div className={filesStyles.empty}>
                            <StatusIndicator
                                status="idle"
                                label={chartEmptyDataText}
                            />
                        </div>
                    ) : sortedEnabledColumns.length === 0 ? (
                        <div className={filesStyles.empty}>
                            <StatusIndicator
                                status="idle"
                                label={chartEmptySelectionText}
                            />
                        </div>
                    ) : (
                        sortedEnabledColumns.map((colIndex) => (
                            <div
                                key={colIndex}
                                className={filesStyles.chartWrapper}
                                onClick={() => onOpenEnlargedChart(colIndex)}
                                role="button"
                                tabIndex={0}
                            >
                                <div className={filesStyles.chartLabel}>
                                    <span
                                        className={filesStyles.colorDot}
                                        style={{
                                            background: getSeriesColor(
                                                colIndex,
                                                chartColors,
                                            ),
                                        }}
                                    />
                                    {csvData.headers[colIndex]}
                                </div>
                                <div
                                    ref={(el) => onSetChartRef(colIndex, el)}
                                    className={filesStyles.chart}
                                />
                            </div>
                        ))
                    )}
                </div>
            </div>

            {enlargedColumn !== null && (
                <div
                    className={filesStyles.chartModal}
                    onClick={onCloseEnlargedChart}
                    role="dialog"
                    aria-modal="true"
                >
                    <div
                        className={filesStyles.chartModalContent}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={filesStyles.chartModalHeader}>
                            <div className={filesStyles.chartModalTitle}>
                                {csvData.headers[enlargedColumn]}
                            </div>
                            <div className={filesStyles.chartModalActions}>
                                <button
                                    className={filesStyles.chartModalBtn}
                                    onClick={onResetEnlargedZoom}
                                >
                                    {resetText}
                                </button>
                                <button
                                    className={filesStyles.chartModalBtn}
                                    onClick={onCloseEnlargedChart}
                                >
                                    {closeText}
                                </button>
                            </div>
                        </div>
                        <div
                            ref={enlargedChartRef}
                            className={filesStyles.chartModalBody}
                        >
                            {enlargedChartError && (
                                <div className={filesStyles.error}>
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: 12,
                                            padding: 12,
                                        }}
                                    >
                                        <StatusIndicator
                                            status="alarm"
                                            label={chartInitErrorText}
                                        />
                                        <button
                                            className={filesStyles.refreshBtn}
                                            onClick={onRetryEnlargedChart}
                                            type="button"
                                        >
                                            {retryText}
                                        </button>
                                        <details style={{ maxWidth: 560 }}>
                                            <summary>查看错误详情</summary>
                                            <pre
                                                style={{
                                                    marginTop: 8,
                                                    whiteSpace: "pre-wrap",
                                                    color: "var(--text-secondary)",
                                                }}
                                            >
                                                {enlargedChartError.stack ??
                                                    enlargedChartError.message}
                                            </pre>
                                        </details>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className={filesStyles.chartModalHint}>
                            {zoomHintText}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
