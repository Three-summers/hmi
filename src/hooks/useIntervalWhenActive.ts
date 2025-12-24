/**
 * 在 enabled=true 时运行的 interval（并在 disabled/卸载时自动清理）
 *
 * 典型场景：
 * - Keep-Alive 视图切换后组件不卸载，但不可见时应暂停轮询/刷新；
 * - 避免后台持续 setInterval 占用 CPU，或在视图恢复时出现“重复定时器”。
 *
 * @module useIntervalWhenActive
 */

import { useEffect, useRef } from "react";

interface UseIntervalWhenActiveOptions {
    /** 是否启用 interval（例如传入 useIsViewActive()） */
    enabled?: boolean;
    /** 是否在启动时立即执行一次 callback */
    immediate?: boolean;
}

/**
 * 在 enabled=true 且 delayMs!=null 时启动 interval。
 *
 * @param callback - 定时回调
 * @param delayMs - 间隔（ms）；传入 null 表示禁用
 * @param options - 配置项
 */
export function useIntervalWhenActive(
    callback: () => void,
    delayMs: number | null,
    { enabled = true, immediate = false }: UseIntervalWhenActiveOptions = {},
) {
    const callbackRef = useRef(callback);

    // 保持 callback 最新，避免 interval 读到旧闭包
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    useEffect(() => {
        if (!enabled) return;
        if (delayMs === null) return;

        if (immediate) {
            callbackRef.current();
        }

        const id = window.setInterval(() => {
            callbackRef.current();
        }, delayMs);

        return () => {
            window.clearInterval(id);
        };
    }, [delayMs, enabled, immediate]);
}

