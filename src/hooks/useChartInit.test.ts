import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChartInit } from "./useChartInit";

describe("useChartInit", () => {
    it("run：factory 成功时应进入 ready 且返回 value", () => {
        const { result } = renderHook(() => useChartInit());

        act(() => {
            const res = result.current.run(() => 42);
            expect(res.ok).toBe(true);
            expect(res.value).toBe(42);
            expect(res.message).toBeNull();
        });

        expect(result.current.status).toBe("ready");
        expect(result.current.error).toBeNull();
    });

    it("run：factory 抛错时应进入 error 且回调 onError", () => {
        const onError = vi.fn();
        const { result } = renderHook(() => useChartInit({ onError }));

        act(() => {
            const res = result.current.run(() => {
                throw new Error("boom");
            });
            expect(res.ok).toBe(false);
            expect(res.value).toBeNull();
            expect(res.message).toMatch(/boom/);
        });

        expect(result.current.status).toBe("error");
        expect(result.current.error).toMatch(/boom/);
        expect(onError).toHaveBeenCalledWith("boom", expect.any(Error));
    });

    it("retry：应清空错误并递增 retryToken", () => {
        const { result } = renderHook(() => useChartInit());

        act(() => {
            result.current.run(() => {
                throw new Error("boom");
            });
        });

        const prevToken = result.current.retryToken;
        act(() => {
            result.current.retry();
        });

        expect(result.current.status).toBe("idle");
        expect(result.current.error).toBeNull();
        expect(result.current.retryToken).toBe(prevToken + 1);
    });
});

