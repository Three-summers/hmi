import {
    useEffect,
    useRef,
    useState,
    useCallback,
    lazy,
    Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Tabs, StatusIndicator } from "@/components/common";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { invoke } from "@/platform/invoke";
import { isTauri } from "@/platform/tauri";
import styles from "../shared.module.css";
import monitorStyles from "./Monitor.module.css";

const SpectrumAnalyzer = lazy(() => import("./SpectrumAnalyzer"));

interface SpectrumData {
    timestamp: number;
    frequencies: number[];
    amplitudes: number[];
    peak_frequency: number;
    peak_amplitude: number;
    average_amplitude: number;
}

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
    grid: "rgba(100, 150, 200, 0.2)",
    axis: "rgba(180, 200, 230, 0.9)",
    text: "rgba(220, 235, 255, 0.95)",
    peak: "#ff4444",
    background: "rgba(8, 15, 30, 0.98)",
};

export default function MonitorView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<number>(0);
    const isViewActiveRef = useRef(true);
    const spectrumDataRef = useRef<SpectrumData | null>(null);
    const prevAmplitudesRef = useRef<number[]>([]);
    const canvasSizeRef = useRef<{
        width: number;
        height: number;
        dpr: number;
    } | null>(null);
    const gradientCacheRef = useRef<{
        key: string;
        gradient: CanvasGradient;
    } | null>(null);
    const lastDrawAtRef = useRef<number>(0);
    const hasReceivedDataRef = useRef(false);

    type SpectrumStatus = "unavailable" | "loading" | "ready" | "error";
    const [spectrumStatus, setSpectrumStatus] =
        useState<SpectrumStatus>("loading");
    const [spectrumError, setSpectrumError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);

    const [isPaused, setIsPaused] = useState(false);
    const [displayMode, setDisplayMode] = useState<"bars" | "fill" | "line">(
        "fill",
    );
    const [activeTab, setActiveTab] = useState<
        "overview" | "info" | "spectrum-analyzer"
    >("overview");
    const [stats, setStats] = useState<SpectrumStats>({
        peak_frequency: 0,
        peak_amplitude: -90,
        average_amplitude: -90,
        bandwidth: 0,
    });

    const isSpectrumActive = isViewActive && activeTab === "overview";

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

            for (let i = 0; i < amplitudes.length; i++) {
                if (amplitudes[i] >= threshold) {
                    lowFreq = frequencies[i];
                    break;
                }
            }

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

    // 绘制频谱图
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

        // 控制绘制频率（默认约 30 FPS），避免不必要的满速重绘
        if (!isPaused) {
            const now = performance.now();
            if (now - lastDrawAtRef.current < 33) {
                scheduleNextFrame();
                return;
            }
            lastDrawAtRef.current = now;
        }
        // 增加左侧 padding 以显示完整的 dB 标签
        const padding = { top: 40, right: 30, bottom: 60, left: 80 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // 清空画布
        ctx.fillStyle = SPECTRUM_COLORS.background;
        ctx.fillRect(0, 0, width, height);

        const data = spectrumDataRef.current;
        if (!data || data.frequencies.length === 0) {
            // 显示等待数据提示
            ctx.fillStyle = SPECTRUM_COLORS.text;
            ctx.font = "16px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(t("monitor.canvas.waiting"), width / 2, height / 2);

            // 绘制空白网格
            drawGrid(ctx, padding, chartWidth, chartHeight, width, height);

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
        drawGrid(ctx, padding, chartWidth, chartHeight, width, height);

        // 绘制 dB 刻度标签
        const dbSteps = [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
        ctx.fillStyle = SPECTRUM_COLORS.text;
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        dbSteps.forEach((db) => {
            const y =
                padding.top +
                chartHeight * (1 - (db - minAmp) / (maxAmp - minAmp));
            ctx.fillText(`${db}`, padding.left - 10, y);
        });

        // 绘制频率刻度标签
        const freqSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        freqSteps.forEach((freq) => {
            const x = padding.left + chartWidth * (freq / 10);
            ctx.fillText(`${freq}k`, x, padding.top + chartHeight + 8);
        });

        // 绘制坐标轴标题
        ctx.fillStyle = SPECTRUM_COLORS.axis;
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
            t("monitor.canvas.axisFrequency"),
            padding.left + chartWidth / 2,
            height - 20,
        );

        ctx.save();
        ctx.translate(20, padding.top + chartHeight / 2);
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
                ctx.fillRect(x, y, Math.max(barWidth - 0.5, 1), barHeight);
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
            ctx.lineWidth = 2;
            ctx.stroke();

            // 添加发光效果
            ctx.strokeStyle = "rgba(100, 220, 255, 0.25)";
            ctx.lineWidth = 8;
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
            ctx.lineWidth = 2;
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
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(255, 100, 100, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(peakX, padding.top);
        ctx.lineTo(peakX, padding.top + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // 峰值点
        ctx.beginPath();
        ctx.arc(peakX, peakY, 6, 0, Math.PI * 2);
        ctx.fillStyle = SPECTRUM_COLORS.peak;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 峰值标签背景
        const peakFreq = frequencies[peakIdx];
        const labelText1 = `${(peakFreq / 1000).toFixed(2)} kHz`;
        const labelText2 = `${smoothedAmps[peakIdx].toFixed(1)} dB`;

        ctx.font = "bold 11px system-ui, sans-serif";
        const textWidth =
            Math.max(
                ctx.measureText(labelText1).width,
                ctx.measureText(labelText2).width,
            ) + 12;

        let labelX = peakX - textWidth / 2;
        let labelY = peakY - 45;

        // 防止标签超出边界
        if (labelX < padding.left) labelX = padding.left;
        if (labelX + textWidth > width - padding.right)
            labelX = width - padding.right - textWidth;
        if (labelY < padding.top) labelY = peakY + 15;

        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(labelX - 2, labelY, textWidth + 4, 36);
        ctx.strokeStyle = SPECTRUM_COLORS.peak;
        ctx.lineWidth = 1;
        ctx.strokeRect(labelX - 2, labelY, textWidth + 4, 36);

        // 峰值标签文字
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(labelText1, labelX + textWidth / 2, labelY + 5);
        ctx.fillStyle = SPECTRUM_COLORS.peak;
        ctx.fillText(labelText2, labelX + textWidth / 2, labelY + 20);

        // 绘制边框
        ctx.strokeStyle = SPECTRUM_COLORS.axis;
        ctx.lineWidth = 1;
        ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

        // 添加标题
        ctx.fillStyle = "#fff";
        ctx.font = "bold 15px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(t("monitor.spectrum.title"), padding.left, 20);

        // 时间戳
        ctx.fillStyle = SPECTRUM_COLORS.text;
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "right";
        const time = new Date(data.timestamp).toLocaleTimeString();
        ctx.fillText(time, width - padding.right, 20);

        // 继续动画循环
        scheduleNextFrame();
    }, [displayMode, isPaused, t]);

    // 仅在容器尺寸变化时调整 Canvas backing store，避免每帧重复 resize 导致性能抖动
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
    ) => {
        ctx.strokeStyle = SPECTRUM_COLORS.grid;
        ctx.lineWidth = 1;

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

    // 仅在“监控页可见 + 当前子页为概览”时启动数据订阅，避免后台页面持续消耗资源
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

    const formatFrequency = (freq: number) => {
        if (freq >= 1000) {
            return `${(freq / 1000).toFixed(2)} kHz`;
        }
        return `${freq.toFixed(0)} Hz`;
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
                            <>
                                <div className={monitorStyles.statsGrid}>
                                    <div
                                        className={monitorStyles.statCard}
                                        data-type="peak-freq"
                                    >
                                        <div
                                            className={monitorStyles.cardHeader}
                                        >
                                            <div
                                                className={
                                                    monitorStyles.cardIcon
                                                }
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
                                                </svg>
                                            </div>
                                            <span
                                                className={
                                                    monitorStyles.statusBadge
                                                }
                                                data-status="normal"
                                            >
                                                {t("monitor.badges.peak")}
                                            </span>
                                        </div>
                                        <span
                                            className={monitorStyles.statLabel}
                                        >
                                            {t("monitor.stats.peakFrequency")}
                                        </span>
                                        <span
                                            className={monitorStyles.statValue}
                                        >
                                            {formatFrequency(
                                                stats.peak_frequency,
                                            )}
                                        </span>
                                        <div className={monitorStyles.statMeta}>
                                            <span>
                                                {t(
                                                    "monitor.stats.centerFrequencyAnalysis",
                                                )}
                                            </span>
                                        </div>
                                    </div>

                                    <div
                                        className={monitorStyles.statCard}
                                        data-type="peak-amp"
                                    >
                                        <div
                                            className={monitorStyles.cardHeader}
                                        >
                                            <div
                                                className={
                                                    monitorStyles.cardIcon
                                                }
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" />
                                                </svg>
                                            </div>
                                            <span
                                                className={
                                                    monitorStyles.statusBadge
                                                }
                                                data-status={
                                                    stats.peak_amplitude > -30
                                                        ? "warning"
                                                        : "normal"
                                                }
                                            >
                                                {stats.peak_amplitude > -30
                                                    ? t("monitor.badges.high")
                                                    : t(
                                                          "monitor.badges.normal",
                                                      )}
                                            </span>
                                        </div>
                                        <span
                                            className={monitorStyles.statLabel}
                                        >
                                            {t("monitor.stats.peakAmplitude")}
                                        </span>
                                        <span
                                            className={monitorStyles.statValue}
                                        >
                                            {stats.peak_amplitude.toFixed(1)} dB
                                        </span>
                                        <div className={monitorStyles.statMeta}>
                                            <span>
                                                {t(
                                                    "monitor.stats.signalStrength",
                                                )}
                                            </span>
                                        </div>
                                    </div>

                                    <div
                                        className={monitorStyles.statCard}
                                        data-type="bandwidth"
                                    >
                                        <div
                                            className={monitorStyles.cardHeader}
                                        >
                                            <div
                                                className={
                                                    monitorStyles.cardIcon
                                                }
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M3 5v14h18V5H3zm16 12H5V7h14v10zM7 9h2v6H7zm4 0h2v6h-2zm4 0h2v6h-2z" />
                                                </svg>
                                            </div>
                                            <span
                                                className={
                                                    monitorStyles.statusBadge
                                                }
                                                data-status="normal"
                                            >
                                                {t("monitor.badges.bandwidth")}
                                            </span>
                                        </div>
                                        <span
                                            className={monitorStyles.statLabel}
                                        >
                                            {t("monitor.stats.bandwidth")}
                                        </span>
                                        <span
                                            className={monitorStyles.statValue}
                                        >
                                            {formatFrequency(stats.bandwidth)}
                                        </span>
                                        <div className={monitorStyles.statMeta}>
                                            <span>
                                                {t(
                                                    "monitor.stats.averageAmplitude",
                                                    {
                                                        value: stats.average_amplitude.toFixed(
                                                            1,
                                                        ),
                                                    },
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className={monitorStyles.chartContainer}>
                                    <div className={monitorStyles.chartHeader}>
                                        <div
                                            className={monitorStyles.chartTitle}
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                            >
                                                <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
                                            </svg>
                                            {t("monitor.spectrum.title")}
                                        </div>
                                        <div
                                            className={
                                                monitorStyles.chartControls
                                            }
                                        >
                                            <div
                                                className={
                                                    monitorStyles.timeRangeGroup
                                                }
                                            >
                                                {(
                                                    [
                                                        "fill",
                                                        "bars",
                                                        "line",
                                                    ] as const
                                                ).map((mode) => (
                                                    <button
                                                        key={mode}
                                                        className={
                                                            monitorStyles.timeRangeBtn
                                                        }
                                                        data-active={
                                                            displayMode === mode
                                                        }
                                                        onClick={() =>
                                                            setDisplayMode(mode)
                                                        }
                                                    >
                                                        {mode === "fill"
                                                            ? t(
                                                                  "monitor.displayMode.fill",
                                                              )
                                                            : mode === "bars"
                                                              ? t(
                                                                    "monitor.displayMode.bars",
                                                                )
                                                              : t(
                                                                    "monitor.displayMode.line",
                                                                )}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                className={
                                                    monitorStyles.controlBtn
                                                }
                                                data-active={isPaused}
                                                onClick={() =>
                                                    setIsPaused(!isPaused)
                                                }
                                            >
                                                {isPaused ? (
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                    >
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                ) : (
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                    >
                                                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                                    </svg>
                                                )}
                                                {isPaused
                                                    ? t("common.resume")
                                                    : t("common.pause")}
                                            </button>
                                            <button
                                                className={
                                                    monitorStyles.controlBtn
                                                }
                                                onClick={handleClearData}
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                                </svg>
                                                {t("common.clear")}
                                            </button>
                                        </div>
                                    </div>
                                    <div
                                        ref={containerRef}
                                        className={monitorStyles.chart}
                                    >
                                        {spectrumStatus === "ready" ? (
                                            <canvas
                                                ref={canvasRef}
                                                className={
                                                    monitorStyles.spectrumCanvas
                                                }
                                            />
                                        ) : (
                                            <div
                                                className={styles.emptyState}
                                                style={{ height: "100%" }}
                                            >
                                                <StatusIndicator
                                                    status={
                                                        spectrumStatus ===
                                                        "error"
                                                            ? "alarm"
                                                            : spectrumStatus ===
                                                                "unavailable"
                                                              ? "idle"
                                                              : "processing"
                                                    }
                                                    label={
                                                        spectrumStatus ===
                                                        "error"
                                                            ? t(
                                                                  "monitor.status.error",
                                                              )
                                                            : spectrumStatus ===
                                                                "unavailable"
                                                              ? t(
                                                                    "monitor.status.unavailable",
                                                                )
                                                              : t(
                                                                    "monitor.status.loading",
                                                                )
                                                    }
                                                />
                                                {spectrumError && (
                                                    <div
                                                        style={{
                                                            marginTop: 8,
                                                            fontSize: 12,
                                                            color: "var(--text-secondary)",
                                                            textAlign: "center",
                                                            maxWidth: 520,
                                                        }}
                                                    >
                                                        {spectrumError}
                                                    </div>
                                                )}
                                                {spectrumStatus === "error" && (
                                                    <button
                                                        className={
                                                            monitorStyles.controlBtn
                                                        }
                                                        onClick={
                                                            handleRetrySpectrum
                                                        }
                                                        style={{
                                                            marginTop: 12,
                                                        }}
                                                    >
                                                        {t("common.retry")}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className={monitorStyles.chartLegend}>
                                        <div
                                            className={monitorStyles.legendItem}
                                            data-type="spectrum"
                                        >
                                            <span
                                                className={
                                                    monitorStyles.legendDot
                                                }
                                            />
                                            {t(
                                                "monitor.legend.spectrumAmplitude",
                                            )}
                                        </div>
                                        <div
                                            className={monitorStyles.legendItem}
                                            data-type="peak"
                                        >
                                            <span
                                                className={
                                                    monitorStyles.legendDot
                                                }
                                            />
                                            {t("monitor.legend.peakMarker")}
                                        </div>
                                        <div
                                            className={monitorStyles.legendItem}
                                            data-type="noise"
                                        >
                                            <span
                                                className={
                                                    monitorStyles.legendDot
                                                }
                                            />
                                            {t("monitor.legend.noiseFloor")}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ),
                    },
                    {
                        id: "info",
                        label: t("common.tabs.info"),
                        content: (
                            <div className={monitorStyles.monitorInfo}>
                                <h3 className={monitorStyles.monitorInfoTitle}>
                                    {t("nav.monitor")}
                                </h3>
                                <ul className={monitorStyles.monitorInfoList}>
                                    <li>{t("monitor.info.autoPause")}</li>
                                    <li>{t("monitor.info.displayModeTip")}</li>
                                    <li>{t("monitor.info.browserModeTip")}</li>
                                </ul>
                            </div>
                        ),
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
