import { useEffect, useCallback } from "react";
import { useNavigationStore, useAlarmStore } from "@/stores";
import type { ViewId } from "@/types/semi-e95";

const VIEW_KEYS: Record<string, ViewId> = {
    F1: "jobs",
    F2: "system",
    F3: "monitor",
    F4: "alarms",
    F5: "recipes",
    F6: "setup",
    F7: "help",
};

export function useKeyboardShortcuts() {
    const { setCurrentView } = useNavigationStore();
    const { acknowledgeAll } = useAlarmStore();

    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            // Don't handle shortcuts if user is typing in an input
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                event.target instanceof HTMLSelectElement
            ) {
                return;
            }

            const key = event.key;

            // F1-F7: Navigate between views
            if (VIEW_KEYS[key]) {
                event.preventDefault();
                setCurrentView(VIEW_KEYS[key]);
                return;
            }

            // ESC: Emergency stop (for now just shows alert)
            if (key === "Escape") {
                event.preventDefault();
                // TODO: Implement actual emergency stop via Tauri command
                console.log("Emergency stop triggered");
                return;
            }

            // F11: Toggle fullscreen
            if (key === "F11") {
                event.preventDefault();
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    document.documentElement.requestFullscreen();
                }
                return;
            }

            // Ctrl+A: Acknowledge all alarms
            if (event.ctrlKey && key.toLowerCase() === "a") {
                event.preventDefault();
                acknowledgeAll();
                return;
            }

            // Ctrl+Shift+D: Toggle dev tools (handled by Tauri)
        },
        [setCurrentView, acknowledgeAll],
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}
