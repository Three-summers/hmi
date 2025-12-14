import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ViewId, CommandButtonConfig } from "@/types";
import { useAlarmStore, useNotificationStore } from "@/stores";
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

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalIcon}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
            </svg>
          </div>
          <h3 className={styles.modalTitle}>{title}</h3>
        </div>
        <p className={styles.modalMessage}>{message}</p>
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.confirmBtn} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// SVG Icons for command buttons
const CommandIcons: Record<string, JSX.Element> = {
  newJob: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>,
  runJob: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  stopJob: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>,
  pauseJob: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>,
  refresh: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>,
  start: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>,
  newRecipe: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-7V3.5L18.5 9H13z"/></svg>,
  editRecipe: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>,
  deleteRecipe: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>,
  loadRecipe: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>,
  save: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>,
  reset: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>,
  acknowledgeAll: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/></svg>,
  clearAll: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>,
  export: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>,
  connect: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>,
  disconnect: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>,
  emergency: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>,
};

export function CommandPanel({ currentView }: CommandPanelProps) {
  const { t } = useTranslation();
  const { acknowledgeAll, clearAcknowledged, alarms } = useAlarmStore();
  const { addNotification } = useNotificationStore();
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {} });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  const closeConfirm = () => {
    setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: () => {} });
  };

  const handleConfirm = () => {
    confirmModal.onConfirm();
    closeConfirm();
  };

  const notify = (type: "success" | "error" | "warning" | "info", title: string, message?: string) => {
    addNotification({ type, title, message });
  };

  const unackedCount = alarms.filter(a => !a.acknowledged).length;

  // Command configurations for each view with actual handlers
  const viewCommands: Record<ViewId, CommandButtonConfig[]> = {
    jobs: [
      { id: "newJob", labelKey: "jobs.newJob", onClick: () => notify("info", "New Job", "Creating new job...") },
      { id: "runJob", labelKey: "jobs.runJob", highlight: "processing", onClick: () => notify("success", "Job Started", "Process job is now running") },
      { id: "pauseJob", labelKey: "common.pause", onClick: () => notify("warning", "Job Paused", "Process has been paused") },
      { id: "stopJob", labelKey: "jobs.stopJob", highlight: "alarm", onClick: () => showConfirm("Stop Job", "Are you sure you want to stop the current job?", () => notify("error", "Job Stopped", "Process has been terminated")) },
    ],
    system: [
      { id: "refresh", labelKey: "common.refresh", onClick: () => notify("info", "Refreshing", "System data refreshed") },
      { id: "start", labelKey: "common.start", highlight: "attention", onClick: () => notify("success", "System Started", "All subsystems are now online") },
      { id: "stop", labelKey: "common.stop", highlight: "alarm", onClick: () => showConfirm("Stop System", "Are you sure you want to stop the system?", () => notify("error", "System Stopped", "All subsystems have been shut down")) },
      { id: "emergency", labelKey: "Emergency Stop", highlight: "alarm", onClick: () => showConfirm("Emergency Stop", "This will immediately halt all operations. Continue?", () => notify("error", "EMERGENCY STOP", "All operations immediately halted!")) },
    ],
    monitor: [
      { id: "refresh", labelKey: "common.refresh", onClick: () => notify("info", "Data Refreshed", "Sensor data has been updated") },
      { id: "pause", labelKey: "common.pause", onClick: () => notify("warning", "Monitoring Paused", "Data collection paused") },
      { id: "export", labelKey: "Export Data", onClick: () => notify("success", "Export Complete", "Data exported to file") },
    ],
    recipes: [
      { id: "newRecipe", labelKey: "recipes.newRecipe", onClick: () => notify("info", "New Recipe", "Creating new recipe...") },
      { id: "loadRecipe", labelKey: "Load Recipe", highlight: "processing", onClick: () => notify("success", "Recipe Loaded", "Recipe is ready for execution") },
      { id: "editRecipe", labelKey: "recipes.editRecipe", onClick: () => notify("info", "Edit Mode", "Recipe editor opened") },
      { id: "deleteRecipe", labelKey: "recipes.deleteRecipe", highlight: "warning", onClick: () => showConfirm("Delete Recipe", "Are you sure you want to delete this recipe?", () => notify("warning", "Recipe Deleted", "Recipe has been removed")) },
    ],
    datalog: [
      { id: "refresh", labelKey: "common.refresh", onClick: () => notify("info", "Refreshed", "Datalog refreshed") },
      { id: "export", labelKey: "Export", onClick: () => notify("success", "Exported", "Data exported successfully") },
      { id: "save", labelKey: "common.save", onClick: () => notify("success", "Saved", "Datalog saved") },
    ],
    setup: [
      { id: "connect", labelKey: "Connect", highlight: "attention", onClick: () => notify("success", "Connected", "Connection established") },
      { id: "disconnect", labelKey: "Disconnect", onClick: () => notify("warning", "Disconnected", "Connection closed") },
      { id: "save", labelKey: "common.save", highlight: "processing", onClick: () => notify("success", "Settings Saved", "Configuration has been saved") },
      { id: "reset", labelKey: "common.reset", highlight: "warning", onClick: () => showConfirm("Reset Settings", "Reset all settings to defaults?", () => notify("warning", "Settings Reset", "All settings restored to defaults")) },
    ],
    alarms: [
      {
        id: "acknowledgeAll",
        labelKey: "alarm.acknowledgeAll",
        highlight: unackedCount > 0 ? "attention" : undefined,
        disabled: unackedCount === 0,
        onClick: () => {
          acknowledgeAll();
          notify("success", "Alarms Acknowledged", `${unackedCount} alarm(s) acknowledged`);
        }
      },
      {
        id: "clearAll",
        labelKey: "alarm.clearAll",
        highlight: "warning",
        onClick: () => showConfirm("Clear Alarms", "Clear all acknowledged alarms from history?", () => {
          clearAcknowledged();
          notify("info", "Alarms Cleared", "Alarm history has been cleared");
        })
      },
    ],
    help: [
      { id: "refresh", labelKey: "common.refresh", onClick: () => notify("info", "Refreshed", "Help content refreshed") },
    ],
  };

  const commands = viewCommands[currentView] || [];

  if (commands.length === 0) {
    return (
      <div className={styles.commandPanel}>
        <div className={styles.emptyPanel}>
          <div className={styles.emptyIcon}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.commandPanel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t("nav." + currentView)}</span>
        <span className={styles.commandCount}>{commands.length} commands</span>
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
              <span className={styles.commandIcon}>{CommandIcons[cmd.id]}</span>
            )}
            <span className={styles.commandLabel}>{t(cmd.labelKey)}</span>
          </button>
        ))}
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
