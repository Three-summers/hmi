/**
 * 异步工具函数
 *
 * @module utils/async
 */

/** 超时错误：用于统一判定与提示 */
export class TimeoutError extends Error {
    readonly timeoutMs: number;

    constructor(timeoutMs: number, message?: string) {
        super(message ?? `Operation timed out after ${timeoutMs}ms`);
        this.name = "TimeoutError";
        this.timeoutMs = timeoutMs;
    }
}

export type WithTimeoutOptions = {
    /** 自定义超时错误消息（未提供时使用默认文案） */
    timeoutMessage?: string;
};

/**
 * Promise 超时包装
 *
 * @template T - 业务返回值类型
 * @param promiseOrFactory - 原始 Promise 或 Promise 工厂（用于覆盖同步 throw 场景）
 * @param timeoutMs - 超时时间（ms）
 * @param options - 额外配置
 * @returns 带超时控制的 Promise
 *
 * @description
 * - timeoutMs 非法或 <=0 时：直接返回原 Promise（不包裹）
 * - 超时后 reject TimeoutError；无论成功/失败都会清理定时器，避免泄漏
 */
export function withTimeout<T>(
    promiseOrFactory: Promise<T> | (() => Promise<T>),
    timeoutMs: number,
    options: WithTimeoutOptions = {},
): Promise<T> {
    let promise: Promise<T>;

    try {
        promise =
            typeof promiseOrFactory === "function"
                ? promiseOrFactory()
                : promiseOrFactory;
    } catch (error) {
        return Promise.reject(error);
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            reject(new TimeoutError(timeoutMs, options.timeoutMessage));
        }, timeoutMs);

        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * 判断是否为超时错误
 *
 * @param error - 捕获到的异常
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof Error && error.name === "TimeoutError";
}

/**
 * 延迟一段时间后 resolve
 *
 * @param ms - 延迟时间（ms）
 */
export function sleep(ms: number): Promise<void> {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, safeMs);
    });
}

