import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ViewId } from "@/types";
import { useAlarmStore, useCommStore, useAppStore } from "@/stores";
import styles from "./TitlePanel.module.css";

interface TitlePanelProps {
    currentView: ViewId;
}

export function TitlePanel({ currentView }: TitlePanelProps) {
    const { t, i18n } = useTranslation();
    const [dateTime, setDateTime] = useState(new Date());
    const { serialConnected, tcpConnected } = useCommStore();
    const { unacknowledgedAlarmCount, unacknowledgedWarningCount, alarms } =
        useAlarmStore();
    const { user, logout } = useAppStore();
    const [showLoginModal, setShowLoginModal] = useState(false);

    const isConnected = serialConnected || tcpConnected;
    const latestAlarm = alarms.find((a) => !a.acknowledged);

    useEffect(() => {
        const timer = setInterval(() => {
            setDateTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            },
        );
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            },
        );
    };

    const handleLoginClick = () => {
        if (user) {
            logout();
        } else {
            setShowLoginModal(true);
        }
    };

    const handleQuickLogin = (role: "operator" | "engineer" | "admin") => {
        useAppStore.getState().login({
            id: role,
            name: role.charAt(0).toUpperCase() + role.slice(1),
            role,
        });
        setShowLoginModal(false);
    };

    const getConnectionType = () => {
        if (serialConnected && tcpConnected) return "Serial + TCP";
        if (serialConnected) return "Serial";
        if (tcpConnected) return "TCP";
        return t("title.commStatus.disconnected");
    };

    const totalAlarms = unacknowledgedAlarmCount + unacknowledgedWarningCount;

    return (
        <div className={styles.titlePanel}>
            <div className={styles.topRow}>
                <div className={styles.leftSection}>
                    <div
                        className={styles.commStatus}
                        data-connected={isConnected}
                    >
                        <div className={styles.commIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                            </svg>
                        </div>
                        <div className={styles.commInfo}>
                            <span className={styles.commLabel}>
                                {isConnected
                                    ? t("title.commStatus.connected")
                                    : t("title.commStatus.disconnected")}
                            </span>
                            <span className={styles.commType}>
                                {getConnectionType()}
                            </span>
                        </div>
                        <span
                            className={styles.commIndicator}
                            data-connected={isConnected}
                        />
                    </div>

                    <div className={styles.dateTimeContainer}>
                        <div className={styles.dateIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" />
                            </svg>
                        </div>
                        <div className={styles.dateTimeInfo}>
                            <span className={styles.date}>
                                {formatDate(dateTime)}
                            </span>
                            <span className={styles.time}>
                                {formatTime(dateTime)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className={styles.centerSection}>
                    <h1 className={styles.viewName}>
                        {t(`nav.${currentView}`)}
                    </h1>
                </div>

                <div className={styles.rightSection}>
                    {totalAlarms > 0 && (
                        <div
                            className={styles.alarmBadge}
                            data-severity={
                                unacknowledgedAlarmCount > 0
                                    ? "alarm"
                                    : "warning"
                            }
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                            </svg>
                            <span>{totalAlarms}</span>
                        </div>
                    )}

                    <button
                        className={styles.loginButton}
                        onClick={handleLoginClick}
                        data-logged-in={!!user}
                    >
                        <div className={styles.userIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                            </svg>
                        </div>
                        <div className={styles.loginInfo}>
                            <span className={styles.loginLabel}>
                                {user ? user.name : t("title.loginHere")}
                            </span>
                            {user && (
                                <span className={styles.loginRole}>
                                    {user.role}
                                </span>
                            )}
                        </div>
                    </button>

                    <button
                        className={styles.exitButton}
                        onClick={() => getCurrentWindow().close()}
                        title={t("common.exit")}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </button>
                </div>
            </div>

            <div
                className={styles.messageArea}
                data-severity={latestAlarm?.severity}
            >
                <div className={styles.messageIcon}>
                    {latestAlarm ? (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                    )}
                </div>
                <span className={styles.messageText}>
                    {latestAlarm ? latestAlarm.message : t("system.running")}
                </span>
                {latestAlarm && (
                    <span className={styles.messageTime}>
                        {latestAlarm.timestamp.toLocaleTimeString()}
                    </span>
                )}
            </div>

            {showLoginModal && (
                <div
                    className={styles.modalOverlay}
                    onClick={() => setShowLoginModal(false)}
                >
                    <div
                        className={styles.loginModal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className={styles.modalTitle}>
                            {t("title.loginHere")}
                        </h3>
                        <div className={styles.loginOptions}>
                            <button
                                className={styles.loginOption}
                                onClick={() => handleQuickLogin("operator")}
                            >
                                <span className={styles.optionIcon}>
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path d="M12 6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2m0 10c2.7 0 5.8 1.29 6 2H6c.23-.72 3.31-2 6-2m0-12C9.79 4 8 5.79 8 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                                    </svg>
                                </span>
                                <span>Operator</span>
                            </button>
                            <button
                                className={styles.loginOption}
                                onClick={() => handleQuickLogin("engineer")}
                            >
                                <span className={styles.optionIcon}>
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
                                    </svg>
                                </span>
                                <span>Engineer</span>
                            </button>
                            <button
                                className={styles.loginOption}
                                onClick={() => handleQuickLogin("admin")}
                            >
                                <span className={styles.optionIcon}>
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path d="M17 11c.34 0 .67.04 1 .09V6.27L10.5 3 3 6.27v4.91c0 4.54 3.2 8.79 7.5 9.82.55-.13 1.08-.32 1.6-.55-.69-.98-1.1-2.17-1.1-3.45 0-3.31 2.69-6 6-6z" />
                                        <path d="M17 13c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 1.38c.62 0 1.12.51 1.12 1.12s-.51 1.12-1.12 1.12-1.12-.51-1.12-1.12.5-1.12 1.12-1.12zm0 5.37c-.93 0-1.74-.46-2.24-1.17.05-.72 1.51-1.08 2.24-1.08s2.19.36 2.24 1.08c-.5.71-1.31 1.17-2.24 1.17z" />
                                    </svg>
                                </span>
                                <span>Admin</span>
                            </button>
                        </div>
                        <button
                            className={styles.cancelButton}
                            onClick={() => setShowLoginModal(false)}
                        >
                            {t("common.cancel")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
