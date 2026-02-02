/**
 * 通用 Tauri 事件流订阅 Hook
 *
 * 目标：
 * - 把 “listen + start/stop + 门控 + 节流 + 错误态” 抽成可复用能力
 * - 支持 Keep-Alive 视图：enabled=false 时释放订阅，避免后台泄漏
 * - 支持高频数据：latestRef 高频更新不触发重渲染；onEvent 低频节流触发 UI 更新
 *
 * @module hooks/useTauriEventStream
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@/platform/events";
import { invoke } from "@/platform/invoke";
import { isTauri } from "@/platform/tauri";
import { toErrorMessage } from "@/utils/error";

export type TauriEventStreamStatus =
    | "unavailable"
    | "loading"
    | "ready"
    | "error";

export interface UseTauriEventStreamOptions<TPayload> {
    /** 是否启用订阅（通常为：视图可见 + 子页激活） */
    enabled: boolean;
    /** 事件名 */
    eventName: string;

    /** 是否暂停（暂停时可冻结 onEvent） */
    isPaused?: boolean;
    /** 暂停时是否仍触发 onEvent（默认 false） */
    emitWhenPaused?: boolean;

    /**
     * 事件消费最大频率（Hz）
     *
     * 说明：
     * - 仅影响 onEvent 的节流频率，不影响 latestRef 的更新
     */
    maxHz?: number;

    /** 可选：订阅开始时调用的命令 */
    startCommand?: string;
    startArgs?: Record<string, unknown>;
    /** 可选：订阅结束时调用的命令 */
    stopCommand?: string;
    stopArgs?: Record<string, unknown>;

    /** 事件回调（节流 + 门控后触发） */
    onEvent?: (
        payload: TPayload,
        meta: { paused: boolean; receivedAtMs: number },
    ) => void;
}

export interface UseTauriEventStreamResult<TPayload> {
    status: TauriEventStreamStatus;
    error: string | null;
    latestRef: React.MutableRefObject<TPayload | null>;
    clear: () => void;
    retry: () => void;
}

export function useTauriEventStream<TPayload>(
    options: UseTauriEventStreamOptions<TPayload>,
): UseTauriEventStreamResult<TPayload> {
    const {
        enabled,
        eventName,
        startCommand,
        stopCommand,
        startArgs,
        stopArgs,
    } = options;

    const latestRef = useRef<TPayload | null>(null);
    const hasReceivedDataRef = useRef(false);
    const lastAcceptedAtRef = useRef<number>(0);

    const isPausedRef = useRef(Boolean(options.isPaused));
    const emitWhenPausedRef = useRef(Boolean(options.emitWhenPaused));
    const maxHzRef = useRef(options.maxHz);
    const onEventRef = useRef(options.onEvent);
    const startArgsRef = useRef<Record<string, unknown> | undefined>(startArgs);
    const stopArgsRef = useRef<Record<string, unknown> | undefined>(stopArgs);

    useEffect(() => {
        isPausedRef.current = Boolean(options.isPaused);
    }, [options.isPaused]);

    useEffect(() => {
        emitWhenPausedRef.current = Boolean(options.emitWhenPaused);
    }, [options.emitWhenPaused]);

    useEffect(() => {
        maxHzRef.current = options.maxHz;
    }, [options.maxHz]);

    useEffect(() => {
        onEventRef.current = options.onEvent;
    }, [options.onEvent]);

    useEffect(() => {
        startArgsRef.current = startArgs;
    }, [startArgs]);

    useEffect(() => {
        stopArgsRef.current = stopArgs;
    }, [stopArgs]);

    const [status, setStatus] = useState<TauriEventStreamStatus>("loading");
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let unlistenFn: null | (() => void) = null;
        let localUnlisten: null | (() => void) = null;

        if (!enabled) return;

        if (!isTauri()) {
            setError(null);
            setStatus("unavailable");
            return;
        }

        // 每次（重新）订阅时重置为 loading，直到收到首帧
        setError(null);
        setStatus("loading");
        hasReceivedDataRef.current = false;
        lastAcceptedAtRef.current = 0;

        const setup = async () => {
            try {
                const unlisten = await listen<TPayload>(
                    eventName,
                    (event) => {
                        const payload = event.payload;
                        latestRef.current = payload;

                        if (!hasReceivedDataRef.current) {
                            hasReceivedDataRef.current = true;
                            setStatus("ready");
                            setError(null);
                        }

                        const paused = isPausedRef.current;
                        const shouldEmit =
                            !paused || emitWhenPausedRef.current;
                        if (!shouldEmit) return;

                        const limitHz = maxHzRef.current;
                        if (Number.isFinite(limitHz) && (limitHz ?? 0) > 0) {
                            const desiredRate = Math.max(1, limitHz ?? 1);
                            const minInterval = 1000 / desiredRate;
                            const now = performance.now();
                            const lastAccepted = lastAcceptedAtRef.current;
                            if (lastAccepted && now - lastAccepted < minInterval) {
                                return;
                            }
                            lastAcceptedAtRef.current = now;
                        }

                        onEventRef.current?.(payload, {
                            paused,
                            receivedAtMs: Date.now(),
                        });
                    },
                );

                if (cancelled) {
                    unlisten();
                    return;
                }

                localUnlisten = unlisten;
                unlistenFn = unlisten;

                if (startCommand) {
                    await invoke(startCommand, startArgsRef.current);
                }
            } catch (err) {
                console.error("Failed to setup tauri event stream:", err);
                if (cancelled) return;
                // 若已注册事件监听但启动失败，必须立即释放监听，避免错误态继续消费事件
                try {
                    localUnlisten?.();
                } catch {
                    // 忽略释放失败，避免二次异常覆盖原错误
                }
                if (unlistenFn === localUnlisten) {
                    unlistenFn = null;
                }
                const message = toErrorMessage(err);
                setStatus("error");
                setError(message);
                latestRef.current = null;
            }
        };

        void setup();

        return () => {
            cancelled = true;
            if (stopCommand && isTauri()) {
                invoke(stopCommand, stopArgsRef.current).catch(console.error);
            }
            unlistenFn?.();
        };
    }, [enabled, eventName, retryToken, startCommand, stopCommand]);

    const clear = useCallback(() => {
        latestRef.current = null;
        hasReceivedDataRef.current = false;
        lastAcceptedAtRef.current = 0;
        setError(null);
        setStatus(isTauri() ? "loading" : "unavailable");
    }, []);

    const retry = useCallback(() => {
        clear();
        setRetryToken((prev) => prev + 1);
    }, [clear]);

    return { status, error, latestRef, clear, retry };
}
