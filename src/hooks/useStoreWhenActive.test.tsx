import { act } from "@testing-library/react";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { describe, expect, it } from "vitest";
import { render } from "@/test/utils";
import { useStoreWhenActive } from "./useStoreWhenActive";

describe("useStoreWhenActive", () => {
    it("enabled=false 时暂停订阅，重新启用后恢复读取最新快照", () => {
        type CounterState = {
            count: number;
            inc: () => void;
        };

        const useCounterStore = create<CounterState>((set) => ({
            count: 0,
            inc: () => set((state) => ({ count: state.count + 1 })),
        }));

        const snapshots: number[] = [];

        function Counter({ enabled }: { enabled: boolean }) {
            const count = useStoreWhenActive(
                useCounterStore,
                (state) => state.count,
                { enabled },
            );
            snapshots.push(count);
            return <div data-testid="count">{count}</div>;
        }

        const { rerender } = render(<Counter enabled />);
        expect(snapshots).toEqual([0]);

        act(() => {
            useCounterStore.getState().inc();
        });
        expect(snapshots).toEqual([0, 1]);

        // 禁用后：仍会因为 props 变化重渲染一次，但后续 store 更新不应触发重渲染
        rerender(<Counter enabled={false} />);
        expect(snapshots).toEqual([0, 1, 1]);

        act(() => {
            useCounterStore.getState().inc();
        });
        expect(snapshots).toEqual([0, 1, 1]);

        // 重新启用后：读取到最新状态
        rerender(<Counter enabled />);
        expect(snapshots[snapshots.length - 1]).toBe(2);
    });

    it("配合 useShallow 时，不相关字段变化不会触发重渲染", () => {
        type State = {
            a: number;
            b: number;
            incA: () => void;
            incB: () => void;
        };

        const useStore = create<State>((set) => ({
            a: 0,
            b: 0,
            incA: () => set((state) => ({ a: state.a + 1 })),
            incB: () => set((state) => ({ b: state.b + 1 })),
        }));

        let renderCount = 0;

        function Comp() {
            const { a } = useStoreWhenActive(
                useStore,
                useShallow((state) => ({ a: state.a, incA: state.incA })),
            );
            renderCount += 1;
            return <div data-testid="a">{a}</div>;
        }

        render(<Comp />);
        expect(renderCount).toBe(1);

        act(() => {
            useStore.getState().incB();
        });
        expect(renderCount).toBe(1);

        act(() => {
            useStore.getState().incA();
        });
        expect(renderCount).toBe(2);
    });
});
