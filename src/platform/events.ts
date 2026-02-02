/**
 * Tauri 事件订阅封装
 *
 * 目标：
 * - 与 `src/platform/invoke.ts` 一致：动态 import，避免浏览器模式加载 Tauri 包导致运行时报错
 * - 统一错误格式，便于上层 hook/store 做降级与提示
 *
 * @module platform/events
 */

import { isTauri } from "@/platform/tauri";

export type UnlistenFn = () => void;

export type ListenHandler<TPayload> = (event: { payload: TPayload }) => void;

export type EventErrorCode = "TAURI_API_UNAVAILABLE" | "LISTEN_FAILED";

export class EventError extends Error {
    readonly code: EventErrorCode;
    readonly eventName: string;
    readonly cause?: unknown;

    constructor(params: {
        code: EventErrorCode;
        eventName: string;
        message: string;
        cause?: unknown;
    }) {
        super(params.message);
        this.name = "EventError";
        this.code = params.code;
        this.eventName = params.eventName;
        this.cause = params.cause;
    }
}

/**
 * 订阅 Tauri 事件
 *
 * @template TPayload - 事件 payload 类型
 * @param eventName - 事件名
 * @param handler - 事件处理器
 * @returns unlisten 函数
 */
export async function listen<TPayload>(
    eventName: string,
    handler: ListenHandler<TPayload>,
): Promise<UnlistenFn> {
    if (!isTauri()) {
        throw new EventError({
            code: "TAURI_API_UNAVAILABLE",
            eventName,
            message: `浏览器环境无法订阅 Tauri 事件（eventName=${eventName}）`,
        });
    }

    try {
        const { listen: tauriListen } = await import("@tauri-apps/api/event");
        return await tauriListen<TPayload>(eventName, handler);
    } catch (error) {
        throw new EventError({
            code: "LISTEN_FAILED",
            eventName,
            cause: error,
            message: `Tauri 事件订阅失败（eventName=${eventName}）`,
        });
    }
}

