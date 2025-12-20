/**
 * 应用全局状态 Store
 *
 * 用于存放跨页面共享的 UI/会话相关状态，例如：
 * - 登录会话（仅内存态，不持久化）
 * - 语言、主题等全局设置（持久化到 localStorage）
 * - 调试开关（如前端日志桥接）
 * - 命令面板布局、系统消息提示等
 *
 * @module appStore
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/i18n";
import { THEME_ORDER } from "@/constants";
import type { CommandPanelPosition, ThemeId, UserSession } from "@/types";

interface AppState {
    /** 当前用户会话（未登录为 null） */
    user: UserSession | null;

    /**
     * 登录并写入会话
     *
     * @param user - 用户会话信息
     */
    login: (user: UserSession) => void;

    /** 退出登录并清空会话 */
    logout: () => void;

    /** 当前语言 */
    language: "zh" | "en";

    /**
     * 切换语言并同步到 i18n 实例
     *
     * @param lang - 目标语言
     */
    setLanguage: (lang: "zh" | "en") => void;

    // 主题：仅通过 CSS 变量切换，避免对各模块造成侵入式改动
    /** 当前主题 */
    theme: ThemeId;

    /**
     * 设置主题
     *
     * @param theme - 目标主题
     */
    setTheme: (theme: ThemeId) => void;

    /**
     * 循环切换主题
     *
     * @description 按 `THEME_ORDER` 顺序轮询（例如 dark → light → high-contrast → ...）
     */
    cycleTheme: () => void;

    // 调试：前端日志桥接到后端（终端输出）
    // 默认关闭，避免影响正常使用时的性能与噪音
    /** 是否启用前端日志桥接 */
    debugLogBridgeEnabled: boolean;

    /**
     * 设置前端日志桥接开关
     *
     * @param enabled - 是否启用
     */
    setDebugLogBridgeEnabled: (enabled: boolean) => void;

    // 命令面板位置
    /** 命令面板布局位置 */
    commandPanelPosition: CommandPanelPosition;

    /**
     * 设置命令面板布局位置
     *
     * @param position - left/right
     */
    setCommandPanelPosition: (position: CommandPanelPosition) => void;

    // 系统信息
    /** 顶部信息区显示的消息内容 */
    message: string;

    /** 消息严重级别（用于样式/高亮） */
    messageType: "info" | "warning" | "alarm" | null;

    /**
     * 设置系统消息
     *
     * @param msg - 消息文本
     * @param type - 消息类型，默认为 info
     */
    setMessage: (msg: string, type?: "info" | "warning" | "alarm") => void;

    /** 清空系统消息 */
    clearMessage: () => void;
}

/**
 * 应用全局状态 Store Hook（Zustand）
 *
 * 持久化策略：
 * - 使用 `zustand/middleware` 的 `persist` 将部分设置写入 localStorage
 * - 会话 `user` 不持久化，避免刷新/重启后产生“自动登录”或跨会话残留
 *
 * @returns 应用全局状态的 Store Hook
 */
export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            user: null,
            login: (user) => set({ user }),
            logout: () => set({ user: null }),

            language: "zh",
            setLanguage: (lang) => {
                i18n.changeLanguage(lang);
                set({ language: lang });
            },

            theme: "dark",
            setTheme: (theme) => set({ theme }),
            cycleTheme: () =>
                set((state) => {
                    const currentIndex = THEME_ORDER.indexOf(state.theme);
                    const next =
                        THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
                    return { theme: next };
                }),

            debugLogBridgeEnabled: false,
            setDebugLogBridgeEnabled: (enabled) =>
                set({ debugLogBridgeEnabled: enabled }),

            commandPanelPosition: "right",
            setCommandPanelPosition: (position) =>
                set({ commandPanelPosition: position }),

            message: "",
            messageType: null,
            setMessage: (msg, type = "info") =>
                set({ message: msg, messageType: type }),
            clearMessage: () => set({ message: "", messageType: null }),
        }),
        {
            // 默认保存在 localStorage
            name: "hmi-app-storage",
            // 部分持久化：只保存 UI 设置，不保存用户会话和调试开关
            // debugLogBridgeEnabled 作为调试功能，每次启动默认关闭，需要时手动开启
            partialize: (state) => ({
                language: state.language,
                theme: state.theme,
                commandPanelPosition: state.commandPanelPosition,
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.warn("Failed to rehydrate app storage:", error);
                    return;
                }
                if (state?.language) {
                    i18n.changeLanguage(state.language);
                }
            },
        },
    ),
);
