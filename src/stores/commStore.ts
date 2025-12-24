/**
 * 通信状态管理 Store
 *
 * 该模块封装前端与后端（Tauri 命令）之间的通信状态与操作：
 * - 串口：连接/断开/发送数据/查询可用端口
 * - TCP：连接/断开/发送数据
 *
 * 设计要点：
 * - 所有操作统一通过 `invoke`（`src/platform/invoke.ts`）调用后端命令
 * - 支持超时控制（默认值来自 `COMM_CONFIG`），避免 UI 长时间无响应
 * - 失败时写入 `lastError` 供 UI 展示，并可通过 `onError` 回调做额外处理
 *
 * @module commStore
 */

import { create } from "zustand";
import { COMM_CONFIG } from "@/constants";
import { invoke } from "@/platform/invoke";
import { withTimeout } from "@/utils/async";
import { toErrorMessage } from "@/utils/error";
import type { ErrorHandler } from "@/types/common";
import type { SerialConfig, TcpConfig, CommState } from "@/types";

interface CommOperationOptions {
    /** 超时时间 (ms)，未设置则使用默认值 */
    timeoutMs?: number;
    /** 出错回调（用于 UI 层做额外处理） */
    onError?: ErrorHandler;
}

interface CommStoreState extends CommState {
    // 串口操作
    connectSerial: (
        config: SerialConfig,
        options?: CommOperationOptions,
    ) => Promise<void>;
    disconnectSerial: (options?: CommOperationOptions) => Promise<void>;
    sendSerialData: (
        data: number[],
        options?: CommOperationOptions,
    ) => Promise<void>;

    // TCP 操作
    connectTcp: (
        config: TcpConfig,
        options?: CommOperationOptions,
    ) => Promise<void>;
    disconnectTcp: (options?: CommOperationOptions) => Promise<void>;
    sendTcpData: (
        data: number[],
        options?: CommOperationOptions,
    ) => Promise<void>;

    // 获取可用串口列表
    getSerialPorts: (options?: CommOperationOptions) => Promise<string[]>;

    // 清除错误
    clearError: () => void;
}

/** 默认通信超时（ms）：作为 UI 侧兜底，避免请求无限悬挂 */
const DEFAULT_COMM_TIMEOUT_MS = COMM_CONFIG.TCP_TIMEOUT_MS;

/**
 * 带超时的 Tauri invoke 调用
 *
 * @template TResult - 后端返回值类型
 * @param command - Tauri 命令名
 * @param args - 传递给命令的参数对象
 * @param timeoutMs - 超时时间（ms）
 * @returns 后端返回值
 */
async function invokeWithTimeout<TResult>(
    command: string,
    args: Record<string, unknown> | undefined,
    timeoutMs: number,
): Promise<TResult> {
    return withTimeout(
        invoke<TResult>(command, args),
        timeoutMs,
        {
            timeoutMessage: `通信操作超时（command=${command}, timeoutMs=${timeoutMs}ms）`,
        },
    );
}

/**
 * 通信状态 Store Hook（Zustand）
 *
 * 错误处理约定：
 * - 操作失败时：更新 `lastError`，触发可选的 `options.onError`，并将原错误继续抛出（便于上层 await 捕获）
 * - 操作成功时：清空 `lastError`
 *
 * @returns 通信状态的 Store Hook
 */
export const useCommStore = create<CommStoreState>((set) => ({
    serialConnected: false,
    tcpConnected: false,
    serialConfig: undefined,
    tcpConfig: undefined,
    lastError: undefined,

    connectSerial: async (config, options) => {
        try {
            const timeoutMs = options?.timeoutMs ?? DEFAULT_COMM_TIMEOUT_MS;
            await invokeWithTimeout(
                "connect_serial",
                {
                    config: {
                        // 与后端命令参数保持一致：字段使用 snake_case
                        port: config.port,
                        baud_rate: config.baudRate,
                        data_bits: config.dataBits,
                        stop_bits: config.stopBits,
                        parity: config.parity,
                    },
                },
                timeoutMs,
            );
            set({
                serialConnected: true,
                serialConfig: config,
                lastError: undefined,
            });
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    disconnectSerial: async (options) => {
        try {
            const timeoutMs = options?.timeoutMs ?? DEFAULT_COMM_TIMEOUT_MS;
            await invokeWithTimeout("disconnect_serial", undefined, timeoutMs);
            set({
                serialConnected: false,
                serialConfig: undefined,
                lastError: undefined,
            });
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    sendSerialData: async (data, options) => {
        try {
            const timeoutMs = options?.timeoutMs ?? DEFAULT_COMM_TIMEOUT_MS;
            await invokeWithTimeout("send_serial_data", { data }, timeoutMs);
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    connectTcp: async (config, options) => {
        try {
            // TCP 配置本身携带 timeoutMs，可作为本次连接的默认超时
            const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
            await invokeWithTimeout(
                "connect_tcp",
                {
                    config: {
                        host: config.host,
                        port: config.port,
                        timeout_ms: config.timeoutMs,
                    },
                },
                timeoutMs,
            );
            set({
                tcpConnected: true,
                tcpConfig: config,
                lastError: undefined,
            });
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    disconnectTcp: async (options) => {
        try {
            const timeoutMs = options?.timeoutMs ?? DEFAULT_COMM_TIMEOUT_MS;
            await invokeWithTimeout("disconnect_tcp", undefined, timeoutMs);
            set({
                tcpConnected: false,
                tcpConfig: undefined,
                lastError: undefined,
            });
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    sendTcpData: async (data, options) => {
        try {
            const timeoutMs = options?.timeoutMs ?? DEFAULT_COMM_TIMEOUT_MS;
            await invokeWithTimeout("send_tcp_data", { data }, timeoutMs);
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    getSerialPorts: async (options) => {
        try {
            const timeoutMs = options?.timeoutMs ?? DEFAULT_COMM_TIMEOUT_MS;
            return await invokeWithTimeout<string[]>(
                "get_serial_ports",
                undefined,
                timeoutMs,
            );
        } catch (error) {
            const message = toErrorMessage(error);
            set({ lastError: message });
            options?.onError?.(message, error);
            throw error;
        }
    },

    clearError: () => set({ lastError: undefined }),
}));
