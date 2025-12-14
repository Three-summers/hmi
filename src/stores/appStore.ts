import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/i18n";
import type { CommandPanelPosition, UserSession } from "@/types";

interface AppState {
    // User session
    user: UserSession | null;
    login: (user: UserSession) => void;
    logout: () => void;

    // Language
    language: "zh" | "en";
    setLanguage: (lang: "zh" | "en") => void;

    // Layout
    commandPanelPosition: CommandPanelPosition;
    setCommandPanelPosition: (position: CommandPanelPosition) => void;

    // System message
    message: string;
    messageType: "info" | "warning" | "alarm" | null;
    setMessage: (msg: string, type?: "info" | "warning" | "alarm") => void;
    clearMessage: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            // User session
            user: null,
            login: (user) => set({ user }),
            logout: () => set({ user: null }),

            // Language
            language: "zh",
            setLanguage: (lang) => {
                i18n.changeLanguage(lang);
                set({ language: lang });
            },

            // Layout
            commandPanelPosition: "right",
            setCommandPanelPosition: (position) =>
                set({ commandPanelPosition: position }),

            // System message
            message: "",
            messageType: null,
            setMessage: (msg, type = "info") =>
                set({ message: msg, messageType: type }),
            clearMessage: () => set({ message: "", messageType: null }),
        }),
        {
            name: "hmi-app-storage",
            partialize: (state) => ({
                language: state.language,
                commandPanelPosition: state.commandPanelPosition,
                // Don't persist user session for security
            }),
            onRehydrateStorage: () => (state) => {
                // Sync language with i18n after rehydration
                if (state?.language) {
                    i18n.changeLanguage(state.language);
                }
            },
        },
    ),
);
