/**
 * 命令面板
 *
 * 根据当前视图渲染对应的“命令按钮”列表，并提供统一的确认弹窗能力：
 * - 每个视图通过 `viewCommands` 配置其按钮集合（文案 key、行为、状态高亮等）
 * - 对需要二次确认的操作，通过 `useConfirm` 弹出确认框
 *
 * @module CommandPanel
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { ViewId, CommandButtonConfig } from "@/types";
import { useAlarmStore } from "@/stores";
import { useConfirm, useNotify } from "@/hooks";
import { CommandIcons, WarningIcon } from "@/components/common";
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
    const { acknowledgeAll, clearAcknowledged, alarms } = useAlarmStore(
        useShallow((state) => ({
            acknowledgeAll: state.acknowledgeAll,
            clearAcknowledged: state.clearAcknowledged,
            alarms: state.alarms,
        })),
    );
    const { success, error, warning, info } = useNotify();
    // 确认弹窗状态与操作入口
    const { confirmState, showConfirm, closeConfirm, handleConfirm } = useConfirm();

    const unackedCount = useMemo(
        () => alarms.filter((a) => !a.acknowledged).length,
        [alarms],
    );

    // 各页面的命令按钮配置（含实际处理逻辑）
    // 使用 useMemo：保证按钮数组引用稳定，避免无意义的子组件重渲染。
    const viewCommands: Record<ViewId, CommandButtonConfig[]> = useMemo(() => ({
        jobs: [
            {
                id: "newJob",
                labelKey: "jobs.newJob",
                onClick: () => info(t("notification.newJob"), t("notification.creatingJob")),
            },
            {
                id: "runJob",
                labelKey: "jobs.runJob",
                highlight: "processing",
                onClick: () =>
                    success(
                        t("notification.jobStarted"),
                        t("notification.jobRunning"),
                    ),
            },
            {
                id: "pauseJob",
                labelKey: "common.pause",
                onClick: () =>
                    warning(t("notification.jobPaused"), t("notification.processPaused")),
            },
            {
                id: "stopJob",
                labelKey: "jobs.stopJob",
                highlight: "alarm",
                onClick: () =>
                    showConfirm(
                        t("jobs.stopJob"),
                        t("jobs.stopConfirm"),
                        () =>
                            error(
                                t("notification.jobStopped"),
                                t("notification.processTerminated"),
                            ),
                    ),
            },
        ],
        system: [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(t("notification.refreshing"), t("notification.systemDataRefreshed")),
            },
            {
                id: "start",
                labelKey: "common.start",
                highlight: "attention",
                onClick: () =>
                    success(
                        t("notification.systemStarted"),
                        t("notification.allSubsystemsOnline"),
                    ),
            },
            {
                id: "stop",
                labelKey: "common.stop",
                highlight: "alarm",
                onClick: () =>
                    showConfirm(
                        t("system.title"),
                        t("system.emergencyStopConfirm"),
                        () =>
                            error(
                                t("notification.systemStopped"),
                                t("notification.allSubsystemsShutdown"),
                            ),
                    ),
            },
            {
                id: "emergency",
                labelKey: "system.emergencyStop",
                highlight: "alarm",
                onClick: () =>
                    showConfirm(
                        t("system.emergencyStop"),
                        t("system.emergencyStopConfirm"),
                        () =>
                            error(
                                t("notification.emergencyStop"),
                                t("notification.allOperationsHalted"),
                            ),
                    ),
            },
        ],
        monitor: [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(
                        t("notification.dataRefreshed"),
                        t("notification.sensorDataUpdated"),
                    ),
            },
            {
                id: "pause",
                labelKey: "common.pause",
                onClick: () =>
                    warning(
                        t("notification.monitoringPaused"),
                        t("notification.dataCollectionPaused"),
                    ),
            },
            {
                id: "export",
                labelKey: "monitor.exportData",
                onClick: () =>
                    success(
                        t("notification.exportComplete"),
                        t("notification.dataExportedToFile"),
                    ),
            },
        ],
        recipes: [
            {
                id: "newRecipe",
                labelKey: "recipes.newRecipe",
                onClick: () =>
                    info(t("notification.newRecipe"), t("notification.creatingRecipe")),
            },
            {
                id: "loadRecipe",
                labelKey: "recipes.loadRecipe",
                highlight: "processing",
                onClick: () =>
                    success(
                        t("notification.recipeLoaded"),
                        t("notification.recipeReadyForExecution"),
                    ),
            },
            {
                id: "editRecipe",
                labelKey: "recipes.editRecipe",
                onClick: () =>
                    info(t("notification.editMode"), t("notification.recipeEditorOpened")),
            },
            {
                id: "deleteRecipe",
                labelKey: "recipes.deleteRecipe",
                highlight: "warning",
                onClick: () =>
                    showConfirm(
                        t("recipes.deleteRecipe"),
                        t("recipes.deleteConfirm"),
                        () =>
                            warning(
                                t("notification.recipeDeleted"),
                                t("notification.recipeRemoved"),
                            ),
                    ),
            },
        ],
        files: [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(t("notification.helpRefreshed"), t("notification.fileListRefreshed")),
            },
        ],
        setup: [
            {
                id: "connect",
                labelKey: "setup.connect",
                highlight: "attention",
                onClick: () =>
                    success(t("notification.connected"), t("notification.connectionEstablished")),
            },
            {
                id: "disconnect",
                labelKey: "setup.disconnect",
                onClick: () =>
                    warning(t("notification.disconnected"), t("notification.connectionClosed")),
            },
            {
                id: "save",
                labelKey: "common.save",
                highlight: "processing",
                onClick: () =>
                    success(
                        t("notification.settingsSaved"),
                        t("notification.configurationSaved"),
                    ),
            },
            {
                id: "reset",
                labelKey: "common.reset",
                highlight: "warning",
                onClick: () =>
                    showConfirm(
                        t("setup.resetSettings"),
                        t("setup.resetConfirm"),
                        () =>
                            warning(
                                t("notification.settingsReset"),
                                t("notification.settingsRestoredToDefaults"),
                            ),
                    ),
            },
        ],
        alarms: [
            {
                id: "acknowledgeAll",
                labelKey: "alarm.acknowledgeAll",
                highlight: unackedCount > 0 ? "attention" : undefined,
                disabled: unackedCount === 0,
                onClick: () => {
                    acknowledgeAll();
                    success(
                        t("notification.alarmsAcknowledged"),
                        t("notification.alarmsAcknowledgedCount", { count: unackedCount }),
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
        help: [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(t("notification.helpRefreshed"), t("notification.helpContentRefreshed")),
            },
        ],
    }), [
        acknowledgeAll,
        clearAcknowledged,
        error,
        info,
        showConfirm,
        success,
        t,
        unackedCount,
        warning,
    ]);

    const commands = viewCommands[currentView] || [];

    if (commands.length === 0) {
        return (
            <div className={styles.commandPanel}>
                <div className={styles.emptyPanel}>
                    <div className={styles.emptyIcon}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
                        </svg>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.commandPanel}>
            <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>
                    {t("nav." + currentView)}
                </span>
                <span className={styles.commandCount}>
                    {commands.length} {t("common.commands")}
                </span>
            </div>
            <div className={styles.commandList}>
                {commands.map((cmd) => (
                    <button
                        key={cmd.id}
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
