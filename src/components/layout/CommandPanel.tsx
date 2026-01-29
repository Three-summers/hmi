/**
 * 命令面板
 *
 * 根据当前视图渲染对应的“命令按钮”列表，并提供统一的确认弹窗能力：
 * - 每个视图通过 ViewCommandContext 注册其按钮集合（文案 key、行为、状态高亮等）
 * - 对需要二次确认的操作，通过 Context 提供的 confirm 状态与 showConfirm 弹出确认框
 *
 * @module CommandPanel
 */

import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import type { ViewId } from "@/types";
import { CommandIcons, InfoIcon, WarningIcon } from "@/components/common";
import { useViewCommandState } from "./ViewCommandContext";
import { useSubViewCommandState } from "./SubViewCommandContext";
import styles from "./CommandPanel.module.css";

interface CommandPanelProps {
    currentView: ViewId;
}

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * 通用确认弹窗（简化版）
 *
 * @param props - 弹窗属性
 * @returns 弹窗 JSX；当 `isOpen=false` 时返回 null
 */
function ConfirmModal({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const { t } = useTranslation();
    useEffect(() => {
        if (!isOpen) return;

        // Escape 关闭：避免触发全局快捷键逻辑，优先完成“确认/取消”流程
        // 说明：按 SEMI E95，导航栏可用；但对话框交互应优先。
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            onCancel();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} onClick={onCancel}>
            <div
                className={styles.modal}
                role="dialog"
                aria-modal="false"
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.modalHeader}>
                    <div className={styles.modalIcon}>
                        <WarningIcon />
                    </div>
                    <h3 className={styles.modalTitle}>{title}</h3>
                </div>
                <p className={styles.modalMessage}>{message}</p>
                <div className={styles.modalActions}>
                    <button className={styles.cancelBtn} onClick={onCancel}>
                        {t("common.cancel")}
                    </button>
                    <button className={styles.confirmBtn} onClick={onConfirm}>
                        {t("dialog.confirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * 命令面板组件
 *
 * @param props - 组件属性
 * @returns 命令面板 JSX
 */
export function CommandPanel({ currentView }: CommandPanelProps) {
    const { t } = useTranslation();
    const { commandsByView, confirmStatesByView, closeConfirm, handleConfirm } =
        useViewCommandState();
    const { subCommandsByView } = useSubViewCommandState();

    const viewCommands = commandsByView[currentView] ?? [];
    const subViewCommands = subCommandsByView[currentView] ?? [];
    const commandCount = viewCommands.length + subViewCommands.length;
    const confirmState = confirmStatesByView[currentView];

    return (
        <div className={styles.commandPanel}>
            {commandCount === 0 ? (
                <div className={styles.emptyPanel}>
                    <div className={styles.emptyIcon}>
                        <InfoIcon />
                    </div>
                </div>
            ) : (
                <>
                    <div className={styles.panelHeader}>
                        <span className={styles.panelTitle}>
                            {t("nav." + currentView)}
                        </span>
                        <span className={styles.commandCount}>
                            {commandCount} {t("common.commands")}
                        </span>
                    </div>
                    <div className={styles.commandList}>
                        {viewCommands.map((cmd) => (
                            <button
                                key={`view:${cmd.id}`}
                                className={styles.commandButton}
                                disabled={cmd.disabled}
                                data-highlight={cmd.highlight}
                                onClick={cmd.onClick}
                                title={cmd.title ?? t(cmd.titleKey ?? cmd.labelKey)}
                                aria-label={
                                    cmd.ariaLabel ??
                                    (cmd.ariaLabelKey ? t(cmd.ariaLabelKey) : undefined)
                                }
                            >
                                {(cmd.icon ?? CommandIcons[cmd.id]) && (
                                    <span className={styles.commandIcon}>
                                        {cmd.icon ?? CommandIcons[cmd.id]}
                                    </span>
                                )}
                                <span className={styles.commandLabel}>
                                    {t(cmd.labelKey)}
                                </span>
                            </button>
                        ))}
                        {subViewCommands.map((cmd) => (
                            <button
                                key={`sub:${cmd.id}`}
                                className={styles.commandButton}
                                disabled={cmd.disabled}
                                data-highlight={cmd.highlight}
                                onClick={cmd.onClick}
                                title={cmd.title ?? t(cmd.titleKey ?? cmd.labelKey)}
                                aria-label={
                                    cmd.ariaLabel ??
                                    (cmd.ariaLabelKey ? t(cmd.ariaLabelKey) : undefined)
                                }
                            >
                                {(cmd.icon ?? CommandIcons[cmd.id]) && (
                                    <span className={styles.commandIcon}>
                                        {cmd.icon ?? CommandIcons[cmd.id]}
                                    </span>
                                )}
                                <span className={styles.commandLabel}>
                                    {t(cmd.labelKey)}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}

            <ConfirmModal
                isOpen={Boolean(confirmState?.isOpen)}
                title={confirmState?.title ?? ""}
                message={confirmState?.message ?? ""}
                onConfirm={() => handleConfirm(currentView)}
                onCancel={() => closeConfirm(currentView)}
            />
        </div>
    );
}
