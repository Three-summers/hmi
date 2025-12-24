/**
 * Files：图表数据与渲染 Hook
 *
 * 负责：
 * - CSV 列选择、可见图表数等状态管理
 * - 小图（列表）与放大图（弹窗）的 uPlot 实例生命周期管理
 * - 缩放/resize 等副作用控制（inactive 视图不创建/更新图表）
 *
 * @module useChartData
 */

import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { FILES_CONFIG } from "@/constants";
import { readCssVar, withAlpha } from "@/utils";
import { toErrorMessage } from "@/utils/error";
import type { CsvData } from "@/types";

const DEFAULT_CHART_COLORS = [
    "#00d4ff",
    "#ff6b6b",
    "#00ff88",
    "#ffaa00",
    "#aa66ff",
    "#ff66aa",
    "#66ffaa",
    "#ff8800",
];

export function formatHms(seconds: number): string {
    const date = new Date(seconds * 1000);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
}

/**
 * X 轴刻度格式化函数（支持缩放自适应）
 *
 * 在界面缩放较大时，自动减少刻度密度以避免标签重叠。
 * 通过闭包捕获 scaleFactor，根据缩放系数动态调整显示间隔。
 */
export function createXAxisValuesFormatter(scaleFactor: number) {
    return (_u: uPlot, splits: number[]): string[] => {
        // 根据缩放系数计算步长：缩放越大，步长越大（显示刻度越少）
        const step = Math.max(1, Math.ceil(scaleFactor));

        return splits.map((value, index) => {
            // 跳过非步长倍数的刻度（用空字符串隐藏标签）
            if (index % step !== 0) return "";
            return Number.isFinite(value) ? formatHms(value) : "";
        });
    };
}

export function getXRange(
    xData: number[],
): { min: number; max: number } | null {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of xData) {
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max)
        return null;
    return { min, max };
}

export function getSeriesColor(
    index: number,
    colors: string[] = DEFAULT_CHART_COLORS,
): string {
    return colors[(index - 1) % colors.length];
}

export function getSeriesFill(color: string): string {
    return withAlpha(color, 0.1, "rgba(0, 212, 255, 0.1)");
}

export type ChartSelection = {
    visibleCharts: number;
    enabledColumns: Set<number>;
};

/**
 * 计算 CSV 的默认显示列（启用前 N 个数据列）
 *
 * @param csvData - CSV 数据
 * @param defaultVisible - 默认可见图表数
 */
export function computeDefaultSelection(
    csvData: CsvData,
    defaultVisible: number = FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
): ChartSelection {
    const dataColumns = csvData.headers.length - 1;
    const initialVisible = Math.min(defaultVisible, Math.max(0, dataColumns));
    const enabled = new Set<number>();
    for (let i = 1; i <= initialVisible; i++) {
        enabled.add(i);
    }
    return { visibleCharts: initialVisible, enabledColumns: enabled };
}

/** 启用全部数据列（show more） */
export function computeAllSelection(csvData: CsvData): ChartSelection {
    const maxCharts = Math.max(0, csvData.headers.length - 1);
    const enabled = new Set<number>();
    for (let i = 1; i <= maxCharts; i++) {
        enabled.add(i);
    }
    return { visibleCharts: maxCharts, enabledColumns: enabled };
}

/** 切换列启用状态（纯函数，便于测试） */
export function toggleColumnInSet(
    prev: ReadonlySet<number>,
    colIndex: number,
): Set<number> {
    const next = new Set(prev);
    if (next.has(colIndex)) next.delete(colIndex);
    else next.add(colIndex);
    return next;
}

/** 排序启用列（纯函数，便于测试） */
export function sortEnabledColumns(enabledColumns: ReadonlySet<number>): number[] {
    return Array.from(enabledColumns).sort((a, b) => a - b);
}

export function computeHasMoreCharts(
    csvData: CsvData | null,
    defaultVisible: number = FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
): boolean {
    return !!csvData && csvData.headers.length - 1 > defaultVisible;
}

/**
 * 读取图表配色（从 variables.css 注入到 :root 的 CSS 变量）
 *
 * 说明：该函数不触碰 window/document，便于在 Node 环境做单元测试。
 */
export function readChartColorsFromCssVars(
    style: Pick<CSSStyleDeclaration, "getPropertyValue">,
    defaults: string[] = DEFAULT_CHART_COLORS,
): string[] {
    const colors: string[] = [];
    for (let i = 1; i <= 8; i++) {
        colors.push(readCssVar(style as CSSStyleDeclaration, `--chart-color-${i}`, defaults[i - 1]));
    }
    return colors;
}

type PlotDataCache = {
    csvData: CsvData;
    xData: number[];
    yByCol: Map<number, number[]>;
};

type MutableRef<T> = { current: T };

export type SmallChartsFrameArgs = {
    csvData: CsvData;
    enabledColumns: ReadonlySet<number>;
    chartRefs: Map<number, Pick<HTMLDivElement, "clientWidth">>;
    uplotInstances: Map<number, Pick<uPlot, "destroy" | "setSize" | "setData"> & { series: any[] }>;
    plotDataCacheRef: MutableRef<PlotDataCache | null>;
    lastCsvDataRef: MutableRef<CsvData | null>;
    safeScaleFactor: number;
    chartColors: string[];
    createPlot: (opts: uPlot.Options, data: uPlot.AlignedData, container: any) => any;
};

/**
 * 小图帧渲染逻辑（从 useEffect + rAF 中抽出，便于单元测试覆盖）
 */
export function renderSmallChartsFrame({
    csvData,
    enabledColumns,
    chartRefs,
    uplotInstances,
    plotDataCacheRef,
    lastCsvDataRef,
    safeScaleFactor,
    chartColors,
    createPlot,
}: SmallChartsFrameArgs) {
    const px = (value: number) => Math.round(value * safeScaleFactor);

    const existingCache = plotDataCacheRef.current;

    // 先销毁已禁用列的实例，避免实例长期堆积
    for (const [colIndex, instance] of Array.from(uplotInstances.entries())) {
        if (!enabledColumns.has(colIndex)) {
            instance.destroy();
            uplotInstances.delete(colIndex);
            if (existingCache && existingCache.csvData === csvData) {
                existingCache.yByCol.delete(colIndex);
            }
        }
    }

    // 构建/复用数据缓存：xData 只需要计算一次；yData 按列懒加载
    let cache = plotDataCacheRef.current;
    if (!cache || cache.csvData !== csvData) {
        cache = {
            csvData,
            xData: csvData.rows.map((row) => row[0]),
            yByCol: new Map<number, number[]>(),
        };
        plotDataCacheRef.current = cache;
    }

    // 数据不足：保持空态，不创建图表
    if (cache.xData.length < 2) {
        uplotInstances.forEach((instance) => instance.destroy());
        uplotInstances.clear();
        plotDataCacheRef.current = null;
        lastCsvDataRef.current = csvData;
        return;
    }

    const csvChanged = lastCsvDataRef.current !== csvData;

    for (const colIndex of enabledColumns) {
        if (colIndex >= csvData.headers.length) continue;

        const container = chartRefs.get(colIndex);
        if (!container) continue;

        const width = container.clientWidth;
        if (width <= 0) continue;

        const height = px(200);

        let yData = cache.yByCol.get(colIndex);
        if (!yData) {
            yData = csvData.rows.map((row) => row[colIndex]);
            cache.yByCol.set(colIndex, yData);
        }

        const data: uPlot.AlignedData = [cache.xData, yData];

        const existing = uplotInstances.get(colIndex);
        if (!existing) {
            const axisFontSize = px(11);
            const xAxisSize = px(30);
            const yAxisSize = px(50);

            const color = getSeriesColor(colIndex, chartColors);
            const opts: uPlot.Options = {
                width,
                height,
                scales: {
                    x: { time: true },
                    y: { auto: true },
                },
                series: [
                    {},
                    {
                        label: csvData.headers[colIndex],
                        stroke: color,
                        width: 2 * safeScaleFactor,
                        fill: getSeriesFill(color),
                    },
                ],
                axes: [
                    {
                        stroke: "rgba(180, 200, 230, 0.9)",
                        grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                        ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                        size: xAxisSize,
                        font: `${axisFontSize}px Arial, sans-serif`,
                        values: createXAxisValuesFormatter(safeScaleFactor),
                    },
                    {
                        stroke: "rgba(180, 200, 230, 0.9)",
                        grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                        ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                        size: yAxisSize,
                        font: `${axisFontSize}px Arial, sans-serif`,
                    },
                ],
                cursor: {
                    drag: { x: false, y: false },
                },
            };

            const chart = createPlot(opts, data, container);
            uplotInstances.set(colIndex, chart);
        } else {
            existing.setSize({ width, height });
            if (csvChanged) {
                existing.setData(data);
                if (existing.series?.[1]) {
                    existing.series[1].label = csvData.headers[colIndex];
                }
            }
        }
    }

    lastCsvDataRef.current = csvData;
}

export type EnlargedChartFrameArgs = {
    csvData: CsvData;
    enlargedColumn: number;
    container: Pick<HTMLDivElement, "clientWidth" | "clientHeight">;
    scaleFactor: number;
    chartColors: string[];
    createPlot: (opts: uPlot.Options, data: uPlot.AlignedData, container: any) => any;
};

export type EnlargedChartFrameResult = {
    chart: any;
    fullXRange: { min: number; max: number } | null;
};

/**
 * 放大图渲染逻辑（从 useEffect + rAF 中抽出，便于单元测试覆盖）
 */
export function renderEnlargedChartFrame({
    csvData,
    enlargedColumn,
    container,
    scaleFactor,
    chartColors,
    createPlot,
}: EnlargedChartFrameArgs): EnlargedChartFrameResult {
    const xData = csvData.rows.map((row) => row[0]);
    const yData = csvData.rows.map((row) => row[enlargedColumn]);
    const alignedData: uPlot.AlignedData = [xData, yData];
    const fullXRange = getXRange(xData);

    const safeScaleFactor =
        Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
    const px = (value: number) => Math.round(value * safeScaleFactor);
    const width = container.clientWidth || px(800);
    const height = container.clientHeight || px(520);

    const axisFontSize = px(12);
    const xAxisSize = px(40);
    const yAxisSize = px(60);

    const color = getSeriesColor(enlargedColumn, chartColors);
    const opts: uPlot.Options = {
        width,
        height,
        scales: {
            x: { time: true },
            y: { auto: true },
        },
        series: [
            {},
            {
                label: csvData.headers[enlargedColumn],
                stroke: color,
                width: 2 * safeScaleFactor,
                fill: getSeriesFill(color),
            },
        ],
        axes: [
            {
                stroke: "rgba(180, 200, 230, 0.9)",
                grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                size: xAxisSize,
                font: `${axisFontSize}px Arial, sans-serif`,
                values: createXAxisValuesFormatter(safeScaleFactor),
            },
            {
                stroke: "rgba(180, 200, 230, 0.9)",
                grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                size: yAxisSize,
                font: `${axisFontSize}px Arial, sans-serif`,
            },
        ],
        cursor: {
            drag: { x: true, y: false },
        },
        select: {
            show: true,
            left: 0,
            top: 0,
            width: 0,
            height: 0,
        },
        hooks: {
            setSelect: [
                (u) => {
                    const { left, width: selectWidth } = u.select;
                    if (selectWidth < 10) return;
                    const min = u.posToVal(left, "x");
                    const max = u.posToVal(left + selectWidth, "x");
                    if (
                        !Number.isFinite(min) ||
                        !Number.isFinite(max) ||
                        min === max
                    )
                        return;
                    u.setScale("x", {
                        min: Math.min(min, max),
                        max: Math.max(min, max),
                    });
                    u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
                },
            ],
        },
    };

    const chart = createPlot(opts, alignedData, container);
    return { chart, fullXRange };
}

export type ResizeChartsArgs = {
    isChartsVisible: boolean;
    scaleFactor: number;
    chartRefs: Map<number, Pick<HTMLDivElement, "clientWidth">>;
    uplotInstances: Map<number, Pick<uPlot, "setSize">>;
    enlargedChart?: Pick<uPlot, "setSize"> | null;
    enlargedContainer?: Pick<HTMLDivElement, "clientWidth" | "clientHeight"> | null;
};

/** resize 逻辑抽出为纯函数，便于单元测试覆盖 */
export function resizeChartsFrame({
    isChartsVisible,
    scaleFactor,
    chartRefs,
    uplotInstances,
    enlargedChart,
    enlargedContainer,
}: ResizeChartsArgs) {
    if (!isChartsVisible) return;

    const safeScaleFactor =
        Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
    const height = Math.round(200 * safeScaleFactor);

    uplotInstances.forEach((instance, colIndex) => {
        const container = chartRefs.get(colIndex);
        const width = container?.clientWidth ?? 0;
        if (width <= 0) return;
        instance.setSize({ width, height });
    });

    if (enlargedChart && enlargedContainer) {
        const width = enlargedContainer.clientWidth;
        const height = enlargedContainer.clientHeight;
        if (width > 0 && height > 0) {
            enlargedChart.setSize({ width, height });
        }
    }
}

export type UseChartDataOptions = {
    csvData: CsvData | null;
    theme: string;
    scaleFactor: number;
    isChartsVisible: boolean;
};

export type UseChartDataReturn = {
    visibleCharts: number;
    enabledColumns: Set<number>;
    hasMoreCharts: boolean;
    sortedEnabledColumns: number[];
    chartColors: string[];
    chartError: Error | null;
    retryCharts: () => void;
    enlargedColumn: number | null;
    enlargedChartRef: RefObject<HTMLDivElement>;
    enlargedChartError: Error | null;
    retryEnlargedChart: () => void;
    setChartRef: (colIndex: number, el: HTMLDivElement | null) => void;
    setEnlargedColumn: (colIndex: number | null) => void;
    toggleColumn: (colIndex: number) => void;
    showMoreCharts: () => void;
    showLessCharts: () => void;
    closeEnlargedChart: () => void;
    resetEnlargedZoom: () => void;
};

function normalizeToError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(toErrorMessage(error));
}

export function useChartData({
    csvData,
    theme,
    scaleFactor,
    isChartsVisible,
}: UseChartDataOptions): UseChartDataReturn {
    const [visibleCharts, setVisibleCharts] = useState<number>(
        FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
    );
    const [enabledColumns, setEnabledColumns] = useState<Set<number>>(
        new Set(),
    );
    const [enlargedColumn, setEnlargedColumn] = useState<number | null>(null);
    const [chartColors, setChartColors] = useState<string[]>(
        DEFAULT_CHART_COLORS,
    );
    const [chartError, setChartError] = useState<Error | null>(null);
    const [chartRetryToken, setChartRetryToken] = useState(0);
    const [enlargedChartError, setEnlargedChartError] = useState<Error | null>(
        null,
    );
    const [enlargedRetryToken, setEnlargedRetryToken] = useState(0);

    const chartRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const uplotInstances = useRef<Map<number, uPlot>>(new Map());
    const uplotScaleFactorRef = useRef(scaleFactor);
    const styleKeyRef = useRef<string>("");
    const plotDataCacheRef = useRef<PlotDataCache | null>(null);
    const lastCsvDataRef = useRef<CsvData | null>(null);
    const enlargedChartRef = useRef<HTMLDivElement | null>(null);
    const enlargedUplotInstance = useRef<uPlot | null>(null);
    const enlargedFullXRange = useRef<{ min: number; max: number } | null>(
        null,
    );

    useEffect(() => {
        const computed = getComputedStyle(document.documentElement);
        setChartColors(readChartColorsFromCssVars(computed));
    }, [theme]);

    const destroySmallCharts = useCallback(() => {
        uplotInstances.current.forEach((instance) => instance.destroy());
        uplotInstances.current.clear();
        plotDataCacheRef.current = null;
        lastCsvDataRef.current = null;
    }, []);

    const destroyEnlargedChart = useCallback(() => {
        if (enlargedUplotInstance.current) {
            enlargedUplotInstance.current.destroy();
            enlargedUplotInstance.current = null;
        }
        enlargedFullXRange.current = null;
    }, []);

    // CSV 切换：重置图表状态
    useEffect(() => {
        if (!csvData) {
            setVisibleCharts(FILES_CONFIG.DEFAULT_VISIBLE_CHARTS);
            setEnabledColumns(new Set());
            setEnlargedColumn(null);
            setChartError(null);
            setEnlargedChartError(null);
            destroySmallCharts();
            destroyEnlargedChart();
            return;
        }

        const selection = computeDefaultSelection(csvData);
        setVisibleCharts(selection.visibleCharts);
        setEnabledColumns(selection.enabledColumns);
        setEnlargedColumn(null);
        setChartError(null);
        setEnlargedChartError(null);
    }, [csvData, destroyEnlargedChart, destroySmallCharts]);

    // 组件卸载时清理 uPlot 实例，释放事件监听与 Canvas 资源
    useEffect(() => {
        return () => {
            destroySmallCharts();
            destroyEnlargedChart();
        };
    }, [destroyEnlargedChart, destroySmallCharts]);

    // 渲染小图：每个启用列一个 uPlot 实例（默认禁用拖拽交互，避免与滚动冲突）
    useEffect(() => {
        if (!csvData) return;
        if (!isChartsVisible) return;
        if (chartError) return;

        // 数据不足时不创建图表，避免 uPlot 初始化失败（空数组/单点数据）
        if (csvData.rows.length < 2) {
            destroySmallCharts();
            return;
        }

        const safeScaleFactor =
            Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
        const px = (value: number) => Math.round(value * safeScaleFactor);

        const nextStyleKey = `${safeScaleFactor}:${chartColors.join("|")}`;
        if (
            uplotScaleFactorRef.current !== safeScaleFactor ||
            styleKeyRef.current !== nextStyleKey
        ) {
            uplotScaleFactorRef.current = safeScaleFactor;
            styleKeyRef.current = nextStyleKey;
            destroySmallCharts();
        }

        const raf = requestAnimationFrame(() => {
            try {
                const existingCache = plotDataCacheRef.current;

                // 先销毁已禁用列的实例，避免实例长期堆积
                for (const [colIndex, instance] of Array.from(
                    uplotInstances.current.entries(),
                )) {
                    if (!enabledColumns.has(colIndex)) {
                        instance.destroy();
                        uplotInstances.current.delete(colIndex);
                        if (existingCache && existingCache.csvData === csvData) {
                            existingCache.yByCol.delete(colIndex);
                        }
                    }
                }

                // 构建/复用数据缓存：xData 只需要计算一次；yData 按列懒加载
                let cache = plotDataCacheRef.current;
                if (!cache || cache.csvData !== csvData) {
                    cache = {
                        csvData,
                        xData: csvData.rows.map((row) => row[0]),
                        yByCol: new Map<number, number[]>(),
                    };
                    plotDataCacheRef.current = cache;
                }

                // 数据不足：保持空态，不创建图表
                if (cache.xData.length < 2) {
                    destroySmallCharts();
                    lastCsvDataRef.current = csvData;
                    return;
                }

                const csvChanged = lastCsvDataRef.current !== csvData;

                for (const colIndex of enabledColumns) {
                    if (colIndex >= csvData.headers.length) continue;

                    const container = chartRefs.current.get(colIndex);
                    if (!container) continue;

                    const width = container.clientWidth;
                    if (width <= 0) continue;

                    const height = px(200);

                    let yData = cache.yByCol.get(colIndex);
                    if (!yData) {
                        yData = csvData.rows.map((row) => row[colIndex]);
                        cache.yByCol.set(colIndex, yData);
                    }

                    const data: uPlot.AlignedData = [cache.xData, yData];

                    const existing = uplotInstances.current.get(colIndex);
                    if (!existing) {
                        const axisFontSize = px(11);
                        const xAxisSize = px(30);
                        const yAxisSize = px(50);

                        const color = getSeriesColor(colIndex, chartColors);
                        const opts: uPlot.Options = {
                            width,
                            height,
                            scales: {
                                x: { time: true },
                                y: { auto: true },
                            },
                            series: [
                                {},
                                {
                                    label: csvData.headers[colIndex],
                                    stroke: color,
                                    width: 2 * safeScaleFactor,
                                    fill: getSeriesFill(color),
                                },
                            ],
                            axes: [
                                {
                                    stroke: "rgba(180, 200, 230, 0.9)",
                                    grid: {
                                        stroke: "rgba(100, 150, 200, 0.2)",
                                    },
                                    ticks: {
                                        stroke: "rgba(100, 150, 200, 0.3)",
                                    },
                                    size: xAxisSize,
                                    font: `${axisFontSize}px Arial, sans-serif`,
                                    values: createXAxisValuesFormatter(
                                        safeScaleFactor,
                                    ),
                                },
                                {
                                    stroke: "rgba(180, 200, 230, 0.9)",
                                    grid: {
                                        stroke: "rgba(100, 150, 200, 0.2)",
                                    },
                                    ticks: {
                                        stroke: "rgba(100, 150, 200, 0.3)",
                                    },
                                    size: yAxisSize,
                                    font: `${axisFontSize}px Arial, sans-serif`,
                                },
                            ],
                            cursor: {
                                // 小图模式禁用拖拽交互（避免误操作 & 与滚动冲突）
                                drag: { x: false, y: false },
                            },
                        };

                        const chart = new uPlot(opts, data, container);
                        uplotInstances.current.set(colIndex, chart);
                    } else {
                        existing.setSize({ width, height });
                        if (csvChanged) {
                            existing.setData(data);
                            existing.series[1].label =
                                csvData.headers[colIndex];
                        }
                    }
                }

                lastCsvDataRef.current = csvData;
            } catch (error) {
                console.error("[Files] uPlot 小图初始化失败：", error);
                setChartError(normalizeToError(error));
                destroySmallCharts();
            }
        });

        return () => cancelAnimationFrame(raf);
    }, [
        chartColors,
        chartError,
        chartRetryToken,
        csvData,
        destroySmallCharts,
        enabledColumns,
        isChartsVisible,
        scaleFactor,
    ]);

    // 放大图表：点击小图打开弹窗，并支持“拖拽选择区域缩放”
    useEffect(() => {
        if (!csvData || enlargedColumn === null) {
            destroyEnlargedChart();
            return;
        }
        if (enlargedChartError) return;

        const container = enlargedChartRef.current;
        if (!container || enlargedColumn >= csvData.headers.length) {
            destroyEnlargedChart();
            return;
        }

        destroyEnlargedChart();

        // 数据不足：不创建放大图，避免初始化失败
        if (csvData.rows.length < 2) return;

        const xData = csvData.rows.map((row) => row[0]);
        const yData = csvData.rows.map((row) => row[enlargedColumn]);
        const alignedData: uPlot.AlignedData = [xData, yData];
        enlargedFullXRange.current = getXRange(xData);

        const raf = requestAnimationFrame(() => {
            try {
                const safeScaleFactor =
                    Number.isFinite(scaleFactor) && scaleFactor > 0
                        ? scaleFactor
                        : 1;
                const px = (value: number) =>
                    Math.round(value * safeScaleFactor);
                const width = container.clientWidth || px(800);
                const height = container.clientHeight || px(520);

                const axisFontSize = px(12);
                const xAxisSize = px(40);
                const yAxisSize = px(60);

                const color = getSeriesColor(enlargedColumn, chartColors);
                const opts: uPlot.Options = {
                    width,
                    height,
                    scales: {
                        x: { time: true },
                        y: { auto: true },
                    },
                    series: [
                        {},
                        {
                            label: csvData.headers[enlargedColumn],
                            stroke: color,
                            width: 2 * safeScaleFactor,
                            fill: getSeriesFill(color),
                        },
                    ],
                    axes: [
                        {
                            stroke: "rgba(180, 200, 230, 0.9)",
                            grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                            ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                            size: xAxisSize,
                            font: `${axisFontSize}px Arial, sans-serif`,
                            values: createXAxisValuesFormatter(safeScaleFactor),
                        },
                        {
                            stroke: "rgba(180, 200, 230, 0.9)",
                            grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                            ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                            size: yAxisSize,
                            font: `${axisFontSize}px Arial, sans-serif`,
                        },
                    ],
                    cursor: {
                        drag: { x: true, y: false },
                    },
                    select: {
                        show: true,
                        left: 0,
                        top: 0,
                        width: 0,
                        height: 0,
                    },
                    hooks: {
                        setSelect: [
                            (u) => {
                                const { left, width: selectWidth } = u.select;
                                if (selectWidth < 10) return;
                                const min = u.posToVal(left, "x");
                                const max = u.posToVal(left + selectWidth, "x");
                                if (
                                    !Number.isFinite(min) ||
                                    !Number.isFinite(max) ||
                                    min === max
                                )
                                    return;
                                u.setScale("x", {
                                    min: Math.min(min, max),
                                    max: Math.max(min, max),
                                });
                                u.setSelect(
                                    { left: 0, top: 0, width: 0, height: 0 },
                                    false,
                                );
                            },
                        ],
                    },
                };

                const chart = new uPlot(opts, alignedData, container);
                enlargedUplotInstance.current = chart;
            } catch (error) {
                console.error("[Files] uPlot 放大图初始化失败：", error);
                setEnlargedChartError(normalizeToError(error));
                destroyEnlargedChart();
            }
        });

        return () => {
            cancelAnimationFrame(raf);
            destroyEnlargedChart();
        };
    }, [
        chartColors,
        csvData,
        destroyEnlargedChart,
        enlargedChartError,
        enlargedColumn,
        enlargedRetryToken,
        scaleFactor,
    ]);

    const resizeCharts = useCallback(() => {
        if (!isChartsVisible) return;

        const safeScaleFactor =
            Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
        const height = Math.round(200 * safeScaleFactor);

        uplotInstances.current.forEach((instance, colIndex) => {
            const container = chartRefs.current.get(colIndex);
            const width = container?.clientWidth ?? 0;
            if (width <= 0) return;
            instance.setSize({ width, height });
        });

        const enlarged = enlargedUplotInstance.current;
        const enlargedContainer = enlargedChartRef.current;
        if (enlarged && enlargedContainer) {
            const width = enlargedContainer.clientWidth;
            const height = enlargedContainer.clientHeight;
            if (width > 0 && height > 0) {
                enlarged.setSize({ width, height });
            }
        }
    }, [isChartsVisible, scaleFactor]);

    useEffect(() => {
        const handleResize = () => {
            resizeCharts();
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [resizeCharts]);

    useEffect(() => {
        if (!isChartsVisible) return;
        const raf = requestAnimationFrame(resizeCharts);
        return () => cancelAnimationFrame(raf);
    }, [isChartsVisible, resizeCharts]);

    const toggleColumn = useCallback((colIndex: number) => {
        setEnabledColumns((prev) => {
            const next = new Set(prev);
            if (next.has(colIndex)) {
                next.delete(colIndex);
            } else {
                next.add(colIndex);
            }
            return next;
        });
    }, []);

    const showMoreCharts = useCallback(() => {
        if (!csvData) return;
        const maxCharts = csvData.headers.length - 1;
        setVisibleCharts(maxCharts);
        const allEnabled = new Set<number>();
        for (let i = 1; i <= maxCharts; i++) {
            allEnabled.add(i);
        }
        setEnabledColumns(allEnabled);
    }, [csvData]);

    const showLessCharts = useCallback(() => {
        setVisibleCharts(FILES_CONFIG.DEFAULT_VISIBLE_CHARTS);
        if (!csvData) return;
        const initialEnabled = new Set<number>();
        for (
            let i = 1;
            i <=
            Math.min(
                FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
                csvData.headers.length - 1,
            );
            i++
        ) {
            initialEnabled.add(i);
        }
        setEnabledColumns(initialEnabled);
    }, [csvData]);

    const hasMoreCharts = useMemo(() => {
        return (
            !!csvData &&
            csvData.headers.length - 1 > FILES_CONFIG.DEFAULT_VISIBLE_CHARTS
        );
    }, [csvData]);

    const sortedEnabledColumns = useMemo(() => {
        return Array.from(enabledColumns).sort((a, b) => a - b);
    }, [enabledColumns]);

    const setChartRef = useCallback(
        (colIndex: number, el: HTMLDivElement | null) => {
            if (el) chartRefs.current.set(colIndex, el);
            else chartRefs.current.delete(colIndex);
        },
        [],
    );

    const closeEnlargedChart = useCallback(() => {
        setEnlargedColumn(null);
        setEnlargedChartError(null);
    }, []);

    const retryCharts = useCallback(() => {
        setChartError(null);
        destroySmallCharts();
        setChartRetryToken((prev) => prev + 1);
    }, [destroySmallCharts]);

    const retryEnlargedChart = useCallback(() => {
        setEnlargedChartError(null);
        destroyEnlargedChart();
        setEnlargedRetryToken((prev) => prev + 1);
    }, [destroyEnlargedChart]);

    const resetEnlargedZoom = useCallback(() => {
        const chart = enlargedUplotInstance.current;
        const range = enlargedFullXRange.current;
        if (!chart || !range) return;
        chart.setScale("x", { min: range.min, max: range.max });
    }, []);

    return {
        visibleCharts,
        enabledColumns,
        hasMoreCharts,
        sortedEnabledColumns,
        chartColors,
        chartError,
        retryCharts,
        enlargedColumn,
        enlargedChartRef,
        enlargedChartError,
        retryEnlargedChart,
        setChartRef,
        setEnlargedColumn,
        toggleColumn,
        showMoreCharts,
        showLessCharts,
        closeEnlargedChart,
        resetEnlargedZoom,
    };
}
