/**
 * ErrorBoundary 组件
 *
 * 目标：
 * - 捕获“渲染阶段/生命周期”的异常，避免白屏
 * - 支持 resetKeys：关键输入变化时自动恢复（例如视图切换）
 * - 支持 onError：统一错误日志链路（console / 后端桥接 / 通知）
 *
 * @module ErrorBoundary
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export type ErrorBoundaryFallbackRender = (args: {
    /** 捕获到的错误对象 */
    error: Error;
    /** 重试：重置错误状态并重新渲染 children */
    reset: () => void;
}) => ReactNode;

export interface ErrorBoundaryProps {
    children: ReactNode;
    /**
     * 用于触发自动 reset 的关键输入
     *
     * 常见用法：`resetKeys={[currentView]}`，当用户切换视图时自动重试渲染。
     */
    resetKeys?: readonly unknown[];
    /** 手动重试/自动重置时的回调（可用于切换到安全视图等） */
    onReset?: () => void;
    /** 捕获到错误时的回调（用于日志/上报/通知等） */
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    /** 自定义降级 UI 渲染 */
    fallback?: ErrorBoundaryFallbackRender;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

function areResetKeysEqual(
    prevKeys?: readonly unknown[],
    nextKeys?: readonly unknown[],
): boolean {
    const prev = prevKeys ?? [];
    const next = nextKeys ?? [];
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
        if (!Object.is(prev[i], next[i])) return false;
    }
    return true;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false,
        error: null,
    };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // 关键原则：记录问题，但不阻塞其他 UI 正常工作
        console.error("[HMI] 组件渲染异常，已进入降级模式：", error);
        console.error(errorInfo.componentStack);
        this.props.onError?.(error, errorInfo);
    }

    componentDidUpdate(prevProps: Readonly<ErrorBoundaryProps>) {
        // 当关键输入变化时（例如 currentView 切换），自动重置错误状态，尝试恢复渲染
        if (
            this.state.hasError &&
            !areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)
        ) {
            this.reset();
        }
    }

    private reset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        const error = this.state.error ?? new Error("Unknown error");
        const fallback = this.props.fallback?.({
            error,
            reset: this.reset,
        });
        if (fallback) return fallback;

        return (
            <div style={{ padding: "var(--sp-md-rem, 1rem)" }}>
                <h2 style={{ margin: 0 }}>页面渲染失败</h2>
                <p style={{ margin: "var(--sp-sm-rem, 0.75rem) 0 0" }}>
                    已进入降级模式。你可以点击“重试”或切换到其他视图。
                </p>
                <div style={{ marginTop: "var(--sp-sm-rem, 0.75rem)" }}>
                    <button type="button" onClick={this.reset}>
                        重试
                    </button>
                </div>
                <details style={{ marginTop: "var(--sp-sm-rem, 0.75rem)" }}>
                    <summary>查看错误详情</summary>
                    <pre
                        style={{
                            marginTop: "var(--sp-xs-rem, 0.5rem)",
                            whiteSpace: "pre-wrap",
                        }}
                    >
                        {error.stack ?? error.message}
                    </pre>
                </details>
            </div>
        );
    }
}

