/**
 * Files 视图类型定义
 *
 * 目标：
 * - 统一 Files 相关 hooks / 子组件的数据契约（避免跨文件重复定义）
 * - 将“文件树 / 预览 / 图表”三块能力的核心类型集中管理
 *
 * @module types/files
 */

/** 文件树节点（目录或文件） */
export type FileNode = {
    /** 显示名称（不含路径） */
    name: string;
    /** 绝对路径（由后端提供的日志目录拼接而来） */
    path: string;
    /** 是否为目录 */
    isDirectory: boolean;
    /** 子节点（仅目录可能存在） */
    children?: FileNode[];
};

/** CSV 解析结果（时间列 + 多数值列） */
export type CsvData = {
    headers: string[];
    rows: number[][];
};

/** 文件树扁平化后的可见行（用于渲染缩进层级） */
export type VisibleTreeItem = {
    entry: FileNode;
    level: number;
    isExpanded: boolean;
};

/**
 * 预览面板数据契约
 *
 * 说明：
 * - `csvData` 仅当选中文件为 CSV 且解析成功时存在
 * - `selectedFileName` 由 `selectedFilePath` 派生（用于 Header 展示）
 */
export type PreviewConfig = {
    selectedFilePath: string | null;
    selectedFileName: string | null;
    loading: boolean;
    error: string | null;
    content: string;
    csvData: CsvData | null;
    isCsvFile: boolean;
};

