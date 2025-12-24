/**
 * 通知 Hook
 *
 * 对 notificationStore 的简单封装，提供类型化的通知方法。
 * 使用 useCallback 确保引用稳定，避免触发消费组件的无关重渲染。
 *
 * @module useNotify
 */

import { useCallback } from "react";
import { useNotificationStore, NotificationType } from "@/stores";

/** Hook 返回值 */
interface UseNotifyReturn {
    /** 显示成功通知 */
    success: (title: string, message?: string) => void;
    /** 显示错误通知 */
    error: (title: string, message?: string) => void;
    /** 显示警告通知 */
    warning: (title: string, message?: string) => void;
    /** 显示信息通知 */
    info: (title: string, message?: string) => void;
    /** 通用通知方法 */
    notify: (type: NotificationType, title: string, message?: string) => void;
}

/**
 * 简化的通知 Hook
 *
 * @returns 通知方法集合
 *
 * @example
 * ```tsx
 * const { success, error, warning, info } = useNotify();
 *
 * // 显示成功通知
 * success("保存成功", "配置已保存到本地");
 *
 * // 显示错误通知
 * error("连接失败", "无法连接到服务器");
 * ```
 */
export function useNotify(): UseNotifyReturn {
    // 只订阅 action（函数引用稳定），避免通知列表变化导致本 Hook/消费组件无关重渲染
    const addNotification = useNotificationStore(
        (state) => state.addNotification,
    );

    // 通用通知方法：调用 store 的 addNotification
    const notify = useCallback(
        (type: NotificationType, title: string, message?: string) => {
            addNotification({ type, title, message });
        },
        [addNotification],
    );

    // 成功通知快捷方法
    const success = useCallback(
        (title: string, message?: string) => notify("success", title, message),
        [notify],
    );

    // 错误通知快捷方法
    const error = useCallback(
        (title: string, message?: string) => notify("error", title, message),
        [notify],
    );

    // 警告通知快捷方法
    const warning = useCallback(
        (title: string, message?: string) => notify("warning", title, message),
        [notify],
    );

    // 信息通知快捷方法
    const info = useCallback(
        (title: string, message?: string) => notify("info", title, message),
        [notify],
    );

    return { success, error, warning, info, notify };
}
