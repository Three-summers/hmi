import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { TimeoutError } from "@/utils/async";
import { useFileTree } from "./useFileTree";

vi.mock("@tauri-apps/plugin-fs", () => ({
    readDir: vi.fn(),
}));

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("hooks/useFileTree", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const t = (key: string) => key;
    const isTauriTrue = () => true;
    const isTauriFalse = () => false;

    it("浏览器环境（非 Tauri）应进入不可用错误态", async () => {
        const { result } = renderHook(() =>
            useFileTree(t, { isTauri: isTauriFalse }),
        );

        await act(async () => {});

        expect(result.current.treeError).toBe("files.unavailableInBrowser");
        expect(result.current.logBasePath).toBe("");
        expect(result.current.visibleItems).toEqual([]);
    });

    it("初始化：Tauri 环境下默认空树，并进入加载态", async () => {
        const deferred = createDeferred<string>();
        const invoke = vi.fn().mockReturnValue(deferred.promise);
        const readDir = vi.fn().mockResolvedValue([]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir,
            }),
        );

        await waitFor(() => {
            expect(result.current.treeLoading).toBe(true);
        });

        expect(result.current.fileTree).toEqual([]);
        expect(result.current.visibleItems).toEqual([]);
        expect(result.current.treeError).toBeNull();
        expect(result.current.logBasePath).toBe("");

        await act(async () => {
            deferred.resolve("/log");
        });

        await waitFor(() => {
            expect(result.current.logBasePath).toBe("/log");
        });
    });

    it("加载：获取 log 目录后应构建并排序文件树（目录优先）", async () => {
        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            .mockResolvedValueOnce([
                { name: "b.csv", isDirectory: false },
                { name: "dir", isDirectory: true },
                { name: "a.csv", isDirectory: false },
            ])
            .mockResolvedValueOnce([{ name: "sub.csv", isDirectory: false }]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
            }),
        );

        await waitFor(() => {
            expect(result.current.fileTree).toHaveLength(3);
        });

        expect(result.current.logBasePath).toBe("/log");
        expect(result.current.fileTree[0]).toMatchObject({
            name: "dir",
            path: "/log/dir",
            isDirectory: true,
        });
        expect(result.current.fileTree[0]?.children).toEqual([
            {
                name: "sub.csv",
                path: "/log/dir/sub.csv",
                isDirectory: false,
            },
        ]);
        expect(result.current.fileTree[1]?.name).toBe("a.csv");
        expect(result.current.fileTree[2]?.name).toBe("b.csv");
        expect(result.current.visibleItems).toHaveLength(3);
    });

    it("展开/折叠：toggleDirectory 可切换目录展开状态并更新 visibleItems", async () => {
        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            .mockResolvedValueOnce([
                { name: "dir", isDirectory: true },
                { name: "a.csv", isDirectory: false },
            ])
            .mockResolvedValueOnce([
                { name: "sub1.csv", isDirectory: false },
                { name: "sub2.csv", isDirectory: false },
            ]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
            }),
        );

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(2);
        });

        const dirPath = result.current.fileTree[0]?.path;
        expect(dirPath).toBe("/log/dir");

        act(() => {
            result.current.toggleDirectory(dirPath!);
        });

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(4);
        });

        const first = result.current.visibleItems[0];
        expect(first?.entry.path).toBe("/log/dir");
        expect(first?.isExpanded).toBe(true);

        act(() => {
            result.current.toggleDirectory(dirPath!);
        });

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(2);
        });
        expect(result.current.visibleItems[0]?.isExpanded).toBe(false);
    });

    it("选择：visibleItems 提供稳定的 entry.path 与 level，便于 UI 定位与高亮", async () => {
        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            .mockResolvedValueOnce([{ name: "dir", isDirectory: true }])
            .mockResolvedValueOnce([{ name: "child.csv", isDirectory: false }]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
            }),
        );

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(1);
        });

        act(() => {
            result.current.toggleDirectory("/log/dir");
        });

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(2);
        });

        const [dirItem, childItem] = result.current.visibleItems;
        expect(dirItem).toMatchObject({
            level: 0,
            entry: { path: "/log/dir", name: "dir", isDirectory: true },
        });
        expect(childItem).toMatchObject({
            level: 1,
            entry: { path: "/log/dir/child.csv", name: "child.csv" },
        });
    });

    it("过滤：UI 可基于 visibleItems 的 entry.name 做关键字过滤", async () => {
        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            .mockResolvedValueOnce([
                { name: "dir", isDirectory: true },
                { name: "ok.csv", isDirectory: false },
            ])
            .mockResolvedValueOnce([
                { name: "error-1.log", isDirectory: false },
                { name: "error-2.log", isDirectory: false },
            ]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
            }),
        );

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(2);
        });

        act(() => {
            result.current.toggleDirectory("/log/dir");
        });

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(4);
        });

        const filtered = result.current.visibleItems
            .filter((item) => item.entry.name.includes("error"))
            .map((item) => item.entry.name);

        expect(filtered).toEqual(["error-1.log", "error-2.log"]);
    });

    it("错误处理：get_log_dir 失败时应进入 noLogFolder 错误态并清空树", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        const invoke = vi.fn().mockRejectedValue(new Error("boom"));
        const readDir = vi.fn();

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir,
            }),
        );

        await waitFor(() => {
            expect(result.current.treeError).toBe("files.noLogFolder");
        });

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result.current.logBasePath).toBe("");
        expect(result.current.fileTree).toEqual([]);
        expect(result.current.visibleItems).toEqual([]);
        expect(result.current.treeLoading).toBe(false);
    });

    it("重试：loadFileTree 失败后调用 retryTree 可重新加载并清除错误", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            .mockRejectedValueOnce(new Error("readDir failed"))
            .mockResolvedValueOnce([{ name: "a.csv", isDirectory: false }]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
            }),
        );

        await waitFor(() => {
            expect(result.current.treeError).toBe("files.noLogFolder");
        });
        expect(readDir).toHaveBeenCalledTimes(1);

        act(() => {
            result.current.retryTree();
        });

        await waitFor(() => {
            expect(result.current.treeError).toBeNull();
            expect(result.current.fileTree).toHaveLength(1);
        });

        expect(readDir).toHaveBeenCalledTimes(2);
        expect(result.current.visibleItems[0]?.entry.name).toBe("a.csv");
    });

    it("性能：大量子文件默认不展开，visibleItems 仅包含扁平列表所需条目", async () => {
        const invoke = vi.fn().mockResolvedValue("/log");
        const bigChildren = Array.from({ length: 1000 }, (_, idx) => ({
            name: `file-${idx}.log`,
            isDirectory: false,
        }));

        const readDir = vi
            .fn()
            .mockResolvedValueOnce([{ name: "big", isDirectory: true }])
            .mockResolvedValueOnce(bigChildren);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
            }),
        );

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(1);
        });

        act(() => {
            result.current.toggleDirectory("/log/big");
        });

        await waitFor(() => {
            expect(result.current.visibleItems).toHaveLength(1001);
        });
    });

    it("get_log_dir 超时后应自动重试并最终成功", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        const invoke = vi
            .fn()
            .mockRejectedValueOnce(new TimeoutError(10, "timeout"))
            .mockResolvedValueOnce("/log");
        const readDir = vi.fn().mockResolvedValue([]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
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

        const invoke = vi.fn().mockResolvedValue("/log");
        const readDir = vi
            .fn()
            // 让 withTimeout 触发超时（更接近真实场景），避免直接抛 TimeoutError 导致的时序差异
            .mockReturnValueOnce(new Promise(() => {}))
            .mockResolvedValueOnce([{ name: "a.csv", isDirectory: false }]);

        const { result } = renderHook(() =>
            useFileTree(t, {
                isTauri: isTauriTrue,
                invoke,
                readDir: readDir as any,
                timeoutMs: 10,
            }),
        );

        // 等待 loadFileTree 启动并发起第一次 readDir
        await act(async () => {
            await Promise.resolve();
        });
        expect(readDir).toHaveBeenCalledTimes(1);

        await act(async () => {
            // loadLogBasePath -> loadFileTree 可能跨多个微任务阶段触发，分两轮推进更稳健
            await vi.runAllTimersAsync();
            await Promise.resolve();
            await vi.runAllTimersAsync();
        });

        expect(readDir).toHaveBeenCalledTimes(2);
        expect(result.current.fileTree).toHaveLength(1);
        expect(result.current.visibleItems[0]?.entry.name).toBe("a.csv");
    });
});
