import { useTranslation } from "react-i18next";
import type { ViewId, HighlightStatus } from "@/types";
import { useAlarmStore, useNavigationStore } from "@/stores";
import { HMI_NAV_ITEMS } from "@/hmi/viewRegistry";
import styles from "./NavPanel.module.css";

interface NavPanelProps {
    currentView: ViewId;
    onViewChange: (view: ViewId) => void;
}

export function NavPanel({ currentView, onViewChange }: NavPanelProps) {
    const { t } = useTranslation();
    const { unacknowledgedAlarmCount, unacknowledgedWarningCount } =
        useAlarmStore();
    const { unfinishedTasks } = useNavigationStore();

    const getHighlight = (item: { id: ViewId; highlight?: HighlightStatus }): HighlightStatus => {
        if (item.id === "alarms") {
            if (unacknowledgedAlarmCount > 0) return "alarm";
            if (unacknowledgedWarningCount > 0) return "warning";
        }
        if (unfinishedTasks[item.id]) return "processing";
        return item.highlight || "none";
    };

    const getBadgeCount = (item: { id: ViewId }): number | null => {
        if (item.id === "alarms") {
            const total = unacknowledgedAlarmCount + unacknowledgedWarningCount;
            return total > 0 ? total : null;
        }
        return null;
    };

    return (
        <nav className={styles.navPanel}>
            <div className={styles.navContainer}>
                {HMI_NAV_ITEMS.map((item) => {
                    const highlight = getHighlight(item);
                    const badge = getBadgeCount(item);

                    return (
                        <button
                            key={item.id}
                            className={styles.navButton}
                            data-id={item.id}
                            data-active={currentView === item.id}
                            data-highlight={
                                highlight !== "none" ? highlight : undefined
                            }
                            onClick={() => onViewChange(item.id)}
                        >
                            <div className={styles.navIconContainer}>
                                <span className={styles.navIcon}>
                                    {item.icon}
                                </span>
                                {badge !== null && (
                                    <span
                                        className={styles.badge}
                                        data-severity={
                                            unacknowledgedAlarmCount > 0
                                                ? "alarm"
                                                : "warning"
                                        }
                                    >
                                        {badge > 99 ? "99+" : badge}
                                    </span>
                                )}
                            </div>
                            <span className={styles.navLabel}>
                                {t(item.labelKey)}
                            </span>
                            {currentView === item.id && (
                                <span className={styles.activeIndicator} />
                            )}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
