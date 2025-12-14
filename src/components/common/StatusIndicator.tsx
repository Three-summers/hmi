import type { HighlightStatus } from "@/types";
import styles from "./StatusIndicator.module.css";

type ExtendedStatus = HighlightStatus | "idle";

interface StatusIndicatorProps {
  /** Status type per SEMI E95 color semantics */
  status: ExtendedStatus;
  /** Label text */
  label?: string;
  /** Show pulsing animation for active states */
  animate?: boolean;
}

/**
 * Status indicator component following SEMI E95 color semantics
 * - Alarm (Red): Critical alerts
 * - Warning (Yellow): Warnings
 * - Processing (Blue): In progress / incomplete
 * - Attention (Green): Needs user attention
 */
export function StatusIndicator({
  status,
  label,
}: StatusIndicatorProps) {
  return (
    <span className={styles.indicator} data-status={status}>
      <span className={styles.dot} />
      {label && <span>{label}</span>}
    </span>
  );
}
