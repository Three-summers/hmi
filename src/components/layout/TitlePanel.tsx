/**
 * 标题面板（顶部栏）
 *
 * 展示全局状态与快捷操作入口，包括：
 * - 通信连接状态（串口/TCP）
 * - 当前时间
 * - 当前视图标题
 * - 主题切换、登录/登出、全屏、退出等快捷按钮
 * - 最新未确认告警/系统运行提示
 *
 * @module TitlePanel
 */

import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { ViewId } from "@/types";
import { useAlarmStore } from "@/stores";
import { AlarmIcon, OkIcon } from "@/components/common/Icons";
import { InfoSection } from "./InfoSection";
import { TitleSection } from "./TitleSection";
import { CommandSection } from "./CommandSection";
import styles from "./TitlePanel.module.css";

interface TitlePanelProps {
    /** 当前激活视图 */
    currentView: ViewId;
}

/**
 * 标题面板组件
 *
 * @param props - 组件属性
 * @returns 标题面板 JSX
 */
export function TitlePanel({ currentView }: TitlePanelProps) {
    const { t } = useTranslation();
    const { unacknowledgedAlarmCount, unacknowledgedWarningCount, alarms } =
        useAlarmStore(
            useShallow((state) => ({
                unacknowledgedAlarmCount: state.unacknowledgedAlarmCount,
                unacknowledgedWarningCount: state.unacknowledgedWarningCount,
                alarms: state.alarms,
            })),
        );

    // 展示最新未确认告警（用于顶部消息条），无未确认告警则显示“系统运行中”
    const latestAlarm = alarms.find((a) => !a.acknowledged);

    return (
        <div className={styles.titlePanel}>
            <div className={styles.topRow}>
                <InfoSection />
                <TitleSection currentView={currentView} />
                <CommandSection
                    unacknowledgedAlarmCount={unacknowledgedAlarmCount}
                    unacknowledgedWarningCount={unacknowledgedWarningCount}
                />
            </div>

            <div
                className={styles.messageArea}
                data-severity={latestAlarm?.severity}
            >
                <div className={styles.messageIcon}>
                    {latestAlarm ? <AlarmIcon /> : <OkIcon />}
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
        </div>
    );
}
