/**
 * Files：文件预览 Hook
 *
 * 负责：
 * - 维护“当前选中文件”的预览状态（loading/error/content）
 * - 对 CSV 文件进行解析，生成图表所需的结构化数据
 *
 * @module useFilePreview
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { isTimeoutError, withTimeout } from "@/utils/async";
import type { CsvData, FileNode, PreviewConfig } from "@/types";
import { useRetry } from "./useRetry";

type Translate = (key: string) => string;

type TauriReadTextFile = typeof import("@tauri-apps/plugin-fs").readTextFile;

type UseFilePreviewDeps = {
    readTextFile?: TauriReadTextFile;
    timeoutMs?: number;
};

const FILE_PREVIEW_TIMEOUT_MS = 8000;

const defaultReadTextFile: TauriReadTextFile = async (path, options) => {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path, options);
};

/**
 * 解析 CSV 内容：支持“时间列 + 多数值列”的通用数据日志格式
 *
 * 说明：
 * - 仅当字段为“纯数字”时才按 number 解析，避免误把时间戳解析成年份等
 * - 时间字段优先按固定格式解析，最后兜底 Date 解析（不同 WebView 行为可能不同）
 */
export function parseCsv(content: string): CsvData | null {
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

export type UseFilePreviewReturn = {
    preview: PreviewConfig;
    selectFile: (file: FileNode) => Promise<void>;
    retryPreview: () => Promise<void>;
};

/**
 * Files 预览 Hook
 *
 * 设计说明：
 * - 预览读取存在竞态：用户快速切换文件时，前一次读取可能后完成
 * - 使用 requestId 进行去抖：仅允许最后一次选择更新状态
 */
export function useFilePreview(
    t: Translate,
    deps: UseFilePreviewDeps = {},
): UseFilePreviewReturn {
    const readTextFile = deps.readTextFile ?? defaultReadTextFile;
    const timeoutMs = deps.timeoutMs ?? FILE_PREVIEW_TIMEOUT_MS;

    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
        null,
    );
    const [content, setContent] = useState<string>("");
    const [csvData, setCsvData] = useState<CsvData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const lastFileRef = useRef<FileNode | null>(null);

    const { run: runWithRetry } = useRetry({
        // 预览读取属于“无副作用读操作”：默认允许对任意异常做一次重试
        maxAttempts: 2,
        baseDelayMs: 200,
        maxDelayMs: 800,
        backoff: "fixed",
        jitterRatio: 0,
        shouldRetry: () => true,
    });

    const selectedFileName = useMemo(() => {
        if (!selectedFilePath) return null;
        const name = selectedFilePath.split("/").pop();
        return name ?? selectedFilePath;
    }, [selectedFilePath]);

    const isCsvFile = useMemo(() => {
        return selectedFilePath?.toLowerCase().endsWith(".csv") ?? false;
    }, [selectedFilePath]);

    const selectFile = useCallback(
        async (file: FileNode) => {
            if (file.isDirectory) return;

            const requestId = ++requestIdRef.current;
            lastFileRef.current = file;
            setSelectedFilePath(file.path);
            setContent("");
            setCsvData(null);
            setLoading(true);
            setError(null);

            try {
                const nextContent = await runWithRetry(() =>
                    withTimeout(readTextFile(file.path), timeoutMs),
                );
                // 仅允许最后一次选择生效，避免竞态导致预览错乱
                if (requestIdRef.current !== requestId) return;

                setContent(nextContent);

                if (file.name.toLowerCase().endsWith(".csv")) {
                    const parsed = parseCsv(nextContent);
                    setCsvData(parsed);
                }
            } catch (err) {
                console.error("Failed to read file:", err);
                if (requestIdRef.current !== requestId) return;
                setError(
                    isTimeoutError(err)
                        ? t("files.loadTimeout")
                        : t("files.readError"),
                );
            } finally {
                if (requestIdRef.current !== requestId) return;
                setLoading(false);
            }
        },
        [readTextFile, runWithRetry, t, timeoutMs],
    );

    const retryPreview = useCallback(async () => {
        const last = lastFileRef.current;
        if (!last) return;
        await selectFile(last);
    }, [selectFile]);

    return {
        preview: {
            selectedFilePath,
            selectedFileName,
            loading,
            error,
            content,
            csvData,
            isCsvFile,
        },
        selectFile,
        retryPreview,
    };
}
