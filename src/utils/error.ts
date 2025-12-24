/**
 * 错误处理工具函数
 *
 * @module utils/error
 */

import type { ErrorHandler } from "@/types/common";

/**
 * 将 unknown 错误统一转换为可展示的字符串
 *
 * @param error - 捕获到的异常
 * @returns 可读错误信息
 */
export function toErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;

    if (error instanceof Error) {
        const message = error.message?.trim();
        if (message) return message;
        const name = error.name?.trim();
        if (name) return name;
        return "Error";
    }

    if (error && typeof error === "object") {
        const maybeMessage = (error as { message?: unknown }).message;
        if (typeof maybeMessage === "string") {
            const trimmed = maybeMessage.trim();
            if (trimmed) return trimmed;
        }
    }

    try {
        return String(error);
    } catch {
        return "Unknown error";
    }
}

/**
 * 执行 ErrorHandler（支持同步/异步）
 *
 * @param handler - 错误处理回调（可选）
 * @param message - 可读错误消息
 * @param error - 原始错误对象
 */
export async function invokeErrorHandler(
    handler: ErrorHandler | undefined,
    message: string,
    error: unknown,
): Promise<void> {
    if (!handler) return;
    await handler(message, error);
}

/**
 * 标准化错误处理：生成 message + 调用 handler
 *
 * @param error - 捕获到的异常
 * @param handler - 错误处理回调（可选）
 * @param message - 覆盖默认 message（可选）
 * @returns 最终使用的错误消息
 */
export async function reportError(
    error: unknown,
    handler?: ErrorHandler,
    message?: string,
): Promise<string> {
    const finalMessage = message ?? toErrorMessage(error);
    await invokeErrorHandler(handler, finalMessage, error);
    return finalMessage;
}

