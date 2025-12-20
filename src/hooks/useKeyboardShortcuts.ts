/**
 * 键盘快捷键 Hook
 *
 * 统一管理全局键盘事件，避免各页面分散注册造成冲突或清理遗漏。
 *
 * 默认策略：
 * - 用户正在输入（input/textarea/select/contenteditable）时不拦截快捷键
 * - 模态对话框打开时，优先保证对话框自身交互（例如 Escape 关闭）
 * - 视图切换快捷键来源于 `VIEW_HOTKEY_TO_VIEW_ID`
 *
 * @module useKeyboardShortcuts
 */

import { useEffect, useCallback } from "react";
import { useNavigationStore, useAlarmStore } from "@/stores";
import { toggleFullscreen } from "@/platform/window";
import { VIEW_HOTKEY_TO_VIEW_ID } from "@/constants";

/**
 * 判断事件目标是否为“可编辑输入区域”
 *
 * @param target - 键盘事件目标
 * @returns 是否处于输入场景
 * @description 输入场景下应保留浏览器/控件的默认快捷键（如复制粘贴、方向键移动光标等）。
 */
function isEditableTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}

/**
 * 判断是否存在打开的模态对话框
 *
 * @returns 是否有模态对话框处于打开状态
 */
function isModalOpen(): boolean {
    // Dialog 使用 aria-modal=true，打开时应避免全局快捷键干扰其交互
    return Boolean(
        document.querySelector('[role="dialog"][aria-modal="true"]'),
    );
}

/**
 * 注册全局键盘快捷键
 *
 * @returns void
 * @description 该 Hook 仅负责注册/清理事件监听，不返回任何值。
 */
export function useKeyboardShortcuts() {
    const { setCurrentView } = useNavigationStore();
    const { acknowledgeAll } = useAlarmStore();

    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            // 如果用户正在输入，则不处理快捷键
            if (isEditableTarget(event.target)) {
                return;
            }

            // 对话框打开时，优先保证对话框自己的键盘交互（例如 Escape 关闭）
            // 仅保留全屏快捷键，避免切视图/触发操作影响用户的“确认/取消”流程。
            if (isModalOpen() && event.key !== "F11") {
                return;
            }

            const view = VIEW_HOTKEY_TO_VIEW_ID[event.key];
            if (view) {
                event.preventDefault();
                setCurrentView(view);
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                // TODO：后续可通过 Tauri 命令接入真实的急停逻辑
                console.log("Emergency stop triggered");
                return;
            }

            if (event.key === "F11") {
                event.preventDefault();
                // 全屏切换失败不应影响主流程，这里选择静默失败（UI 侧可在需要时补通知）
                void toggleFullscreen().catch(() => {});
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
                event.preventDefault();
                // 快捷键：Ctrl/Cmd + A → “确认全部告警”（与默认全选冲突，因此仅在非输入场景生效）
                acknowledgeAll();
                return;
            }
        },
        [setCurrentView, acknowledgeAll],
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}
