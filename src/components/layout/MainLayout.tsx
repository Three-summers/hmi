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
import { useAlarmStore, useNavigationStore, useAppStore } from "@/stores";
import { useKeyboardShortcuts, useFrontendLogBridge } from "@/hooks";
import styles from "./MainLayout.module.css";

/**
 * HMI 主布局入口组件
 *
 * @returns 主布局 JSX
 */
export function MainLayout() {
    const { currentView, setCurrentView } = useNavigationStore(
        useShallow((state) => ({
            currentView: state.currentView,
            setCurrentView: state.setCurrentView,
        })),
    );
    const { commandPanelPosition, theme } = useAppStore(
        useShallow((state) => ({
            commandPanelPosition: state.commandPanelPosition,
            theme: state.theme,
        })),
    );

    useKeyboardShortcuts();
    useFrontendLogBridge();

    useEffect(() => {
        const seedDemoAlarmsIfEmpty = () => {
            const { alarms, addAlarm } = useAlarmStore.getState();
            if (alarms.length > 0) return;

            // Demo 数据：仅在“告警历史为空”时注入一组示例告警，方便演示 UI 效果。
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
        <>
            <div
                className={styles.mainLayout}
                data-command-position={commandPanelPosition}
            >
                <div className={styles.titlePanel}>
                    <TitlePanel currentView={currentView} />
                </div>

                <div className={styles.infoPanel}>
                    <InfoPanel currentView={currentView} />
                </div>

                <div className={styles.commandPanel}>
                    <CommandPanel currentView={currentView} />
                </div>

                <div className={styles.navPanel}>
                    <NavPanel
                        currentView={currentView}
                        onViewChange={setCurrentView}
                    />
                </div>
            </div>
            <NotificationToast />
        </>
    );
}
