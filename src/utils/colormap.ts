import type { ColorScheme } from "@/types";

export type RGBA = { r: number; g: number; b: number; a: number };

/**
 * 频谱瀑布图配色映射
 *
 * 约定：
 * - 输入幅度单位为 dBm，默认范围 [-100, 0]
 * - 低于阈值的区域视为底噪：返回半透明深蓝，便于与背景区分
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

function lerp(a: RGBA, b: RGBA, t: number): RGBA {
    return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
        a: Math.round(a.a + (b.a - a.a) * t),
    };
}

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
