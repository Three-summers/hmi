/**
 * 前端日志桥接 Hook（可选）
 *
 * 将 WebView 内的 console 输出与全局错误事件聚合后，通过 Tauri `invoke` 转发到后端日志系统。
 *
 * 该能力主要用于调试：默认关闭，避免影响正常使用的性能与噪音。
 *
 * @module useFrontendLogBridge
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigationStore, useAppStore } from "@/stores";
import { isTauri } from "@/platform/tauri";
import { LOG_BRIDGE_CONFIG } from "@/constants";

interface FrontendLogEntry {
    /** 后端可识别的日志等级（避免随意字符串导致后端解析分支膨胀） */
    level: NormalizedLogLevel;
    message: string;
    timestamp_ms: number;
    source?: string;
}

const { MAX_BATCH_SIZE, FLUSH_INTERVAL_MS, MAX_MESSAGE_LENGTH } =
    LOG_BRIDGE_CONFIG;

const consoleLevels = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleLevel = (typeof consoleLevels)[number];

/**
 * 归一化后的日志等级
 *
 * 说明：
 * - 前端来源很多（console/window/promise），这里收敛为后端可稳定处理的一组等级
 * - 不使用 string，可在编译期约束后续新增等级时同步更新后端/配置
 */
type NormalizedLogLevel = "info" | "warn" | "error" | "debug";

/**
 * 将未知值格式化为可读字符串
 *
 * @param value - 需要格式化的值
 * @param depth - 最大递归深度（避免深层对象导致性能问题）
 * @param seen - 循环引用检测集合
 * @returns 格式化后的字符串
 */
function formatUnknown(
    value: unknown,
    depth: number,
    seen: WeakSet<object>,
): string {
    if (depth <= 0) return "[Object]";
    if (value === null) return "null";
    if (value === undefined) return "undefined";

    if (typeof value === "string") return value;
    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return String(value);
    }
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") {
        return `[Function ${(value as Function).name || "anonymous"}]`;
    }

    if (value instanceof Error) {
        const stack = value.stack ? `\n${value.stack}` : "";
        return `${value.name}: ${value.message}${stack}`;
    }

    if (value instanceof Date) return value.toISOString();

    if (typeof value === "object") {
        if (seen.has(value as object)) return "[Circular]";
        seen.add(value as object);

        try {
            const json = JSON.stringify(
                value,
                (_key, v) => {
                    if (v instanceof Error) {
                        return {
                            name: v.name,
                            message: v.message,
                            stack: v.stack,
                        };
                    }
                    if (typeof v === "bigint") return v.toString();
                    return v;
                },
                2,
            );
            if (json !== undefined) return json;
        } catch {
            // 忽略格式化失败
        }

        try {
            return String(value);
        } catch {
            return "[Unserializable]";
        }
    }

    return String(value);
}

function formatConsoleArgs(args: unknown[]): string {
    const seen = new WeakSet<object>();
    const parts = args.map((v) => formatUnknown(v, 3, seen));
    const message = parts.join(" ");
    if (message.length <= MAX_MESSAGE_LENGTH) return message;
    return `${message.slice(0, MAX_MESSAGE_LENGTH)}…(truncated)`;
}

/**
 * 将不同来源的日志等级归一化为后端可识别的等级
 *
 * @param level - console 等级或窗口事件来源
 * @returns 归一化后的等级字符串
 */
function normalizeLevel(
    level: ConsoleLevel | "window" | "promise",
): NormalizedLogLevel {
    if (level === "error") return "error";
    if (level === "warn") return "warn";
    if (level === "debug") return "debug";
    if (level === "info") return "info";
    if (level === "log") return "info";
    return "info";
}

/**
 * 前端日志桥接（可选）：将 WebView 内的 console 输出与全局错误转发到后端日志系统（终端输出）。
 *
 * 使用方式：
 * - 默认关闭（避免影响正常使用的性能与噪音）
 * - 在 Setup → 调试 中手动开启后生效
 *
 * 性能策略：
 * - 批量发送：合并一段时间内的日志，减少 invoke 次数
 * - 失败降级：转发失败时不抛异常，不影响业务流程
 *
 * @returns void
 */
export function useFrontendLogBridge() {
    const enabled = useAppStore((s) => s.debugLogBridgeEnabled);
    const currentView = useNavigationStore((s) => s.currentView);

    const currentViewRef = useRef(currentView);
    useEffect(() => {
        currentViewRef.current = currentView;
    }, [currentView]);

    // 用于保存“卸载/还原”函数，确保 Hook 多次启停时不会重复 patch console
    const installedRef = useRef<null | (() => void)>(null);

    useEffect(() => {
        if (!enabled) {
            installedRef.current?.();
            installedRef.current = null;
            return;
        }

        if (!isTauri()) return;
        if (installedRef.current) return;

        const originals: Partial<
            Record<ConsoleLevel, (...args: unknown[]) => void>
        > = {};
        // 待发送队列：通过批量 flush 降低 invoke 次数
        const queue: FrontendLogEntry[] = [];
        let flushTimer: number | null = null;
        let inFlush = false;

        const scheduleFlush = () => {
            if (flushTimer !== null) return;
            flushTimer = window.setTimeout(() => {
                flushTimer = null;
                void flush();
            }, FLUSH_INTERVAL_MS);
        };

        const enqueue = (
            entry: Omit<FrontendLogEntry, "timestamp_ms"> & {
                timestamp_ms?: number;
            },
        ) => {
            queue.push({
                timestamp_ms: entry.timestamp_ms ?? Date.now(),
                level: entry.level,
                message: entry.message,
                source: entry.source,
            });

            if (queue.length >= MAX_BATCH_SIZE) {
                // 达到批量阈值时立即发送，减少堆积延迟
                void flush();
            } else {
                scheduleFlush();
            }
        };

        const flush = async () => {
            if (inFlush) return;
            if (queue.length === 0) return;

            inFlush = true;
            try {
                const batch = queue.splice(0, MAX_BATCH_SIZE);
                await invoke<void>("frontend_log_batch", { entries: batch });
            } catch {
                // 转发失败时静默丢弃，避免影响业务
                queue.length = 0;
            } finally {
                inFlush = false;
            }
        };

        const buildMessage = (base: string): string => {
            const view = currentViewRef.current;
            return `[view=${view}] ${base}`;
        };

        const patchConsole = (level: ConsoleLevel) => {
            const original = console[level] as (...args: unknown[]) => void;
            originals[level] = original;

            console[level] = (...args: unknown[]) => {
                try {
                    const msg = formatConsoleArgs(args);
                    enqueue({
                        level: normalizeLevel(level),
                        source: `console.${level}`,
                        message: buildMessage(msg),
                    });
                } catch {
                    // 忽略格式化失败
                }

                try {
                    original.apply(console, args);
                } catch {
                    // 忽略原始 console 调用失败
                }
            };
        };

        const onWindowError = (event: ErrorEvent) => {
            const detail = [
                event.message,
                event.filename
                    ? `\n${event.filename}:${event.lineno}:${event.colno}`
                    : "",
                event.error
                    ? `\n${formatUnknown(event.error, 5, new WeakSet<object>())}`
                    : "",
            ].join("");

            enqueue({
                level: normalizeLevel("window"),
                source: "window.error",
                message: buildMessage(detail || "Unknown error"),
            });
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = formatUnknown(
                event.reason,
                5,
                new WeakSet<object>(),
            );
            enqueue({
                level: normalizeLevel("promise"),
                source: "window.unhandledrejection",
                message: buildMessage(reason),
            });
        };

        consoleLevels.forEach(patchConsole);
        window.addEventListener("error", onWindowError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);

        enqueue({
            level: "info",
            source: "bridge",
            message: buildMessage("前端日志桥接已开启"),
        });

        installedRef.current = () => {
            try {
                consoleLevels.forEach((level) => {
                    const original = originals[level];
                    if (original)
                        console[level] = original as Console[ConsoleLevel];
                });
                window.removeEventListener("error", onWindowError);
                window.removeEventListener(
                    "unhandledrejection",
                    onUnhandledRejection,
                );
                if (flushTimer !== null) window.clearTimeout(flushTimer);
                flushTimer = null;
                queue.length = 0;
            } catch {
                // 忽略清理失败，避免影响卸载流程
            }
        };

        return () => {
            installedRef.current?.();
            installedRef.current = null;
        };
    }, [enabled]);
}
