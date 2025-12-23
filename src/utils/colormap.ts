/**
 * 频谱瀑布图配色映射工具
 *
 * 提供将频谱幅度值映射为颜色的功能，支持多种配色方案。
 * 核心特性：
 * - 多配色方案：grayscale（灰度）、jet、viridis、turbo
 * - 阈值过滤：低于阈值的区域显示为半透明深蓝（底噪）
 * - 归一化映射：将 dBm 幅度值归一化到 [0, 1] 后映射到颜色
 * - 平滑渐变：使用线性插值确保颜色平滑过渡
 *
 * @module Colormap
 */

import type { ColorScheme } from "@/types";

/** RGBA 颜色值 */
export type RGBA = { r: number; g: number; b: number; a: number };

/**
 * 将频谱幅度值映射为 RGBA 颜色
 *
 * 约定：
 * - 输入幅度单位为 dBm，默认范围 [-100, 0]
 * - 低于阈值的区域视为底噪：返回半透明深蓝，便于与背景区分
 *
 * @param amp - 幅度值（dBm）
 * @param threshold - 阈值（dBm），低于此值视为底噪
 * @param minAmp - 最小幅度值（默认 -100 dBm）
 * @param maxAmp - 最大幅度值（默认 0 dBm）
 * @param scheme - 配色方案（默认 turbo）
 * @returns RGBA 颜色对象
 */
export function amplitudeToColor(
    amp: number,
    threshold: number,
    minAmp: number = -100,
    maxAmp: number = 0,
    scheme: ColorScheme = "turbo",
): RGBA {
    // 低于阈值返回半透明深蓝（底噪）
    if (amp < threshold) {
        return { r: 0, g: 0, b: 50, a: 128 };
    }

    // 归一化到 [0, 1]
    const range = maxAmp - minAmp;
    const normalized = range === 0 ? 0 : (amp - minAmp) / range;
    const clamped = Math.max(0, Math.min(1, normalized));

    switch (scheme) {
        case "grayscale": {
            const v = Math.round(clamped * 255);
            return { r: v, g: v, b: v, a: 255 };
        }
        case "jet": {
            // Jet（近似）：深蓝 → 蓝 → 青 → 黄 → 红 → 深红
            return lerpStops(
                [
                    { t: 0, color: { r: 0, g: 0, b: 128, a: 255 } },
                    { t: 0.35, color: { r: 0, g: 0, b: 255, a: 255 } },
                    { t: 0.5, color: { r: 0, g: 255, b: 255, a: 255 } },
                    { t: 0.65, color: { r: 255, g: 255, b: 0, a: 255 } },
                    { t: 0.85, color: { r: 255, g: 0, b: 0, a: 255 } },
                    { t: 1, color: { r: 128, g: 0, b: 0, a: 255 } },
                ],
                clamped,
            );
        }
        case "viridis": {
            // Viridis（近似）：紫 → 蓝 → 绿 → 黄
            return lerpStops(
                [
                    { t: 0, color: { r: 68, g: 1, b: 84, a: 255 } },
                    { t: 0.25, color: { r: 59, g: 82, b: 139, a: 255 } },
                    { t: 0.5, color: { r: 33, g: 145, b: 140, a: 255 } },
                    { t: 0.75, color: { r: 94, g: 201, b: 98, a: 255 } },
                    { t: 1, color: { r: 253, g: 231, b: 37, a: 255 } },
                ],
                clamped,
            );
        }
        case "turbo":
        default: {
            // Turbo（近似）：蓝 → 青 → 绿 → 黄 → 红
            return lerpStops(
                [
                    { t: 0, color: { r: 0, g: 0, b: 255, a: 255 } },
                    { t: 0.25, color: { r: 0, g: 255, b: 255, a: 255 } },
                    { t: 0.5, color: { r: 0, g: 255, b: 0, a: 255 } },
                    { t: 0.75, color: { r: 255, g: 255, b: 0, a: 255 } },
                    { t: 1, color: { r: 255, g: 0, b: 0, a: 255 } },
                ],
                clamped,
            );
        }
    }
}

/**
 * 颜色线性插值
 *
 * @param a - 起始颜色
 * @param b - 目标颜色
 * @param t - 插值系数 [0, 1]
 * @returns 插值后的颜色
 */
function lerp(a: RGBA, b: RGBA, t: number): RGBA {
    return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
        a: Math.round(a.a + (b.a - a.a) * t),
    };
}

/**
 * 多段颜色插值（根据 stops 定义的颜色节点进行插值）
 *
 * @param stops - 颜色节点数组，每个节点包含位置 t 和颜色
 * @param value - 插值目标值 [0, 1]
 * @returns 插值后的颜色
 */
function lerpStops(
    stops: Array<{ t: number; color: RGBA }>,
    value: number,
): RGBA {
    if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 255 };
    if (stops.length === 1) return stops[0]!.color;

    const v = Math.max(0, Math.min(1, value));

    for (let i = 0; i < stops.length - 1; i += 1) {
        const a = stops[i]!;
        const b = stops[i + 1]!;
        if (v <= b.t) {
            const span = b.t - a.t;
            const t = span === 0 ? 0 : (v - a.t) / span;
            return lerp(a.color, b.color, t);
        }
    }

    return stops[stops.length - 1]!.color;
}
