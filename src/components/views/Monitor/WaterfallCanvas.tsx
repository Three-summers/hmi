import { useCallback, useEffect, useRef } from "react";
import type { RGBA } from "@/utils/colormap";
import { amplitudeToColor } from "@/utils/colormap";
import type { ColorScheme } from "@/types";
import { useAppStore } from "@/stores";
import styles from "./WaterfallCanvas.module.css";

export interface WaterfallCanvasProps {
    /** 当前帧幅度数据（dBm） */
    amplitudes: number[];
    /** 阈值（dBm） */
    threshold: number;
    /** 历史深度（行数） */
    historyDepth: number;
    /** 是否暂停 */
    isPaused: boolean;
    /** 配色方案 */
    colorScheme?: ColorScheme;
}

type CanvasSize = { width: number; height: number; dpr: number };

const MIN_AMP_DBM = -100;
const MAX_AMP_DBM = 0;

interface WaterfallPalette {
    background: string;
    axis: string;
    text: string;
    grid: string;
    divider: string;
    legendBg: string;
    timeBg: string;
    timeText: string;
}

const TIME_SCALE_WIDTH_PX = 60;

function rgbaToCss(color: RGBA): string {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

function normalizePositiveInt(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.floor(value));
}

function getLegendWidth(totalWidth: number): number {
    // 颜色条 + 刻度标签区域的“期望宽度”
    const preferred = 80;
    const minWaterfallWidth = 64;
    if (!Number.isFinite(totalWidth) || totalWidth <= 0) return preferred;
    if (totalWidth <= minWaterfallWidth) return 0;
    return Math.min(preferred, Math.max(0, Math.floor(totalWidth - minWaterfallWidth)));
}

function getTimeScaleWidth(totalWidth: number): number {
    const preferred = TIME_SCALE_WIDTH_PX;
    const minWaterfallWidth = 64;
    if (!Number.isFinite(totalWidth) || totalWidth <= 0) return preferred;
    if (totalWidth <= minWaterfallWidth) return 0;
    return Math.min(preferred, Math.max(0, Math.floor(totalWidth - minWaterfallWidth)));
}

function formatRelativeTimeLabel(deltaMs: number): string {
    const seconds = Math.max(0, Math.round(deltaMs / 1000));
    return seconds === 0 ? "0s" : `-${seconds}s`;
}

function drawColorBar(
    ctx: CanvasRenderingContext2D,
    legendWidth: number,
    height: number,
    threshold: number,
    colorScheme: ColorScheme,
    palette: WaterfallPalette,
): void {
    if (legendWidth <= 0 || height <= 0) return;

    const barWidth = Math.min(12, Math.max(6, Math.floor(legendWidth * 0.18)));
    const barPaddingRight = 8;
    const barX = Math.max(0, Math.floor(legendWidth - barWidth - barPaddingRight));
    const labelX = Math.max(0, barX - 6);

    // 颜色条背景
    ctx.fillStyle = palette.legendBg;
    ctx.fillRect(0, 0, legendWidth, height);

    // 逐行绘制渐变（使用与热力图相同的 colormap）
    for (let y = 0; y < height; y++) {
        const t = height <= 1 ? 0 : y / (height - 1);
        const amp = MAX_AMP_DBM - t * (MAX_AMP_DBM - MIN_AMP_DBM);
        const color = amplitudeToColor(amp, threshold, MIN_AMP_DBM, MAX_AMP_DBM, colorScheme);
        ctx.fillStyle = rgbaToCss(color);
        ctx.fillRect(barX, y, barWidth, 1);
    }

    // 边框
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, 0.5, barWidth, Math.max(0, height - 1));

    // 刻度与标签
    const ticks = [-100, -80, -60, -40, -20, 0];
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = palette.text;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;

    for (const tick of ticks) {
        const ratio =
            (MAX_AMP_DBM - tick) / Math.max(1, MAX_AMP_DBM - MIN_AMP_DBM);
        const y = ratio * (height - 1);

        // 刻度线（延伸到瀑布图边界前，避免挡住图像）
        ctx.beginPath();
        ctx.moveTo(Math.max(0, barX - 3) + 0.5, y + 0.5);
        ctx.lineTo(Math.min(legendWidth, barX + barWidth + 3) + 0.5, y + 0.5);
        ctx.stroke();

        ctx.fillText(`${tick}`, labelX, y);
    }

    // 单位提示
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("dBm", 6, 6);
}

export default function WaterfallCanvas({
    amplitudes,
    threshold,
    historyDepth,
    isPaused,
    colorScheme = "turbo",
}: WaterfallCanvasProps) {
    const theme = useAppStore((s) => s.theme);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const canvasSizeRef = useRef<CanvasSize | null>(null);
    const paletteRef = useRef<WaterfallPalette>({
        background: "rgba(8, 15, 30, 0.98)",
        axis: "rgba(180, 200, 230, 0.6)",
        text: "rgba(220, 235, 255, 0.95)",
        grid: "rgba(100, 150, 200, 0.2)",
        divider: "rgba(180, 200, 230, 0.25)",
        legendBg: "rgba(0, 0, 0, 0.25)",
        timeBg: "rgba(0, 0, 0, 0.18)",
        timeText: "rgba(0, 255, 120, 0.85)",
    });

    // 离屏缓冲区：存储瀑布图历史（滚动时只操作这张图）
    const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const bufferSizeRef = useRef<{ width: number; height: number } | null>(null);
    const rowImageDataRef = useRef<ImageData | null>(null);
    const rowTimestampRef = useRef<number[]>([]);

    const pendingRowRef = useRef<number[] | null>(null);
    const rafRef = useRef<number>(0);

    const ensureBuffer = useCallback((waterfallWidth: number, depth: number) => {
        const width = Math.max(1, Math.floor(waterfallWidth));
        const height = Math.max(1, Math.floor(depth));

        const prev = bufferSizeRef.current;
        if (prev && prev.width === width && prev.height === height) return;

        const bufferCanvas = document.createElement("canvas");
        bufferCanvas.width = width;
        bufferCanvas.height = height;

        const ctx = bufferCanvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
            bufferCanvasRef.current = null;
            bufferCtxRef.current = null;
            bufferSizeRef.current = { width, height };
            rowImageDataRef.current = null;
            rowTimestampRef.current = new Array(height).fill(0);
            return;
        }

        // 初始化为“底噪色”，避免空白突兀
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = rgbaToCss(
            amplitudeToColor(MIN_AMP_DBM, Number.POSITIVE_INFINITY, MIN_AMP_DBM, MAX_AMP_DBM),
        );
        ctx.fillRect(0, 0, width, height);

        bufferCanvasRef.current = bufferCanvas;
        bufferCtxRef.current = ctx;
        bufferSizeRef.current = { width, height };
        rowImageDataRef.current = null;
        rowTimestampRef.current = new Array(height).fill(0);
    }, []);

    const pushWaterfallRow = useCallback(
        (row: number[], waterfallWidth: number, depth: number) => {
            ensureBuffer(waterfallWidth, depth);

            const ctx = bufferCtxRef.current;
            const buffer = bufferCanvasRef.current;
            if (!ctx || !buffer) return;

            const width = buffer.width;
            const height = buffer.height;
            if (width <= 0 || height <= 0) return;

            // 1) 获取旧数据 (0, 0, width, height-1)
            // 2) 放置到 (0, 1) 位置（向下偏移1像素）
            if (height > 1) {
                const oldData = ctx.getImageData(0, 0, width, height - 1);
                ctx.putImageData(oldData, 0, 1);
            }

            // 3) 在顶部 (0, 0) 绘制新行
            let rowImageData = rowImageDataRef.current;
            if (!rowImageData || rowImageData.width !== width || rowImageData.height !== 1) {
                rowImageData = ctx.createImageData(width, 1);
                rowImageDataRef.current = rowImageData;
            }

            const data = rowImageData.data;
            const count = row.length;

            for (let x = 0; x < width; x++) {
                const idx =
                    count <= 1
                        ? 0
                        : Math.min(count - 1, Math.floor((x / width) * count));
                const amp = Number.isFinite(row[idx]) ? row[idx] : MIN_AMP_DBM;
                const color = amplitudeToColor(
                    amp,
                    threshold,
                    MIN_AMP_DBM,
                    MAX_AMP_DBM,
                    colorScheme,
                );

                const offset = x * 4;
                data[offset] = color.r;
                data[offset + 1] = color.g;
                data[offset + 2] = color.b;
                data[offset + 3] = color.a;
            }

            ctx.putImageData(rowImageData, 0, 0);

            const nextTimestamps = rowTimestampRef.current;
            if (nextTimestamps.length !== height) {
                rowTimestampRef.current = new Array(height).fill(0);
            }
            rowTimestampRef.current.unshift(Date.now());
            rowTimestampRef.current.length = height;
        },
        [ensureBuffer, threshold, colorScheme],
    );

    const scheduleDraw = useCallback(() => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;

            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

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

            if (!size || size.width <= 0 || size.height <= 0) return;

            const { width, height, dpr } = size;
            const nextCanvasWidth = Math.max(1, Math.floor(width * dpr));
            const nextCanvasHeight = Math.max(1, Math.floor(height * dpr));
            if (canvas.width !== nextCanvasWidth || canvas.height !== nextCanvasHeight) {
                canvas.width = nextCanvasWidth;
                canvas.height = nextCanvasHeight;
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;
            }

            // 使用 setTransform 替代 scale，避免累积变换与重复缩放风险
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;

            // 先清背景
            const palette = paletteRef.current;
            ctx.fillStyle = palette.background;
            ctx.fillRect(0, 0, width, height);

            const timeScaleWidth = getTimeScaleWidth(width);
            const legendWidth = getLegendWidth(width - timeScaleWidth);
            const waterfallWidth = Math.max(0, width - legendWidth - timeScaleWidth);
            const safeDepth = normalizePositiveInt(historyDepth, 1);

            // 写入新行（暂停时保持静态画面）
            if (!isPaused && pendingRowRef.current && waterfallWidth > 0) {
                pushWaterfallRow(pendingRowRef.current, waterfallWidth, safeDepth);
                pendingRowRef.current = null;
            }

            // 先画瀑布图（缓冲区），再覆盖左侧颜色条
            const buffer = bufferCanvasRef.current;
            if (buffer && waterfallWidth > 0) {
                ctx.drawImage(
                    buffer,
                    0,
                    0,
                    buffer.width,
                    buffer.height,
                    legendWidth,
                    0,
                    waterfallWidth,
                    height,
                );
            }

            // 分隔线（颜色条与瀑布图区）
            if (legendWidth > 0 && waterfallWidth > 0) {
                ctx.strokeStyle = palette.divider;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(legendWidth + 0.5, 0);
                ctx.lineTo(legendWidth + 0.5, height);
                ctx.stroke();
            }

            // 分隔线（瀑布图区与时间刻度区）
            const timeScaleX = legendWidth + waterfallWidth;
            if (timeScaleWidth > 0 && waterfallWidth > 0) {
                ctx.strokeStyle = palette.divider;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(timeScaleX + 0.5, 0);
                ctx.lineTo(timeScaleX + 0.5, height);
                ctx.stroke();
            }

            drawColorBar(ctx, legendWidth, height, threshold, colorScheme, palette);

            if (timeScaleWidth > 0) {
                ctx.fillStyle = palette.timeBg;
                ctx.fillRect(timeScaleX, 0, timeScaleWidth, height);

                const timestamps = rowTimestampRef.current;
                const latestTs = timestamps[0] ?? 0;
                const rowCount = Math.max(1, safeDepth);
                const targetLabelSpacingPx = 18;
                const minRowStep = 10;
                const rowStepBySpacing = Math.ceil(
                    (targetLabelSpacingPx * rowCount) / Math.max(1, height),
                );
                const rowStep = Math.max(minRowStep, rowStepBySpacing);

                ctx.font =
                    "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
                ctx.fillStyle = palette.timeText;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";

                ctx.strokeStyle = palette.grid;
                ctx.lineWidth = 1;

                for (let rowIndex = 0; rowIndex < rowCount; rowIndex += rowStep) {
                    const ts = timestamps[rowIndex];
                    if (!ts || !latestTs) continue;

                    const y =
                        rowCount <= 1
                            ? 0
                            : (rowIndex / Math.max(1, rowCount - 1)) * (height - 1);
                    const label = formatRelativeTimeLabel(latestTs - ts);

                    ctx.beginPath();
                    ctx.moveTo(timeScaleX + 0.5, y + 0.5);
                    ctx.lineTo(Math.min(width, timeScaleX + 6) + 0.5, y + 0.5);
                    ctx.stroke();

                    ctx.fillText(label, timeScaleX + 8, y);
                }
            }
        });
    }, [historyDepth, isPaused, pushWaterfallRow, threshold, colorScheme]);

    useEffect(() => {
        const container = containerRef.current;
        const computed = getComputedStyle(container ?? document.documentElement);
        const prev = paletteRef.current;

        paletteRef.current = {
            background: computed.getPropertyValue("--bg-secondary").trim() || prev.background,
            axis: computed.getPropertyValue("--text-secondary").trim() || prev.axis,
            text: computed.getPropertyValue("--text-primary").trim() || prev.text,
            grid: computed.getPropertyValue("--border-subtle").trim() || prev.grid,
            divider: computed.getPropertyValue("--border-color").trim() || prev.divider,
            legendBg: computed.getPropertyValue("--bg-primary").trim() || prev.legendBg,
            timeBg: computed.getPropertyValue("--bg-primary").trim() || prev.timeBg,
            timeText: computed.getPropertyValue("--color-attention").trim() || prev.timeText,
        };

        scheduleDraw();
    }, [theme, scheduleDraw]);

    // 新数据到来：使用 rAF 合并绘制，避免同一帧重复写入/重绘
    useEffect(() => {
        if (!amplitudes || amplitudes.length === 0) return;
        pendingRowRef.current = amplitudes;
        if (!isPaused) scheduleDraw();
    }, [amplitudes, isPaused, scheduleDraw]);

    // 阈值/深度变化：触发一次重绘（深度变化将重建缓冲区）
    useEffect(() => {
        bufferSizeRef.current = null;
        scheduleDraw();
    }, [historyDepth, scheduleDraw]);

    useEffect(() => {
        scheduleDraw();
    }, [threshold, scheduleDraw]);

    useEffect(() => {
        scheduleDraw();
    }, [colorScheme, scheduleDraw]);

    // ResizeObserver：更新 canvas backing store 并在暂停状态下也主动刷新画面
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const updateCanvasSize = () => {
            const rect = container.getBoundingClientRect();
            const width = Math.floor(rect.width);
            const height = Math.floor(rect.height);

            // 隐藏面板可能为 0 尺寸；此时不把画布缩放到 0，避免切回显示空白。
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
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            scheduleDraw();
        };

        updateCanvasSize();
        const observer = new ResizeObserver(() => updateCanvasSize());
        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [scheduleDraw]);

    // 卸载时清理 rAF
    useEffect(() => {
        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
            }
        };
    }, []);

    return (
        <div ref={containerRef} className={styles.container}>
            <canvas ref={canvasRef} className={styles.canvas} />
        </div>
    );
}
