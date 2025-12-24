import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { TimeoutError } from "@/utils/async";
import { useFileTree } from "./useFileTree";

describe("hooks/useFileTree", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("浏览器环境（非 Tauri）应进入不可用错误态", async () => {
        const t = (key: string) => key;

        const { result } = renderHook(() =>
            useFileTree(t, { isTauri: () => false }),
        );

        await act(async () => {});

        expect(result.current.treeError).toBe("files.unavailableInBrowser");
        expect(result.current.logBasePath).toBe("");
        expect(result.current.visibleItems).toEqual([]);
    });

    it("get_log_dir 超时后应自动重试并最终成功", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        const t = (key: string) => key;
        const invoke = vi
            .fn()
            .mockRejectedValueOnce(new TimeoutError(10, "timeout"))
            .mockResolvedValueOnce("/log");
        const readDir = vi.fn().mockResolvedValue([]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: () => true,
                invoke,
                readDir,
                timeoutMs: 10,
            }),
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(result.current.logBasePath).toBe("/log");
    });

    it("readDir 超时后应自动重试并加载文件树", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        const t = (key: string) => key;
        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            .mockRejectedValueOnce(new TimeoutError(10, "timeout"))
            .mockResolvedValueOnce([{ name: "a.csv", isDirectory: false }]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: () => true,
                invoke,
                readDir: readDir as any,
                timeoutMs: 10,
            }),
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(readDir).toHaveBeenCalledTimes(2);
        expect(result.current.fileTree).toHaveLength(1);
        expect(result.current.visibleItems[0]?.entry.name).toBe("a.csv");
    });
});

