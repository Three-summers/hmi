import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { readTextFile, readDir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import styles from "../shared.module.css";
import filesStyles from "./Files.module.css";

// Check if running in Tauri environment
const isTauri = () => {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

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

const DEFAULT_VISIBLE_CHARTS = 4;

export default function FilesView() {
    const { t } = useTranslation();
    const [fileTree, setFileTree] = useState<FileEntry[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string>("");
    const [csvData, setCsvData] = useState<CsvData | null>(null);
    const [visibleCharts, setVisibleCharts] = useState<number>(DEFAULT_VISIBLE_CHARTS);
    const [enabledColumns, setEnabledColumns] = useState<Set<number>>(new Set());
    const [treeLoading, setTreeLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [treeError, setTreeError] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [logBasePath, setLogBasePath] = useState<string>("");
    const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
        new Set(),
    );
    const [enlargedColumn, setEnlargedColumn] = useState<number | null>(null);
    const chartRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const uplotInstances = useRef<Map<number, uPlot>>(new Map());
    const enlargedChartRef = useRef<HTMLDivElement | null>(null);
    const enlargedUplotInstance = useRef<uPlot | null>(null);
    const enlargedFullXRange = useRef<{ min: number; max: number } | null>(null);

    // Get Log directory path
    useEffect(() => {
        const initPath = async () => {
            if (!isTauri()) {
                setTreeError("Not running in Tauri environment");
                return;
            }
            try {
                const logPath = await invoke<string>("get_log_dir");
                setLogBasePath(logPath);
            } catch (err) {
                console.error("Failed to get Log directory:", err);
                setTreeError(t("files.noLogFolder"));
            }
        };
        initPath();
    }, [t]);

    // Load file tree
    const loadFileTree = useCallback(async () => {
        if (!logBasePath || !isTauri()) return;

        try {
            setTreeLoading(true);
            setTreeError(null);

            const entries = await readDir(logBasePath);
            const tree: FileEntry[] = [];

            for (const entry of entries) {
                const fileEntry: FileEntry = {
                    name: entry.name,
                    path: `${logBasePath}/${entry.name}`,
                    isDirectory: entry.isDirectory,
                };

                if (entry.isDirectory) {
                    try {
                        const subEntries = await readDir(fileEntry.path);
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

            // Sort: directories first, then files
            tree.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });

            setFileTree(tree);
        } catch (err) {
            console.error("Failed to load file tree:", err);
            setTreeError(t("files.noLogFolder"));
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

    const formatHms = (seconds: number): string => {
        const date = new Date(seconds * 1000);
        const hh = String(date.getHours()).padStart(2, "0");
        const mm = String(date.getMinutes()).padStart(2, "0");
        const ss = String(date.getSeconds()).padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
    };

    const xAxisValues = (_u: uPlot, splits: number[]): string[] => {
        return splits.map((value) => (Number.isFinite(value) ? formatHms(value) : ""));
    };

    const getXRange = (xData: number[]): { min: number; max: number } | null => {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const value of xData) {
            if (!Number.isFinite(value)) continue;
            if (value < min) min = value;
            if (value > max) max = value;
        }
        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
        return { min, max };
    };

    // Parse CSV content
    const parseCsv = (content: string): CsvData | null => {
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
                /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
            );
            if (!match) return null;
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const hours = Number(match[4]);
            const minutes = Number(match[5]);
            const seconds = Number(match[6]);
            const millis = match[7] ? Number(match[7].padEnd(3, "0")) : 0;
            const date = new Date(year, month - 1, day, hours, minutes, seconds, millis);
            const time = date.getTime();
            if (!Number.isFinite(time)) return null;
            return time / 1000;
        };

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map((v) => {
                const trimmed = v.trim();
                // 仅当字段为“纯数字”时才按数值解析，避免把时间戳（如 2024-12-17 08:00:00）误解析成 2024
                if (isPlainNumber(trimmed)) return parseFloat(trimmed);
                // 优先按固定格式解析，避免不同 WebView 的 Date 解析差异
                const parsedFixed = parseDateTimeToSeconds(trimmed);
                if (parsedFixed !== null) return parsedFixed;
                // 兜底：尝试按日期时间解析
                const date = new Date(trimmed);
                if (!isNaN(date.getTime())) return date.getTime() / 1000;
                return NaN;
            });

            // Only include rows with valid data
            if (values.some((v) => !isNaN(v))) {
                rows.push(values);
            }
        }

        return { headers, rows };
    };

    // Load file content
    const handleFileSelect = async (file: FileEntry) => {
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
                    // Initialize enabled columns (default to first 4 data columns)
                    const dataColumns = parsed.headers.length - 1;
                    const initialEnabled = new Set<number>();
                    for (let i = 1; i <= Math.min(DEFAULT_VISIBLE_CHARTS, dataColumns); i++) {
                        initialEnabled.add(i);
                    }
                    setEnabledColumns(initialEnabled);
                    setVisibleCharts(Math.min(DEFAULT_VISIBLE_CHARTS, dataColumns));
                }
            }
        } catch (err) {
            console.error("Failed to read file:", err);
            setPreviewError(t("files.readError"));
        } finally {
            setPreviewLoading(false);
        }
    };

    // Cleanup uPlot instances
    useEffect(() => {
        return () => {
            uplotInstances.current.forEach((instance) => instance.destroy());
            uplotInstances.current.clear();
        };
    }, []);

    // Render charts
    useEffect(() => {
        if (!csvData) {
            // Cleanup existing charts
            uplotInstances.current.forEach((instance) => instance.destroy());
            uplotInstances.current.clear();
            return;
        }

        // Cleanup previous instances
        uplotInstances.current.forEach((instance) => instance.destroy());
        uplotInstances.current.clear();

        // Prepare X axis data (first column as time)
        const xData = csvData.rows.map((row) => row[0]);

        // Use requestAnimationFrame to ensure container is rendered
        requestAnimationFrame(() => {
            // Render chart for each enabled column
            enabledColumns.forEach((colIndex) => {
                const container = chartRefs.current.get(colIndex);
                if (!container || colIndex >= csvData.headers.length) return;

                const yData = csvData.rows.map((row) => row[colIndex]);
                const data: uPlot.AlignedData = [xData, yData];

                const chartHeight = 200;
                const chartWidth = container.clientWidth || 400;

                const opts: uPlot.Options = {
                    width: chartWidth,
                    height: chartHeight,
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
            });
        });
    }, [csvData, enabledColumns]);

    // Enlarged chart (click-to-zoom modal)
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
                            if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;
                            u.setScale("x", { min: Math.min(min, max), max: Math.max(min, max) });
                            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
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

    // Handle window resize
    useEffect(() => {
        const handleResize = () => {
            uplotInstances.current.forEach((instance, colIndex) => {
                const container = chartRefs.current.get(colIndex);
                if (container) {
                    instance.setSize({ width: container.clientWidth, height: 200 });
                }
            });
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const getSeriesColor = (index: number): string => {
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
    };

    const getSeriesFill = (index: number): string => {
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
    };

    const toggleColumn = (colIndex: number) => {
        setEnabledColumns((prev) => {
            const next = new Set(prev);
            if (next.has(colIndex)) {
                next.delete(colIndex);
            } else {
                next.add(colIndex);
            }
            return next;
        });
    };

    const showMoreCharts = () => {
        if (csvData) {
            const maxCharts = csvData.headers.length - 1;
            setVisibleCharts(maxCharts);
            // Enable all columns
            const allEnabled = new Set<number>();
            for (let i = 1; i <= maxCharts; i++) {
                allEnabled.add(i);
            }
            setEnabledColumns(allEnabled);
        }
    };

    const showLessCharts = () => {
        setVisibleCharts(DEFAULT_VISIBLE_CHARTS);
        if (csvData) {
            const initialEnabled = new Set<number>();
            for (let i = 1; i <= Math.min(DEFAULT_VISIBLE_CHARTS, csvData.headers.length - 1); i++) {
                initialEnabled.add(i);
            }
            setEnabledColumns(initialEnabled);
        }
    };

    const isCsvFile = selectedFile?.toLowerCase().endsWith(".csv");
    const hasMoreCharts = csvData && csvData.headers.length - 1 > DEFAULT_VISIBLE_CHARTS;

    const toggleDirectory = (path: string) => {
        setExpandedDirectories((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    // Render file tree item
    const renderFileItem = (file: FileEntry, level: number = 0) => {
        const isSelected = selectedFile === file.path;
        const isExpanded = file.isDirectory && expandedDirectories.has(file.path);
        const icon = file.isDirectory ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className={filesStyles.fileIcon}>
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
        ) : file.name.endsWith(".csv") ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className={filesStyles.fileIcon} data-type="csv">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
            </svg>
        ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className={filesStyles.fileIcon}>
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
        );

        return (
            <div key={file.path}>
                <div
                    className={filesStyles.fileItem}
                    style={{ paddingLeft: `${12 + level * 16}px` }}
                    data-selected={isSelected}
                    data-directory={file.isDirectory}
                    data-expanded={file.isDirectory ? isExpanded : undefined}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                        file.isDirectory
                            ? toggleDirectory(file.path)
                            : handleFileSelect(file)
                    }
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        if (file.isDirectory) toggleDirectory(file.path);
                        else handleFileSelect(file);
                    }}
                >
                    {file.isDirectory ? (
                        <span
                            className={filesStyles.expandIcon}
                            data-expanded={isExpanded}
                            aria-hidden="true"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                            </svg>
                        </span>
                    ) : (
                        <span className={filesStyles.expandSpacer} aria-hidden="true" />
                    )}
                    {icon}
                    <span className={filesStyles.fileName}>{file.name}</span>
                </div>
                {file.isDirectory &&
                    isExpanded &&
                    file.children?.map((child) =>
                        renderFileItem(child, level + 1),
                    )}
            </div>
        );
    };

    return (
        <div className={styles.view}>
            <div className={styles.header}>
                <h2 className={styles.title}>{t("nav.files")}</h2>
                <button className={filesStyles.refreshBtn} onClick={loadFileTree} disabled={treeLoading}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                    </svg>
                    {t("common.refresh")}
                </button>
            </div>

            <div className={filesStyles.container}>
                {/* File tree panel */}
                <div className={filesStyles.fileTree}>
                    <div className={filesStyles.treeHeader}>
                        <span>{t("files.logFolder")}</span>
                    </div>
                    <div className={filesStyles.treeContent}>
                        {treeLoading && !fileTree.length ? (
                            <div className={filesStyles.loading}>{t("files.loading")}</div>
                        ) : treeError && !fileTree.length ? (
                            <div className={filesStyles.error}>{treeError}</div>
                        ) : fileTree.length === 0 ? (
                            <div className={filesStyles.empty}>{t("files.empty")}</div>
                        ) : (
                            fileTree.map((file) => renderFileItem(file))
                        )}
                    </div>
                </div>

                {/* Preview panel */}
                <div className={filesStyles.preview}>
                    {!selectedFile ? (
                        <div className={filesStyles.placeholder}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                            </svg>
                            <span>{t("files.selectFile")}</span>
                        </div>
                    ) : previewLoading ? (
                        <div className={filesStyles.loading}>{t("files.loading")}</div>
                    ) : previewError ? (
                        <div className={filesStyles.error}>{previewError}</div>
                    ) : isCsvFile && csvData ? (
                        <div className={filesStyles.csvPreview}>
                            <div className={filesStyles.csvHeader}>
                                <span className={filesStyles.csvTitle}>
                                    {selectedFile.split("/").pop()}
                                </span>
                                <div className={filesStyles.columnToggle}>
                                    {csvData.headers.slice(1, visibleCharts + 1).map((header, idx) => (
                                        <button
                                            key={idx + 1}
                                            className={filesStyles.columnBtn}
                                            data-active={enabledColumns.has(idx + 1)}
                                            onClick={() => toggleColumn(idx + 1)}
                                            style={{ borderColor: getSeriesColor(idx + 1) }}
                                        >
                                            {header}
                                        </button>
                                    ))}
                                </div>
                                {hasMoreCharts && (
                                    <button
                                        className={filesStyles.moreBtn}
                                        onClick={visibleCharts > DEFAULT_VISIBLE_CHARTS ? showLessCharts : showMoreCharts}
                                    >
                                        {visibleCharts > DEFAULT_VISIBLE_CHARTS
                                            ? t("files.showLess")
                                            : t("files.showMore", { count: csvData.headers.length - 1 - DEFAULT_VISIBLE_CHARTS })}
                                    </button>
                                )}
                            </div>
                            <div className={filesStyles.chartsContainer}>
                                {Array.from(enabledColumns)
                                    .sort((a, b) => a - b)
                                    .map((colIndex) => (
                                        <div
                                            key={colIndex}
                                            className={filesStyles.chartWrapper}
                                            onClick={() => setEnlargedColumn(colIndex)}
                                            role="button"
                                            tabIndex={0}
                                        >
                                            <div className={filesStyles.chartLabel}>
                                                <span
                                                    className={filesStyles.colorDot}
                                                    style={{ background: getSeriesColor(colIndex) }}
                                                />
                                                {csvData.headers[colIndex]}
                                            </div>
                                            <div
                                                ref={(el) => {
                                                    if (el) chartRefs.current.set(colIndex, el);
                                                    else chartRefs.current.delete(colIndex);
                                                }}
                                                className={filesStyles.chart}
                                            />
                                        </div>
                                    ))}
                            </div>
                        </div>
                    ) : (
                        <div className={filesStyles.textPreview}>
                            <div className={filesStyles.textHeader}>
                                {selectedFile.split("/").pop()}
                            </div>
                            <pre className={filesStyles.textContent}>{fileContent}</pre>
                        </div>
                    )}
                </div>
            </div>

            {csvData && enlargedColumn !== null && (
                <div className={filesStyles.chartModal} onClick={closeEnlargedChart} role="dialog" aria-modal="true">
                    <div className={filesStyles.chartModalContent} onClick={(e) => e.stopPropagation()}>
                        <div className={filesStyles.chartModalHeader}>
                            <div className={filesStyles.chartModalTitle}>
                                {csvData.headers[enlargedColumn]}
                            </div>
                            <div className={filesStyles.chartModalActions}>
                                <button className={filesStyles.chartModalBtn} onClick={resetEnlargedZoom}>
                                    重置
                                </button>
                                <button className={filesStyles.chartModalBtn} onClick={closeEnlargedChart}>
                                    关闭
                                </button>
                            </div>
                        </div>
                        <div ref={enlargedChartRef} className={filesStyles.chartModalBody} />
                        <div className={filesStyles.chartModalHint}>
                            拖拽横向选择区域可缩放（小图模式已禁用拖拽）
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
