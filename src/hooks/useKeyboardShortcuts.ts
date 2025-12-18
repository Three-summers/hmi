import { useEffect, useCallback } from "react";
import { useNavigationStore, useAlarmStore } from "@/stores";
import type { ViewId } from "@/types/semi-e95";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
            // 如果用户正在输入，则不处理快捷键
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                event.target instanceof HTMLSelectElement
            ) {
                return;
            }

            const key = event.key;

            // F1-F7: 在视图间切换
            if (VIEW_KEYS[key]) {
                event.preventDefault();
                setCurrentView(VIEW_KEYS[key]);
                return;
            }

            // ESC: 紧急停止，目前只显示日志
            if (key === "Escape") {
                event.preventDefault();
                // TODO：后续可通过 Tauri 命令接入真实的急停逻辑
                console.log("Emergency stop triggered");
                return;
            }

            // F11: 切换全屏
            if (key === "F11") {
                event.preventDefault();
                let window = getCurrentWindow();
                window.isFullscreen().then((isFullscreen) => {
                    window.setFullscreen(!isFullscreen);
                });
                return;
            }

            // Ctrl+A: 确定所有警报
            if (event.ctrlKey && key.toLowerCase() === "a") {
                event.preventDefault();
                acknowledgeAll();
                return;
            }

            // Ctrl+Shift+D：开发工具开关（由 Tauri 侧处理）
        },
        [setCurrentView, acknowledgeAll],
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}
