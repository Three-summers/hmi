/**
 * 主布局组件
 *
 * 负责拼装 HMI 的整体页面框架，包含：
 * - TitlePanel：顶部状态与标题区域
 * - InfoPanel：主视图承载区（支持视图 Keep Alive）
 * - CommandPanel：命令按钮区（随视图变化）
 * - NavPanel：底部主导航
 * - NotificationToast：全局通知 Toast
 *
 * 同时在此处安装全局行为：
 * - 键盘快捷键（useKeyboardShortcuts）
 * - 前端日志桥接（useFrontendLogBridge，可通过设置开关控制）
 * - 主题切换：通过 `data-theme` 驱动 CSS 变量
 *
 * @module MainLayout
 */

import {
    Component,
    memo,
    useCallback,
    useEffect,
    type ErrorInfo,
    type ReactNode,
} from "react";
import { useShallow } from "zustand/shallow";
import { TitlePanel } from "./TitlePanel";
import { InfoPanel } from "./InfoPanel";
import { NavPanel } from "./NavPanel";
import { CommandPanel } from "./CommandPanel";
import { NotificationToast } from "./NotificationToast";
import { ViewCommandProvider } from "./ViewCommandContext";
import { SubViewCommandProvider } from "./SubViewCommandContext";
import { useAlarmStore, useNavigationStore, useAppStore } from "@/stores";
import { useKeyboardShortcuts, useFrontendLogBridge, useHMIScale } from "@/hooks";
import styles from "./MainLayout.module.css";

/**
 * ErrorBoundary：隔离“局部渲染失败”，避免单个视图/组件异常导致整个应用白屏
 *
 * 说明：
 * - React Error Boundary 只能捕获“渲染阶段/生命周期”抛出的错误（render/constructor/componentDidMount 等）
 * - 事件回调/Promise/定时器中的异常不会被捕获（应在业务内部 try/catch 或统一错误上报）
 * - 本实现支持 resetKeys：当关键输入变化（如 currentView 切换）时自动重置错误状态，便于降级恢复
 */
type ErrorBoundaryFallbackRender = (args: {
    /** 捕获到的错误对象 */
    error: Error;
    /** 重试：重置错误状态并重新渲染 children */
    reset: () => void;
}) => ReactNode;

interface ErrorBoundaryProps {
    children: ReactNode;
    /**
     * 用于触发自动 reset 的关键输入
     *
     * 常见用法：`resetKeys={[currentView]}`，当用户切换视图时自动重试渲染。
     */
    resetKeys?: readonly unknown[];
    /** 手动重试/自动重置时的回调（可用于切换到安全视图等） */
    onReset?: () => void;
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

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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

// React.memo：避免 MainLayout 因“主题/布局”等无关变化时，子面板在 props 未变化的情况下重复渲染
const MemoTitlePanel = memo(TitlePanel);
const MemoInfoPanel = memo(InfoPanel);
const MemoCommandPanel = memo(CommandPanel);
const MemoNavPanel = memo(NavPanel);

/**
 * HMI 主布局入口组件
 *
 * @returns 主布局 JSX
 */
export function MainLayout() {
    // 从导航 Store 获取当前视图和切换方法
    // 使用 useShallow 避免无关字段变化导致的重渲染
    const { currentView, setCurrentView } = useNavigationStore(
        useShallow((state) => ({
            currentView: state.currentView,
            setCurrentView: state.setCurrentView,
        })),
    );

    // 从应用 Store 获取命令面板位置和主题配置
    const { commandPanelPosition, theme } = useAppStore(
        useShallow((state) => ({
            commandPanelPosition: state.commandPanelPosition,
            theme: state.theme,
        })),
    );

    // 安装全局键盘快捷键（如 Ctrl+K 打开命令面板）
    useKeyboardShortcuts();

    // 安装前端日志桥接（可选，通过设置开关控制）
    useFrontendLogBridge();

    // 安装 HMI 缩放系统（rem + 动态根字体）
    useHMIScale();

    // 初始化 Demo 告警数据（仅在首次加载且告警为空时）
    useEffect(() => {
        const seedDemoAlarmsIfEmpty = () => {
            const { alarms, addAlarm } = useAlarmStore.getState();
            // 如果已有告警数据，跳过初始化
            if (alarms.length > 0) return;

            // Demo 数据：仅在"告警历史为空"时注入一组示例告警，方便演示 UI 效果。
            addAlarm({
                severity: "alarm",
                message: "Chamber pressure exceeds limit (>100 mTorr)",
            });
            addAlarm({
                severity: "warning",
                message: "Cooling water temperature high (42°C)",
            });
            addAlarm({
                severity: "info",
                message: "Recipe ETCH-001 completed successfully",
            });
            addAlarm({
                severity: "warning",
                message: "Gas flow deviation detected on MFC-3",
            });
            addAlarm({
                severity: "alarm",
                message: "RF power reflected >10% - check matching network",
            });
        };

        // 持久化的告警需要等待 hydration 完成后才能读取到正确数据；
        // 如果 hydration 已完成则直接注入 demo 告警，否则订阅 finish 事件。
        if (useAlarmStore.persist.hasHydrated()) {
            seedDemoAlarmsIfEmpty();
            return;
        }

        // 订阅 hydration 完成事件，确保在持久化数据加载完成后再初始化
        const unsubscribe = useAlarmStore.persist.onFinishHydration(() => {
            seedDemoAlarmsIfEmpty();
        });

        return unsubscribe;
    }, []);

    useEffect(() => {
        // 统一通过 data-theme 切换主题，保持 CSS 变量方案的可扩展性与低侵入性
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    const resetToSafeView = useCallback(() => {
        // 降级策略：当关键视图（尤其是含 Canvas 绘制的 Monitor）发生异常时，
        // 将视图切回一个更“轻量/稳定”的页面，避免用户卡死在错误视图中。
        setCurrentView("jobs");
    }, [setCurrentView]);

    return (
        // 命令 Context 提供者：管理主视图和子视图的命令按钮状态
        <ViewCommandProvider>
            <SubViewCommandProvider>
                <>
                    {/* 主布局容器：通过 data-command-position 控制命令面板位置（left/right） */}
                    <div
                        className={styles.mainLayout}
                        data-command-position={commandPanelPosition}
                    >
                        {/* 顶部标题栏：显示系统状态、消息、快捷操作 */}
                        <div className={styles.titlePanel}>
                            <MemoTitlePanel currentView={currentView} />
                        </div>

                        {/* 主视图区域：支持 Keep-Alive，切换视图时保留状态 */}
                        <div className={styles.infoPanel}>
                            <ErrorBoundary
                                resetKeys={[currentView]}
                                fallback={({ error, reset }) => (
                                    <div
                                        style={{
                                            padding: "var(--sp-md-rem, 1rem)",
                                        }}
                                    >
                                        <h2 style={{ margin: 0 }}>
                                            视图渲染失败（已降级）
                                        </h2>
                                        <p
                                            style={{
                                                margin:
                                                    "var(--sp-sm-rem, 0.75rem) 0 0",
                                            }}
                                        >
                                            当前视图：{currentView}
                                            <br />
                                            可能原因：视图组件异常 / Canvas 绘制环境不支持 / 数据异常等。
                                        </p>
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: "var(--sp-sm-rem, 0.75rem)",
                                                marginTop:
                                                    "var(--sp-sm-rem, 0.75rem)",
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={reset}
                                            >
                                                重试
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    resetToSafeView();
                                                    reset();
                                                }}
                                            >
                                                返回 Jobs
                                            </button>
                                        </div>
                                        <details
                                            style={{
                                                marginTop:
                                                    "var(--sp-sm-rem, 0.75rem)",
                                            }}
                                        >
                                            <summary>查看错误详情</summary>
                                            <pre
                                                style={{
                                                    marginTop:
                                                        "var(--sp-xs-rem, 0.5rem)",
                                                    whiteSpace: "pre-wrap",
                                                }}
                                            >
                                                {error.stack ?? error.message}
                                            </pre>
                                        </details>
                                    </div>
                                )}
                            >
                                <MemoInfoPanel currentView={currentView} />
                            </ErrorBoundary>
                        </div>

                        {/* 命令面板：根据当前视图显示对应的命令按钮 */}
                        <div className={styles.commandPanel}>
                            <MemoCommandPanel currentView={currentView} />
                        </div>

                        {/* 底部导航栏：主视图切换 */}
                        <div className={styles.navPanel}>
                            <MemoNavPanel
                                currentView={currentView}
                                onViewChange={setCurrentView}
                            />
                        </div>
                    </div>

                    {/* 全局通知 Toast：浮动在最顶层 */}
                    <NotificationToast />
                </>
            </SubViewCommandProvider>
        </ViewCommandProvider>
    );
}
