/**
 * Tauri RPC 调用封装
 *
 * 本项目需要同时支持两种运行形态：
 * - Tauri WebView：通过 `@tauri-apps/api/core` 的 `invoke` 调用后端命令
 * - 浏览器开发模式：无法访问 Tauri API，需要用 mock 来模拟后端返回
 *
 * 该模块提供统一入口：
 * - `invoke()`：调用后端命令（或在浏览器模式下走 mock）
 * - `registerInvokeMock()`：为浏览器模式注册 mock handler，便于本地开发/测试
 *
 * @module invoke
 */

import { isTauri } from "@/platform/tauri";

type InvokeArgs = Record<string, unknown> | undefined;
type InvokeMockHandler<TArgs extends InvokeArgs, TResult> = (
    args: TArgs,
) => TResult | Promise<TResult>;

const invokeMocks = new Map<string, InvokeMockHandler<InvokeArgs, unknown>>();

export type InvokeErrorCode =
    | "MOCK_NOT_REGISTERED"
    | "TAURI_API_UNAVAILABLE"
    | "INVOKE_FAILED";

/**
 * invoke 统一错误类型
 *
 * 目标：
 * - 让上层可以稳定拿到：command / args / code / 原始错误（cause）
 * - 同时避免在不同运行环境（Tauri/Web）下出现完全不同的报错格式，导致 UI/日志分支膨胀
 */
export class InvokeError extends Error {
    readonly code: InvokeErrorCode;
    readonly command: string;
    readonly args?: InvokeArgs;
    readonly cause?: unknown;

    constructor(params: {
        code: InvokeErrorCode;
        command: string;
        message: string;
        args?: InvokeArgs;
        cause?: unknown;
    }) {
        super(params.message);
        this.name = "InvokeError";
        this.code = params.code;
        this.command = params.command;
        this.args = params.args;
        this.cause = params.cause;
    }
}

function normalizeToError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(typeof error === "string" ? error : String(error));
}

/**
 * 注册浏览器模式下的 invoke mock
 *
 * @template TArgs - mock handler 的参数结构
 * @template TResult - mock handler 的返回值结构
 * @param command - 命令名（需与后端 `invoke` 的 command 一致）
 * @param handler - mock 处理函数，可返回值或 Promise
 * @returns void
 * @description 仅在非 Tauri 环境生效；同名 command 会被覆盖。
 */
export function registerInvokeMock<TArgs extends InvokeArgs, TResult>(
    command: string,
    handler: InvokeMockHandler<TArgs, TResult>,
) {
    invokeMocks.set(command, handler as InvokeMockHandler<InvokeArgs, unknown>);
}

/**
 * 统一的 Tauri 命令调用入口
 *
 * @template TResult - 期望的返回值类型
 * @param command - 命令名（后端暴露的 Tauri command）
 * @param args - 命令参数对象（可选）
 * @returns 后端返回值（或浏览器模式下 mock 返回值）
 * @throws 在浏览器模式且未注册对应 mock 时抛出错误
 */
export async function invoke<TResult>(
    command: string,
    args?: InvokeArgs,
): Promise<TResult> {
    if (isTauri()) {
        // 动态 import：避免在浏览器开发模式下加载 Tauri 包导致运行时报错
        try {
            const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
            return await tauriInvoke<TResult>(command, args);
        } catch (error) {
            const base = normalizeToError(error);
            throw new InvokeError({
                code: "INVOKE_FAILED",
                command,
                args,
                cause: error,
                message: `Tauri invoke 调用失败（command=${command}）：${base.message}`,
            });
        }
    }

    const handler = invokeMocks.get(command);
    if (handler) {
        try {
            return (await handler(args)) as TResult;
        } catch (error) {
            const base = normalizeToError(error);
            throw new InvokeError({
                code: "INVOKE_FAILED",
                command,
                args,
                cause: error,
                message: `invoke mock 执行失败（command=${command}）：${base.message}`,
            });
        }
    }

    // 浏览器模式兜底：提示调用方需要注册 mock，避免 silent failure
    throw new InvokeError({
        code: "MOCK_NOT_REGISTERED",
        command,
        args,
        message: `浏览器环境无法调用 Tauri invoke（command=${command}），请在开发模式注册对应 mock`,
    });
}
