import { describe, expect, it, vi } from "vitest";

describe("platform/invoke", () => {
    it("浏览器模式未注册 mock 时应抛出 InvokeError（MOCK_NOT_REGISTERED）", async () => {
        vi.resetModules();
        vi.doMock("@/platform/tauri", () => ({ isTauri: () => false }));

        const mod = await import("../invoke");

        await expect(mod.invoke("missing_mock")).rejects.toBeInstanceOf(
            mod.InvokeError,
        );
        await expect(mod.invoke("missing_mock")).rejects.toMatchObject({
            code: "MOCK_NOT_REGISTERED",
            command: "missing_mock",
        });
    });

    it("浏览器模式注册 mock 后应返回 mock 结果", async () => {
        vi.resetModules();
        vi.doMock("@/platform/tauri", () => ({ isTauri: () => false }));

        const mod = await import("../invoke");
        mod.registerInvokeMock("hello", () => 42);

        await expect(mod.invoke<number>("hello")).resolves.toBe(42);
    });

    it("mock handler 抛错时应包装为 InvokeError（INVOKE_FAILED）", async () => {
        vi.resetModules();
        vi.doMock("@/platform/tauri", () => ({ isTauri: () => false }));

        const mod = await import("../invoke");
        mod.registerInvokeMock("boom", () => {
            throw new Error("bad");
        });

        await expect(mod.invoke("boom")).rejects.toMatchObject({
            code: "INVOKE_FAILED",
            command: "boom",
        });
    });

    it("Tauri 模式 invoke 失败时应包装为 InvokeError（INVOKE_FAILED）", async () => {
        vi.resetModules();
        vi.doMock("@/platform/tauri", () => ({ isTauri: () => true }));
        vi.doMock("@tauri-apps/api/core", () => ({
            invoke: vi.fn().mockRejectedValue(new Error("backend boom")),
        }));

        const mod = await import("../invoke");

        await expect(mod.invoke("cmd")).rejects.toMatchObject({
            code: "INVOKE_FAILED",
            command: "cmd",
        });
    });
});

