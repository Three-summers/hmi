/**
 * SEMI E95 UI 类型定义
 *
 * 该文件用于描述 HMI 前端的核心 UI 模型（视图 ID、按钮配置、对话框配置等），
 * 以 TypeScript 类型的方式约束各模块之间的数据契约，降低跨模块联动时的维护成本。
 *
 * @module semi-e95
 */

import type { ReactNode } from "react";

/** 主导航视图 ID */
export type ViewId =
    | "jobs"
    | "system"
    | "monitor"
    | "recipes"
    | "files"
    | "setup"
    | "alarms"
    | "help";

/** 按钮行为类型（SEMI E95） */
export type ButtonBehavior = "momentary" | "toggle";

/** 按钮高亮状态（语义色） */
export type HighlightStatus =
    | "none"
    | "alarm"
    | "warning"
    | "processing"
    | "attention";

/** 对话框类型（SEMI E95） */
export type DialogType = "info" | "input" | "message";

/** 消息对话框图标类型 */
export type MessageIconType =
    | "information"
    | "progress"
    | "attention"
    | "error";

/** 对话框按钮配置 */
export interface DialogButtons {
    ok?: boolean;
    cancel?: boolean;
    close?: boolean;
    yes?: boolean;
    no?: boolean;
    apply?: boolean;
}

/** 主导航按钮配置 */
export interface NavButtonConfig {
    id: ViewId;
    labelKey: string;
    icon?: string;
    highlight?: HighlightStatus;
    hasUnfinishedTask?: boolean;
}

/** 命令按钮配置 */
export interface CommandButtonConfig {
    id: string;
    labelKey: string;
    /**
     * 可选图标节点
     *
     * @description
     * - 对于 CommandPanel：未提供时可按 `id` 映射到内置图标表（例如 CommandIcons）
     * - 对于 TitlePanel/CommandSection：通常直接传入 ReactNode
     */
    icon?: ReactNode;
    /** tooltip 文案 key（未提供则默认使用 labelKey） */
    titleKey?: string;
    /** tooltip 文案（用于动态内容，例如“缩放: 125%”） */
    title?: string;
    /** aria-label 文案 key（未提供则默认使用 labelKey） */
    ariaLabelKey?: string;
    /** aria-label 文案（用于动态内容） */
    ariaLabel?: string;
    disabled?: boolean;
    highlight?: HighlightStatus;
    behavior?: ButtonBehavior;
    onClick?: () => void | Promise<void>;
}

/** 对话框配置 */
export interface DialogConfig {
    id: string;
    type: DialogType;
    title: string;
    /** 自定义内容（例如复杂表单、进度条等） */
    content?: ReactNode;
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

/** 报警项 */
export interface AlarmItem {
    id: string;
    severity: "alarm" | "warning" | "info";
    message: string;
    timestamp: Date;
    acknowledged: boolean;
}

/** 通信状态 */
export interface CommStatus {
    connected: boolean;
    mode: "local" | "remote";
    protocol?: string;
}

/** 用户会话 */
export interface UserSession {
    id: string;
    name: string;
    role: "operator" | "engineer" | "admin";
}

/** 命令面板布局位置 */
export type CommandPanelPosition = "left" | "right";

/** UI 主题标识（通过 `data-theme` 切换 CSS 变量） */
export type ThemeId = "dark" | "light" | "high-contrast";
