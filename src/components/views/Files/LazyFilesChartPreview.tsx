import {
    Component,
    Suspense,
    lazy,
    type ErrorInfo,
    type ReactNode,
} from "react";
import { StatusIndicator } from "@/components/common";
import type { FilesChartPreviewProps } from "./FilesChartPreview";
import filesStyles from "./Files.module.css";

const FilesChartPreview = lazy(() => import("./FilesChartPreview"));

interface LazyFilesChartPreviewProps extends FilesChartPreviewProps {
    loadingText: string;
}

interface LocalErrorBoundaryProps {
    children: ReactNode;
    chartInitErrorText: string;
    resetKey: string;
}

interface LocalErrorBoundaryState {
    error: Error | null;
}

class LocalErrorBoundary extends Component<
    LocalErrorBoundaryProps,
    LocalErrorBoundaryState
> {
    state: LocalErrorBoundaryState = {
        error: null,
    };

    static getDerivedStateFromError(error: Error): LocalErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("[HMI] Files chart subtree render failed:", error);
        console.error(errorInfo.componentStack);
    }

    componentDidUpdate(prevProps: Readonly<LocalErrorBoundaryProps>) {
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    render() {
        if (this.state.error) {
            return (
                <div className={filesStyles.error}>
                    <StatusIndicator
                        status="alarm"
                        label={this.props.chartInitErrorText}
                    />
                </div>
            );
        }

        return this.props.children;
    }
}

export function LazyFilesChartPreview({
    loadingText,
    chartInitErrorText,
    title,
    csvData,
    showMoreText,
    showLessText,
    resetText,
    closeText,
    zoomHintText,
    retryText,
    chartEmptyDataText,
    chartEmptySelectionText,
}: LazyFilesChartPreviewProps) {
    const resetKey = `${title}:${csvData.headers.join("|")}:${csvData.rows.length}`;

    return (
        <LocalErrorBoundary
            chartInitErrorText={chartInitErrorText}
            resetKey={resetKey}
        >
            <Suspense
                fallback={
                    <div className={filesStyles.loading}>
                        <StatusIndicator
                            status="processing"
                            label={loadingText}
                        />
                    </div>
                }
            >
                <FilesChartPreview
                    title={title}
                    csvData={csvData}
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
            </Suspense>
        </LocalErrorBoundary>
    );
}
