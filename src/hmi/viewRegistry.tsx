import { lazy, type LazyExoticComponent } from "react";
import type { HighlightStatus, ViewId } from "@/types";

/**
 * HMI 视图注册表（View Registry）
 *
 * 设计目的：
 * - 统一管理“主导航/视图加载/图标/默认文案 key”等元信息，减少分散的硬编码
 * - 让 MainLayout 作为可复用的“壳”，未来在其它项目中只需要替换/扩展注册表即可复用整套布局
 *
 * 使用方式：
 * - NavPanel：使用 `HMI_NAV_ITEMS` 渲染导航按钮与图标
 * - InfoPanel：使用 `HMI_VIEW_COMPONENTS` 渲染主页面组件（支持 Keep-Alive）
 */

export interface HmiNavItem {
    id: ViewId;
    labelKey: string;
    icon: JSX.Element;
    highlight?: HighlightStatus;
}

const JobsView = lazy(() => import("@/components/views/Jobs"));
const SystemView = lazy(() => import("@/components/views/System"));
const MonitorView = lazy(() => import("@/components/views/Monitor"));
const RecipesView = lazy(() => import("@/components/views/Recipes"));
const FilesView = lazy(() => import("@/components/views/Files"));
const SetupView = lazy(() => import("@/components/views/Setup"));
const AlarmsView = lazy(() => import("@/components/views/Alarms"));
const HelpView = lazy(() => import("@/components/views/Help"));

export const HMI_NAV_ITEMS: HmiNavItem[] = [
    {
        id: "jobs",
        labelKey: "nav.jobs",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
        ),
    },
    {
        id: "system",
        labelKey: "nav.system",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
        ),
    },
    {
        id: "monitor",
        labelKey: "nav.monitor",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
            </svg>
        ),
    },
    {
        id: "recipes",
        labelKey: "nav.recipes",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
        ),
    },
    {
        id: "files",
        labelKey: "nav.files",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
        ),
    },
    {
        id: "setup",
        labelKey: "nav.setup",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
            </svg>
        ),
    },
    {
        id: "alarms",
        labelKey: "nav.alarms",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            </svg>
        ),
    },
    {
        id: "help",
        labelKey: "nav.help",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
            </svg>
        ),
    },
];

export const HMI_VIEW_COMPONENTS = {
    jobs: JobsView,
    system: SystemView,
    monitor: MonitorView,
    recipes: RecipesView,
    files: FilesView,
    setup: SetupView,
    alarms: AlarmsView,
    help: HelpView,
} satisfies Record<ViewId, LazyExoticComponent<() => JSX.Element>>;
