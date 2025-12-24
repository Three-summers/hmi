export type { RGBA } from "./colormap";
export { amplitudeToColor } from "./colormap";
export { captureSpectrumAnalyzer } from "./screenshot";

export type { AuthCredentials } from "./auth";
export {
    getStoredCredentials,
    hashPassword,
    initializeDefaultCredentials,
    setCredentials,
    verifyPassword,
} from "./auth";

export function readCssVar(
    style: CSSStyleDeclaration,
    name: string,
    fallback: string,
): string {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
}

type RGB = { r: number; g: number; b: number };

function clampByte(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseCssColorToRgb(input: string): RGB | null {
    const color = input.trim();

    if (!color) return null;

    // #rgb, #rgba, #rrggbb, #rrggbbaa
    if (color.startsWith("#")) {
        const hex = color.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            return { r, g, b };
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return { r, g, b };
        }
    }

    // rgb(r, g, b) / rgba(r, g, b, a)
    const match = color.match(
        /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+)\s*)?\)$/i,
    );
    if (match) {
        const r = clampByte(Number(match[1]));
        const g = clampByte(Number(match[2]));
        const b = clampByte(Number(match[3]));
        return { r, g, b };
    }

    return null;
}

export function withAlpha(color: string, alpha: number, fallback: string): string {
    const rgb = parseCssColorToRgb(color);
    if (!rgb) return fallback;
    const safeAlpha = Number.isFinite(alpha)
        ? Math.max(0, Math.min(1, alpha))
        : 1;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

