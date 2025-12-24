/**
 * 监控视图 - 频谱监测与分析
 *
 * 提供实时频谱监测、频谱分析仪、瀑布图等功能。
 * 核心特性：
 * - Canvas 实时绘制频谱图（支持柱状图、填充、线条三种模式）
 * - 性能优化：ResizeObserver 尺寸缓存、渐变缓存、绘制频率控制
 * - Tauri 事件监听：订阅后端传感器数据
 * - 视图激活控制：后台时停止绘制以节省资源
 *
 * @module Monitor
 */

import {
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo,
    lazy,
    Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Tabs } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useRegisterViewCommands } from "@/components/layout/ViewCommandContext";
import { useRegisterSubViewCommands } from "@/components/layout/SubViewCommandContext";
import { invoke } from "@/platform/invoke";
import { isTauri } from "@/platform/tauri";
import { useCanvasScale, useNotify } from "@/hooks";
import { useSpectrumAnalyzerStore } from "@/stores";
import { readCssVar } from "@/utils";
import { MonitorInfo } from "./MonitorInfo";
import { MonitorOverview } from "./MonitorOverview";
import styles from "../shared.module.css";

// 懒加载频谱分析仪组件（包含 uPlot 库，避免影响主页面加载）
const SpectrumAnalyzer = lazy(() => import("./SpectrumAnalyzer"));

/** 频谱数据（后端事件推送） */
interface SpectrumData {
    /** 数据时间戳（毫秒） */
    timestamp: number;
    /** 频率数组（Hz） */
    frequencies: number[];
    /** 幅度数组（dBm） */
    amplitudes: number[];
    /** 峰值频率（Hz） */
    peak_frequency: number;
    /** 峰值幅度（dBm） */
    peak_amplitude: number;
    /** 平均幅度（dBm） */
    average_amplitude: number;
}

/** 频谱统计信息（用于展示） */
interface SpectrumStats {
    peak_frequency: number;
    peak_amplitude: number;
    average_amplitude: number;
    bandwidth: number;
}

// 频谱图颜色配置
const SPECTRUM_COLORS = {
    // 渐变色停止点 (从底部到顶部)
    gradient: [
        { pos: 0, color: "rgba(0, 50, 150, 0.3)" }, // 深蓝 (底噪区)
        { pos: 0.2, color: "rgba(0, 150, 255, 0.5)" }, // 蓝色
        { pos: 0.4, color: "rgba(0, 255, 200, 0.7)" }, // 青绿
        { pos: 0.6, color: "rgba(100, 255, 100, 0.8)" }, // 绿色
        { pos: 0.75, color: "rgba(255, 255, 0, 0.9)" }, // 黄色
        { pos: 0.9, color: "rgba(255, 150, 0, 0.95)" }, // 橙色
        { pos: 1, color: "rgba(255, 50, 50, 1)" }, // 红色 (高幅值)
    ],
};

/**
 * 监控视图主组件
 *
 * 架构说明：
 * - 使用 Tabs 组件切换三个子页：概览（Overview）、说明（Info）、频谱分析仪（SpectrumAnalyzer）
 * - 概览页：实时绘制频谱图（Canvas）+ 统计卡片
 * - 频谱分析仪：基于 uPlot 的专业频谱分析工具
 * - 性能优化：视图激活判断、尺寸缓存、渐变缓存、绘制频率控制（~30 FPS）
 */
export default function MonitorView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { success, warning, info } = useNotify();
    const scaleFactor = useCanvasScale(16);

    // 视图命令配置（刷新、暂停、导出）
    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(
                        t("notification.dataRefreshed"),
                        t("notification.sensorDataUpdated"),
                    ),
            },
            {
                id: "pause",
                labelKey: "common.pause",
                onClick: () =>
                    warning(
                        t("notification.monitoringPaused"),
                        t("notification.dataCollectionPaused"),
                    ),
            },
            {
                id: "export",
                labelKey: "monitor.exportData",
                onClick: () =>
                    success(
                        t("notification.exportComplete"),
                        t("notification.dataExportedToFile"),
                    ),
            },
        ],
        [info, success, t, warning],
    );

    useRegisterViewCommands("monitor", commands, isViewActive);

    // Ref 引用：用于 Canvas 绘制和状态维护
    const canvasRef = useRef<HTMLCanvasElement>(null); // Canvas 元素
    const containerRef = useRef<HTMLDivElement>(null); // Canvas 容器（用于尺寸监听）
    const animationRef = useRef<number>(0); // requestAnimationFrame 句柄（0 表示未启动）
    const isViewActiveRef = useRef(true); // 视图激活状态（同步至 Ref，避免动画回调闭包陈旧）
    const spectrumDataRef = useRef<SpectrumData | null>(null); // 最新频谱数据（避免每次都触发重渲染）
    const prevAmplitudesRef = useRef<number[]>([]); // 上一帧幅度（用于平滑动画）
    const canvasSizeRef = useRef<{
        width: number;
        height: number;
        dpr: number;
    } | null>(null); // 缓存的 Canvas 尺寸（避免每帧读取 DOM）
    const gradientCacheRef = useRef<{
        key: string;
        gradient: CanvasGradient;
    } | null>(null); // 渐变缓存（按尺寸 key 缓存，避免每帧重建）
    const lastDrawAtRef = useRef<number>(0); // 上次绘制时间（用于控制帧率）
    const hasReceivedDataRef = useRef(false); // 是否已接收到首帧数据（用于状态切换）

    // 频谱状态管理
    type SpectrumStatus = "unavailable" | "loading" | "ready" | "error";
    const [spectrumStatus, setSpectrumStatus] =
        useState<SpectrumStatus>("loading"); // 频谱状态（不可用/加载中/就绪/错误）
    const [spectrumError, setSpectrumError] = useState<string | null>(null); // 错误信息
    const [retryToken, setRetryToken] = useState(0); // 重试令牌（递增以触发重新订阅）

    // UI 控制状态
    const [isPaused, setIsPaused] = useState(false); // 是否暂停绘制
    const [displayMode, setDisplayMode] = useState<"bars" | "fill" | "line">(
        "fill",
    ); // 显示模式（柱状图/填充/线条）
    const [activeTab, setActiveTab] = useState<
        "overview" | "info" | "spectrum-analyzer"
    >("overview"); // 当前激活的子页
    const [stats, setStats] = useState<SpectrumStats>({
        peak_frequency: 0,
        peak_amplitude: -90,
        average_amplitude: -90,
        bandwidth: 0,
    }); // 频谱统计信息

    // 视图激活状态判断：仅在监控页可见且当前子页为概览时绘制频谱图
    const isSpectrumActive = isViewActive && activeTab === "overview";
    const isSpectrumAnalyzerTabActive =
        isViewActive && activeTab === "spectrum-analyzer";

    // 频谱分析仪状态（从全局 Store 获取）

    const spectrumAnalyzerPaused = useSpectrumAnalyzerStore((s) => s.isPaused);
    const spectrumAnalyzerShowMaxHold = useSpectrumAnalyzerStore(
        (s) => s.showMaxHold,
    );
    const spectrumAnalyzerShowAverage = useSpectrumAnalyzerStore(
        (s) => s.showAverage,
    );
    const setSpectrumAnalyzerPaused = useSpectrumAnalyzerStore(
        (s) => s.setIsPaused,
    );
    const setSpectrumAnalyzerShowMaxHold = useSpectrumAnalyzerStore(
        (s) => s.setShowMaxHold,
    );
    const setSpectrumAnalyzerShowAverage = useSpectrumAnalyzerStore(
        (s) => s.setShowAverage,
    );
    const resetSpectrumAnalyzerMaxHold = useSpectrumAnalyzerStore(
        (s) => s.resetMaxHold,
    );
    const resetSpectrumAnalyzerAverage = useSpectrumAnalyzerStore(
        (s) => s.resetAverage,
    );

    const spectrumAnalyzerSubCommands = useMemo<CommandButtonConfig[]>(() => {
        if (!isSpectrumAnalyzerTabActive) return [];

        return [
            {
                id: spectrumAnalyzerPaused ? "start" : "pause",
                labelKey: spectrumAnalyzerPaused
                    ? "monitor.spectrumAnalyzer.controls.resume"
                    : "monitor.spectrumAnalyzer.controls.pause",
                highlight: spectrumAnalyzerPaused ? "warning" : "none",
                onClick: () => setSpectrumAnalyzerPaused(!spectrumAnalyzerPaused),
            },
            {
                id: "spectrumMaxHold",
                labelKey: "monitor.spectrumAnalyzer.controls.maxHold",
                highlight: spectrumAnalyzerShowMaxHold ? "attention" : "none",
                behavior: "toggle",
                onClick: () =>
                    setSpectrumAnalyzerShowMaxHold(!spectrumAnalyzerShowMaxHold),
            },
            {
                id: "spectrumAverage",
                labelKey: "monitor.spectrumAnalyzer.controls.average",
                highlight: spectrumAnalyzerShowAverage ? "attention" : "none",
                behavior: "toggle",
                onClick: () =>
                    setSpectrumAnalyzerShowAverage(!spectrumAnalyzerShowAverage),
            },
            {
                id: "reset",
                labelKey: "monitor.spectrumAnalyzer.controls.reset",
                highlight: "warning",
                onClick: () => {
                    resetSpectrumAnalyzerMaxHold();
                    resetSpectrumAnalyzerAverage();
                },
            },
        ];
    }, [
        isSpectrumAnalyzerTabActive,
        resetSpectrumAnalyzerAverage,
        resetSpectrumAnalyzerMaxHold,
        setSpectrumAnalyzerPaused,
        setSpectrumAnalyzerShowAverage,
        setSpectrumAnalyzerShowMaxHold,
        spectrumAnalyzerPaused,
        spectrumAnalyzerShowAverage,
        spectrumAnalyzerShowMaxHold,
    ]);

    useRegisterSubViewCommands(
        "monitor",
        spectrumAnalyzerSubCommands,
        isSpectrumAnalyzerTabActive,
    );

    // 计算 -3dB 带宽
    const calculateBandwidth = useCallback(
        (
            frequencies: number[],
            amplitudes: number[],
            peakAmp: number,
        ): number => {
            const threshold = peakAmp - 3;
            let lowFreq = frequencies[0];
            let highFreq = frequencies[frequencies.length - 1];

            // 从左侧找到第一个 >= 阈值的频率
            for (let i = 0; i < amplitudes.length; i++) {
                if (amplitudes[i] >= threshold) {
                    lowFreq = frequencies[i];
                    break;
                }
            }

            // 从右侧找到最后一个 >= 阈值的频率
            for (let i = amplitudes.length - 1; i >= 0; i--) {
                if (amplitudes[i] >= threshold) {
                    highFreq = frequencies[i];
                    break;
                }
            }

            return highFreq - lowFreq;
        },
        [],
    );

    /**
     * 绘制频谱图（Canvas 实时绘制）
     *
     * 性能优化策略：
     * - 视图激活判断：后台时不绘制，避免占用 CPU
     * - 尺寸缓存：从 ResizeObserver 缓存的尺寸读取，避免每帧触发 layout 测量
     * - 渐变缓存：按尺寸 key 缓存渐变对象，避免每帧重建
     * - 绘制频率控制：约 30 FPS（33ms 间隔），避免满速重绘
     * - 平滑动画：复用同一缓冲数组进行增量更新，避免每帧分配内存
     * - setTransform：替代 scale，避免累积变换与重复缩放风险
     *
     * 绘制流程：
     * 1. 视图激活判断 -> 跳过或继续
     * 2. 获取 Canvas 上下文和尺寸
     * 3. DPR 处理（高清屏适配）
     * 4. 绘制频率控制（30 FPS）
     * 5. 清空画布 -> 绘制网格 -> 绘制坐标轴 -> 绘制频谱 -> 标记峰值
     * 6. 调度下一帧（requestAnimationFrame）
     */
    const drawSpectrum = useCallback(() => {
        // 视图在后台时不重绘，避免占用 CPU；状态仍然保留在内存中
        if (!isViewActiveRef.current) return;

        // requestAnimationFrame 回调触发后，先清空句柄，便于外部判断当前是否仍有排队的绘制任务
        animationRef.current = 0;

        const scheduleNextFrame = () => {
            if (!isViewActiveRef.current) return;
            // 暂停时只保留静态画面，不持续占用 CPU
            if (isPaused) return;
            animationRef.current = requestAnimationFrame(drawSpectrum);
        };

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            scheduleNextFrame();
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            scheduleNextFrame();
            return;
        }

        // 从 ResizeObserver 缓存的尺寸读取，避免每帧触发 layout 测量
        let size = canvasSizeRef.current;
        if (!size) {
            const rect = container.getBoundingClientRect();
            const width = Math.floor(rect.width);
            const height = Math.floor(rect.height);
            const dpr = window.devicePixelRatio || 1;
            if (width > 0 && height > 0) {
                size = { width, height, dpr };
                canvasSizeRef.current = size;
            }
        }

        if (!size || size.width <= 0 || size.height <= 0) {
            scheduleNextFrame();
            return;
        }

        const { width, height, dpr } = size;

        // 避免首帧在 ResizeObserver 回调之前触发时画布尺寸不匹配
        const nextCanvasWidth = Math.max(1, Math.floor(width * dpr));
        const nextCanvasHeight = Math.max(1, Math.floor(height * dpr));
        if (
            canvas.width !== nextCanvasWidth ||
            canvas.height !== nextCanvasHeight
        ) {
            canvas.width = nextCanvasWidth;
            canvas.height = nextCanvasHeight;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            gradientCacheRef.current = null;
        }

        // 使用 setTransform 替代 scale，避免累积变换与重复缩放风险
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 获取当前主题颜色
        const computed = getComputedStyle(canvas);
        const peakColor = readCssVar(computed, "--color-alarm", "#ff4444");
        const textColor = readCssVar(computed, "--text-secondary", "rgba(220, 235, 255, 0.95)");
        const axisColor = readCssVar(computed, "--text-disabled", "rgba(180, 200, 230, 0.9)");
        const gridColor = readCssVar(computed, "--border-subtle", "rgba(100, 150, 200, 0.2)");
        const bgColor = readCssVar(computed, "--bg-primary", "rgba(8, 15, 30, 0.98)");
        const titleColor = readCssVar(computed, "--text-primary", "#ffffff");

        // 控制绘制频率（默认约 30 FPS），避免不必要的满速重绘
        if (!isPaused) {
            const now = performance.now();
            if (now - lastDrawAtRef.current < 33) {
                scheduleNextFrame();
                return;
            }
            lastDrawAtRef.current = now;
        }
        const safeScaleFactor =
            Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
        const px = (value: number) => Math.round(value * safeScaleFactor);
        const lw = (value: number) => value * safeScaleFactor;

        // 增加左侧 padding 以显示完整的 dB 标签
        const padding = {
            top: px(40),
            right: px(30),
            bottom: px(60),
            left: px(80),
        };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // 清空画布
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        const data = spectrumDataRef.current;
        if (!data || data.frequencies.length === 0) {
            // 显示等待数据提示
            ctx.fillStyle = textColor;
            ctx.font = `${px(16)}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(t("monitor.canvas.waiting"), width / 2, height / 2);

            // 绘制空白网格
            drawGrid(
                ctx,
                padding,
                chartWidth,
                chartHeight,
                width,
                height,
                gridColor,
                lw(1),
            );

            scheduleNextFrame();
            return;
        }

        const { frequencies, amplitudes } = data;
        const minAmp = -100;
        const maxAmp = 0;

        // 平滑动画：复用同一个缓冲数组进行增量更新，避免每帧 map/拷贝产生大量分配
        let smoothedAmps = prevAmplitudesRef.current;
        if (smoothedAmps.length !== amplitudes.length) {
            smoothedAmps = amplitudes.slice();
            prevAmplitudesRef.current = smoothedAmps;
        } else if (!isPaused) {
            for (let i = 0; i < amplitudes.length; i++) {
                smoothedAmps[i] =
                    smoothedAmps[i] + (amplitudes[i] - smoothedAmps[i]) * 0.4;
            }
        }

        // 创建渐变（按尺寸缓存，避免每帧重复构建）
        const gradientKey = `${padding.top}-${chartHeight}`;
        let gradient = gradientCacheRef.current?.gradient;
        if (gradientCacheRef.current?.key !== gradientKey || !gradient) {
            const newGradient = ctx.createLinearGradient(
                0,
                padding.top + chartHeight,
                0,
                padding.top,
            );
            for (const stop of SPECTRUM_COLORS.gradient) {
                newGradient.addColorStop(stop.pos, stop.color);
            }
            gradient = newGradient;
            gradientCacheRef.current = {
                key: gradientKey,
                gradient: newGradient,
            };
        }

        // 绘制网格
        drawGrid(
            ctx,
            padding,
            chartWidth,
            chartHeight,
            width,
            height,
            gridColor,
            lw(1),
        );

        // 绘制 dB 刻度标签
        const dbSteps = [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
        ctx.fillStyle = textColor;
        ctx.font = `${px(12)}px system-ui, sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        dbSteps.forEach((db) => {
            const y =
                padding.top +
                chartHeight * (1 - (db - minAmp) / (maxAmp - minAmp));
            ctx.fillText(`${db}`, padding.left - px(10), y);
        });

        // 绘制频率刻度标签
        const freqSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        freqSteps.forEach((freq) => {
            const x = padding.left + chartWidth * (freq / 10);
            ctx.fillText(`${freq}k`, x, padding.top + chartHeight + px(8));
        });

        // 绘制坐标轴标题
        ctx.fillStyle = axisColor;
        ctx.font = `${px(13)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
            t("monitor.canvas.axisFrequency"),
            padding.left + chartWidth / 2,
            height - px(20),
        );

        ctx.save();
        ctx.translate(px(20), padding.top + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = "middle";
        ctx.fillText(t("monitor.canvas.axisAmplitude"), 0, 0);
        ctx.restore();

        // 绘制频谱
        const barWidth = chartWidth / smoothedAmps.length;

        if (displayMode === "bars") {
            // 柱状图模式
            smoothedAmps.forEach((amp, i) => {
                const x = padding.left + i * barWidth;
                const normalizedAmp = Math.max(
                    0,
                    (amp - minAmp) / (maxAmp - minAmp),
                );
                const barHeight = normalizedAmp * chartHeight;
                const y = padding.top + chartHeight - barHeight;

                ctx.fillStyle = gradient;
                ctx.fillRect(
                    x,
                    y,
                    Math.max(barWidth - 0.5 * safeScaleFactor, 1),
                    barHeight,
                );
            });
        } else if (displayMode === "fill") {
            // 填充区域模式
            ctx.beginPath();
            ctx.moveTo(padding.left, padding.top + chartHeight);

            smoothedAmps.forEach((amp, i) => {
                const x = padding.left + i * barWidth + barWidth / 2;
                const normalizedAmp = Math.max(
                    0,
                    (amp - minAmp) / (maxAmp - minAmp),
                );
                const y = padding.top + chartHeight * (1 - normalizedAmp);
                ctx.lineTo(x, y);
            });

            ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // 绘制顶部线条
            ctx.beginPath();
            smoothedAmps.forEach((amp, i) => {
                const x = padding.left + i * barWidth + barWidth / 2;
                const normalizedAmp = Math.max(
                    0,
                    (amp - minAmp) / (maxAmp - minAmp),
                );
                const y = padding.top + chartHeight * (1 - normalizedAmp);

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.strokeStyle = "rgba(100, 220, 255, 0.9)";
            ctx.lineWidth = lw(2);
            ctx.stroke();

            // 添加发光效果
            ctx.strokeStyle = "rgba(100, 220, 255, 0.25)";
            ctx.lineWidth = lw(8);
            ctx.stroke();
        } else {
            // 线条模式
            ctx.beginPath();
            smoothedAmps.forEach((amp, i) => {
                const x = padding.left + i * barWidth + barWidth / 2;
                const normalizedAmp = Math.max(
                    0,
                    (amp - minAmp) / (maxAmp - minAmp),
                );
                const y = padding.top + chartHeight * (1 - normalizedAmp);

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.strokeStyle = "rgba(0, 255, 200, 0.9)";
            ctx.lineWidth = lw(2);
            ctx.stroke();
        }

        // 标记峰值点
        let peakIdx = 0;
        let maxVal = smoothedAmps[0];
        for (let i = 1; i < smoothedAmps.length; i++) {
            if (smoothedAmps[i] > maxVal) {
                maxVal = smoothedAmps[i];
                peakIdx = i;
            }
        }

        const peakX = padding.left + peakIdx * barWidth + barWidth / 2;
        const peakNorm = Math.max(
            0,
            (smoothedAmps[peakIdx] - minAmp) / (maxAmp - minAmp),
        );
        const peakY = padding.top + chartHeight * (1 - peakNorm);

        // 峰值标记线
        ctx.setLineDash([px(4), px(4)]);
        ctx.strokeStyle = "rgba(255, 100, 100, 0.5)";
        ctx.lineWidth = lw(1);
        ctx.beginPath();
        ctx.moveTo(peakX, padding.top);
        ctx.lineTo(peakX, padding.top + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // 峰值点
        ctx.beginPath();
        ctx.arc(peakX, peakY, px(6), 0, Math.PI * 2);
        ctx.fillStyle = peakColor;
        ctx.fill();
        ctx.strokeStyle = titleColor;
        ctx.lineWidth = lw(2);
        ctx.stroke();

        // 峰值标签背景
        const peakFreq = frequencies[peakIdx];
        const labelText1 = `${(peakFreq / 1000).toFixed(2)} kHz`;
        const labelText2 = `${smoothedAmps[peakIdx].toFixed(1)} dB`;

        ctx.font = `bold ${px(11)}px system-ui, sans-serif`;
        const textWidth =
            Math.max(
                ctx.measureText(labelText1).width,
                ctx.measureText(labelText2).width,
            ) + px(12);

        let labelX = peakX - textWidth / 2;
        let labelY = peakY - px(45);

        // 防止标签超出边界
        if (labelX < padding.left) labelX = padding.left;
        if (labelX + textWidth > width - padding.right)
            labelX = width - padding.right - textWidth;
        if (labelY < padding.top) labelY = peakY + px(15);

        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(labelX - px(2), labelY, textWidth + px(4), px(36));
        ctx.strokeStyle = peakColor;
        ctx.lineWidth = lw(1);
        ctx.strokeRect(labelX - px(2), labelY, textWidth + px(4), px(36));

        // 峰值标签文字
        ctx.fillStyle = titleColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(labelText1, labelX + textWidth / 2, labelY + px(5));
        ctx.fillStyle = peakColor;
        ctx.fillText(labelText2, labelX + textWidth / 2, labelY + px(20));

        // 绘制边框
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = lw(1);
        ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

        // 添加标题
        ctx.fillStyle = titleColor;
        ctx.font = `bold ${px(15)}px system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(t("monitor.spectrum.title"), padding.left, px(20));

        // 时间戳
        ctx.fillStyle = textColor;
        ctx.font = `${px(12)}px system-ui, sans-serif`;
        ctx.textAlign = "right";
        const time = new Date(data.timestamp).toLocaleTimeString();
        ctx.fillText(time, width - padding.right, px(20));

        // 继续动画循环
        scheduleNextFrame();
    }, [displayMode, isPaused, scaleFactor, t]);

    /**
     * 监听容器尺寸变化，更新 Canvas backing store
     *
     * 优化说明：
     * - 仅在容器尺寸真正变化时调整 Canvas，避免每帧重复 resize 导致性能抖动
     * - 视图缓存 + 标签页模式下，隐藏面板可能为 0 尺寸；此时不把画布缩放到 0，避免切回显示空白
     * - 使用 ResizeObserver 替代 resize 事件监听，更高效且支持容器级监听
     */
    useEffect(() => {
        if (spectrumStatus !== "ready") return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const updateCanvasSize = () => {
            const rect = container.getBoundingClientRect();
            const width = Math.floor(rect.width);
            const height = Math.floor(rect.height);

            // 视图缓存 + 标签页模式下，隐藏面板可能为 0 尺寸；此时不把画布缩放到 0，避免切回显示空白。
            if (width <= 0 || height <= 0) return;

            const dpr = window.devicePixelRatio || 1;
            const prev = canvasSizeRef.current;
            if (
                prev &&
                prev.width === width &&
                prev.height === height &&
                prev.dpr === dpr
            ) {
                return;
            }

            canvasSizeRef.current = { width, height, dpr };
            gradientCacheRef.current = null;

            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            // 暂停状态下不会持续动画，resize 后主动触发一次重绘
            if (isViewActiveRef.current && !animationRef.current) {
                animationRef.current = requestAnimationFrame(drawSpectrum);
            }
        };

        updateCanvasSize();
        const observer = new ResizeObserver(() => updateCanvasSize());
        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [drawSpectrum, spectrumStatus]);

    // 绘制网格的辅助函数
    const drawGrid = (
        ctx: CanvasRenderingContext2D,
        padding: { top: number; right: number; bottom: number; left: number },
        chartWidth: number,
        chartHeight: number,
        _width: number,
        _height: number,
        gridColor: string,
        lineWidth: number,
    ) => {
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = lineWidth;

        // 水平网格线 (dB)
        const dbSteps = [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
        dbSteps.forEach((db) => {
            const y =
                padding.top + chartHeight * (1 - (db - -100) / (0 - -100));
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        });

        // 垂直网格线 (频率)
        for (let i = 0; i <= 10; i++) {
            const x = padding.left + chartWidth * (i / 10);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();
        }
    };

    // 更新数据回调
    const updateSpectrum = useCallback(
        (data: SpectrumData) => {
            // 始终更新数据引用，这样动画循环可以显示最新数据
            spectrumDataRef.current = data;

            // 首次收到数据时，切换到 ready 状态（用于控制占位符/Canvas 绘制）
            if (!hasReceivedDataRef.current) {
                hasReceivedDataRef.current = true;
                setSpectrumStatus("ready");
                setSpectrumError(null);
            }

            // 只有在非暂停状态下才更新统计信息
            if (!isPaused) {
                const bandwidth = calculateBandwidth(
                    data.frequencies,
                    data.amplitudes,
                    data.peak_amplitude,
                );

                setStats({
                    peak_frequency: data.peak_frequency,
                    peak_amplitude: data.peak_amplitude,
                    average_amplitude: data.average_amplitude,
                    bandwidth,
                });
            }
        },
        [isPaused, calculateBandwidth],
    );

    // 将回调写入 Ref，避免事件监听闭包拿到旧的函数引用
    const updateSpectrumRef = useRef(updateSpectrum);
    useEffect(() => {
        updateSpectrumRef.current = updateSpectrum;
    }, [updateSpectrum]);

    /**
     * 控制绘制动画循环的启动与停止
     *
     * 触发条件：isSpectrumActive（视图可见 + 当前子页为概览）或 spectrumStatus 变化
     * - 激活时：启动 requestAnimationFrame 循环
     * - 停止时：取消动画帧，释放资源
     */
    useEffect(() => {
        const shouldDrawSpectrum =
            isSpectrumActive && spectrumStatus === "ready";
        isViewActiveRef.current = shouldDrawSpectrum;

        if (!shouldDrawSpectrum) {
            if (animationRef.current)
                cancelAnimationFrame(animationRef.current);
            animationRef.current = 0;
            return;
        }

        if (!animationRef.current) {
            animationRef.current = requestAnimationFrame(drawSpectrum);
        }

        return () => {
            if (animationRef.current)
                cancelAnimationFrame(animationRef.current);
            animationRef.current = 0;
        };
    }, [drawSpectrum, isSpectrumActive, spectrumStatus]);

    /**
     * Tauri 事件订阅：监听后端传感器数据推送
     *
     * 订阅条件：仅在"监控页可见 + 当前子页为概览"时启动，避免后台页面持续消耗资源
     * 订阅流程：
     * 1. 检查 Tauri 环境（浏览器模式下不可用）
     * 2. 注册 "spectrum-data" 事件监听器
     * 3. 调用后端 start_sensor_simulation 启动数据推送
     * 4. 清理：停止推送 + 注销监听器
     *
     * 错误处理：捕获异常并设置错误状态，支持重试
     */
    // 仅在"监控页可见 + 当前子页为概览"时启动数据订阅，避免后台页面持续消耗资源
    useEffect(() => {
        if (!isSpectrumActive) return;

        if (!isTauri()) {
            setSpectrumStatus("unavailable");
            setSpectrumError(null);
            console.warn(
                "Not running in Tauri environment - spectrum data will not be available",
            );
            return;
        }

        setSpectrumStatus("loading");
        setSpectrumError(null);
        hasReceivedDataRef.current = false;

        let unlisten: (() => void) | null = null;
        let cancelled = false;

        const setup = async () => {
            try {
                const unlistenFn = await listen<SpectrumData>(
                    "spectrum-data",
                    (event) => {
                        if (!cancelled) {
                            updateSpectrumRef.current(event.payload);
                        }
                    },
                );
                if (cancelled) {
                    unlistenFn();
                    return;
                }
                unlisten = unlistenFn;

                await invoke("start_sensor_simulation");
            } catch (err) {
                console.error("Failed to setup spectrum monitoring:", err);
                if (cancelled) return;
                const message =
                    err instanceof Error ? err.message : String(err);
                setSpectrumStatus("error");
                setSpectrumError(message);
                spectrumDataRef.current = null;
                prevAmplitudesRef.current = [];
            }
        };

        setup();

        return () => {
            cancelled = true;
            if (isTauri()) {
                invoke("stop_sensor_simulation").catch(console.error);
            }
            unlisten?.();
        };
    }, [isSpectrumActive, retryToken]);

    const handleClearData = () => {
        spectrumDataRef.current = null;
        prevAmplitudesRef.current = [];
        hasReceivedDataRef.current = false;
        setSpectrumStatus(isTauri() ? "loading" : "unavailable");
        setSpectrumError(null);
        setStats({
            peak_frequency: 0,
            peak_amplitude: -90,
            average_amplitude: -90,
            bandwidth: 0,
        });
    };

    const handleRetrySpectrum = () => {
        spectrumDataRef.current = null;
        prevAmplitudesRef.current = [];
        hasReceivedDataRef.current = false;
        setStats({
            peak_frequency: 0,
            peak_amplitude: -90,
            average_amplitude: -90,
            bandwidth: 0,
        });
        setSpectrumStatus(isTauri() ? "loading" : "unavailable");
        setSpectrumError(null);
        setRetryToken((prev) => prev + 1);
    };

    const handleTogglePaused = () => {
        setIsPaused((prev) => !prev);
    };

    return (
        <div className={styles.view}>
            <Tabs
                activeId={activeTab}
                onChange={setActiveTab}
                tabs={[
                    {
                        id: "overview",
                        label: t("common.tabs.overview"),
                        content: (
                            <MonitorOverview
                                stats={stats}
                                displayMode={displayMode}
                                onChangeDisplayMode={setDisplayMode}
                                isPaused={isPaused}
                                onTogglePaused={handleTogglePaused}
                                onClearData={handleClearData}
                                spectrumStatus={spectrumStatus}
                                spectrumError={spectrumError}
                                onRetrySpectrum={handleRetrySpectrum}
                                containerRef={containerRef}
                                canvasRef={canvasRef}
                            />
                        ),
                    },
                    {
                        id: "info",
                        label: t("common.tabs.info"),
                        content: <MonitorInfo />,
                    },
                    {
                        id: "spectrum-analyzer",
                        label: "频谱分析仪",
                        content: (
                            <Suspense
                                fallback={
                                    <div
                                        style={{
                                            padding: 16,
                                            color: "var(--text-secondary)",
                                        }}
                                    >
                                        Loading...
                                    </div>
                                }
                            >
                                <SpectrumAnalyzer
                                    isActive={activeTab === "spectrum-analyzer"}
                                />
                            </Suspense>
                        ),
                    },
                ]}
            />
        </div>
    );
}
