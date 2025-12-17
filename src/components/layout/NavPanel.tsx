import { useTranslation } from "react-i18next";
import type { ViewId, HighlightStatus } from "@/types";
import { useAlarmStore, useNavigationStore } from "@/stores";
import styles from "./NavPanel.module.css";

interface NavPanelProps {
    currentView: ViewId;
    onViewChange: (view: ViewId) => void;
}

interface NavItem {
    id: ViewId;
    highlight?: HighlightStatus;
}

const navItems: NavItem[] = [
    { id: "jobs" },
    { id: "system" },
    { id: "monitor" },
    { id: "recipes" },
    { id: "files" },
    { id: "setup" },
    { id: "alarms" },
    { id: "help" },
];

const NavIcons: Record<ViewId, JSX.Element> = {
    jobs: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
        </svg>
    ),
    system: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
    ),
    monitor: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
        </svg>
    ),
    recipes: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
    ),
    files: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
    ),
    setup: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
        </svg>
    ),
    alarms: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
    ),
    help: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
        </svg>
    ),
};

export function NavPanel({ currentView, onViewChange }: NavPanelProps) {
    const { t } = useTranslation();
    const { unacknowledgedAlarmCount, unacknowledgedWarningCount } =
        useAlarmStore();
    const { unfinishedTasks } = useNavigationStore();

    const getHighlight = (item: NavItem): HighlightStatus => {
        if (item.id === "alarms") {
            if (unacknowledgedAlarmCount > 0) return "alarm";
            if (unacknowledgedWarningCount > 0) return "warning";
        }
        if (unfinishedTasks[item.id]) return "processing";
        return item.highlight || "none";
    };

    const getBadgeCount = (item: NavItem): number | null => {
        if (item.id === "alarms") {
            const total = unacknowledgedAlarmCount + unacknowledgedWarningCount;
            return total > 0 ? total : null;
        }
        return null;
    };

    return (
        <nav className={styles.navPanel}>
            <div className={styles.navContainer}>
                {navItems.map((item) => {
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
                                    {NavIcons[item.id]}
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
                                {t(`nav.${item.id}`)}
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
