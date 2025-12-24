import { screen } from "@testing-library/react";
import { create } from "zustand";
import { describe, expect, it } from "vitest";
import { createStoreSpy, render, waitForStore } from "./utils";

describe("测试基础设施", () => {
    it("可以使用 React Testing Library 渲染组件", () => {
        render(<div>hello</div>);
        expect(screen.getByText("hello")).toBeInTheDocument();
    });

    it("render 支持 wrapper 注入", () => {
        render(<div>wrapped</div>, {
            wrapper: ({ children }) => <section data-testid="wrap">{children}</section>,
        });

        expect(screen.getByTestId("wrap")).toHaveTextContent("wrapped");
    });

    it("createStoreSpy 可记录状态变化（含初始快照）", async () => {
        type CounterState = {
            count: number;
            inc: () => void;
            set: (value: number) => void;
        };

        const useCounterStore = create<CounterState>((set) => ({
            count: 0,
            inc: () => set((state) => ({ count: state.count + 1 })),
            set: (value) => set({ count: value }),
        }));

        const spy = createStoreSpy(useCounterStore);
        useCounterStore.getState().inc();
        useCounterStore.getState().set(42);

        await waitForStore(useCounterStore, (state) => state.count === 42);
        spy.unsubscribe();

        expect(spy.records.map((r) => r.state.count)).toEqual([0, 1, 42]);
    });

    it("createStoreSpy 可禁用初始快照", () => {
        type CounterState = {
            count: number;
            inc: () => void;
        };

        const useCounterStore = create<CounterState>((set) => ({
            count: 0,
            inc: () => set((state) => ({ count: state.count + 1 })),
        }));

        const spy = createStoreSpy(useCounterStore, { includeInitialState: false });
        useCounterStore.getState().inc();
        spy.unsubscribe();

        expect(spy.records.map((r) => r.state.count)).toEqual([1]);
    });

    it("waitForStore 在初始状态已满足时会立即返回", async () => {
        const useStore = create(() => ({ value: 1 }));
        await expect(
            waitForStore(useStore, (state) => state.value === 1),
        ).resolves.toEqual({ value: 1 });
    });

    it("waitForStore 可等待后续更新命中条件", async () => {
        const useStore = create<{ value: number; set: (v: number) => void }>(
            (set) => ({
                value: 0,
                set: (value) => set({ value }),
            }),
        );

        const pending = waitForStore(useStore, (state) => state.value === 2);
        useStore.getState().set(1);
        useStore.getState().set(2);

        await expect(pending).resolves.toMatchObject({ value: 2 });
    });

    it("waitForStore 超时会 reject", async () => {
        const useStore = create(() => ({ value: 0 }));
        await expect(
            waitForStore(useStore, (state) => state.value === 1, {
                timeoutMs: 10,
            }),
        ).rejects.toThrow(/timeout/i);
    });
});
