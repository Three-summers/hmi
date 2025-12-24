import React from "react";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";

type RenderWrapper = React.ComponentType<{ children: React.ReactNode }>;

export type TestRenderOptions = Omit<RenderOptions, "wrapper"> & {
    wrapper?: RenderWrapper;
};

/**
 * React Testing Library 渲染封装
 *
 * 统一入口便于后续按需注入 Provider（i18n、router、store 等）。
 */
export function render(ui: React.ReactElement, options: TestRenderOptions = {}) {
    const { wrapper, ...renderOptions } = options;
    return rtlRender(ui, { wrapper, ...renderOptions });
}

export type ZustandStoreApi<TState> = {
    getState: () => TState;
    subscribe: (
        listener: (state: TState, prevState: TState) => void,
    ) => () => void;
};

export type StoreSubscriptionRecord<TState> = {
    state: TState;
    prevState?: TState;
};

/**
 * Zustand 订阅监听器（用于断言状态变化序列）
 *
 * @param store - Zustand store（useStore 本体或 store api）
 * @param includeInitialState - 是否记录初始快照
 */
export function createStoreSpy<TState>(
    store: ZustandStoreApi<TState>,
    { includeInitialState = true }: { includeInitialState?: boolean } = {},
) {
    const records: StoreSubscriptionRecord<TState>[] = [];

    if (includeInitialState) {
        records.push({ state: store.getState() });
    }

    const unsubscribe = store.subscribe((state, prevState) => {
        records.push({ state, prevState });
    });

    return { records, unsubscribe };
}

/**
 * 等待 Zustand store 进入指定状态（基于 subscribe 模拟订阅）
 *
 * @param store - Zustand store（useStore 本体或 store api）
 * @param predicate - 命中条件
 * @param timeoutMs - 超时（ms）
 */
export function waitForStore<TState>(
    store: ZustandStoreApi<TState>,
    predicate: (state: TState) => boolean,
    { timeoutMs = 1000 }: { timeoutMs?: number } = {},
): Promise<TState> {
    const current = store.getState();
    if (predicate(current)) return Promise.resolve(current);

    return new Promise<TState>((resolve, reject) => {
        let unsubscribe = () => {};

        const timer = window.setTimeout(() => {
            unsubscribe();
            reject(new Error(`waitForStore timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        unsubscribe = store.subscribe((state) => {
            if (!predicate(state)) return;
            window.clearTimeout(timer);
            unsubscribe();
            resolve(state);
        });
    });
}
