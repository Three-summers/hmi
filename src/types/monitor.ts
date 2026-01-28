/**
 * Monitor 视图相关类型契约
 *
 * 目标：
 * - 收敛“频谱数据/状态/统计信息”的跨组件契约，减少隐式耦合
 * - 支持 Overview（Canvas）与 SpectrumAnalyzer（uPlot/瀑布图）复用同一事件 payload 类型
 *
 * @module types/monitor
 */

/** 频谱订阅状态（用于 UI 展示） */
export type SpectrumStatus = "unavailable" | "loading" | "ready" | "error";

/** Monitor Overview 的显示模式 */
export type SpectrumDisplayMode = "bars" | "fill" | "line";

/**
 * 后端事件推送的频谱数据
 *
 * 说明：
 * - 不同消费端对字段需求不同；基础字段为 timestamp/frequencies/amplitudes
 * - 后端可能附带 peak/average 等统计字段，因此这里做成可选，避免强耦合
 */
export interface SpectrumData {
    /** 数据时间戳（毫秒） */
    timestamp: number;
    /** 频率数组（Hz） */
    frequencies: number[];
    /** 幅度数组（dBm） */
    amplitudes: number[];
    /** 峰值频率（Hz） */
    peak_frequency?: number;
    /** 峰值幅度（dBm） */
    peak_amplitude?: number;
    /** 平均幅度（dBm） */
    average_amplitude?: number;
}

/** 频谱统计信息（用于展示） */
export interface SpectrumStats {
    peak_frequency: number;
    peak_amplitude: number;
    average_amplitude: number;
    bandwidth: number;
}

/**
 * 频谱分析仪截图保存模式
 *
 * 说明：
 * - `downloads`：默认保存到下载目录
 *   - 浏览器：触发下载（由浏览器/系统下载目录接管）
 *   - Tauri：由后端写入系统下载目录（无浏览器下载弹窗）
 * - `custom`：保存到用户选择的目录（通过系统目录选择对话框选择并持久化）
 */
export type ScreenshotSaveMode = "downloads" | "custom";
