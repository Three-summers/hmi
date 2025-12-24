import { memo, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { StatusIndicator } from "@/components/common";
import type { FileNode, VisibleTreeItem } from "@/types";
import filesStyles from "./Files.module.css";

type VisibleItem = VisibleTreeItem;

interface FileTreeRowProps {
    item: VisibleItem;
    selectedPath: string | null;
    onToggleDirectory: (path: string) => void;
    onSelectFile: (file: FileNode) => void | Promise<void>;
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
            style={{ paddingLeft: `${0.75 + level * 1}rem` }}
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
    items: VisibleItem[];
    selectedPath: string | null;
    treeLoading: boolean;
    treeError: string | null;
    loadingText: string;
    emptyText: string;
    retryText: string;
    retryDisabled: boolean;
    onRetry: () => void;
    onToggleDirectory: (path: string) => void;
    onSelectFile: (file: FileNode) => void | Promise<void>;
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

export interface FileTreePanelProps {
    headerText: string;
    items: VisibleItem[];
    selectedPath: string | null;
    treeLoading: boolean;
    treeError: string | null;
    loadingText: string;
    emptyText: string;
    retryText: string;
    retryDisabled: boolean;
    onRetry: () => void;
    onToggleDirectory: (path: string) => void;
    onSelectFile: (file: FileNode) => void | Promise<void>;
}

/**
 * Files 左侧文件树面板（拆分自 Files/index.tsx）
 */
export function FileTreePanel({
    headerText,
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
}: FileTreePanelProps) {
    return (
        <div className={filesStyles.fileTree}>
            <div className={filesStyles.treeHeader}>
                <span>{headerText}</span>
            </div>
            <div className={filesStyles.treeContent}>
                <FileTreeContent
                    items={items}
                    selectedPath={selectedPath}
                    treeLoading={treeLoading}
                    treeError={treeError}
                    loadingText={loadingText}
                    emptyText={emptyText}
                    retryText={retryText}
                    retryDisabled={retryDisabled}
                    onRetry={onRetry}
                    onToggleDirectory={onToggleDirectory}
                    onSelectFile={onSelectFile}
                />
            </div>
        </div>
    );
}

