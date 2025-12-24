import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";
import { useIntervalWhenActive } from "./useIntervalWhenActive";

describe("useIntervalWhenActive", () => {
    it("enabled 切换时会正确启动/停止 interval", () => {
        vi.useFakeTimers();
        const tick = vi.fn();

        function Comp({ enabled }: { enabled: boolean }) {
            useIntervalWhenActive(tick, 1000, { enabled });
            return null;
        }

        const { rerender, unmount } = render(<Comp enabled />);

        act(() => {
            vi.advanceTimersByTime(3100);
        });
        expect(tick).toHaveBeenCalledTimes(3);

        rerender(<Comp enabled={false} />);
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(tick).toHaveBeenCalledTimes(3);

        rerender(<Comp enabled />);
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(tick).toHaveBeenCalledTimes(5);

        unmount();
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(tick).toHaveBeenCalledTimes(5);
        vi.useRealTimers();
    });

    it("delayMs=null 时不会启动 interval；immediate=true 会先执行一次", () => {
        vi.useFakeTimers();
        const tick = vi.fn();

        function Comp({
            enabled,
            delayMs,
            immediate,
        }: {
            enabled: boolean;
            delayMs: number | null;
            immediate: boolean;
        }) {
            useIntervalWhenActive(tick, delayMs, { enabled, immediate });
            return null;
        }

        const { rerender } = render(
            <Comp enabled delayMs={null} immediate={false} />,
        );

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(tick).toHaveBeenCalledTimes(0);

        rerender(<Comp enabled delayMs={1000} immediate />);
        expect(tick).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(tick).toHaveBeenCalledTimes(3);
        vi.useRealTimers();
    });
});

