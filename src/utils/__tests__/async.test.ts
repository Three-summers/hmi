import { describe, expect, it, afterEach, vi } from "vitest";
import { TimeoutError, isTimeoutError, sleep, withTimeout } from "../async";

describe("utils/async", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("withTimeout：正常返回时应 resolve 并清理定时器", async () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(window, "clearTimeout");

        await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42);
        expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it("withTimeout：底层 Promise reject 时应透传错误并清理定时器", async () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(window, "clearTimeout");

        const err = new Error("boom");
        await expect(withTimeout(Promise.reject(err), 100)).rejects.toBe(err);
        expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it("withTimeout：同步 throw（factory）应返回 rejected Promise 且不启动定时器", async () => {
        vi.useFakeTimers();

        const setSpy = vi.spyOn(window, "setTimeout");
        await expect(
            withTimeout(() => {
                throw new Error("sync");
            }, 100),
        ).rejects.toThrow("sync");

        expect(setSpy).not.toHaveBeenCalled();
    });

    it("withTimeout：超时应 reject TimeoutError", async () => {
        vi.useFakeTimers();

        const pending = withTimeout(() => sleep(200).then(() => "ok"), 50);
        vi.advanceTimersByTime(50);

        try {
            await pending;
            throw new Error("Expected withTimeout to reject on timeout");
        } catch (err) {
            expect(err).toBeInstanceOf(TimeoutError);
            expect(isTimeoutError(err)).toBe(true);
        }
    });

    it("withTimeout：timeoutMs 非法或 <= 0 时不应触发超时", async () => {
        vi.useFakeTimers();

        const pending = withTimeout(() => sleep(20).then(() => "ok"), 0);
        vi.advanceTimersByTime(20);

        await expect(pending).resolves.toBe("ok");
    });

    it("isTimeoutError：应正确判定 TimeoutError", () => {
        expect(isTimeoutError(new TimeoutError(10))).toBe(true);
        expect(isTimeoutError(new Error("no"))).toBe(false);
        expect(isTimeoutError("TimeoutError")).toBe(false);
    });
});
