import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { TimeoutError } from "@/utils/async";
import { RetryCancelledError, useRetry } from "./useRetry";

describe("hooks/useRetry", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("默认只对 TimeoutError 重试：普通 Error 应直接失败", async () => {
        const { result } = renderHook(() =>
            useRetry({
                maxAttempts: 3,
                baseDelayMs: 10,
                jitterRatio: 0,
            }),
        );

        const err = new Error("boom");

        await act(async () => {
            await expect(result.current.run(async () => {
                throw err;
            })).rejects.toBe(err);
        });

        expect(result.current.attempt).toBe(1);
        expect(result.current.isRunning).toBe(false);
        expect(result.current.error).toBe(err);
    });

    it("应按配置重试并最终成功", async () => {
        vi.useFakeTimers();

        const { result } = renderHook(() =>
            useRetry({
                maxAttempts: 3,
                baseDelayMs: 100,
                backoff: "fixed",
                jitterRatio: 0,
                shouldRetry: () => true,
            }),
        );

        let calls = 0;
        let runPromise: Promise<number>;
        act(() => {
            runPromise = result.current.run(async () => {
                calls += 1;
                if (calls < 3) throw new Error("fail");
                return 42;
            });
        });

        await vi.runAllTimersAsync();
        await act(async () => {
            await runPromise!;
        });

        expect(await runPromise!).toBe(42);
        expect(calls).toBe(3);
        expect(result.current.error).toBeNull();
        expect(result.current.isRunning).toBe(false);

        vi.useRealTimers();
    });

    it("cancel() 后应终止后续重试", async () => {
        vi.useFakeTimers();

        const { result } = renderHook(() =>
            useRetry({
                maxAttempts: 5,
                baseDelayMs: 1000,
                backoff: "fixed",
                jitterRatio: 0,
                shouldRetry: () => true,
            }),
        );

        let runPromise: Promise<unknown>;
        act(() => {
            runPromise = result.current.run(async () => {
                throw new TimeoutError(10, "timeout");
            });
            // 防止 unhandled rejection 警告
            runPromise.catch(() => { /* 由测试 expect 处理 */ });
        });

        // 第一次失败后会进入 sleep，期间调用 cancel 可阻止后续尝试
        act(() => {
            result.current.cancel();
        });

        await vi.runAllTimersAsync();
        await expect(runPromise!).rejects.toBeInstanceOf(RetryCancelledError);
    });
});
