/**
 * 系统信息查询封装
 *
 * 作用：
 * - 为 System 视图提供统一的系统资源快照查询入口
 * - 统一复用 `invoke` 的错误处理与 Tauri IPC 调用模式
 *
 * @module platform/system
 */

import { invoke } from "@/platform/invoke";

export interface SystemOverview {
    uptime: number;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    temperature: number | null;
}

/**
 * 获取系统资源概览
 *
 * @returns 当前系统的运行时资源快照
 */
export async function getSystemOverview(): Promise<SystemOverview> {
    return invoke<SystemOverview>("get_system_overview");
}
