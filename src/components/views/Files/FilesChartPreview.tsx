import { useDeferredValue } from "react";
import "uplot/dist/uPlot.min.css";
import { useCanvasScale } from "@/hooks/useCanvasScale";
import { useChartData } from "@/hooks/useChartData";
import { useAppStore } from "@/stores";
import type { CsvData } from "@/types";
import { ChartPanel } from "./ChartPanel";

export interface FilesChartPreviewProps {
    isActive: boolean;
    title: string;
    csvData: CsvData;
    showMoreText: string;
    showLessText: string;
    resetText: string;
    closeText: string;
    zoomHintText: string;
    retryText: string;
    chartInitErrorText: string;
    chartEmptyDataText: string;
    chartEmptySelectionText: string;
}

export default function FilesChartPreview({
    isActive,
    title,
    csvData,
    showMoreText,
    showLessText,
    resetText,
    closeText,
    zoomHintText,
    retryText,
    chartInitErrorText,
    chartEmptyDataText,
    chartEmptySelectionText,
}: FilesChartPreviewProps) {
    const theme = useAppStore((s) => s.theme);
    const scaleFactor = useCanvasScale(16);
    const deferredCsvData = useDeferredValue(csvData);
    const charts = useChartData({
        csvData: deferredCsvData,
        theme,
        scaleFactor,
        isChartsVisible: isActive,
    });

    return (
        <ChartPanel
            title={title}
            csvData={deferredCsvData}
            visibleCharts={charts.visibleCharts}
            enabledColumns={charts.enabledColumns}
            sortedEnabledColumns={charts.sortedEnabledColumns}
            hasMoreCharts={charts.hasMoreCharts}
            chartColors={charts.chartColors}
            chartError={charts.chartError}
            onRetryCharts={charts.retryCharts}
            enlargedColumn={charts.enlargedColumn}
            enlargedChartRef={charts.enlargedChartRef}
            enlargedChartError={charts.enlargedChartError}
            onRetryEnlargedChart={charts.retryEnlargedChart}
            onToggleColumn={charts.toggleColumn}
            onShowMoreCharts={charts.showMoreCharts}
            onShowLessCharts={charts.showLessCharts}
            onSetChartRef={charts.setChartRef}
            onOpenEnlargedChart={charts.setEnlargedColumn}
            onCloseEnlargedChart={charts.closeEnlargedChart}
            onResetEnlargedZoom={charts.resetEnlargedZoom}
            showMoreText={showMoreText}
            showLessText={showLessText}
            resetText={resetText}
            closeText={closeText}
            zoomHintText={zoomHintText}
            retryText={retryText}
            chartInitErrorText={chartInitErrorText}
            chartEmptyDataText={chartEmptyDataText}
            chartEmptySelectionText={chartEmptySelectionText}
        />
    );
}
