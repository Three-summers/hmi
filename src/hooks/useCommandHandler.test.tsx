import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores";
import { closeWindow, toggleFullscreen } from "@/platform/window";
import { getStoredCredentials, verifyPassword } from "@/utils/auth";
import { useCommandHandler } from "./useCommandHandler";

const notifyError = vi.fn();

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "zh" },
    }),
    initReactI18next: {
        type: "3rdParty",
        init: vi.fn(),
    },
}));

vi.mock("@/hooks/useNotify", () => ({
    useNotify: () => ({
        success: vi.fn(),
        error: notifyError,
        warning: vi.fn(),
        info: vi.fn(),
        notify: vi.fn(),
    }),
}));

vi.mock("@/platform/window", () => ({
    toggleFullscreen: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
}));

vi.mock("@/utils/auth", () => ({
    getStoredCredentials: vi.fn(() => []),
    verifyPassword: vi.fn(async () => false),
}));

describe("useCommandHandler", () => {
    beforeEach(() => {
        useAppStore.setState({ user: null, theme: "dark", scaleOverride: 1.0 });
        vi.clearAllMocks();
    });

    it("未登录时点击登录会打开弹窗，按 ESC 关闭", () => {
        const { result } = renderHook(() => useCommandHandler());

        expect(result.current.showLoginModal).toBe(false);

        act(() => {
            result.current.handleLoginClick();
        });
        expect(result.current.showLoginModal).toBe(true);

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(result.current.showLoginModal).toBe(false);
    });

    it("选择操作员会直接登录并关闭弹窗", () => {
        const { result } = renderHook(() => useCommandHandler());

        act(() => {
            result.current.openLoginModal();
            result.current.handleRoleSelect("operator");
        });

        expect(useAppStore.getState().user?.role).toBe("operator");
        expect(result.current.showLoginModal).toBe(false);
    });

    it("已登录时点击登录会执行登出", () => {
        useAppStore.setState({
            user: { id: "admin", name: "admin", role: "admin" },
        });

        const { result } = renderHook(() => useCommandHandler());

        act(() => {
            result.current.handleLoginClick();
        });

        expect(useAppStore.getState().user).toBeNull();
    });

    it("工程师登录缺少凭证时提示错误，并在 3 秒后自动清除", async () => {
        vi.useFakeTimers();

        vi.mocked(getStoredCredentials).mockReturnValue([]);

        const { result } = renderHook(() => useCommandHandler());

        act(() => {
            result.current.openLoginModal();
            result.current.handleRoleSelect("engineer");
            result.current.setPassword("bad");
        });

        await act(async () => {
            await result.current.handlePasswordSubmit();
        });

        expect(result.current.passwordError).toBe("title.errors.missingCredentials");

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.passwordError).toBeNull();
        vi.useRealTimers();
    });

    it("选择工程师/管理员时会自动聚焦密码输入框", () => {
        const { result } = renderHook(() => useCommandHandler());

        const input = document.createElement("input");
        const focusSpy = vi.spyOn(input, "focus");

        act(() => {
            // 仅用于测试：人为注入 ref.current 以覆盖 focus 分支
            (result.current.passwordInputRef as unknown as { current: HTMLInputElement | null }).current =
                input;
        });

        act(() => {
            result.current.openLoginModal();
            result.current.handleRoleSelect("engineer");
        });

        expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it("全屏/退出失败时会通过 notifyError 提示", async () => {
        vi.mocked(toggleFullscreen).mockRejectedValueOnce(new Error("fs-fail"));
        vi.mocked(closeWindow).mockRejectedValueOnce(new Error("close-fail"));

        const { result } = renderHook(() => useCommandHandler());

        await act(async () => {
            await result.current.handleToggleFullscreen();
            await result.current.handleCloseWindow();
        });

        expect(notifyError).toHaveBeenCalledWith(
            "title.errors.fullscreenFailed",
            "fs-fail",
        );
        expect(notifyError).toHaveBeenCalledWith(
            "title.errors.closeFailed",
            "close-fail",
        );
    });

    it("密码错误时提示 invalidPassword", async () => {
        vi.mocked(getStoredCredentials).mockReturnValue([
            { role: "engineer", passwordHash: "hash" },
        ]);
        vi.mocked(verifyPassword).mockResolvedValue(false);

        const { result } = renderHook(() => useCommandHandler());

        act(() => {
            result.current.openLoginModal();
            result.current.handleRoleSelect("engineer");
            result.current.setPassword("bad");
        });

        await act(async () => {
            await result.current.handlePasswordSubmit();
        });

        expect(result.current.passwordError).toBe("title.errors.invalidPassword");
    });
});

