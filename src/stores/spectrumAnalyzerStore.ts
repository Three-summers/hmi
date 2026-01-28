/**
 * 频谱分析仪状态管理 Store
 *
 * 职责范围：
 * - 持久化配置：threshold / historyDepth / refreshRate / colorScheme
 * - UI 交互状态：暂停/恢复、Marker 位置
 * - 实时数据缓冲：瀑布图环形缓冲区（waterfallBuffer + bufferHead）
 *
 * 环形缓冲区约定：
 * - `bufferHead` 表示“下次写入的位置”（当缓冲区满时，也等同于最旧数据所在位置）
 * - 写入新行时：
 *   - 未满：push 到末尾，并更新 head
 *   - 已满：覆盖 `bufferHead` 位置，并 head=(head+1)%capacity
 *
 * @module spectrumAnalyzerStore
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ColorScheme, ScreenshotSaveMode } from "@/types";

interface MarkerPosition {
    x: number;
    y: number;
}

interface SpectrumAnalyzerState {
    // 配置项（需持久化）
    /** 阈值 dBm */
    threshold: number;
    /** 瀑布图历史深度（行数） */
    historyDepth: number;
    /** 刷新率 Hz */
    refreshRate: number;
    /** 配色方案 */
    colorScheme: ColorScheme;
    /** 截图保存模式 */
    screenshotSaveMode: ScreenshotSaveMode;
    /** 自定义截图目录名称（用于 UI 展示；实际目录句柄持久化在 IndexedDB） */
    screenshotCustomDirectoryName: string | null;
    /** 自定义截图目录路径（仅 Tauri 使用；浏览器环境依赖 IndexedDB 持久化目录句柄） */
    screenshotCustomDirectoryPath: string | null;

    // UI 状态
    /** 是否暂停 */
    isPaused: boolean;
    /** Marker 位置 */
    markerPosition: MarkerPosition | null;

    // 专业显示曲线
    /** 是否显示 Max Hold 曲线 */
    showMaxHold: boolean;
    /** 是否显示 Average 曲线 */
    showAverage: boolean;
    /** Max Hold 数据缓存 */
    maxHoldData: number[];
    /** 累计平均数据 */
    averageData: number[];
    /** 平均计数 */
    averageCount: number;

    // 瀑布图数据缓冲区
    /** 环形缓冲区：每行为一帧频谱数据 */
    waterfallBuffer: number[][];
    /** 缓冲区头指针（下次写入位置） */
    bufferHead: number;

    // Actions
    setThreshold: (v: number) => void;
    setHistoryDepth: (v: number) => void;
    setRefreshRate: (v: number) => void;
    setColorScheme: (v: string) => void;
    setScreenshotSaveMode: (v: ScreenshotSaveMode) => void;
    setScreenshotCustomDirectoryName: (v: string | null) => void;
    setScreenshotCustomDirectoryPath: (v: string | null) => void;
    setIsPaused: (v: boolean) => void;
    setMarkerPosition: (pos: MarkerPosition | null) => void;
    setShowMaxHold: (v: boolean) => void;
    setShowAverage: (v: boolean) => void;
    updateMaxHold: (amplitudes: number[]) => void;
    updateAverage: (amplitudes: number[]) => void;
    resetMaxHold: () => void;
    resetAverage: () => void;
    pushWaterfallRow: (row: number[]) => void;
    clearWaterfallBuffer: () => void;
}

const DEFAULT_THRESHOLD_DBM = -80;
const DEFAULT_HISTORY_DEPTH = 100;
const DEFAULT_REFRESH_RATE_HZ = 30;
const DEFAULT_COLOR_SCHEME: ColorScheme = "turbo";
const DEFAULT_SCREENSHOT_SAVE_MODE: ScreenshotSaveMode = "downloads";

function isColorScheme(value: string): value is ColorScheme {
    return (
        value === "turbo" ||
        value === "viridis" ||
        value === "jet" ||
        value === "grayscale"
    );
}

function normalizePositiveInt(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.floor(value));
}

function getOrderedWaterfallRows(
    buffer: number[][],
    bufferHead: number,
    capacity: number,
): number[][] {
    if (buffer.length === 0) return [];

    // 未写满：数组已按时间顺序（旧 → 新）追加
    if (buffer.length < capacity) return buffer.slice();

    const safeCapacity = Math.max(1, capacity);
    const safeHead =
        ((bufferHead % safeCapacity) + safeCapacity) % safeCapacity;
    return buffer.slice(safeHead).concat(buffer.slice(0, safeHead));
}

export const useSpectrumAnalyzerStore = create<SpectrumAnalyzerState>()(
    persist(
        (set) => ({
            threshold: DEFAULT_THRESHOLD_DBM,
            historyDepth: DEFAULT_HISTORY_DEPTH,
            refreshRate: DEFAULT_REFRESH_RATE_HZ,
            colorScheme: DEFAULT_COLOR_SCHEME,
            screenshotSaveMode: DEFAULT_SCREENSHOT_SAVE_MODE,
            screenshotCustomDirectoryName: null,
            screenshotCustomDirectoryPath: null,

            isPaused: false,
            markerPosition: null,

            showMaxHold: false,
            showAverage: false,
            maxHoldData: [],
            averageData: [],
            averageCount: 0,

            waterfallBuffer: [],
            bufferHead: 0,

            setThreshold: (v) =>
                set({
                    threshold: Number.isFinite(v) ? v : DEFAULT_THRESHOLD_DBM,
                }),

            setHistoryDepth: (v) =>
                set((state) => {
                    const nextDepth = normalizePositiveInt(
                        v,
                        state.historyDepth,
                    );
                    if (nextDepth === state.historyDepth) return state;

                    const ordered = getOrderedWaterfallRows(
                        state.waterfallBuffer,
                        state.bufferHead,
                        state.historyDepth,
                    );
                    const keepFrom = Math.max(0, ordered.length - nextDepth);
                    const nextBuffer = ordered.slice(keepFrom);
                    const nextHead = nextBuffer.length % nextDepth;

                    return {
                        historyDepth: nextDepth,
                        waterfallBuffer: nextBuffer,
                        bufferHead: nextHead,
                    };
                }),

            setRefreshRate: (v) =>
                set((state) => {
                    const nextRate = normalizePositiveInt(v, state.refreshRate);
                    if (nextRate === state.refreshRate) return state;
                    return { refreshRate: nextRate };
                }),

            setColorScheme: (v) =>
                set((state) => {
                    const nextScheme = isColorScheme(v)
                        ? v
                        : DEFAULT_COLOR_SCHEME;
                    if (nextScheme === state.colorScheme) return state;
                    return { colorScheme: nextScheme };
                }),

            setScreenshotSaveMode: (v) =>
                set((state) => {
                    const nextMode =
                        v === "custom" || v === "downloads"
                            ? v
                            : DEFAULT_SCREENSHOT_SAVE_MODE;
                    if (nextMode === state.screenshotSaveMode) return state;
                    return { screenshotSaveMode: nextMode };
                }),

            setScreenshotCustomDirectoryName: (v) =>
                set((state) => {
                    const nextName =
                        typeof v === "string" && v.trim() ? v.trim() : null;
                    if (nextName === state.screenshotCustomDirectoryName)
                        return state;
                    return { screenshotCustomDirectoryName: nextName };
                }),

            setScreenshotCustomDirectoryPath: (v) =>
                set((state) => {
                    const nextPath =
                        typeof v === "string" && v.trim() ? v.trim() : null;
                    if (nextPath === state.screenshotCustomDirectoryPath)
                        return state;
                    return { screenshotCustomDirectoryPath: nextPath };
                }),

            setIsPaused: (v) => set({ isPaused: v }),

            setMarkerPosition: (pos) => set({ markerPosition: pos }),

            setShowMaxHold: (v) => set({ showMaxHold: v }),

            setShowAverage: (v) => set({ showAverage: v }),

            updateMaxHold: (amplitudes) =>
                set((state) => {
                    if (amplitudes.length === 0) return state;

                    const normalized = amplitudes.map((v) =>
                        Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY,
                    );

                    const nextMaxHold =
                        state.maxHoldData.length === normalized.length
                            ? state.maxHoldData.map((v, i) => {
                                  const next = normalized[i];
                                  if (!Number.isFinite(v)) return next;
                                  if (!Number.isFinite(next)) return v;
                                  return Math.max(v, next);
                              })
                            : normalized.slice();

                    return { maxHoldData: nextMaxHold };
                }),

            updateAverage: (amplitudes) =>
                set((state) => {
                    if (amplitudes.length === 0) return state;

                    const normalized = amplitudes.map((v) =>
                        Number.isFinite(v) ? v : Number.NaN,
                    );

                    if (state.averageData.length !== normalized.length) {
                        return {
                            averageData: normalized.slice(),
                            averageCount: 1,
                        };
                    }

                    const count = state.averageCount + 1;
                    const nextAverage = state.averageData.map((v, i) => {
                        const next = normalized[i];
                        if (!Number.isFinite(next)) return v;
                        if (!Number.isFinite(v)) return next;
                        return v + (next - v) / count;
                    });

                    return { averageData: nextAverage, averageCount: count };
                }),

            resetMaxHold: () =>
                set({
                    maxHoldData: [],
                }),

            resetAverage: () =>
                set({
                    averageData: [],
                    averageCount: 0,
                }),

            pushWaterfallRow: (row) =>
                set((state) => {
                    const capacity = Math.max(1, state.historyDepth);
                    const nextBuffer = state.waterfallBuffer.slice();
                    let nextHead = state.bufferHead;

                    if (nextBuffer.length < capacity) {
                        nextBuffer.push(row);
                        nextHead = nextBuffer.length % capacity;
                    } else {
                        nextBuffer[nextHead] = row;
                        nextHead = (nextHead + 1) % capacity;
                    }

                    return {
                        waterfallBuffer: nextBuffer,
                        bufferHead: nextHead,
                    };
                }),

            clearWaterfallBuffer: () =>
                set({
                    waterfallBuffer: [],
                    bufferHead: 0,
                }),
        }),
        {
            name: "spectrum-analyzer-config",
            // 仅持久化配置项，避免将实时数据写入 localStorage
            partialize: (state) => ({
                threshold: state.threshold,
                historyDepth: state.historyDepth,
                refreshRate: state.refreshRate,
                colorScheme: state.colorScheme,
                screenshotSaveMode: state.screenshotSaveMode,
                screenshotCustomDirectoryName: state.screenshotCustomDirectoryName,
                screenshotCustomDirectoryPath: state.screenshotCustomDirectoryPath,
            }),
        },
    ),
);
