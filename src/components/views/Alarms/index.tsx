/**
 * 告警视图 - 告警管理与历史记录
 *
 * 提供告警列表、确认操作、历史记录查看等功能。
 * 核心特性：
 * - 告警列表：显示未确认和已确认的告警
 * - 批量确认：一键确认所有未确认告警
 * - 清空已确认：清空已确认的历史告警
 * - 告警统计：显示告警/警告数量和优先级
 * - SEMI E95 色彩语义：Alarm（红色）、Warning（黄色）
 *
 * @module Alarms
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { Tabs } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import {
    useRegisterViewCommands,
    useViewCommandActions,
} from "@/components/layout/ViewCommandContext";
import { useAlarmStore } from "@/stores";
import { useNotify, useStoreWhenActive } from "@/hooks";
import styles from "./Alarms.module.css";
import sharedStyles from "../shared.module.css";

export default function AlarmsView() {
    const { t, i18n } = useTranslation();
    const isViewActive = useIsViewActive();
    const { showConfirm } = useViewCommandActions();
    const { success, info } = useNotify();
    const {
        alarms,
        acknowledgeAlarm,
        acknowledgeAll,
        clearAcknowledged,
        unacknowledgedAlarmCount,
        unacknowledgedWarningCount,
    } = useStoreWhenActive(
        useAlarmStore,
        useShallow((state) => ({
            alarms: state.alarms,
            acknowledgeAlarm: state.acknowledgeAlarm,
            acknowledgeAll: state.acknowledgeAll,
            clearAcknowledged: state.clearAcknowledged,
            unacknowledgedAlarmCount: state.unacknowledgedAlarmCount,
            unacknowledgedWarningCount: state.unacknowledgedWarningCount,
        })),
        { enabled: isViewActive },
    );

    const activeAlarms = alarms.filter((a) => !a.acknowledged);
    const acknowledgedAlarms = alarms.filter((a) => a.acknowledged);
    const unackedCount = activeAlarms.length;

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "acknowledgeAll",
                labelKey: "alarm.acknowledgeAll",
                highlight: unackedCount > 0 ? "attention" : undefined,
                disabled: unackedCount === 0,
                onClick: () => {
                    acknowledgeAll();
                    success(
                        t("notification.alarmsAcknowledged"),
                        t("notification.alarmsAcknowledgedCount", {
                            count: unackedCount,
                        }),
                    );
                },
            },
            {
                id: "clearAll",
                labelKey: "alarm.clearAll",
                highlight: "warning",
                onClick: () =>
                    showConfirm(
                        t("alarm.clearAll"),
                        t("notification.alarmHistoryCleared"),
                        () => {
                            clearAcknowledged();
                            info(
                                t("notification.alarmsCleared"),
                                t("notification.alarmHistoryCleared"),
                            );
                        },
                    ),
            },
        ],
        [
            acknowledgeAll,
            clearAcknowledged,
            info,
            showConfirm,
            success,
            t,
            unackedCount,
        ],
    );

    useRegisterViewCommands("alarms", commands, isViewActive);

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
        return date.toLocaleTimeString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            },
        );
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                month: "2-digit",
                day: "2-digit",
            },
        );
    };

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
                                            {t("alarm.section.active", {
                                                count: activeAlarms.length,
                                            })}
                                        </h3>
                                        <div className={styles.alarmsList}>
                                            {activeAlarms.map((alarm) => (
                                                <div
                                                    key={alarm.id}
                                                    className={styles.alarmCard}
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
                                                                {t(
                                                                    `alarm.severity.${alarm.severity}`,
                                                                )}
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
                                                        {t("alarm.actions.ack")}
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
                                            {t("alarm.section.history", {
                                                count: acknowledgedAlarms.length,
                                            })}
                                        </h3>
                                        <div className={styles.alarmsList}>
                                            {acknowledgedAlarms.map((alarm) => (
                                                <div
                                                    key={alarm.id}
                                                    className={styles.alarmCard}
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
                                                                {t(
                                                                    "alarm.acknowledged",
                                                                )}
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
