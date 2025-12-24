/**
 * Canvas 绘制缩放 Hook（基于根字号）
 *
 * 背景：
 * - 项目通过 `useHMIScale` 动态调整 `<html>` 的 `font-size`，使 rem 布局随窗口缩放。
 * - Canvas 绘制使用的是“像素常量”，不会自动随根字号变化。
 *
 * 该 Hook 用于计算当前根字号相对于设计基准字号（默认 16px）的缩放系数，
 * 供 Canvas / uPlot 等需要手动缩放的绘制逻辑使用。
 *
 * @module useCanvasScale
 */

import { useEffect, useState } from "react";

function getRootFontSizePx(): number {
    if (typeof window === "undefined") return 16;
    if (typeof document === "undefined") return 16;
    const raw = window.getComputedStyle(document.documentElement).fontSize;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
}

/**
 * 获取 Canvas 缩放系数（root font-size / baseFontSize）。
 *
 * @param baseFontSize - 设计基准根字号（默认 16px）
 */
export function useCanvasScale(baseFontSize = 16): number {
    const safeBaseFontSize =
        Number.isFinite(baseFontSize) && baseFontSize > 0 ? baseFontSize : 16;
    const [scaleFactor, setScaleFactor] = useState(1);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (typeof document === "undefined") return;

        const updateScale = () => {
            const current = getRootFontSizePx();
            setScaleFactor(current / safeBaseFontSize);
        };

        updateScale();

        // 根字号通常随窗口 resize 变化（useHMIScale），同时也可能由用户设置触发 style/class 变更。
        window.addEventListener("resize", updateScale);
        const observer = new MutationObserver(updateScale);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["style", "class", "data-theme"],
        });

        return () => {
            window.removeEventListener("resize", updateScale);
            observer.disconnect();
        };
    }, [safeBaseFontSize]);

    return scaleFactor;
}

