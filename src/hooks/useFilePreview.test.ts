import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFilePreview, parseCsv } from "./useFilePreview";

describe("hooks/useFilePreview", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("parseCsv：应解析基础 CSV 数据", () => {
        const parsed = parseCsv("t,a,b\n0,1,2\n1,3,4\n");
        expect(parsed?.headers).toEqual(["t", "a", "b"]);
        expect(parsed?.rows.length).toBe(2);
        expect(parsed?.rows[0][1]).toBe(1);
    });

    it("selectFile：应读取内容并解析 csvData", async () => {
        const t = (key: string) => key;
        const readTextFile = vi
            .fn()
            .mockResolvedValue("t,a\n0,1\n1,2\n");

        const { result } = renderHook(() =>
            useFilePreview(t, { readTextFile: readTextFile as any }),
        );

        await act(async () => {
            await result.current.selectFile({
                name: "a.csv",
                path: "/a.csv",
                isDirectory: false,
            });
        });

        expect(readTextFile).toHaveBeenCalledTimes(1);
        expect(result.current.preview.content).toContain("t,a");
        expect(result.current.preview.csvData?.headers).toEqual(["t", "a"]);
        expect(result.current.preview.error).toBeNull();
    });

    it("selectedFileName：Windows 路径应正确提取文件名", async () => {
        const t = (key: string) => key;
        const readTextFile = vi.fn().mockResolvedValue("t,a\n0,1\n1,2\n");

        const { result } = renderHook(() =>
            useFilePreview(t, { readTextFile: readTextFile as any }),
        );

        await act(async () => {
            await result.current.selectFile({
                name: "a.csv",
                path: "C:\\log\\a.csv",
                isDirectory: false,
            });
        });

        expect(readTextFile).toHaveBeenCalledWith("C:\\log\\a.csv");
        expect(result.current.preview.selectedFileName).toBe("a.csv");
    });

    it("读取失败时应自动重试一次并成功", async () => {
        vi.useFakeTimers();

        const t = (key: string) => key;
        const readTextFile = vi
            .fn()
            .mockRejectedValueOnce(new Error("fail"))
            .mockResolvedValueOnce("t,a\n0,1\n1,2\n");

        const { result } = renderHook(() =>
            useFilePreview(t, { readTextFile: readTextFile as any }),
        );

        await act(async () => {
            const p = result.current.selectFile({
                name: "a.csv",
                path: "/a.csv",
                isDirectory: false,
            });
            await vi.runAllTimersAsync();
            await p;
        });

        expect(readTextFile).toHaveBeenCalledTimes(2);
        expect(result.current.preview.error).toBeNull();
        expect(result.current.preview.csvData?.rows.length).toBeGreaterThan(0);
    });

    it("withTimeout 超时时应显示 loadTimeout", async () => {
        vi.useFakeTimers();

        const t = (key: string) => key;
        const readTextFile = vi.fn().mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() =>
            useFilePreview(t, {
                readTextFile: readTextFile as any,
                timeoutMs: 20,
            }),
        );

        await act(async () => {
            const p = result.current.selectFile({
                name: "a.csv",
                path: "/a.csv",
                isDirectory: false,
            });
            // 添加 catch handler 避免 unhandled rejection
            p.catch(() => {
                /* 错误会被 hook 内部处理并写入 state */
            });
            // 需要推进足够时间：第一次超时(20ms) + 重试延迟(200ms) + 第二次超时(20ms)
            await vi.advanceTimersByTimeAsync(20 + 200 + 20);
        });

        expect(result.current.preview.error).toBe("files.loadTimeout");
    });

    it("retryPreview：应重新读取上一次文件", async () => {
        const t = (key: string) => key;
        const readTextFile = vi.fn().mockResolvedValue("x,y\n0,1\n1,2\n");

        const { result } = renderHook(() =>
            useFilePreview(t, { readTextFile: readTextFile as any }),
        );

        await act(async () => {
            await result.current.selectFile({
                name: "a.csv",
                path: "/a.csv",
                isDirectory: false,
            });
        });

        await act(async () => {
            await result.current.retryPreview();
        });

        expect(readTextFile).toHaveBeenCalledTimes(2);
    });
});
