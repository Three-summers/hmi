/**
 * 异步操作封装 Hook
 *
 * 目标：将常见的异步执行模式统一起来，减少页面里重复的样板代码：
 * - loading / error 状态管理
 * - 统一的成功/失败通知（可配置）
 *
 * @module useAsync
 */

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
 *
 * @template T - 异步函数返回值类型
 * @param asyncFn - 需要执行的异步函数
 * @param options - 通知与显示策略配置
 * @returns 包含 execute/loading/error/clearError 的对象
 *
 * @description
 * - `execute()` 内部会捕获异常并转为字符串写入 `error`
 * - 默认仅在失败时显示通知（`showErrorNotification=true`），成功通知需显式开启
 */
export function useAsync<T>(
    asyncFn: () => Promise<T>,
    options: UseAsyncOptions = {},
): UseAsyncReturn<T> {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // 只订阅 action，避免通知列表变化导致本 Hook/使用方无关重渲染
    const addNotification = useNotificationStore(
        (state) => state.addNotification,
    );

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
