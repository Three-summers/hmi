/**
 * 窗口与全屏操作封装
 *
 * 该模块屏蔽运行环境差异：
 * - Tauri：使用 `@tauri-apps/api/window` 操作当前窗口
 * - 浏览器：使用标准 Fullscreen API / `window.close()`
 *
 * @module window
 */

import { isTauri } from "@/platform/tauri";

/**
 * 获取 Tauri 当前窗口对象
 *
 * @returns Tauri Window 实例
 * @description 使用动态 import，避免在浏览器开发模式下加载 Tauri 包导致运行时报错。
 */
async function getTauriWindow() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
}

/**
 * 判断当前是否处于全屏状态
 *
 * @returns 是否全屏
 */
export async function isFullscreen(): Promise<boolean> {
    if (isTauri()) {
        const window = await getTauriWindow();
        return window.isFullscreen();
    }

    // 浏览器 Fullscreen API：document.fullscreenElement 不为空表示全屏
    return Boolean(document.fullscreenElement);
}

/**
 * 设置全屏状态
 *
 * @param fullscreen - true 进入全屏；false 退出全屏
 * @returns Promise<void> - 操作完成后 resolve
 */
export async function setFullscreen(fullscreen: boolean): Promise<void> {
    if (isTauri()) {
        const window = await getTauriWindow();
        await window.setFullscreen(fullscreen);
        return;
    }

    if (fullscreen) {
        await document.documentElement.requestFullscreen?.();
        return;
    }

    await document.exitFullscreen?.();
}

/**
 * 切换全屏状态
 *
 * @description 先读取当前状态，再调用 `setFullscreen` 反转。
 * @returns Promise<void> - 操作完成后 resolve
 */
export async function toggleFullscreen(): Promise<void> {
    const fullscreen = await isFullscreen();
    await setFullscreen(!fullscreen);
}

/**
 * 关闭窗口
 *
 * @description 在 Tauri 中关闭当前窗口；在浏览器中调用 `window.close()`（通常仅对脚本打开的窗口生效）。
 * @returns Promise<void> - 操作完成后 resolve
 */
export async function closeWindow(): Promise<void> {
    if (isTauri()) {
        const window = await getTauriWindow();
        await window.close();
        return;
    }

    window.close();
}
