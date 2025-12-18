import { useEffect } from "react";
import { TitlePanel } from "./TitlePanel";
import { InfoPanel } from "./InfoPanel";
import { NavPanel } from "./NavPanel";
import { CommandPanel } from "./CommandPanel";
import { NotificationToast } from "./NotificationToast";
import { useAlarmStore, useNavigationStore, useAppStore } from "@/stores";
import { useKeyboardShortcuts, useFrontendLogBridge } from "@/hooks";
import styles from "./MainLayout.module.css";

export function MainLayout() {
    const { currentView, setCurrentView } = useNavigationStore();
    const { commandPanelPosition, theme } = useAppStore();

    useKeyboardShortcuts();
    useFrontendLogBridge();

    useEffect(() => {
        const seedDemoAlarmsIfEmpty = () => {
            const { alarms, addAlarm } = useAlarmStore.getState();
            if (alarms.length > 0) return;

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
