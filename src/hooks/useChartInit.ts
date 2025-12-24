/**
 * 图表初始化辅助 hook
 *
 * 目的：
 * - 将“初始化可能失败”的逻辑从组件中抽离，统一状态/错误/重试的约定
 * - 避免 uPlot/Canvas 等初始化异常导致页面白屏
 *
 * @module hooks/useChartInit
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorMessage } from "@/utils/error";

export type ChartInitStatus = "idle" | "loading" | "ready" | "error";

export interface ChartInitResult<T> {
    ok: boolean;
    value: T | null;
    error: unknown;
    message: string | null;
}

export interface UseChartInitOptions {
    /** 初始化失败时的回调（可用于日志/提示） */
    onError?: (message: string, error: unknown) => void;
}

/**
 * 纯函数版本：执行 factory 并返回标准化结果
 *
 * 说明：
 * - 便于在 Node SSR 测试中覆盖“成功/失败”分支（无需运行 React hook）
 */
export function runChartFactory<T>(factory: () => T): ChartInitResult<T> {
    try {
        const value = factory();
        return { ok: true, value, error: null, message: null };
    } catch (err) {
        const message = toErrorMessage(err);
        return { ok: false, value: null, error: err, message };
    }
}

/**
 * useChartInit
 *
 * 使用方式：
 * - 在“需要初始化一次”的地方调用 `run(factory)`，factory 负责创建图表实例
 * - 如果 factory 抛错，将自动进入 error 状态并返回可读 message
 * - 调用 `retry()` 可清空错误并递增 retryToken，便于外部触发重建流程
 */
export function useChartInit(options: UseChartInitOptions = {}) {
    const [status, setStatus] = useState<ChartInitStatus>("idle");
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const onErrorRef = useRef(options.onError);

    useEffect(() => {
        onErrorRef.current = options.onError;
    }, [options.onError]);

    const run = useCallback(
        <T,>(factory: () => T): ChartInitResult<T> => {
            setStatus("loading");
            const result = runChartFactory(factory);
            if (result.ok) {
                setStatus("ready");
                setError(null);
                return result;
            }

            const message = result.message ?? "Unknown error";
            setStatus("error");
            setError(message);
            onErrorRef.current?.(message, result.error);
            return result;
        },
        [],
    );

    const retry = useCallback(() => {
        setStatus("idle");
        setError(null);
        setRetryToken((prev) => prev + 1);
    }, []);

    return { status, error, retryToken, run, retry };
}
