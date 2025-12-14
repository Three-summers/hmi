import { TitlePanel } from "./TitlePanel";
import { InfoPanel } from "./InfoPanel";
import { NavPanel } from "./NavPanel";
import { CommandPanel } from "./CommandPanel";
import { NotificationToast } from "./NotificationToast";
import { useNavigationStore, useAppStore } from "@/stores";
import { useKeyboardShortcuts } from "@/hooks";
import styles from "./MainLayout.module.css";

export function MainLayout() {
    const { currentView, setCurrentView } = useNavigationStore();
    const { commandPanelPosition } = useAppStore();

    // Enable keyboard shortcuts
    useKeyboardShortcuts();

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
