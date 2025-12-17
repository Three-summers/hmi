import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/common";
import { useAlarmStore } from "@/stores";
import styles from "./Alarms.module.css";
import sharedStyles from "../shared.module.css";

export default function AlarmsView() {
    const { t } = useTranslation();
    const {
        alarms,
        acknowledgeAlarm,
        addAlarm,
        unacknowledgedAlarmCount,
        unacknowledgedWarningCount,
    } = useAlarmStore();

    useEffect(() => {
        if (alarms.length === 0) {
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
        }
    }, []);

    const getSeverityIcon = (severity: "alarm" | "warning" | "info") => {
        switch (severity) {
            case "alarm":
                return (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                    </svg>
                );
            case "warning":
                return (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                );
            default:
                return (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                    </svg>
                );
        }
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
        });
    };

    const activeAlarms = alarms.filter((a) => !a.acknowledged);
    const acknowledgedAlarms = alarms.filter((a) => a.acknowledged);
    const [activeTab, setActiveTab] = useState<"active" | "history">("active");

    return (
        <div className={sharedStyles.view}>
            <div className={styles.statsBar}>
                <div className={styles.statItem} data-severity="alarm">
                    <span className={styles.statIcon}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                        </svg>
                    </span>
                    <span className={styles.statValue}>
                        {unacknowledgedAlarmCount}
                    </span>
                    <span className={styles.statLabel}>
                        {t("alarm.severity.alarm")}
                    </span>
                </div>
                <div className={styles.statItem} data-severity="warning">
                    <span className={styles.statIcon}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                        </svg>
                    </span>
                    <span className={styles.statValue}>
                        {unacknowledgedWarningCount}
                    </span>
                    <span className={styles.statLabel}>
                        {t("alarm.severity.warning")}
                    </span>
                </div>
                <div className={styles.statItem} data-severity="total">
                    <span className={styles.statIcon}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                        </svg>
                    </span>
                    <span className={styles.statValue}>{alarms.length}</span>
                    <span className={styles.statLabel}>{t("jobs.total")}</span>
                </div>
            </div>

            <Tabs
                activeId={activeTab}
                onChange={setActiveTab}
                tabs={[
                    {
                        id: "active",
                        label: t("alarm.tabs.active"),
                        content: (
                            <div className={styles.alarmsContent}>
                                {activeAlarms.length === 0 ? (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyIcon}>
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                            >
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                            </svg>
                                        </div>
                                        <span className={styles.emptyText}>
                                            {t("alarm.noAlarms")}
                                        </span>
                                    </div>
                                ) : (
                                    <div className={styles.alarmSection}>
                                        <h3 className={styles.sectionTitle}>
                                            Active ({activeAlarms.length})
                                        </h3>
                                        <div className={styles.alarmsList}>
                                            {activeAlarms.map((alarm) => (
                                                <div
                                                    key={alarm.id}
                                                    className={
                                                        styles.alarmCard
                                                    }
                                                    data-severity={
                                                        alarm.severity
                                                    }
                                                >
                                                    <div
                                                        className={
                                                            styles.alarmIcon
                                                        }
                                                        data-severity={
                                                            alarm.severity
                                                        }
                                                    >
                                                        {getSeverityIcon(
                                                            alarm.severity,
                                                        )}
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.alarmContent
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.alarmMessage
                                                            }
                                                        >
                                                            {alarm.message}
                                                        </span>
                                                        <div
                                                            className={
                                                                styles.alarmMeta
                                                            }
                                                        >
                                                            <span
                                                                className={
                                                                    styles.alarmTime
                                                                }
                                                            >
                                                                {formatDate(
                                                                    alarm.timestamp,
                                                                )}{" "}
                                                                {formatTime(
                                                                    alarm.timestamp,
                                                                )}
                                                            </span>
                                                            <span
                                                                className={
                                                                    styles.alarmSeverity
                                                                }
                                                                data-severity={
                                                                    alarm.severity
                                                                }
                                                            >
                                                                {alarm.severity.toUpperCase()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        className={
                                                            styles.ackButton
                                                        }
                                                        onClick={() =>
                                                            acknowledgeAlarm(
                                                                alarm.id,
                                                            )
                                                        }
                                                    >
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                        >
                                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                                        </svg>
                                                        ACK
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ),
                    },
                    {
                        id: "history",
                        label: t("alarm.tabs.history"),
                        content: (
                            <div className={styles.alarmsContent}>
                                {acknowledgedAlarms.length === 0 ? (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyIcon}>
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                            >
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                            </svg>
                                        </div>
                                        <span className={styles.emptyText}>
                                            {t("alarm.noAlarms")}
                                        </span>
                                    </div>
                                ) : (
                                    <div className={styles.alarmSection}>
                                        <h3 className={styles.sectionTitle}>
                                            History ({acknowledgedAlarms.length}
                                            )
                                        </h3>
                                        <div className={styles.alarmsList}>
                                            {acknowledgedAlarms.map((alarm) => (
                                                <div
                                                    key={alarm.id}
                                                    className={
                                                        styles.alarmCard
                                                    }
                                                    data-severity={
                                                        alarm.severity
                                                    }
                                                    data-acknowledged="true"
                                                >
                                                    <div
                                                        className={
                                                            styles.alarmIcon
                                                        }
                                                        data-severity={
                                                            alarm.severity
                                                        }
                                                    >
                                                        {getSeverityIcon(
                                                            alarm.severity,
                                                        )}
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.alarmContent
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.alarmMessage
                                                            }
                                                        >
                                                            {alarm.message}
                                                        </span>
                                                        <div
                                                            className={
                                                                styles.alarmMeta
                                                            }
                                                        >
                                                            <span
                                                                className={
                                                                    styles.alarmTime
                                                                }
                                                            >
                                                                {formatDate(
                                                                    alarm.timestamp,
                                                                )}{" "}
                                                                {formatTime(
                                                                    alarm.timestamp,
                                                                )}
                                                            </span>
                                                            <span
                                                                className={
                                                                    styles.alarmAcked
                                                                }
                                                            >
                                                                ACKNOWLEDGED
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
