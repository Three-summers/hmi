/**
 * Monitor 频谱数据订阅 hook
 *
 * 目标：
 * - 统一 Tauri 事件订阅、start/stop 命令调用、状态与错误管理
 * - 支持“最新数据写入 Ref（高频） + 统计信息写入 State（低频 UI）”的组合，减少不必要重渲染
 *
 * @module hooks/useSpectrumData
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/platform/invoke";
import { isTauri } from "@/platform/tauri";
import { toErrorMessage } from "@/utils/error";
import type { SpectrumData, SpectrumStats, SpectrumStatus } from "@/types";

export interface UseSpectrumDataOptions {
    /** 是否启用订阅（通常为：视图可见 + 当前子页激活） */
    enabled: boolean;
    /** 是否暂停（暂停时可选择冻结 onFrame 与统计更新） */
    isPaused?: boolean;
    /**
     * 事件消费最大频率（Hz）
     *
     * 说明：
     * - 仅影响 onFrame 与 stats 更新的节流频率，不影响 latestRef 的更新
     * - 例如 refreshRate=30 -> 约 33ms 一次更新
     */
    maxHz?: number;
    /** 暂停时是否仍调用 onFrame（默认 false：暂停时冻结 UI 更新） */
    emitWhenPaused?: boolean;
    /** 是否在 hook 内部计算 stats（默认 false） */
    statsEnabled?: boolean;
    /** 数据帧回调（用于更新组件状态/Store 等） */
    onFrame?: (frame: SpectrumData) => void;
    /** 事件名（默认 spectrum-data） */
    eventName?: string;
    /** 启动命令（默认 start_sensor_simulation） */
    startCommand?: string;
    /** 停止命令（默认 stop_sensor_simulation） */
    stopCommand?: string;
}

export interface UseSpectrumDataResult {
    /** 订阅状态 */
    status: SpectrumStatus;
    /** 错误文本（status=error 时非空） */
    error: string | null;
    /** 最新帧引用（高频更新，不触发重渲染） */
    latestRef: React.MutableRefObject<SpectrumData | null>;
    /** 频谱统计信息（statsEnabled=true 时更新） */
    stats: SpectrumStats;
    /** 清空数据（不重启订阅） */
    clear: () => void;
    /** 重试（重启订阅） */
    retry: () => void;
}

/** 默认的频谱统计值（用于初始化与 reset） */
export const DEFAULT_SPECTRUM_STATS: SpectrumStats = {
    peak_frequency: 0,
    peak_amplitude: -90,
    average_amplitude: -90,
    bandwidth: 0,
};

/**
 * 计算 -3dB 带宽
 *
 * 说明：
 * - 当幅度数组为空或阈值无法命中时返回 0
 */
export function calculateSpectrumBandwidth(
    frequencies: number[],
    amplitudes: number[],
    peakAmp: number,
): number {
    if (frequencies.length === 0 || amplitudes.length === 0) return 0;

    const threshold = peakAmp - 3;
    let lowFreq = frequencies[0] ?? 0;
    let highFreq = frequencies[frequencies.length - 1] ?? lowFreq;

    const count = Math.min(frequencies.length, amplitudes.length);

    // 从左侧找到第一个 >= 阈值的频率
    for (let i = 0; i < count; i += 1) {
        if (amplitudes[i] >= threshold) {
            lowFreq = frequencies[i];
            break;
        }
    }

    // 从右侧找到最后一个 >= 阈值的频率
    for (let i = count - 1; i >= 0; i -= 1) {
        if (amplitudes[i] >= threshold) {
            highFreq = frequencies[i];
            break;
        }
    }

    const bandwidth = highFreq - lowFreq;
    return Number.isFinite(bandwidth) && bandwidth > 0 ? bandwidth : 0;
}

/**
 * 从单帧频谱数据中计算可展示的统计信息
 *
 * 规则：
 * - 若 payload 已包含 peak/average 字段，则优先使用（避免重复计算）
 * - 否则从数组计算 peak 与 average
 */
export function computeSpectrumStats(frame: SpectrumData): SpectrumStats {
    const peakIdx =
        frame.amplitudes.length === 0
            ? 0
            : frame.amplitudes.reduce(
                  (bestIdx, amp, idx, arr) =>
                      amp > (arr[bestIdx] ?? Number.NEGATIVE_INFINITY)
                          ? idx
                          : bestIdx,
                  0,
              );

    const peak_frequency =
        frame.peak_frequency ?? frame.frequencies[peakIdx] ?? 0;

    const peak_amplitude =
        frame.peak_amplitude ??
        frame.amplitudes.reduce(
            (max, v) => (Number.isFinite(v) ? Math.max(max, v) : max),
            Number.NEGATIVE_INFINITY,
        ) ??
        DEFAULT_SPECTRUM_STATS.peak_amplitude;

    const average_amplitude =
        frame.average_amplitude ??
        (frame.amplitudes.length > 0
            ? frame.amplitudes.reduce(
                  (sum, v) => sum + (Number.isFinite(v) ? v : 0),
                  0,
              ) / Math.max(1, frame.amplitudes.length)
            : DEFAULT_SPECTRUM_STATS.average_amplitude);

    return {
        peak_frequency: Number.isFinite(peak_frequency) ? peak_frequency : 0,
        peak_amplitude: Number.isFinite(peak_amplitude)
            ? peak_amplitude
            : DEFAULT_SPECTRUM_STATS.peak_amplitude,
        average_amplitude: Number.isFinite(average_amplitude)
            ? average_amplitude
            : DEFAULT_SPECTRUM_STATS.average_amplitude,
        bandwidth: calculateSpectrumBandwidth(
            frame.frequencies,
            frame.amplitudes,
            Number.isFinite(peak_amplitude)
                ? peak_amplitude
                : DEFAULT_SPECTRUM_STATS.peak_amplitude,
        ),
    };
}

export function useSpectrumData(
    options: UseSpectrumDataOptions,
): UseSpectrumDataResult {
    const {
        enabled,
        isPaused = false,
        maxHz,
        emitWhenPaused = false,
        statsEnabled = false,
        onFrame,
        eventName = "spectrum-data",
        startCommand = "start_sensor_simulation",
        stopCommand = "stop_sensor_simulation",
    } = options;

    const [status, setStatus] = useState<SpectrumStatus>("loading");
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<SpectrumStats>(DEFAULT_SPECTRUM_STATS);
    const [retryToken, setRetryToken] = useState(0);

    const latestRef = useRef<SpectrumData | null>(null);
    const hasReceivedDataRef = useRef(false);
    const isPausedRef = useRef(isPaused);
    const maxHzRef = useRef(maxHz);
    const emitWhenPausedRef = useRef(emitWhenPaused);
    const statsEnabledRef = useRef(statsEnabled);
    const onFrameRef = useRef(onFrame);
    const lastAcceptedAtRef = useRef<number>(0);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        maxHzRef.current = maxHz;
    }, [maxHz]);

    useEffect(() => {
        emitWhenPausedRef.current = emitWhenPaused;
    }, [emitWhenPaused]);

    useEffect(() => {
        statsEnabledRef.current = statsEnabled;
    }, [statsEnabled]);

    useEffect(() => {
        onFrameRef.current = onFrame;
    }, [onFrame]);

    useEffect(() => {
        if (!enabled) return;

        if (!isTauri()) {
            setStatus("unavailable");
            setError(null);
            return;
        }

        setStatus("loading");
        setError(null);
        hasReceivedDataRef.current = false;
        lastAcceptedAtRef.current = 0;

        let cancelled = false;
        let unlisten: (() => void) | null = null;

        const setup = async () => {
            let localUnlisten: (() => void) | null = null;
            try {
                const unlistenFn = await listen<SpectrumData>(
                    eventName,
                    (event) => {
                        if (cancelled) return;

                        const frame = event.payload;
                        latestRef.current = frame;

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
                            if (
                                lastAccepted &&
                                now - lastAccepted < minInterval
                            ) {
                                return;
                            }
                            lastAcceptedAtRef.current = now;
                        }

                        if (statsEnabledRef.current && !paused) {
                            setStats(computeSpectrumStats(frame));
                        }

                        onFrameRef.current?.(frame);
                    },
                );

                if (cancelled) {
                    unlistenFn();
                    return;
                }

                localUnlisten = unlistenFn;
                unlisten = unlistenFn;
                await invoke(startCommand);
            } catch (err) {
                console.error("Failed to setup spectrum subscription:", err);
                if (cancelled) return;
                // 若已注册事件监听但启动失败，必须立即释放监听：
                // 否则会出现“错误态仍然消费事件/更新状态”的竞态与泄漏。
                try {
                    localUnlisten?.();
                } catch {
                    // 忽略释放失败，避免二次异常覆盖原错误
                }
                if (unlisten === localUnlisten) {
                    unlisten = null;
                }
                const message = toErrorMessage(err);
                setStatus("error");
                setError(message);
                latestRef.current = null;
                setStats(DEFAULT_SPECTRUM_STATS);
            }
        };

        void setup();

        return () => {
            cancelled = true;
            if (isTauri()) {
                invoke(stopCommand).catch(console.error);
            }
            unlisten?.();
        };
    }, [enabled, eventName, retryToken, startCommand, stopCommand]);

    const clear = useCallback(() => {
        latestRef.current = null;
        hasReceivedDataRef.current = false;
        setStats(DEFAULT_SPECTRUM_STATS);
        setError(null);
        setStatus(isTauri() ? "loading" : "unavailable");
    }, []);

    const retry = useCallback(() => {
        clear();
        setRetryToken((prev) => prev + 1);
    }, [clear]);

    return { status, error, latestRef, stats, clear, retry };
}
