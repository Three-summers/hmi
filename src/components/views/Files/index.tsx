/**
 * 文件视图 - 文件管理与数据查看
 *
 * 提供文件浏览、数据文件查看、图表绘制等功能。
 * 核心特性：
 * - 文件浏览器：目录树导航和文件列表
 * - 数据文件查看：支持 CSV/TXT 等格式
 * - 图表绘制：基于 uPlot 绘制数据文件中的时间序列图
 * - 文件搜索：支持文件名过滤和搜索
 * - Tauri 集成：使用 Tauri FS API 读取本地文件
 *
 * @module Files
 */

import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { readTextFile, readDir } from "@tauri-apps/plugin-fs";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Tabs, StatusIndicator } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useRegisterViewCommands } from "@/components/layout/ViewCommandContext";
import { isTauri } from "@/platform/tauri";
import { invoke } from "@/platform/invoke";
import { FILES_CONFIG } from "@/constants";
import { useNotify } from "@/hooks";
import styles from "../shared.module.css";
import filesStyles from "./Files.module.css";

interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: FileEntry[];
}

interface CsvData {
    headers: string[];
    rows: number[][];
}

const FILE_TREE_TIMEOUT_MS = 8000;

function createTimeoutError(timeoutMs: number): Error {
    const error = new Error(`Operation timed out after ${timeoutMs}ms`);
    error.name = "TimeoutError";
    return error;
}

function isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.name === "TimeoutError";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            reject(createTimeoutError(timeoutMs));
        }, timeoutMs);

        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function formatHms(seconds: number): string {
    const date = new Date(seconds * 1000);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
}

function xAxisValues(_u: uPlot, splits: number[]): string[] {
    return splits.map((value) =>
        Number.isFinite(value) ? formatHms(value) : "",
    );
}

function getXRange(xData: number[]): { min: number; max: number } | null {
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

// 解析 CSV 内容：支持“时间列 + 多数值列”的通用数据日志格式
function parseCsv(content: string): CsvData | null {
    const lines = content.trim().split(/\r?\n/);
    if (lines.length < 2) return null;

    const headers = lines[0].split(",").map((h) => h.trim());
    const rows: number[][] = [];

    const isPlainNumber = (value: string): boolean => {
        return /^[-+]?(\d+(\.\d+)?|\.\d+)(e[-+]?\d+)?$/i.test(value);
    };

    const parseDateTimeToSeconds = (value: string): number | null => {
        // 支持：YYYY-MM-DD HH:mm:ss(.SSS) / YYYY-MM-DDTHH:mm:ss(.SSS) / YYYY/MM/DD HH:mm:ss(.SSS)
        const match = value.match(
            /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
        );
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hours = Number(match[4]);
        const minutes = Number(match[5]);
        const seconds = Number(match[6]);
        const millis = match[7] ? Number(match[7].padEnd(3, "0")) : 0;
        const date = new Date(
            year,
            month - 1,
            day,
            hours,
            minutes,
            seconds,
            millis,
        );
        const time = date.getTime();
        if (!Number.isFinite(time)) return null;
        return time / 1000;
    };

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map((v) => {
            const trimmed = v.trim();
            // 仅当字段为“纯数字”时才按数值解析，避免把时间戳（如 2024-12-17 08:00:00）误解析成 2024
            if (isPlainNumber(trimmed)) return Number.parseFloat(trimmed);
            // 优先按固定格式解析，避免不同 WebView 的 Date 解析差异
            const parsedFixed = parseDateTimeToSeconds(trimmed);
            if (parsedFixed !== null) return parsedFixed;
            // 兜底：尝试按日期时间解析
            const date = new Date(trimmed);
            if (!Number.isNaN(date.getTime())) return date.getTime() / 1000;
            return Number.NaN;
        });

        // 仅保留包含有效数值的行，避免空行/无效行污染曲线
        if (values.some((v) => !Number.isNaN(v))) {
            rows.push(values);
        }
    }

    return { headers, rows };
}

function getSeriesColor(index: number): string {
    const colors = [
        "#00d4ff",
        "#ff6b6b",
        "#00ff88",
        "#ffaa00",
        "#aa66ff",
        "#ff66aa",
        "#66ffaa",
        "#ff8800",
    ];
    return colors[(index - 1) % colors.length];
}

function getSeriesFill(index: number): string {
    const colors: Record<string, string> = {
        "#00d4ff": "rgba(0, 212, 255, 0.1)",
        "#ff6b6b": "rgba(255, 107, 107, 0.1)",
        "#00ff88": "rgba(0, 255, 136, 0.1)",
        "#ffaa00": "rgba(255, 170, 0, 0.1)",
        "#aa66ff": "rgba(170, 102, 255, 0.1)",
        "#ff66aa": "rgba(255, 102, 170, 0.1)",
        "#66ffaa": "rgba(102, 255, 170, 0.1)",
        "#ff8800": "rgba(255, 136, 0, 0.1)",
    };
    return colors[getSeriesColor(index)] || "rgba(0, 212, 255, 0.1)";
}

type VisibleTreeItem = {
    entry: FileEntry;
    level: number;
    isExpanded: boolean;
};

interface FileTreeRowProps {
    item: VisibleTreeItem;
    selectedPath: string | null;
    onToggleDirectory: (path: string) => void;
    onSelectFile: (file: FileEntry) => void;
}

const FileTreeRow = memo(function FileTreeRow({
    item,
    selectedPath,
    onToggleDirectory,
    onSelectFile,
}: FileTreeRowProps) {
    const { entry, level, isExpanded } = item;
    const isSelected = selectedPath === entry.path;

    const handleActivate = useCallback(() => {
        if (entry.isDirectory) {
            onToggleDirectory(entry.path);
        } else {
            void onSelectFile(entry);
        }
    }, [entry, onSelectFile, onToggleDirectory]);

    const handleKeyDown = useCallback(
        (e: ReactKeyboardEvent<HTMLDivElement>) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            handleActivate();
        },
        [handleActivate],
    );

    const icon = entry.isDirectory ? (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={filesStyles.fileIcon}
        >
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
    ) : entry.name.endsWith(".csv") ? (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={filesStyles.fileIcon}
            data-type="csv"
        >
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
        </svg>
    ) : (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={filesStyles.fileIcon}
        >
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
    );

    return (
        <div
            className={filesStyles.fileItem}
            style={{ paddingLeft: `${12 + level * 16}px` }}
            data-selected={isSelected}
            data-directory={entry.isDirectory}
            data-expanded={entry.isDirectory ? isExpanded : undefined}
            role="button"
            tabIndex={0}
            onClick={handleActivate}
            onKeyDown={handleKeyDown}
        >
            {entry.isDirectory ? (
                <span
                    className={filesStyles.expandIcon}
                    data-expanded={isExpanded}
                    aria-hidden="true"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                    </svg>
                </span>
            ) : (
                <span className={filesStyles.expandSpacer} aria-hidden="true" />
            )}
            {icon}
            <span className={filesStyles.fileName}>{entry.name}</span>
        </div>
    );
});

interface FileTreeContentProps {
    items: VisibleTreeItem[];
    selectedPath: string | null;
    treeLoading: boolean;
    treeError: string | null;
    loadingText: string;
    emptyText: string;
    retryText: string;
    retryDisabled: boolean;
    onRetry: () => void;
    onToggleDirectory: (path: string) => void;
    onSelectFile: (file: FileEntry) => void;
}

const FileTreeContent = memo(function FileTreeContent({
    items,
    selectedPath,
    treeLoading,
    treeError,
    loadingText,
    emptyText,
    retryText,
    retryDisabled,
    onRetry,
    onToggleDirectory,
    onSelectFile,
}: FileTreeContentProps) {
    if (treeLoading && items.length === 0) {
        return (
            <div className={filesStyles.loading}>
                <StatusIndicator status="processing" label={loadingText} />
            </div>
        );
    }
    if (treeError && items.length === 0) {
        return (
            <div className={filesStyles.error}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <StatusIndicator status="alarm" label={treeError} />
                    <button
                        className={filesStyles.refreshBtn}
                        onClick={onRetry}
                        disabled={retryDisabled}
                    >
                        {retryText}
                    </button>
                </div>
            </div>
        );
    }
    if (items.length === 0) {
        return (
            <div className={filesStyles.empty}>
                <StatusIndicator status="idle" label={emptyText} />
            </div>
        );
    }

    return (
        <>
            {items.map((item) => (
                <FileTreeRow
                    key={item.entry.path}
                    item={item}
                    selectedPath={selectedPath}
                    onToggleDirectory={onToggleDirectory}
                    onSelectFile={onSelectFile}
                />
            ))}
        </>
    );
});

export default function FilesView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { info } = useNotify();

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(
                        t("notification.helpRefreshed"),
                        t("notification.fileListRefreshed"),
                    ),
            },
        ],
        [info, t],
    );

    useRegisterViewCommands("files", commands, isViewActive);

    const [fileTree, setFileTree] = useState<FileEntry[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string>("");
    const [csvData, setCsvData] = useState<CsvData | null>(null);
    const [visibleCharts, setVisibleCharts] = useState<number>(
        FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
    );
    const [enabledColumns, setEnabledColumns] = useState<Set<number>>(
        new Set(),
    );
    const [treeLoading, setTreeLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [treeError, setTreeError] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [logBasePath, setLogBasePath] = useState<string>("");
    const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
        new Set(),
    );
    const [activeTab, setActiveTab] = useState<"overview" | "info">("overview");
    const [enlargedColumn, setEnlargedColumn] = useState<number | null>(null);
    const chartRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const uplotInstances = useRef<Map<number, uPlot>>(new Map());
    const plotDataCacheRef = useRef<{
        csvData: CsvData;
        xData: number[];
        yByCol: Map<number, number[]>;
    } | null>(null);
    const lastCsvDataRef = useRef<CsvData | null>(null);
    const enlargedChartRef = useRef<HTMLDivElement | null>(null);
    const enlargedUplotInstance = useRef<uPlot | null>(null);
    const enlargedFullXRange = useRef<{ min: number; max: number } | null>(
        null,
    );

    // 获取日志目录路径（由后端提供，避免前端硬编码）
    const loadLogBasePath = useCallback(async () => {
        if (!isTauri()) {
            setTreeError(t("files.unavailableInBrowser"));
            setLogBasePath("");
            setFileTree([]);
            return;
        }

        try {
            setTreeLoading(true);
            setTreeError(null);
            const logPath = await withTimeout(
                invoke<string>("get_log_dir"),
                FILE_TREE_TIMEOUT_MS,
            );
            setLogBasePath(logPath);
        } catch (err) {
            console.error("Failed to get Log directory:", err);
            setLogBasePath("");
            setFileTree([]);
            setTreeError(
                isTimeoutError(err)
                    ? t("files.loadTimeout")
                    : t("files.noLogFolder"),
            );
        } finally {
            setTreeLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadLogBasePath();
    }, [loadLogBasePath]);

    // 加载文件树（目录默认收起，点击展开/收起）
    const loadFileTree = useCallback(async () => {
        if (!logBasePath || !isTauri()) return;

        try {
            setTreeLoading(true);
            setTreeError(null);

            const entries = await withTimeout(
                readDir(logBasePath),
                FILE_TREE_TIMEOUT_MS,
            );
            const tree: FileEntry[] = [];

            for (const entry of entries) {
                const fileEntry: FileEntry = {
                    name: entry.name,
                    path: `${logBasePath}/${entry.name}`,
                    isDirectory: entry.isDirectory,
                };

                if (entry.isDirectory) {
                    try {
                        const subEntries = await withTimeout(
                            readDir(fileEntry.path),
                            FILE_TREE_TIMEOUT_MS,
                        );
                        fileEntry.children = subEntries.map((sub) => ({
                            name: sub.name,
                            path: `${fileEntry.path}/${sub.name}`,
                            isDirectory: sub.isDirectory,
                        }));
                    } catch {
                        fileEntry.children = [];
                    }
                }

                tree.push(fileEntry);
            }

            // 排序：目录优先，其次文件
            tree.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });

            setFileTree(tree);
        } catch (err) {
            console.error("Failed to load file tree:", err);
            setTreeError(
                isTimeoutError(err)
                    ? t("files.loadTimeout")
                    : t("files.noLogFolder"),
            );
            setFileTree([]);
        } finally {
            setTreeLoading(false);
        }
    }, [logBasePath, t]);

    useEffect(() => {
        if (logBasePath) {
            loadFileTree();
        }
    }, [logBasePath, loadFileTree]);

    // 加载选中文件内容；CSV 将自动解析并渲染多图表预览
    const handleFileSelect = useCallback(
        async (file: FileEntry) => {
            if (file.isDirectory) return;

            setSelectedFile(file.path);
            setFileContent("");
            setCsvData(null);
            setPreviewLoading(true);
            setPreviewError(null);

            try {
                const content = await readTextFile(file.path);
                setFileContent(content);

                if (file.name.toLowerCase().endsWith(".csv")) {
                    const parsed = parseCsv(content);
                    if (parsed) {
                        setCsvData(parsed);
                        // 初始化显示列：默认启用前 N 个数据列（由常量配置）
                        const dataColumns = parsed.headers.length - 1;
                        const initialEnabled = new Set<number>();
                        for (
                            let i = 1;
                            i <=
                            Math.min(
                                FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
                                dataColumns,
                            );
                            i++
                        ) {
                            initialEnabled.add(i);
                        }
                        setEnabledColumns(initialEnabled);
                        setVisibleCharts(
                            Math.min(
                                FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
                                dataColumns,
                            ),
                        );
                    }
                }
            } catch (err) {
                console.error("Failed to read file:", err);
                setPreviewError(t("files.readError"));
            } finally {
                setPreviewLoading(false);
            }
        },
        [t],
    );

    // 组件卸载时清理 uPlot 实例，释放事件监听与 Canvas 资源
    useEffect(() => {
        return () => {
            uplotInstances.current.forEach((instance) => instance.destroy());
            uplotInstances.current.clear();
            plotDataCacheRef.current = null;
            lastCsvDataRef.current = null;
        };
    }, []);

    // 渲染小图：每个启用列一个 uPlot 实例（默认禁用拖拽交互，避免与滚动冲突）
    useEffect(() => {
        if (!csvData) {
            // CSV 被清空时销毁图表
            uplotInstances.current.forEach((instance) => instance.destroy());
            uplotInstances.current.clear();
            plotDataCacheRef.current = null;
            lastCsvDataRef.current = null;
            return;
        }

        // 视图缓存 + keepMounted 场景下，后台视图不做图表创建/更新，避免无意义开销
        if (!isViewActive || activeTab !== "overview") return;

        const raf = requestAnimationFrame(() => {
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

            const csvChanged = lastCsvDataRef.current !== csvData;

            for (const colIndex of enabledColumns) {
                if (colIndex >= csvData.headers.length) continue;

                const container = chartRefs.current.get(colIndex);
                if (!container) continue;

                const width = container.clientWidth;
                if (width <= 0) continue;

                const height = 200;

                let yData = cache.yByCol.get(colIndex);
                if (!yData) {
                    yData = csvData.rows.map((row) => row[colIndex]);
                    cache.yByCol.set(colIndex, yData);
                }

                const data: uPlot.AlignedData = [cache.xData, yData];

                const existing = uplotInstances.current.get(colIndex);
                if (!existing) {
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
                                stroke: getSeriesColor(colIndex),
                                width: 2,
                                fill: getSeriesFill(colIndex),
                            },
                        ],
                        axes: [
                            {
                                stroke: "rgba(180, 200, 230, 0.9)",
                                grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                                ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                                size: 30,
                                values: xAxisValues,
                            },
                            {
                                stroke: "rgba(180, 200, 230, 0.9)",
                                grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                                ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                                size: 50,
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
                        existing.series[1].label = csvData.headers[colIndex];
                    }
                }
            }

            lastCsvDataRef.current = csvData;
        });

        return () => cancelAnimationFrame(raf);
    }, [activeTab, csvData, enabledColumns, isViewActive]);

    // 放大图表：点击小图打开弹窗，并支持“拖拽选择区域缩放”
    useEffect(() => {
        const cleanup = () => {
            if (enlargedUplotInstance.current) {
                enlargedUplotInstance.current.destroy();
                enlargedUplotInstance.current = null;
            }
            enlargedFullXRange.current = null;
        };

        if (!csvData || !enlargedColumn) {
            cleanup();
            return;
        }

        const container = enlargedChartRef.current;
        if (!container || enlargedColumn >= csvData.headers.length) {
            cleanup();
            return;
        }

        cleanup();

        const xData = csvData.rows.map((row) => row[0]);
        const yData = csvData.rows.map((row) => row[enlargedColumn]);
        const alignedData: uPlot.AlignedData = [xData, yData];
        enlargedFullXRange.current = getXRange(xData);

        requestAnimationFrame(() => {
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 520;

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
                        stroke: getSeriesColor(enlargedColumn),
                        width: 2,
                        fill: getSeriesFill(enlargedColumn),
                    },
                ],
                axes: [
                    {
                        stroke: "rgba(180, 200, 230, 0.9)",
                        grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                        ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                        size: 40,
                        values: xAxisValues,
                    },
                    {
                        stroke: "rgba(180, 200, 230, 0.9)",
                        grid: { stroke: "rgba(100, 150, 200, 0.2)" },
                        ticks: { stroke: "rgba(100, 150, 200, 0.3)" },
                        size: 60,
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
        });

        return cleanup;
    }, [csvData, enlargedColumn]);

    const closeEnlargedChart = () => {
        setEnlargedColumn(null);
    };

    const resetEnlargedZoom = () => {
        const chart = enlargedUplotInstance.current;
        const range = enlargedFullXRange.current;
        if (!chart || !range) return;
        chart.setScale("x", { min: range.min, max: range.max });
    };

    const resizeCharts = useCallback(() => {
        // 视图缓存 + 标签页模式下，隐藏面板的容器宽度可能为 0；此时不能把图表缩放到 0，否则切回会显示为空白。
        if (!isViewActive) return;

        if (activeTab === "overview") {
            uplotInstances.current.forEach((instance, colIndex) => {
                const container = chartRefs.current.get(colIndex);
                const width = container?.clientWidth ?? 0;
                if (width <= 0) return;
                instance.setSize({ width, height: 200 });
            });
        }

        const enlarged = enlargedUplotInstance.current;
        const enlargedContainer = enlargedChartRef.current;
        if (enlarged && enlargedContainer) {
            const width = enlargedContainer.clientWidth;
            const height = enlargedContainer.clientHeight;
            if (width > 0 && height > 0) {
                enlarged.setSize({ width, height });
            }
        }
    }, [activeTab, isViewActive]);

    useEffect(() => {
        const handleResize = () => {
            resizeCharts();
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [resizeCharts]);

    useEffect(() => {
        if (!isViewActive) return;
        const raf = requestAnimationFrame(resizeCharts);
        return () => cancelAnimationFrame(raf);
    }, [activeTab, isViewActive, resizeCharts]);

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

    const showMoreCharts = () => {
        if (csvData) {
            const maxCharts = csvData.headers.length - 1;
            setVisibleCharts(maxCharts);
            // 启用全部列
            const allEnabled = new Set<number>();
            for (let i = 1; i <= maxCharts; i++) {
                allEnabled.add(i);
            }
            setEnabledColumns(allEnabled);
        }
    };

    const showLessCharts = () => {
        setVisibleCharts(FILES_CONFIG.DEFAULT_VISIBLE_CHARTS);
        if (csvData) {
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
        }
    };

    const isCsvFile = selectedFile?.toLowerCase().endsWith(".csv");
    const hasMoreCharts =
        csvData &&
        csvData.headers.length - 1 > FILES_CONFIG.DEFAULT_VISIBLE_CHARTS;
    const sortedEnabledColumns = useMemo(
        () => Array.from(enabledColumns).sort((a, b) => a - b),
        [enabledColumns],
    );

    const toggleDirectory = useCallback((path: string) => {
        setExpandedDirectories((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    const visibleTreeItems = useMemo<VisibleTreeItem[]>(() => {
        const items: VisibleTreeItem[] = [];

        const walk = (entry: FileEntry, level: number) => {
            const isExpanded =
                entry.isDirectory && expandedDirectories.has(entry.path);
            items.push({ entry, level, isExpanded });

            if (entry.isDirectory && isExpanded && entry.children?.length) {
                for (const child of entry.children) {
                    walk(child, level + 1);
                }
            }
        };

        for (const entry of fileTree) {
            walk(entry, 0);
        }

        return items;
    }, [expandedDirectories, fileTree]);

    const handleRetryTree = useCallback(() => {
        if (!logBasePath) {
            void loadLogBasePath();
            return;
        }
        void loadFileTree();
    }, [loadFileTree, loadLogBasePath, logBasePath]);

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
                                <div className={filesStyles.container}>
                                    <div className={filesStyles.fileTree}>
                                        <div className={filesStyles.treeHeader}>
                                            <span>{t("files.logFolder")}</span>
                                        </div>
                                        <div
                                            className={filesStyles.treeContent}
                                        >
                                            <FileTreeContent
                                                items={visibleTreeItems}
                                                selectedPath={selectedFile}
                                                treeLoading={treeLoading}
                                                treeError={treeError}
                                                loadingText={t("files.loading")}
                                                emptyText={t("files.empty")}
                                                retryText={t("common.retry")}
                                                retryDisabled={treeLoading}
                                                onRetry={handleRetryTree}
                                                onToggleDirectory={
                                                    toggleDirectory
                                                }
                                                onSelectFile={handleFileSelect}
                                            />
                                        </div>
                                    </div>

                                    <div className={filesStyles.preview}>
                                        {!selectedFile ? (
                                            <div
                                                className={
                                                    filesStyles.placeholder
                                                }
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                                                </svg>
                                                <StatusIndicator
                                                    status="idle"
                                                    label={t(
                                                        "files.selectFile",
                                                    )}
                                                />
                                            </div>
                                        ) : previewLoading ? (
                                            <div
                                                className={filesStyles.loading}
                                            >
                                                <StatusIndicator
                                                    status="processing"
                                                    label={t("files.loading")}
                                                />
                                            </div>
                                        ) : previewError ? (
                                            <div className={filesStyles.error}>
                                                <StatusIndicator
                                                    status="alarm"
                                                    label={previewError}
                                                />
                                            </div>
                                        ) : isCsvFile && csvData ? (
                                            <div
                                                className={
                                                    filesStyles.csvPreview
                                                }
                                            >
                                                <div
                                                    className={
                                                        filesStyles.csvHeader
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            filesStyles.csvTitle
                                                        }
                                                    >
                                                        {selectedFile
                                                            .split("/")
                                                            .pop()}
                                                    </span>
                                                    <div
                                                        className={
                                                            filesStyles.columnToggle
                                                        }
                                                    >
                                                        {csvData.headers
                                                            .slice(
                                                                1,
                                                                visibleCharts +
                                                                    1,
                                                            )
                                                            .map(
                                                                (
                                                                    header,
                                                                    idx,
                                                                ) => (
                                                                    <button
                                                                        key={
                                                                            idx +
                                                                            1
                                                                        }
                                                                        className={
                                                                            filesStyles.columnBtn
                                                                        }
                                                                        data-active={enabledColumns.has(
                                                                            idx +
                                                                                1,
                                                                        )}
                                                                        onClick={() =>
                                                                            toggleColumn(
                                                                                idx +
                                                                                    1,
                                                                            )
                                                                        }
                                                                        style={{
                                                                            borderColor:
                                                                                getSeriesColor(
                                                                                    idx +
                                                                                        1,
                                                                                ),
                                                                        }}
                                                                    >
                                                                        {header}
                                                                    </button>
                                                                ),
                                                            )}
                                                    </div>
                                                    {hasMoreCharts && (
                                                        <button
                                                            className={
                                                                filesStyles.moreBtn
                                                            }
                                                            onClick={
                                                                visibleCharts >
                                                                FILES_CONFIG.DEFAULT_VISIBLE_CHARTS
                                                                    ? showLessCharts
                                                                    : showMoreCharts
                                                            }
                                                        >
                                                            {visibleCharts >
                                                            FILES_CONFIG.DEFAULT_VISIBLE_CHARTS
                                                                ? t(
                                                                      "files.showLess",
                                                                  )
                                                                : t(
                                                                      "files.showMore",
                                                                      {
                                                                          count:
                                                                              csvData
                                                                                  .headers
                                                                                  .length -
                                                                              1 -
                                                                              FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
                                                                      },
                                                                  )}
                                                        </button>
                                                    )}
                                                </div>
                                                <div
                                                    className={
                                                        filesStyles.chartsContainer
                                                    }
                                                >
                                                    {sortedEnabledColumns.map(
                                                        (colIndex) => (
                                                            <div
                                                                key={colIndex}
                                                                className={
                                                                    filesStyles.chartWrapper
                                                                }
                                                                onClick={() =>
                                                                    setEnlargedColumn(
                                                                        colIndex,
                                                                    )
                                                                }
                                                                role="button"
                                                                tabIndex={0}
                                                            >
                                                                <div
                                                                    className={
                                                                        filesStyles.chartLabel
                                                                    }
                                                                >
                                                                    <span
                                                                        className={
                                                                            filesStyles.colorDot
                                                                        }
                                                                        style={{
                                                                            background:
                                                                                getSeriesColor(
                                                                                    colIndex,
                                                                                ),
                                                                        }}
                                                                    />
                                                                    {
                                                                        csvData
                                                                            .headers[
                                                                            colIndex
                                                                        ]
                                                                    }
                                                                </div>
                                                                <div
                                                                    ref={(
                                                                        el,
                                                                    ) => {
                                                                        if (el)
                                                                            chartRefs.current.set(
                                                                                colIndex,
                                                                                el,
                                                                            );
                                                                        else
                                                                            chartRefs.current.delete(
                                                                                colIndex,
                                                                            );
                                                                    }}
                                                                    className={
                                                                        filesStyles.chart
                                                                    }
                                                                />
                                                            </div>
                                                        ),
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div
                                                className={
                                                    filesStyles.textPreview
                                                }
                                            >
                                                <div
                                                    className={
                                                        filesStyles.textHeader
                                                    }
                                                >
                                                    {selectedFile
                                                        .split("/")
                                                        .pop()}
                                                </div>
                                                <pre
                                                    className={
                                                        filesStyles.textContent
                                                    }
                                                >
                                                    {fileContent}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {csvData && enlargedColumn !== null && (
                                    <div
                                        className={filesStyles.chartModal}
                                        onClick={closeEnlargedChart}
                                        role="dialog"
                                        aria-modal="true"
                                    >
                                        <div
                                            className={
                                                filesStyles.chartModalContent
                                            }
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div
                                                className={
                                                    filesStyles.chartModalHeader
                                                }
                                            >
                                                <div
                                                    className={
                                                        filesStyles.chartModalTitle
                                                    }
                                                >
                                                    {
                                                        csvData.headers[
                                                            enlargedColumn
                                                        ]
                                                    }
                                                </div>
                                                <div
                                                    className={
                                                        filesStyles.chartModalActions
                                                    }
                                                >
                                                    <button
                                                        className={
                                                            filesStyles.chartModalBtn
                                                        }
                                                        onClick={
                                                            resetEnlargedZoom
                                                        }
                                                    >
                                                        {t("common.reset")}
                                                    </button>
                                                    <button
                                                        className={
                                                            filesStyles.chartModalBtn
                                                        }
                                                        onClick={
                                                            closeEnlargedChart
                                                        }
                                                    >
                                                        {t("common.close")}
                                                    </button>
                                                </div>
                                            </div>
                                            <div
                                                ref={enlargedChartRef}
                                                className={
                                                    filesStyles.chartModalBody
                                                }
                                            />
                                            <div
                                                className={
                                                    filesStyles.chartModalHint
                                                }
                                            >
                                                {t("files.chart.zoomHint")}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        ),
                    },
                    {
                        id: "info",
                        label: t("common.tabs.info"),
                        content: (
                            <div className={filesStyles.filesInfo}>
                                <h3 className={filesStyles.filesInfoTitle}>
                                    {t("files.title")}
                                </h3>
                                <ul className={filesStyles.filesInfoList}>
                                    <li>{t("files.selectFile")}</li>
                                    <li>{t("files.info.zoomTip")}</li>
                                    <li>{t("files.info.refreshTip")}</li>
                                </ul>
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
