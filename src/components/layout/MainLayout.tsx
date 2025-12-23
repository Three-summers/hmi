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

import { useEffect } from "react";
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
                            <TitlePanel currentView={currentView} />
                        </div>

                        {/* 主视图区域：支持 Keep-Alive，切换视图时保留状态 */}
                        <div className={styles.infoPanel}>
                            <InfoPanel currentView={currentView} />
                        </div>

                        {/* 命令面板：根据当前视图显示对应的命令按钮 */}
                        <div className={styles.commandPanel}>
                            <CommandPanel currentView={currentView} />
                        </div>

                        {/* 底部导航栏：主视图切换 */}
                        <div className={styles.navPanel}>
                            <NavPanel
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
