/**
 * HMI 全局缩放 Hook（rem + 动态根字体）
 *
 * 通过动态设置 `<html>` 的 `font-size`，让 rem 单位的尺寸可以随窗口宽度等比例缩放。
 *
 * 计算公式：
 * - fontSize = max(12, (currentWidth / baseWidth) * baseFontSize)
 *
 * @module useHMIScale
 */

import { useEffect } from "react";

const MIN_ROOT_FONT_SIZE_PX = 12;
const RESIZE_DEBOUNCE_MS = 100;

/**
 * 安装 HMI 缩放系统：根据窗口宽度动态调整 HTML 根字体大小。
 *
 * @param baseWidth - 设计基准宽度（默认 1280）
 * @param baseFontSize - 设计基准根字体（默认 16）
 * @returns void
 */
export function useHMIScale(baseWidth = 1280, baseFontSize = 16): void {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const previousInlineFontSize = document.documentElement.style.fontSize;

        const applyScale = () => {
            const safeBaseWidth = baseWidth > 0 ? baseWidth : 1280;
            const safeBaseFontSize = baseFontSize > 0 ? baseFontSize : 16;
            const currentWidth = window.innerWidth;

            const nextFontSize = Math.max(
                MIN_ROOT_FONT_SIZE_PX,
                (currentWidth / safeBaseWidth) * safeBaseFontSize,
            );

            document.documentElement.style.fontSize = `${nextFontSize}px`;
        };

        let resizeTimer: number | undefined;
        const handleResize = () => {
            if (resizeTimer !== undefined) {
                window.clearTimeout(resizeTimer);
            }

            resizeTimer = window.setTimeout(applyScale, RESIZE_DEBOUNCE_MS);
        };

        // 首次挂载时立即应用，避免等待 resize 才生效
        applyScale();
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            if (resizeTimer !== undefined) {
                window.clearTimeout(resizeTimer);
            }
            document.documentElement.style.fontSize = previousInlineFontSize;
        };
    }, [baseWidth, baseFontSize]);
}

