/**
 * Monitor 告警列表子组件
 *
 * 目标：
 * - 在 Monitor 视图中提供“快速查看”能力（不替代完整的 Alarms 视图）
 * - 以只读列表为主，避免在监控页引入过多操作入口
 *
 * @module Monitor/AlarmList
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAlarmStore } from "@/stores";
import type { AlarmItem } from "@/types";
import sharedStyles from "../shared.module.css";

export interface AlarmListProps {
    /** 最多显示多少条（默认 8） */
    maxItems?: number;
    /** 是否包含已确认告警（默认 false：仅显示未确认） */
    includeAcknowledged?: boolean;
}

function formatAlarmTime(date: Date, locale: string) {
    return date.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function AlarmList({
    maxItems = 8,
    includeAcknowledged = false,
}: AlarmListProps) {
    const { t, i18n } = useTranslation();
    const alarms = useAlarmStore((s) => s.alarms);

    const visible = useMemo(() => {
        const filtered = includeAcknowledged
            ? alarms
            : alarms.filter((a) => !a.acknowledged);
        return filtered.slice(0, Math.max(0, Math.floor(maxItems)));
    }, [alarms, includeAcknowledged, maxItems]);

    const emptyText = includeAcknowledged
        ? t("alarm.noAlarms")
        : t("alarm.noAlarms");

    return (
        <div style={{ minHeight: 0 }}>
            <div className={sharedStyles.header}>
                <div className={sharedStyles.title}>{t("alarm.title")}</div>
                <div
                    style={{
                        fontSize: 12,
                        color: "var(--text-secondary)",
                    }}
                >
                    {includeAcknowledged
                        ? `${alarms.length}`
                        : `${alarms.filter((a) => !a.acknowledged).length}`}
                </div>
            </div>

            {visible.length === 0 ? (
                <div
                    className={sharedStyles.emptyState}
                    style={{ height: 180 }}
                >
                    <div className={sharedStyles.emptyIcon}>🔔</div>
                    <span>{emptyText}</span>
                </div>
            ) : (
                <div className={sharedStyles.list} role="list">
                    {visible.map((alarm: AlarmItem) => (
                        <div
                            key={alarm.id}
                            className={sharedStyles.listItem}
                            data-selected={!alarm.acknowledged}
                            role="listitem"
                        >
                            <div className={sharedStyles.itemInfo}>
                                <div className={sharedStyles.itemName}>
                                    {alarm.message}
                                </div>
                                <div className={sharedStyles.itemMeta}>
                                    {t(`alarm.severity.${alarm.severity}`)} ·{" "}
                                    {formatAlarmTime(
                                        alarm.timestamp,
                                        i18n.language,
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

