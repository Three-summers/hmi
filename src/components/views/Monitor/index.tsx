import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import styles from "../shared.module.css";
import monitorStyles from "./Monitor.module.css";

// Check if running in Tauri environment
const isTauri = () => {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

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
        { pos: 0, color: "rgba(0, 50, 150, 0.3)" },      // 深蓝 (底噪区)
        { pos: 0.2, color: "rgba(0, 150, 255, 0.5)" },   // 蓝色
        { pos: 0.4, color: "rgba(0, 255, 200, 0.7)" },   // 青绿
        { pos: 0.6, color: "rgba(100, 255, 100, 0.8)" }, // 绿色
        { pos: 0.75, color: "rgba(255, 255, 0, 0.9)" },  // 黄色
        { pos: 0.9, color: "rgba(255, 150, 0, 0.95)" },  // 橙色
        { pos: 1, color: "rgba(255, 50, 50, 1)" },       // 红色 (高幅值)
    ],
    grid: "rgba(100, 150, 200, 0.2)",
    axis: "rgba(180, 200, 230, 0.9)",
    text: "rgba(220, 235, 255, 0.95)",
    peak: "#ff4444",
    background: "rgba(8, 15, 30, 0.98)",
};

export default function MonitorView() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<number>(0);
    const spectrumDataRef = useRef<SpectrumData | null>(null);
    const prevAmplitudesRef = useRef<number[]>([]);

    const [isPaused, setIsPaused] = useState(false);
    const [displayMode, setDisplayMode] = useState<"bars" | "fill" | "line">("fill");
    const [stats, setStats] = useState<SpectrumStats>({
        peak_frequency: 0,
        peak_amplitude: -90,
        average_amplitude: -90,
        bandwidth: 0,
    });

    // 计算 -3dB 带宽
    const calculateBandwidth = useCallback((frequencies: number[], amplitudes: number[], peakAmp: number): number => {
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
    }, []);

    // 绘制频谱图
    const drawSpectrum = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            animationRef.current = requestAnimationFrame(drawSpectrum);
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            animationRef.current = requestAnimationFrame(drawSpectrum);
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) {
            animationRef.current = requestAnimationFrame(drawSpectrum);
            return;
        }

        // 设置画布尺寸
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
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
            ctx.fillText("等待频谱数据...", width / 2, height / 2);

            // 绘制空白网格
            drawGrid(ctx, padding, chartWidth, chartHeight, width, height);

            animationRef.current = requestAnimationFrame(drawSpectrum);
            return;
        }

        const { frequencies, amplitudes } = data;
        const minAmp = -100;
        const maxAmp = 0;

        // 平滑动画：与前一帧数据插值（只在非暂停时更新）
        let smoothedAmps = amplitudes;
        if (prevAmplitudesRef.current.length === amplitudes.length) {
            if (!isPaused) {
                // 非暂停时，进行平滑插值
                smoothedAmps = amplitudes.map((amp, i) => {
                    const prev = prevAmplitudesRef.current[i];
                    return prev + (amp - prev) * 0.4;
                });
                prevAmplitudesRef.current = [...smoothedAmps];
            } else {
                // 暂停时，使用上一帧的数据
                smoothedAmps = prevAmplitudesRef.current;
            }
        } else {
            // 首次，直接使用当前数据
            prevAmplitudesRef.current = [...amplitudes];
        }

        // 创建渐变
        const gradient = ctx.createLinearGradient(0, padding.top + chartHeight, 0, padding.top);
        SPECTRUM_COLORS.gradient.forEach(stop => {
            gradient.addColorStop(stop.pos, stop.color);
        });

        // 绘制网格
        drawGrid(ctx, padding, chartWidth, chartHeight, width, height);

        // 绘制 dB 刻度标签
        const dbSteps = [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
        ctx.fillStyle = SPECTRUM_COLORS.text;
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        dbSteps.forEach(db => {
            const y = padding.top + chartHeight * (1 - (db - minAmp) / (maxAmp - minAmp));
            ctx.fillText(`${db}`, padding.left - 10, y);
        });

        // 绘制频率刻度标签
        const freqSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        freqSteps.forEach(freq => {
            const x = padding.left + chartWidth * (freq / 10);
            ctx.fillText(`${freq}k`, x, padding.top + chartHeight + 8);
        });

        // 绘制坐标轴标题
        ctx.fillStyle = SPECTRUM_COLORS.axis;
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("频率 (kHz)", padding.left + chartWidth / 2, height - 20);

        ctx.save();
        ctx.translate(20, padding.top + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = "middle";
        ctx.fillText("幅值 (dB)", 0, 0);
        ctx.restore();

        // 绘制频谱
        const barWidth = chartWidth / smoothedAmps.length;

        if (displayMode === "bars") {
            // 柱状图模式
            smoothedAmps.forEach((amp, i) => {
                const x = padding.left + i * barWidth;
                const normalizedAmp = Math.max(0, (amp - minAmp) / (maxAmp - minAmp));
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
                const normalizedAmp = Math.max(0, (amp - minAmp) / (maxAmp - minAmp));
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
                const normalizedAmp = Math.max(0, (amp - minAmp) / (maxAmp - minAmp));
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
                const normalizedAmp = Math.max(0, (amp - minAmp) / (maxAmp - minAmp));
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
        const peakNorm = Math.max(0, (smoothedAmps[peakIdx] - minAmp) / (maxAmp - minAmp));
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
        const textWidth = Math.max(ctx.measureText(labelText1).width, ctx.measureText(labelText2).width) + 12;

        let labelX = peakX - textWidth / 2;
        let labelY = peakY - 45;

        // 防止标签超出边界
        if (labelX < padding.left) labelX = padding.left;
        if (labelX + textWidth > width - padding.right) labelX = width - padding.right - textWidth;
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
        ctx.fillText("实时频谱分析", padding.left, 20);

        // 时间戳
        ctx.fillStyle = SPECTRUM_COLORS.text;
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "right";
        const time = new Date(data.timestamp).toLocaleTimeString();
        ctx.fillText(time, width - padding.right, 20);

        // 继续动画循环
        animationRef.current = requestAnimationFrame(drawSpectrum);
    }, [displayMode, isPaused]);

    // 绘制网格的辅助函数
    const drawGrid = (
        ctx: CanvasRenderingContext2D,
        padding: { top: number; right: number; bottom: number; left: number },
        chartWidth: number,
        chartHeight: number,
        _width: number,
        _height: number
    ) => {
        ctx.strokeStyle = SPECTRUM_COLORS.grid;
        ctx.lineWidth = 1;

        // 水平网格线 (dB)
        const dbSteps = [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
        dbSteps.forEach(db => {
            const y = padding.top + chartHeight * (1 - (db - (-100)) / (0 - (-100)));
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
    const updateSpectrum = useCallback((data: SpectrumData) => {
        // 调试日志
        console.log("Received spectrum data:", {
            timestamp: data.timestamp,
            peakFreq: data.peak_frequency,
            peakAmp: data.peak_amplitude,
            dataPoints: data.amplitudes?.length
        });

        // 始终更新数据引用，这样动画循环可以显示最新数据
        spectrumDataRef.current = data;

        // 只有在非暂停状态下才更新统计信息
        if (!isPaused) {
            const bandwidth = calculateBandwidth(
                data.frequencies,
                data.amplitudes,
                data.peak_amplitude
            );

            setStats({
                peak_frequency: data.peak_frequency,
                peak_amplitude: data.peak_amplitude,
                average_amplitude: data.average_amplitude,
                bandwidth,
            });
        }
    }, [isPaused, calculateBandwidth]);

    // Store updateSpectrum in ref
    const updateSpectrumRef = useRef(updateSpectrum);
    useEffect(() => {
        updateSpectrumRef.current = updateSpectrum;
    }, [updateSpectrum]);

    // 启动动画循环
    useEffect(() => {
        animationRef.current = requestAnimationFrame(drawSpectrum);
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [drawSpectrum]);

    // 监听后端数据
    useEffect(() => {
        if (!isTauri()) {
            console.warn("Not running in Tauri environment - spectrum data will not be available");
            return;
        }

        let unlisten: (() => void) | null = null;
        let mounted = true;

        const setup = async () => {
            try {
                unlisten = await listen<SpectrumData>("spectrum-data", (event) => {
                    if (mounted) {
                        updateSpectrumRef.current(event.payload);
                    }
                });
                console.log("Spectrum listener setup complete");

                await invoke("start_sensor_simulation");
                console.log("Spectrum simulation started");
            } catch (err) {
                console.error("Failed to setup spectrum monitoring:", err);
            }
        };

        setup();

        return () => {
            mounted = false;
            if (isTauri()) {
                invoke("stop_sensor_simulation").catch(console.error);
            }
            unlisten?.();
        };
    }, []);

    const handleClearData = () => {
        spectrumDataRef.current = null;
        prevAmplitudesRef.current = [];
        setStats({
            peak_frequency: 0,
            peak_amplitude: -90,
            average_amplitude: -90,
            bandwidth: 0,
        });
    };

    const formatFrequency = (freq: number) => {
        if (freq >= 1000) {
            return `${(freq / 1000).toFixed(2)} kHz`;
        }
        return `${freq.toFixed(0)} Hz`;
    };

    return (
        <div className={styles.view}>
            {/* 统计卡片 */}
            <div className={monitorStyles.statsGrid}>
                <div className={monitorStyles.statCard} data-type="peak-freq">
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
                            </svg>
                        </div>
                        <span className={monitorStyles.statusBadge} data-status="normal">
                            PEAK
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>峰值频率</span>
                    <span className={monitorStyles.statValue}>
                        {formatFrequency(stats.peak_frequency)}
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>中心频率分析</span>
                    </div>
                </div>

                <div className={monitorStyles.statCard} data-type="peak-amp">
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status={stats.peak_amplitude > -30 ? "warning" : "normal"}
                        >
                            {stats.peak_amplitude > -30 ? "HIGH" : "NORMAL"}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>峰值幅值</span>
                    <span className={monitorStyles.statValue}>
                        {stats.peak_amplitude.toFixed(1)} dB
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>信号强度</span>
                    </div>
                </div>

                <div className={monitorStyles.statCard} data-type="bandwidth">
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 5v14h18V5H3zm16 12H5V7h14v10zM7 9h2v6H7zm4 0h2v6h-2zm4 0h2v6h-2z" />
                            </svg>
                        </div>
                        <span className={monitorStyles.statusBadge} data-status="normal">
                            BW
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>信号带宽 (-3dB)</span>
                    <span className={monitorStyles.statValue}>
                        {formatFrequency(stats.bandwidth)}
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>Avg: {stats.average_amplitude.toFixed(1)} dB</span>
                    </div>
                </div>
            </div>

            {/* 频谱图 */}
            <div className={monitorStyles.chartContainer}>
                <div className={monitorStyles.chartHeader}>
                    <div className={monitorStyles.chartTitle}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
                        </svg>
                        实时频谱分析
                    </div>
                    <div className={monitorStyles.chartControls}>
                        <div className={monitorStyles.timeRangeGroup}>
                            {(["fill", "bars", "line"] as const).map((mode) => (
                                <button
                                    key={mode}
                                    className={monitorStyles.timeRangeBtn}
                                    data-active={displayMode === mode}
                                    onClick={() => setDisplayMode(mode)}
                                >
                                    {mode === "fill" ? "填充" : mode === "bars" ? "柱状" : "线条"}
                                </button>
                            ))}
                        </div>
                        <button
                            className={monitorStyles.controlBtn}
                            data-active={isPaused}
                            onClick={() => setIsPaused(!isPaused)}
                        >
                            {isPaused ? (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                </svg>
                            )}
                            {isPaused ? "继续" : "暂停"}
                        </button>
                        <button
                            className={monitorStyles.controlBtn}
                            onClick={handleClearData}
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                            清除
                        </button>
                    </div>
                </div>
                <div ref={containerRef} className={monitorStyles.chart}>
                    <canvas ref={canvasRef} className={monitorStyles.spectrumCanvas} />
                </div>
                <div className={monitorStyles.chartLegend}>
                    <div className={monitorStyles.legendItem} data-type="spectrum">
                        <span className={monitorStyles.legendDot} />
                        频谱幅值
                    </div>
                    <div className={monitorStyles.legendItem} data-type="peak">
                        <span className={monitorStyles.legendDot} />
                        峰值标记
                    </div>
                    <div className={monitorStyles.legendItem} data-type="noise">
                        <span className={monitorStyles.legendDot} />
                        底噪
                    </div>
                </div>
            </div>
        </div>
    );
}
