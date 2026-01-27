/**
 * SEMI E95 对话框组件
 *
 * 提供符合工业 HMI 标准的对话框交互，支持信息展示、输入、消息确认等场景。
 *
 * @module Dialog
 */

import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { DialogType, MessageIconType, DialogButtons } from "@/types";
import { ErrorIcon, InfoIcon, ProgressIcon, WarningIcon } from "./Icons";
import styles from "./Dialog.module.css";

interface DialogProps {
    /** 是否打开 */
    open: boolean;
    /** 对话框类型（SEMI E95） */
    type: DialogType;
    /** 标题 */
    title: string;
    /** 内容（input 类型） */
    children?: React.ReactNode;
    /** 文本（info/message 类型） */
    message?: string;
    /** 图标（message 类型） */
    icon?: MessageIconType;
    /** 按钮配置 */
    buttons?: DialogButtons;
    /** OK 是否禁用（例如：必填项未填写） */
    okDisabled?: boolean;
    /** 回调 */
    onOk?: () => void;
    onCancel?: () => void;
    onClose?: () => void;
    onYes?: () => void;
    onNo?: () => void;
    onApply?: () => void;
}

const iconMap: Record<MessageIconType, JSX.Element> = {
    information: <InfoIcon />,
    progress: <ProgressIcon />,
    attention: <WarningIcon />,
    error: <ErrorIcon />,
};

export type DialogEscapeAction = "cancel" | "close" | "no" | null;
export type DialogCloseAction = "cancel" | "close";

/**
 * 根据对话框类型补齐默认按钮策略，避免调用方遗漏导致不符合规范
 */
export function resolveDialogButtons(
    type: DialogType,
    buttons: DialogButtons = {},
): DialogButtons {
    return {
        ...buttons,
        // info 必须是 Close
        ...(type === "info" && { close: true, ok: false }),
        // input 必须是 OK/Cancel
        ...(type === "input" && { ok: true, cancel: true }),
    };
}

/**
 * Escape：优先走 Cancel/Close/No（按 SEMI E95 语义尽量“安全退出”）
 */
export function getDialogEscapeAction(
    resolvedButtons: DialogButtons,
): DialogEscapeAction {
    if (resolvedButtons.cancel) return "cancel";
    if (resolvedButtons.close) return "close";
    if (resolvedButtons.no) return "no";
    return null;
}

/**
 * 右上角 X：语义等同 Cancel（若无 Cancel 则视为 Close）
 */
export function getDialogCloseAction(
    resolvedButtons: DialogButtons,
): DialogCloseAction {
    return resolvedButtons.cancel ? "cancel" : "close";
}

/**
 * SEMI E95 对话框组件
 *
 * 类型约定：
 * - info：信息展示，只允许 Close
 * - input：输入/选择，只允许 OK/Cancel
 * - message：带图标的消息，根据业务配置按钮（Yes/No/Apply 等）
 *
 * 交互约定：
 * - 固定位置与尺寸（不拖拽/不缩放）
 * - 右上角 X 的语义等同 Cancel（若无 Cancel 则视为 Close）
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

    const resolvedButtons = resolveDialogButtons(type, buttons);

    // Escape：优先走 Cancel/Close/No（按 SEMI E95 语义尽量“安全退出”）
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;

            const action = getDialogEscapeAction(resolvedButtons);
            if (action === "cancel") onCancel?.();
            if (action === "close") onClose?.();
            if (action === "no") onNo?.();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, resolvedButtons, onCancel, onClose, onNo]);

    // X：等同 Cancel（若无 Cancel 则走 Close）
    const handleCloseButton = useCallback(() => {
        const action = getDialogCloseAction(resolvedButtons);
        if (action === "cancel") onCancel?.();
        if (action === "close") onClose?.();
    }, [resolvedButtons, onCancel, onClose]);

    if (!open) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.dialog} role="dialog" aria-modal="true">
                {/* 标题栏 */}
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

                {/* 内容区 */}
                <div className={styles.content}>
                    {type === "message" && message ? (
                        <div className={styles.messageContent}>
                            {icon && (
                                <span
                                    className={styles.messageIcon}
                                    data-type={icon}
                                >
                                    {iconMap[icon]}
                                </span>
                            )}
                            <span className={styles.messageText}>
                                {message}
                            </span>
                        </div>
                    ) : type === "info" && message ? (
                        <div className={styles.messageText}>{message}</div>
                    ) : (
                        children
                    )}
                </div>

                {/* 按钮区（SEMI E95：主按钮居中） */}
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
                            <button
                                className={styles.dialogButton}
                                onClick={onNo}
                            >
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
                            <button
                                className={styles.dialogButton}
                                onClick={onCancel}
                            >
                                {t("common.cancel")}
                            </button>
                        )}
                        {resolvedButtons.close && (
                            <button
                                className={styles.dialogButton}
                                onClick={onClose}
                            >
                                {t("common.close")}
                            </button>
                        )}
                    </div>

                    {/* 辅助按钮（SEMI E95：右侧对齐） */}
                    {resolvedButtons.apply && (
                        <div className={styles.auxiliaryButtons}>
                            <button
                                className={styles.dialogButton}
                                onClick={onApply}
                            >
                                {t("common.apply")}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
