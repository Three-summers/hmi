import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/i18n";
import type { CommandPanelPosition, UserSession } from "@/types";

interface AppState {
    user: UserSession | null;
    login: (user: UserSession) => void;
    logout: () => void;

    language: "zh" | "en";
    setLanguage: (lang: "zh" | "en") => void;

    // 命令面板位置
    commandPanelPosition: CommandPanelPosition;
    setCommandPanelPosition: (position: CommandPanelPosition) => void;

    // 系统信息
    message: string;
    messageType: "info" | "warning" | "alarm" | null;
    setMessage: (msg: string, type?: "info" | "warning" | "alarm") => void;
    clearMessage: () => void;
}

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
            // 部分持久化，只保存 language 和 layout 设置，为安全起见不保存用户会话
            partialize: (state) => ({
                language: state.language,
                commandPanelPosition: state.commandPanelPosition,
            }),
            onRehydrateStorage: () => (state) => {
                if (state?.language) {
                    i18n.changeLanguage(state.language);
                }
            },
        },
    ),
);
