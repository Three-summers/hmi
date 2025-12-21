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
    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} onClick={onCancel}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
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
    const { commandsByView, confirmState, closeConfirm, handleConfirm } =
        useViewCommandState();
    const { subCommandsByView } = useSubViewCommandState();

    const viewCommands = commandsByView[currentView] ?? [];
    const subViewCommands = subCommandsByView[currentView] ?? [];
    const commandCount = viewCommands.length + subViewCommands.length;

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
                                title={t(cmd.labelKey)}
                            >
                                {CommandIcons[cmd.id] && (
                                    <span className={styles.commandIcon}>
                                        {CommandIcons[cmd.id]}
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
                                title={t(cmd.labelKey)}
                            >
                                {CommandIcons[cmd.id] && (
                                    <span className={styles.commandIcon}>
                                        {CommandIcons[cmd.id]}
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
                isOpen={confirmState.isOpen}
                title={confirmState.title}
                message={confirmState.message}
                onConfirm={handleConfirm}
                onCancel={closeConfirm}
            />
        </div>
    );
}
