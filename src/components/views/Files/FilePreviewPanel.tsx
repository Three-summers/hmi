import { StatusIndicator } from "@/components/common";
import type { PreviewConfig } from "@/types";
import { ChartPanel, type ChartPanelProps } from "./ChartPanel";
import filesStyles from "./Files.module.css";

export interface FilePreviewPanelProps {
    preview: PreviewConfig;
    selectFileText: string;
    loadingText: string;
    retryText: string;
    retryDisabled: boolean;
    onRetryPreview: () => void;
    showMoreText: string;
    showLessText: string;
    resetText: string;
    closeText: string;
    zoomHintText: string;
    chartInitErrorText: string;
    chartEmptyDataText: string;
    chartEmptySelectionText: string;
    chartProps: Omit<
        ChartPanelProps,
        | "csvData"
        | "title"
        | "showMoreText"
        | "showLessText"
        | "resetText"
        | "closeText"
        | "zoomHintText"
        | "retryText"
        | "chartInitErrorText"
        | "chartEmptyDataText"
        | "chartEmptySelectionText"
    > | null;
}

/**
 * Files 右侧预览面板（拆分自 Files/index.tsx）
 */
export function FilePreviewPanel({
    preview,
    selectFileText,
    loadingText,
    retryText,
    retryDisabled,
    onRetryPreview,
    showMoreText,
    showLessText,
    resetText,
    closeText,
    zoomHintText,
    chartInitErrorText,
    chartEmptyDataText,
    chartEmptySelectionText,
    chartProps,
}: FilePreviewPanelProps) {
    if (!preview.selectedFilePath) {
        return (
            <div className={filesStyles.preview}>
                <div className={filesStyles.placeholder}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                    </svg>
                    <StatusIndicator status="idle" label={selectFileText} />
                </div>
            </div>
        );
    }

    if (preview.loading) {
        return (
            <div className={filesStyles.preview}>
                <div className={filesStyles.loading}>
                    <StatusIndicator status="processing" label={loadingText} />
                </div>
            </div>
        );
    }

    if (preview.error) {
        return (
            <div className={filesStyles.preview}>
                <div className={filesStyles.error}>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 12,
                        }}
                    >
                        <StatusIndicator status="alarm" label={preview.error} />
                        <button
                            className={filesStyles.refreshBtn}
                            onClick={onRetryPreview}
                            disabled={retryDisabled}
                            type="button"
                        >
                            {retryText}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (preview.isCsvFile && preview.csvData && chartProps) {
        return (
            <div className={filesStyles.preview}>
                <ChartPanel
                    title={preview.selectedFileName ?? preview.selectedFilePath}
                    csvData={preview.csvData}
                    showMoreText={showMoreText}
                    showLessText={showLessText}
                    resetText={resetText}
                    closeText={closeText}
                    zoomHintText={zoomHintText}
                    retryText={retryText}
                    chartInitErrorText={chartInitErrorText}
                    chartEmptyDataText={chartEmptyDataText}
                    chartEmptySelectionText={chartEmptySelectionText}
                    {...chartProps}
                />
            </div>
        );
    }

    return (
        <div className={filesStyles.preview}>
            <div className={filesStyles.textPreview}>
                <div className={filesStyles.textHeader}>
                    {preview.selectedFileName}
                </div>
                <pre className={filesStyles.textContent}>{preview.content}</pre>
            </div>
        </div>
    );
}
