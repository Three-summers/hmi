/**
 * Tauri 运行环境探测
 *
 * 目的：
 * - 项目同时支持 “Tauri WebView” 与 “浏览器开发模式（vite dev）”
 * - 在浏览器环境下调用 Tauri API 会报错，因此所有与 Tauri 强绑定的逻辑都应先判断
 */
export function isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

