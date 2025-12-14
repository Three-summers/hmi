/** SEMI E95 UI Type Definitions */

/** Navigation view IDs */
export type ViewId =
  | "jobs"
  | "system"
  | "monitor"
  | "recipes"
  | "datalog"
  | "setup"
  | "alarms"
  | "help";

/** Button behavior types per SEMI E95 */
export type ButtonBehavior = "momentary" | "toggle";

/** Button highlight status colors */
export type HighlightStatus =
  | "none"
  | "alarm"
  | "warning"
  | "processing"
  | "attention";

/** Dialog types per SEMI E95 */
export type DialogType = "info" | "input" | "message";

/** Message dialog icon types */
export type MessageIconType = "information" | "progress" | "attention" | "error";

/** Dialog button configurations */
export interface DialogButtons {
  ok?: boolean;
  cancel?: boolean;
  close?: boolean;
  yes?: boolean;
  no?: boolean;
  apply?: boolean;
}

/** Navigation button configuration */
export interface NavButtonConfig {
  id: ViewId;
  labelKey: string;
  icon?: string;
  highlight?: HighlightStatus;
  hasUnfinishedTask?: boolean;
}

/** Command button configuration */
export interface CommandButtonConfig {
  id: string;
  labelKey: string;
  icon?: string;
  disabled?: boolean;
  highlight?: HighlightStatus;
  behavior?: ButtonBehavior;
  onClick?: () => void;
}

/** Dialog configuration */
export interface DialogConfig {
  id: string;
  type: DialogType;
  title: string;
  content?: React.ReactNode;
  message?: string;
  icon?: MessageIconType;
  buttons: DialogButtons;
  onOk?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  onYes?: () => void;
  onNo?: () => void;
  onApply?: () => void;
}

/** Alarm item */
export interface AlarmItem {
  id: string;
  severity: "alarm" | "warning" | "info";
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

/** Communication status */
export interface CommStatus {
  connected: boolean;
  mode: "local" | "remote";
  protocol?: string;
}

/** User session */
export interface UserSession {
  id: string;
  name: string;
  role: "operator" | "engineer" | "admin";
}

/** Layout position for command panel */
export type CommandPanelPosition = "left" | "right";
