/**
 * Node ESM Loader：为 node:test 提供 TS/TSX + 路径别名 + CSS stub 能力
 *
 * 目标：
 * - 在缺少 vitest/@testing-library/react 的环境里，仍可运行单元测试并生成覆盖率
 * - 直接运行 src 下的 TS/TSX（React 组件 / hooks）
 *
 * 设计取舍：
 * - 使用 esbuild 做轻量转译（不做类型检查）
 * - 对 `.css`/`.module.css` 统一 stub 为 `export default {}`，避免 Node 侧解析失败
 * - 支持 tsconfig.paths 中的 `@/* -> src/*`
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "esbuild";

const projectRoot = process.cwd();

async function statSafe(filePath) {
    try {
        return await fs.stat(filePath);
    } catch {
        return null;
    }
}

async function resolveFileCandidate(filePath) {
    const stat = await statSafe(filePath);
    if (stat?.isFile()) return filePath;
    return null;
}

async function resolveAsDirectoryIndex(dirPath) {
    const stat = await statSafe(dirPath);
    if (!stat?.isDirectory()) return null;

    const candidates = [
        "index.ts",
        "index.tsx",
        "index.js",
        "index.jsx",
        "index.mjs",
    ].map((name) => path.join(dirPath, name));

    for (const candidate of candidates) {
        const resolved = await resolveFileCandidate(candidate);
        if (resolved) return resolved;
    }

    return null;
}

async function resolveWithExtensions(basePath) {
    const direct = await resolveFileCandidate(basePath);
    if (direct) return direct;

    const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
    for (const ext of exts) {
        const resolved = await resolveFileCandidate(`${basePath}${ext}`);
        if (resolved) return resolved;
    }

    const asIndex = await resolveAsDirectoryIndex(basePath);
    if (asIndex) return asIndex;

    return null;
}

function isCssSpecifier(specifier) {
    return specifier.endsWith(".css");
}

function isJsonUrl(url) {
    return url.endsWith(".json");
}

function isTsLikeUrl(url) {
    return url.endsWith(".ts") || url.endsWith(".tsx");
}

export async function resolve(specifier, context, defaultResolve) {
    // 路径别名：@/xxx -> <root>/src/xxx
    if (specifier.startsWith("@/")) {
        const mapped = path.join(projectRoot, "src", specifier.slice(2));
        const resolved = await resolveWithExtensions(mapped);
        if (!resolved) {
            throw new Error(`Cannot resolve alias specifier: ${specifier}`);
        }
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    // CSS：Node 默认不认识 .css，统一走文件解析
    if (isCssSpecifier(specifier)) {
        // node_modules 内的 CSS（例如 "uplot/dist/uPlot.min.css"）在 Node 侧只需 stub
        if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
            return {
                url: "data:text/javascript,export default {};",
                shortCircuit: true,
            };
        }

        const parentDir = context.parentURL
            ? path.dirname(fileURLToPath(context.parentURL))
            : projectRoot;
        const mapped = specifier.startsWith("/")
            ? path.join(projectRoot, specifier)
            : path.resolve(parentDir, specifier);
        const resolved = await resolveWithExtensions(mapped);
        if (!resolved) {
            throw new Error(`Cannot resolve css specifier: ${specifier}`);
        }
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    // TS/TSX：Node 默认不认识 .ts/.tsx，也需要补全扩展名
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const parentDir = context.parentURL
            ? path.dirname(fileURLToPath(context.parentURL))
            : projectRoot;
        const mapped = specifier.startsWith("/")
            ? path.join(projectRoot, specifier)
            : path.resolve(parentDir, specifier);

        const resolved = await resolveWithExtensions(mapped);
        if (resolved) {
            return { url: pathToFileURL(resolved).href, shortCircuit: true };
        }
    }

    return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
    if (url.startsWith("file:") && url.endsWith(".css")) {
        return {
            format: "module",
            source: "export default {};",
            shortCircuit: true,
        };
    }

    // JSON：避免 Node 的 import assertion 限制，统一转为 ESM default export
    if (url.startsWith("file:") && isJsonUrl(url)) {
        const filePath = fileURLToPath(url);
        const source = await fs.readFile(filePath, "utf8");
        return {
            format: "module",
            source: `export default ${source};`,
            shortCircuit: true,
        };
    }

    if (url.startsWith("file:") && isTsLikeUrl(url)) {
        const filePath = fileURLToPath(url);
        const source = await fs.readFile(filePath, "utf8");
        const loader = filePath.endsWith(".tsx") ? "tsx" : "ts";

        const result = await transform(source, {
            loader,
            format: "esm",
            target: "es2020",
            sourcemap: "inline",
            sourcefile: filePath,
            jsx: "automatic",
        });

        return {
            format: "module",
            source: result.code,
            shortCircuit: true,
        };
    }

    return defaultLoad(url, context, defaultLoad);
}
