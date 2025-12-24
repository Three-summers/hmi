/**
 * Zustand 订阅门控：仅在启用时订阅 store
 *
 * 背景（Keep-Alive 场景）：
 * - InfoPanel 会将已访问的视图保持挂载，切换时仅 hidden 隐藏；
 * - 若视图内部直接使用 Zustand hook 订阅数据，即使视图不可见也会持续接收更新并触发重渲染；
 * - 这会导致后台 CPU 消耗与不必要的渲染开销（尤其是告警列表/高频数据）。
 *
 * 本 Hook 的目标：
 * - enabled=true：正常订阅 Zustand store（与 useStore 类似）
 * - enabled=false：不订阅（暂停），视图不可见时不因 store 更新而重渲染
 *
 * 使用建议：
 * - 搭配 `useIsViewActive()`：`enabled = isViewActive`
 * - selector 返回对象时，请配合 `useShallow(...)` 以保持引用稳定，避免无关更新触发渲染
 *
 * @module useStoreWhenActive
 */

import { useCallback, useSyncExternalStore } from "react";
import type { StoreApi, UseBoundStore } from "zustand";

/**
 * 仅在 enabled=true 时订阅 Zustand store 的 selector。
 *
 * @template TState - store 状态类型
 * @template TSlice - selector 选取的切片类型
 * @param store - Zustand bound store（例如 useAppStore）
 * @param selector - 状态选择器
 * @param options - 配置项
 * @returns selector 对应的状态切片
 */
export function useStoreWhenActive<TState, TSlice>(
    store: UseBoundStore<StoreApi<TState>>,
    selector: (state: TState) => TSlice,
    { enabled = true }: { enabled?: boolean } = {},
): TSlice {
    const subscribe = useCallback(
        (listener: () => void) => {
            if (!enabled) return () => {};
            // Zustand subscribe 会传入 (state, prevState)，这里仅需要“变化通知”即可
            return store.subscribe(() => listener());
        },
        [enabled, store],
    );

    const getSnapshot = useCallback(() => {
        return selector(store.getState());
    }, [selector, store]);

    // serverSnapshot 在本项目（Vite/CSR + JSDOM）中与 clientSnapshot 一致即可
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

