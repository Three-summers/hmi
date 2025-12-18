import { useCallback } from "react";
import { useNotificationStore, NotificationType } from "@/stores";

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
 */
export function useNotify(): UseNotifyReturn {
    const { addNotification } = useNotificationStore();

    const notify = useCallback(
        (type: NotificationType, title: string, message?: string) => {
            addNotification({ type, title, message });
        },
        [addNotification],
    );

    const success = useCallback(
        (title: string, message?: string) => notify("success", title, message),
        [notify],
    );

    const error = useCallback(
        (title: string, message?: string) => notify("error", title, message),
        [notify],
    );

    const warning = useCallback(
        (title: string, message?: string) => notify("warning", title, message),
        [notify],
    );

    const info = useCallback(
        (title: string, message?: string) => notify("info", title, message),
        [notify],
    );

    return { success, error, warning, info, notify };
}
