/**
 * 主导航面板
 *
 * 负责渲染底部导航按钮，并根据应用状态提供“高亮/徽标”提示：
 * - 告警视图：根据未确认告警/警告数量显示徽标与严重级别
 * - 其它视图：根据 unfinishedTasks 标记显示“处理中”高亮
 *
 * @module NavPanel
 */

import { memo, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { ViewId, HighlightStatus } from "@/types";
import { useAlarmStore, useNavigationStore } from "@/stores";
import { HMI_NAV_ITEMS } from "@/hmi/viewRegistry";
import styles from "./NavPanel.module.css";

interface NavPanelProps {
    /** 当前激活视图 */
    currentView: ViewId;
    /** 视图切换回调 */
    onViewChange: (view: ViewId) => void;
}

interface NavButtonProps {
    id: ViewId;
    icon: ReactNode;
    label: string;
    active: boolean;
    highlight: HighlightStatus;
    badge: number | null;
    badgeSeverity: "alarm" | "warning";
    onViewChange: (view: ViewId) => void;
}

/**
 * 单个导航按钮
 *
 * @description 使用 `memo` 避免其它按钮状态变化导致所有按钮重新渲染。
 */
const NavButton = memo(function NavButton({
    id,
    icon,
    label,
    active,
    highlight,
    badge,
    badgeSeverity,
    onViewChange,
}: NavButtonProps) {
    const handleClick = useCallback(() => onViewChange(id), [id, onViewChange]);

    return (
        <button
            className={styles.navButton}
            data-id={id}
            data-active={active}
            data-highlight={highlight !== "none" ? highlight : undefined}
            onClick={handleClick}
        >
            <div className={styles.navIconContainer}>
                <span className={styles.navIcon}>{icon}</span>
                {badge !== null && (
                    <span
                        className={styles.badge}
                        data-severity={badgeSeverity}
                    >
                        {/* 徽标最多显示到 99+，避免占用过多空间 */}
                        {badge > 99 ? "99+" : badge}
                    </span>
                )}
            </div>
            <span className={styles.navLabel}>{label}</span>
            {active && <span className={styles.activeIndicator} />}
        </button>
    );
});

/**
 * 主导航面板
 *
 * @param props - 组件属性
 * @returns 导航面板 JSX
 */
export function NavPanel({ currentView, onViewChange }: NavPanelProps) {
    const { t } = useTranslation();
    const { unacknowledgedAlarmCount, unacknowledgedWarningCount } =
        useAlarmStore(
            useShallow((state) => ({
                unacknowledgedAlarmCount: state.unacknowledgedAlarmCount,
                unacknowledgedWarningCount: state.unacknowledgedWarningCount,
            })),
        );
    const unfinishedTasks = useNavigationStore(
        useShallow((state) => state.unfinishedTasks),
    );

    const getHighlight = (item: {
        id: ViewId;
        highlight?: HighlightStatus;
    }): HighlightStatus => {
        // 告警页：以未确认告警/警告优先决定高亮色
        if (item.id === "alarms") {
            if (unacknowledgedAlarmCount > 0) return "alarm";
            if (unacknowledgedWarningCount > 0) return "warning";
        }
        // 其它页面：若存在未完成任务，则显示“处理中”高亮
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

    const badgeSeverity: "alarm" | "warning" =
        unacknowledgedAlarmCount > 0 ? "alarm" : "warning";

    return (
        <nav className={styles.navPanel}>
            <div className={styles.navContainer}>
                {HMI_NAV_ITEMS.map((item) => {
                    const highlight = getHighlight(item);
                    const badge = getBadgeCount(item);

                    return (
                        <NavButton
                            key={item.id}
                            id={item.id}
                            icon={item.icon}
                            label={t(item.labelKey)}
                            active={currentView === item.id}
                            highlight={highlight}
                            badge={badge}
                            badgeSeverity={badgeSeverity}
                            onViewChange={onViewChange}
                        />
                    );
                })}
            </div>
        </nav>
    );
}
