/**
 * ErrorBoundary 辅助 Hook
 *
 * React ErrorBoundary 只能捕获“渲染阶段/生命周期”的错误，无法捕获：
 * - Promise / async 回调
 * - 事件回调（click、ResizeObserver 等）
 * - setTimeout / requestAnimationFrame
 *
 * 本 Hook 用于把“异步/回调中的错误”转成“下一次 render throw”，从而被最近的 ErrorBoundary 捕获，
 * 达到“局部降级 + 可重试”的目的。
 *
 * @module useErrorBoundary
 */

import { useCallback, useMemo, useState } from "react";
import { toErrorMessage } from "@/utils/error";

export type UseErrorBoundaryOptions = {
    /**
     * 是否在 render 时 throw（默认 true）
     *
     * - true：用于配合 ErrorBoundary（推荐）
     * - false：仅作为“错误状态容器”，由调用方自行渲染错误 UI
     */
    throwOnRender?: boolean;
    /** 捕获错误时的回调（可用于日志链路） */
    onError?: (error: Error) => void;
};

export type UseErrorBoundaryReturn = {
    /** 当前错误（未出错时为 null） */
    error: Error | null;
    /** 触发边界：记录错误并在下一次 render throw */
    showBoundary: (error: unknown) => void;
    /** 重置错误状态（throwOnRender=true 时通常不需要，boundary reset 会重新挂载） */
    resetBoundary: () => void;
};

function normalizeToError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(toErrorMessage(error));
}

/**
 * ErrorBoundary 辅助 Hook
 *
 * @param options - 行为配置
 */
export function useErrorBoundary(options: UseErrorBoundaryOptions = {}): UseErrorBoundaryReturn {
    const [error, setError] = useState<Error | null>(null);

    const throwOnRender = options.throwOnRender ?? true;

    const onError = useMemo(() => options.onError, [options.onError]);

    const showBoundary = useCallback(
        (next: unknown) => {
            const normalized = normalizeToError(next);
            setError(normalized);
            onError?.(normalized);
        },
        [onError],
    );

    const resetBoundary = useCallback(() => {
        setError(null);
    }, []);

    if (throwOnRender && error) {
        throw error;
    }

    return { error, showBoundary, resetBoundary };
}

