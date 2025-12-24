/**
 * Files：文件树数据 Hook
 *
 * 负责：
 * - 获取日志目录路径（Tauri invoke：get_log_dir）
 * - 读取目录结构（Tauri FS：readDir）
 * - 管理目录展开/收起，并生成渲染用的扁平列表
 *
 * @module useFileTree
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { readDir as tauriReadDir } from "@tauri-apps/plugin-fs";
import { invoke as defaultInvoke } from "@/platform/invoke";
import { isTauri as defaultIsTauri } from "@/platform/tauri";
import { isTimeoutError, withTimeout } from "@/utils/async";
import type { FileNode, VisibleTreeItem } from "@/types";
import { useRetry } from "./useRetry";

const FILE_TREE_TIMEOUT_MS = 8000;

type Translate = (key: string) => string;

type UseFileTreeDeps = {
    isTauri?: () => boolean;
    invoke?: typeof defaultInvoke;
    readDir?: typeof tauriReadDir;
    timeoutMs?: number;
};

export type UseFileTreeReturn = {
    fileTree: FileNode[];
    visibleItems: VisibleTreeItem[];
    treeLoading: boolean;
    treeError: string | null;
    logBasePath: string;
    toggleDirectory: (path: string) => void;
    retryTree: () => void;
};

/**
 * Files 文件树 Hook
 *
 * 设计说明：
 * - Hook 内部持有 IO 与状态；UI 组件只负责展示与触发回调
 * - 通过 deps 注入便于单元测试（避免真实 Tauri API）
 */
export function useFileTree(
    t: Translate,
    deps: UseFileTreeDeps = {},
): UseFileTreeReturn {
    const isTauri = deps.isTauri ?? defaultIsTauri;
    const invoke = deps.invoke ?? defaultInvoke;
    const readDir = deps.readDir ?? tauriReadDir;
    const timeoutMs = deps.timeoutMs ?? FILE_TREE_TIMEOUT_MS;

    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [treeLoading, setTreeLoading] = useState(false);
    const [treeError, setTreeError] = useState<string | null>(null);
    const [logBasePath, setLogBasePath] = useState<string>("");
    const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
        new Set(),
    );

    const { run: runIoRetry } = useRetry({
        // 文件树 IO：默认对 TimeoutError 做有限重试，避免 UI 被“偶发超时”卡死在错误态
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 1500,
        backoff: "exponential",
        jitterRatio: 0.1,
    });

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
            const logPath = await runIoRetry(() =>
                withTimeout(invoke<string>("get_log_dir"), timeoutMs),
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
    }, [invoke, isTauri, runIoRetry, t, timeoutMs]);

    useEffect(() => {
        void loadLogBasePath();
    }, [loadLogBasePath]);

    // 加载文件树（目录默认收起，点击展开/收起）
    const loadFileTree = useCallback(async () => {
        if (!logBasePath || !isTauri()) return;

        try {
            setTreeLoading(true);
            setTreeError(null);

            const entries = (await runIoRetry(() =>
                withTimeout(readDir(logBasePath), timeoutMs),
            )) as Array<{ name: string; isDirectory: boolean }>;

            const tree: FileNode[] = [];

            for (const entry of entries) {
                const fileEntry: FileNode = {
                    name: entry.name,
                    path: `${logBasePath}/${entry.name}`,
                    isDirectory: entry.isDirectory,
                };

                if (entry.isDirectory) {
                    try {
                        const subEntries = (await runIoRetry(() =>
                            withTimeout(readDir(fileEntry.path), timeoutMs),
                        )) as Array<{ name: string; isDirectory: boolean }>;
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
    }, [isTauri, logBasePath, readDir, runIoRetry, t, timeoutMs]);

    useEffect(() => {
        if (logBasePath) {
            void loadFileTree();
        }
    }, [logBasePath, loadFileTree]);

    const toggleDirectory = useCallback((path: string) => {
        setExpandedDirectories((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    const visibleItems = useMemo<VisibleTreeItem[]>(() => {
        const items: VisibleTreeItem[] = [];

        const walk = (entry: FileNode, level: number) => {
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

    const retryTree = useCallback(() => {
        if (!logBasePath) {
            void loadLogBasePath();
            return;
        }
        void loadFileTree();
    }, [loadFileTree, loadLogBasePath, logBasePath]);

    return {
        fileTree,
        visibleItems,
        treeLoading,
        treeError,
        logBasePath,
        toggleDirectory,
        retryTree,
    };
}
