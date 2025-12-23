/**
 * 状态指示器组件
 *
 * 遵循 SEMI E95 色彩语义标准，用于显示设备/流程状态。
 *
 * @module StatusIndicator
 */

import type { HighlightStatus } from "@/types";
import styles from "./StatusIndicator.module.css";

type ExtendedStatus = HighlightStatus | "idle";

interface StatusIndicatorProps {
    /** 状态类型（遵循 SEMI E95 色彩语义） */
    status: ExtendedStatus;
    /** 状态标签文本 */
    label?: string;
    /** 是否显示脉冲动画（用于激活状态） */
    animate?: boolean;
}

/**
 * 状态指示器组件（遵循 SEMI E95 色彩语义）
 *
 * - Alarm（红色）：严重告警
 * - Warning（黄色）：警告
 * - Processing（蓝色）：处理中 / 未完成
 * - Attention（绿色）：需要用户关注
 * - Idle（灰色）：空闲/未激活
 */
export function StatusIndicator({ status, label }: StatusIndicatorProps) {
    return (
        <span className={styles.indicator} data-status={status}>
            <span className={styles.dot} />
            {label && <span>{label}</span>}
        </span>
    );
}
