import { act, fireEvent, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";
import { useIntervalWhenActive } from "@/hooks/useIntervalWhenActive";
import { useStoreWhenActive } from "@/hooks/useStoreWhenActive";

describe("InfoPanel Keep-Alive 副作用管理", () => {
    it("isActive=true 时渲染当前视图内容", async () => {
        vi.resetModules();

        const { useIsViewActive } = await import("./ViewContext");

        function JobsView() {
            const isActive = useIsViewActive();
            return (
                <div data-testid="jobs" data-active={String(isActive)}>
                    jobs
                </div>
            );
        }

        function SetupView() {
            return <div data-testid="setup">setup</div>;
        }

        function DummyView() {
            return <div data-testid="dummy">dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: JobsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: SetupView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");
        render(<InfoPanel currentView="jobs" />);

        expect(screen.getByTestId("jobs")).toBeInTheDocument();
        expect(screen.getByTestId("jobs")).toHaveAttribute("data-active", "true");
        expect(screen.queryByTestId("setup")).not.toBeInTheDocument();
    });

    it("isActive=false 时隐藏但保留 DOM（keep mounted）", async () => {
        vi.resetModules();

        const { useIsViewActive } = await import("./ViewContext");

        function JobsView() {
            const isActive = useIsViewActive();
            return (
                <div data-testid="jobs" data-active={String(isActive)}>
                    jobs
                </div>
            );
        }

        function SetupView() {
            const isActive = useIsViewActive();
            return (
                <div data-testid="setup" data-active={String(isActive)}>
                    setup
                </div>
            );
        }

        function DummyView() {
            return <div>dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: JobsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: SetupView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");
        const { rerender } = render(<InfoPanel currentView="jobs" />);

        expect(screen.getByTestId("jobs")).toBeVisible();
        expect(screen.getByTestId("jobs")).toHaveAttribute("data-active", "true");

        rerender(<InfoPanel currentView="setup" />);

        expect(screen.getByTestId("jobs")).toBeInTheDocument();
        expect(screen.getByTestId("jobs")).not.toBeVisible();
        expect(screen.getByTestId("jobs")).toHaveAttribute("data-active", "false");
        expect(screen.getByTestId("setup")).toBeVisible();
        expect(screen.getByTestId("setup")).toHaveAttribute("data-active", "true");
    });

    it("切换 isActive 时保留组件本地状态且不会卸载", async () => {
        vi.resetModules();

        let jobsMountCount = 0;

        function JobsView() {
            const [localCount, setLocalCount] = useState(0);

            useEffect(() => {
                jobsMountCount += 1;
                return () => {
                    jobsMountCount -= 1;
                };
            }, []);

            return (
                <div data-testid="jobs">
                    <span data-testid="jobs-local">{localCount}</span>
                    <button
                        type="button"
                        onClick={() => setLocalCount((v) => v + 1)}
                    >
                        inc
                    </button>
                </div>
            );
        }

        function SetupView() {
            return <div data-testid="setup">setup</div>;
        }

        function DummyView() {
            return <div>dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: JobsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: SetupView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");
        const { rerender } = render(<InfoPanel currentView="jobs" />);

        expect(screen.getByTestId("jobs-local")).toHaveTextContent("0");
        expect(jobsMountCount).toBe(1);

        fireEvent.click(screen.getByText("inc"));
        expect(screen.getByTestId("jobs-local")).toHaveTextContent("1");

        rerender(<InfoPanel currentView="setup" />);
        expect(screen.getByTestId("setup")).toBeInTheDocument();
        expect(screen.getByTestId("jobs")).toBeInTheDocument();
        expect(jobsMountCount).toBe(1);

        rerender(<InfoPanel currentView="jobs" />);
        expect(screen.getByTestId("jobs-local")).toHaveTextContent("1");
        expect(jobsMountCount).toBe(1);
    });

    it("输入框内容在切换后保留", async () => {
        vi.resetModules();

        function JobsView() {
            const [text, setText] = useState("");
            return (
                <div data-testid="jobs">
                    <label htmlFor="jobs-input">name</label>
                    <input
                        id="jobs-input"
                        aria-label="name"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                    />
                </div>
            );
        }

        function SetupView() {
            return <div data-testid="setup">setup</div>;
        }

        function DummyView() {
            return <div>dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: JobsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: SetupView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");
        const { rerender } = render(<InfoPanel currentView="jobs" />);

        const input = screen.getByLabelText("name") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "hello" } });
        expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe(
            "hello",
        );

        rerender(<InfoPanel currentView="setup" />);
        expect(screen.getByTestId("setup")).toBeInTheDocument();

        rerender(<InfoPanel currentView="jobs" />);
        expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe(
            "hello",
        );
    });

    it("isActive=false 时不触发数据更新（暂停 interval 与 store 订阅）", async () => {
        vi.useFakeTimers();
        vi.resetModules();

        const { useIsViewActive } = await import("./ViewContext");

        type CounterState = { value: number; inc: () => void };
        const useCounterStore = create<CounterState>((set) => ({
            value: 0,
            inc: () => set((state) => ({ value: state.value + 1 })),
        }));

        let jobsRenderCount = 0;

        function JobsView() {
            jobsRenderCount += 1;
            const isActive = useIsViewActive();
            const value = useStoreWhenActive(
                useCounterStore,
                (state) => state.value,
                { enabled: isActive },
            );

            useIntervalWhenActive(() => {
                useCounterStore.getState().inc();
            }, 1000, { enabled: isActive });

            return (
                <div data-testid="jobs">
                    <span data-testid="jobs-store">{value}</span>
                </div>
            );
        }

        function SetupView() {
            return <div data-testid="setup">setup</div>;
        }

        function DummyView() {
            return <div>dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: JobsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: SetupView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");
        const { rerender } = render(<InfoPanel currentView="jobs" />);

        act(() => {
            vi.advanceTimersByTime(2500);
        });
        expect(useCounterStore.getState().value).toBe(2);
        expect(screen.getByTestId("jobs-store")).toHaveTextContent("2");

        rerender(<InfoPanel currentView="setup" />);
        expect(screen.getByTestId("setup")).toBeInTheDocument();

        const rendersAfterDeactivate = jobsRenderCount;

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(useCounterStore.getState().value).toBe(2);

        act(() => {
            useCounterStore.getState().inc();
        });
        expect(useCounterStore.getState().value).toBe(3);
        expect(jobsRenderCount).toBe(rendersAfterDeactivate);
        expect(screen.getByTestId("jobs-store")).toHaveTextContent("2");

        vi.useRealTimers();
    });

    it("inactive 视图会暂停 store 订阅与 interval，并保持挂载状态", async () => {
        vi.useFakeTimers();
        vi.resetModules();

        const { useIsViewActive } = await import("./ViewContext");

        type CounterState = { value: number; inc: () => void };
        const useCounterStore = create<CounterState>((set) => ({
            value: 0,
            inc: () => set((state) => ({ value: state.value + 1 })),
        }));

        let jobsRenderCount = 0;
        let jobsMountCount = 0;

        function JobsView() {
            jobsRenderCount += 1;
            const isActive = useIsViewActive();
            const value = useStoreWhenActive(
                useCounterStore,
                (state) => state.value,
                { enabled: isActive },
            );
            const [local, setLocal] = useState(0);

            useEffect(() => {
                jobsMountCount += 1;
                return () => {
                    jobsMountCount -= 1;
                };
            }, []);

            useIntervalWhenActive(() => {
                useCounterStore.getState().inc();
            }, 1000, { enabled: isActive });

            return (
                <div data-testid="jobs">
                    <span data-testid="jobs-store">{value}</span>
                    <span data-testid="jobs-local">{local}</span>
                    <button
                        type="button"
                        onClick={() => setLocal((v) => v + 1)}
                    >
                        inc
                    </button>
                </div>
            );
        }

        function SetupView() {
            const isActive = useIsViewActive();
            return (
                <div data-testid="setup" data-active={String(isActive)}>
                    setup
                </div>
            );
        }

        function DummyView() {
            return <div data-testid="dummy">dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: JobsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: SetupView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");

        const { rerender } = render(<InfoPanel currentView="jobs" />);
        expect(screen.getByTestId("jobs-store")).toHaveTextContent("0");
        expect(screen.getByTestId("jobs-local")).toHaveTextContent("0");

        // Keep-Alive：切换视图前先改一次 local state，返回后应保持
        fireEvent.click(screen.getByText("inc"));
        expect(screen.getByTestId("jobs-local")).toHaveTextContent("1");

        // active 时 interval 会推动 store 增长，并触发重渲染
        act(() => {
            vi.advanceTimersByTime(2500);
        });
        expect(useCounterStore.getState().value).toBe(2);
        expect(screen.getByTestId("jobs-store")).toHaveTextContent("2");
        expect(jobsMountCount).toBe(1);

        const rendersBeforeSwitch = jobsRenderCount;

        // 切换到 setup：jobs 变为 inactive，但仍保持挂载（hidden）
        rerender(<InfoPanel currentView="setup" />);
        expect(screen.getByTestId("setup")).toBeInTheDocument();
        expect(screen.getByTestId("jobs")).toBeInTheDocument();
        expect(jobsMountCount).toBe(1);

        const rendersAfterDeactivate = jobsRenderCount;
        expect(rendersAfterDeactivate).toBeGreaterThan(rendersBeforeSwitch);

        // inactive 后：interval 应被清理，不再推动 store 增长
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(useCounterStore.getState().value).toBe(2);

        // inactive 后：store 更新不应触发 jobs 重渲染（订阅暂停）
        act(() => {
            useCounterStore.getState().inc();
        });
        expect(useCounterStore.getState().value).toBe(3);
        expect(jobsRenderCount).toBe(rendersAfterDeactivate);
        expect(screen.getByTestId("jobs-store")).toHaveTextContent("2");

        // 切回 jobs：恢复订阅并读取最新快照，同时 local state 仍保持
        rerender(<InfoPanel currentView="jobs" />);
        expect(screen.getByTestId("jobs-store")).toHaveTextContent("3");
        expect(screen.getByTestId("jobs-local")).toHaveTextContent("1");
        expect(jobsMountCount).toBe(1);

        vi.useRealTimers();
    });

    it("视图组件挂起（Suspense）时会显示 loading fallback", async () => {
        vi.resetModules();

        function SuspendsView() {
            // 通过抛出 Promise 触发 Suspense fallback
            throw new Promise(() => {});
        }

        function DummyView() {
            return <div>dummy</div>;
        }

        vi.doMock("@/hmi/viewRegistry", () => ({
            HMI_VIEW_COMPONENTS: {
                jobs: SuspendsView,
                system: DummyView,
                monitor: DummyView,
                recipes: DummyView,
                files: DummyView,
                setup: DummyView,
                alarms: DummyView,
                help: DummyView,
            },
        }));

        const { InfoPanel } = await import("./InfoPanel");
        render(<InfoPanel currentView="jobs" />);

        // 默认语言为 zh，common.loading => "加载中..."
        expect(screen.getByText("加载中...")).toBeInTheDocument();
    });
});
