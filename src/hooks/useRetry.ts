/**
 * 重试 Hook
 *
 * 目标：
 * - 将“可控重试 + 退避等待 + 错误暴露”收敛到统一实现，避免各处散落的 for/while + setTimeout 样板代码
 * - 默认策略偏保守：仅对 TimeoutError 自动重试，避免把“有副作用的操作”误重放
 *
 * @module useRetry
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isTimeoutError, sleep } from "@/utils/async";

export type RetryBackoff = "fixed" | "exponential";

export type RetryContext = {
    /** 当前尝试次数（从 1 开始） */
    attempt: number;
    /** 最大尝试次数（包含首次） */
    maxAttempts: number;
    /** 从开始到当前的耗时（ms） */
    elapsedMs: number;
};

export type ShouldRetry = (error: unknown, ctx: RetryContext) => boolean;

export type RetryOptions = {
    /** 最大尝试次数（包含首次），默认 3 */
    maxAttempts?: number;
    /** 基础延迟（ms），默认 250 */
    baseDelayMs?: number;
    /** 最大延迟（ms），默认 2000 */
    maxDelayMs?: number;
    /** 退避策略，默认 exponential */
    backoff?: RetryBackoff;
    /**
     * 抖动比例（0~1），默认 0.2
     *
     * 说明：用于避免多个请求在同一时间点重试造成“同步风暴”。
     */
    jitterRatio?: number;
    /** 自定义延迟计算（优先级高于 backoff/baseDelayMs） */
    getDelayMs?: (ctx: RetryContext) => number;
    /** 判定是否重试（默认：仅 TimeoutError 重试） */
    shouldRetry?: ShouldRetry;
    /** 每次重试前回调（可用于日志/提示） */
    onRetry?: (error: unknown, ctx: RetryContext, delayMs: number) => void;
};

export class RetryCancelledError extends Error {
    constructor(message: string = "Retry cancelled") {
        super(message);
        this.name = "RetryCancelledError";
    }
}

function nowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function computeDelayMs(ctx: RetryContext, options: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "backoff" | "jitterRatio">>): number {
    const base = Math.max(0, options.baseDelayMs);
    const max = Math.max(base, options.maxDelayMs);

    const raw =
        options.backoff === "fixed"
            ? base
            : base * Math.pow(2, Math.max(0, ctx.attempt - 2));

    const capped = clamp(raw, base, max);
    const jitterRatio = clamp(options.jitterRatio, 0, 1);
    if (jitterRatio === 0) return Math.round(capped);

    const range = capped * jitterRatio;
    const jitter = (Math.random() * 2 - 1) * range;
    return Math.round(clamp(capped + jitter, 0, max));
}

function mergeOptions(defaults: RetryOptions | undefined, overrides: RetryOptions | undefined): RetryOptions {
    return { ...(defaults ?? {}), ...(overrides ?? {}) };
}

function normalizeOptions(options: RetryOptions | undefined): Required<RetryOptions> {
    const merged = options ?? {};
    return {
        maxAttempts: Number.isFinite(merged.maxAttempts) ? Math.max(1, Math.floor(merged.maxAttempts!)) : 3,
        baseDelayMs: Number.isFinite(merged.baseDelayMs) ? Math.max(0, Math.floor(merged.baseDelayMs!)) : 250,
        maxDelayMs: Number.isFinite(merged.maxDelayMs) ? Math.max(0, Math.floor(merged.maxDelayMs!)) : 2000,
        backoff: merged.backoff ?? "exponential",
        jitterRatio: Number.isFinite(merged.jitterRatio) ? merged.jitterRatio! : 0.2,
        getDelayMs: merged.getDelayMs ?? ((ctx) => computeDelayMs(ctx, normalizeDelayOptions(merged))),
        shouldRetry: merged.shouldRetry ?? ((error) => isTimeoutError(error)),
        onRetry: merged.onRetry ?? (() => {}),
    };
}

function normalizeDelayOptions(options: RetryOptions | undefined): Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "backoff" | "jitterRatio">> {
    const baseDelayMs = Number.isFinite(options?.baseDelayMs) ? Math.max(0, Math.floor(options!.baseDelayMs!)) : 250;
    const maxDelayMs = Number.isFinite(options?.maxDelayMs) ? Math.max(0, Math.floor(options!.maxDelayMs!)) : 2000;
    return {
        baseDelayMs,
        maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
        backoff: options?.backoff ?? "exponential",
        jitterRatio: Number.isFinite(options?.jitterRatio) ? options!.jitterRatio! : 0.2,
    };
}

export type UseRetryState = {
    /** 是否正在执行（包含等待重试间隔） */
    isRunning: boolean;
    /** 当前尝试次数（0 表示未开始） */
    attempt: number;
    /** 最近一次错误（未开始/成功时为 null） */
    error: unknown | null;
};

export type RetryRunner = <T>(task: (ctx: RetryContext) => Promise<T>, overrides?: RetryOptions) => Promise<T>;

/**
 * 重试 Hook
 *
 * @param defaultOptions - 默认重试策略（可在 run 时被 overrides 覆盖）
 */
export function useRetry(defaultOptions?: RetryOptions) {
    const defaultOptionsRef = useRef<RetryOptions | undefined>(defaultOptions);
    defaultOptionsRef.current = defaultOptions;

    const runIdRef = useRef(0);
    const cancelledRef = useRef(false);

    const [state, setState] = useState<UseRetryState>({
        isRunning: false,
        attempt: 0,
        error: null,
    });

    useEffect(() => {
        cancelledRef.current = false;
        return () => {
            cancelledRef.current = true;
        };
    }, []);

    const cancel = useCallback(() => {
        cancelledRef.current = true;
        runIdRef.current += 1;
        setState((prev) => ({
            ...prev,
            isRunning: false,
        }));
    }, []);

    const reset = useCallback(() => {
        setState({ isRunning: false, attempt: 0, error: null });
    }, []);

    const run: RetryRunner = useCallback(async (task, overrides) => {
        const runId = runIdRef.current + 1;
        runIdRef.current = runId;
        cancelledRef.current = false;

        setState({ isRunning: true, attempt: 0, error: null });

        const merged = mergeOptions(defaultOptionsRef.current, overrides);
        const options = normalizeOptions(merged);
        const startedAt = nowMs();

        let lastError: unknown = null;

        for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
            if (cancelledRef.current || runIdRef.current !== runId) {
                setState((prev) => ({ ...prev, isRunning: false }));
                throw new RetryCancelledError();
            }

            const ctx: RetryContext = {
                attempt,
                maxAttempts: options.maxAttempts,
                elapsedMs: Math.max(0, Math.round(nowMs() - startedAt)),
            };

            setState((prev) => ({ ...prev, attempt: ctx.attempt }));

            try {
                const result = await task(ctx);
                if (runIdRef.current === runId) {
                    setState({ isRunning: false, attempt: ctx.attempt, error: null });
                }
                return result;
            } catch (error) {
                lastError = error;

                const shouldRetry = attempt < options.maxAttempts && options.shouldRetry(error, ctx);
                if (!shouldRetry) {
                    if (runIdRef.current === runId) {
                        setState({ isRunning: false, attempt: ctx.attempt, error });
                    }
                    throw error;
                }

                const delayMs = Math.max(0, Math.floor(options.getDelayMs(ctx)));
                options.onRetry(error, ctx, delayMs);
                setState((prev) => ({ ...prev, error }));

                if (delayMs > 0) {
                    await sleep(delayMs);
                }
            }
        }

        setState({ isRunning: false, attempt: options.maxAttempts, error: lastError });
        throw lastError;
    }, []);

    return {
        run,
        reset,
        cancel,
        ...state,
    };
}

