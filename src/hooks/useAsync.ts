import { useState, useCallback } from "react";
import { useNotificationStore } from "@/stores";

interface UseAsyncOptions {
    /** 成功时的通知标题 */
    successTitle?: string;
    /** 成功时的通知消息 */
    successMessage?: string;
    /** 失败时的通知标题 */
    errorTitle?: string;
    /** 是否在成功时显示通知 */
    showSuccessNotification?: boolean;
    /** 是否在失败时显示通知 */
    showErrorNotification?: boolean;
}

interface UseAsyncReturn<T> {
    /** 执行异步操作 */
    execute: () => Promise<T | undefined>;
    /** 是否正在加载 */
    loading: boolean;
    /** 错误信息 */
    error: string | null;
    /** 清除错误 */
    clearError: () => void;
}

/**
 * 统一处理异步操作的 Hook
 * 自动处理加载状态、错误状态和通知
 */
export function useAsync<T>(
    asyncFn: () => Promise<T>,
    options: UseAsyncOptions = {},
): UseAsyncReturn<T> {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { addNotification } = useNotificationStore();

    const {
        successTitle,
        successMessage,
        errorTitle,
        showSuccessNotification = false,
        showErrorNotification = true,
    } = options;

    const execute = useCallback(async (): Promise<T | undefined> => {
        setLoading(true);
        setError(null);

        try {
            const result = await asyncFn();

            if (showSuccessNotification && successTitle) {
                addNotification({
                    type: "success",
                    title: successTitle,
                    message: successMessage,
                });
            }

            return result;
        } catch (err) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            setError(errorMessage);

            if (showErrorNotification) {
                addNotification({
                    type: "error",
                    title: errorTitle || "Error",
                    message: errorMessage,
                });
            }

            return undefined;
        } finally {
            setLoading(false);
        }
    }, [
        asyncFn,
        addNotification,
        successTitle,
        successMessage,
        errorTitle,
        showSuccessNotification,
        showErrorNotification,
    ]);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return { execute, loading, error, clearError };
}
