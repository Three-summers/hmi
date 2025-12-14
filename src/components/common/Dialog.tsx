import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { DialogType, MessageIconType, DialogButtons } from "@/types";
import styles from "./Dialog.module.css";

interface DialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Dialog type per SEMI E95 */
  type: DialogType;
  /** Dialog title */
  title: string;
  /** Dialog content (for input type) */
  children?: React.ReactNode;
  /** Message text (for info/message type) */
  message?: string;
  /** Icon type (for message type) */
  icon?: MessageIconType;
  /** Button configuration */
  buttons?: DialogButtons;
  /** OK button disabled state (e.g., when required fields not filled) */
  okDisabled?: boolean;
  /** Callbacks */
  onOk?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  onYes?: () => void;
  onNo?: () => void;
  onApply?: () => void;
}

const iconMap: Record<MessageIconType, string> = {
  information: "ℹ️",
  progress: "⏳",
  attention: "⚠️",
  error: "❌",
};

/**
 * SEMI E95 compliant dialog component
 *
 * Types:
 * - info: Information display only, must use Close button
 * - input: Data input/selection, must use OK/Cancel buttons
 * - message: Status/notification with icon, buttons depend on content
 *
 * Rules:
 * - Fixed position and size (not movable/resizable)
 * - Does not cover title panel or navigation panel
 * - X button in title bar equals Cancel behavior
 */
export function Dialog({
  open,
  type,
  title,
  children,
  message,
  icon,
  buttons = {},
  okDisabled = false,
  onOk,
  onCancel,
  onClose,
  onYes,
  onNo,
  onApply,
}: DialogProps) {
  const { t } = useTranslation();

  // Default button configuration based on dialog type
  const resolvedButtons: DialogButtons = {
    ...buttons,
    // Info dialog must use Close
    ...(type === "info" && { close: true, ok: false }),
    // Input dialog must use OK/Cancel
    ...(type === "input" && { ok: true, cancel: true }),
  };

  // Handle Escape key to close/cancel
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (resolvedButtons.cancel) {
          onCancel?.();
        } else if (resolvedButtons.close) {
          onClose?.();
        } else if (resolvedButtons.no) {
          onNo?.();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, resolvedButtons, onCancel, onClose, onNo]);

  // X button handler (equals Cancel per SEMI E95)
  const handleCloseButton = useCallback(() => {
    if (resolvedButtons.cancel) {
      onCancel?.();
    } else {
      onClose?.();
    }
  }, [resolvedButtons, onCancel, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        {/* Title Bar */}
        <div className={styles.titleBar}>
          <span className={styles.title}>{title}</span>
          <button
            className={styles.closeButton}
            onClick={handleCloseButton}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        {/* Content Area */}
        <div className={styles.content}>
          {type === "message" && message ? (
            <div className={styles.messageContent}>
              {icon && (
                <span className={styles.messageIcon} data-type={icon}>
                  {iconMap[icon]}
                </span>
              )}
              <span className={styles.messageText}>{message}</span>
            </div>
          ) : type === "info" && message ? (
            <div className={styles.messageText}>{message}</div>
          ) : (
            children
          )}
        </div>

        {/* Button Area - Per SEMI E95: primary buttons centered */}
        <div className={styles.buttonArea}>
          <div className={styles.primaryButtons}>
            {resolvedButtons.yes && (
              <button
                className={styles.dialogButton}
                data-primary="true"
                onClick={onYes}
              >
                {t("common.yes")}
              </button>
            )}
            {resolvedButtons.no && (
              <button className={styles.dialogButton} onClick={onNo}>
                {t("common.no")}
              </button>
            )}
            {resolvedButtons.ok && (
              <button
                className={styles.dialogButton}
                data-primary="true"
                disabled={okDisabled}
                onClick={onOk}
              >
                {t("common.ok")}
              </button>
            )}
            {resolvedButtons.cancel && (
              <button className={styles.dialogButton} onClick={onCancel}>
                {t("common.cancel")}
              </button>
            )}
            {resolvedButtons.close && (
              <button className={styles.dialogButton} onClick={onClose}>
                {t("common.close")}
              </button>
            )}
          </div>

          {/* Auxiliary buttons right-aligned per SEMI E95 */}
          {resolvedButtons.apply && (
            <div className={styles.auxiliaryButtons}>
              <button className={styles.dialogButton} onClick={onApply}>
                {t("common.apply")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
