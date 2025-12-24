import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@/test/utils";
import { useAppStore } from "@/stores";
import { CommandSection } from "../CommandSection";
import { closeWindow, toggleFullscreen } from "@/platform/window";
import { getStoredCredentials, verifyPassword } from "@/utils/auth";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "zh" },
    }),
}));

vi.mock("@/hooks/useNotify", () => ({
    useNotify: () => ({
        success: vi.fn(),
        error: vi.fn(),
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

describe("CommandSection", () => {
    beforeEach(() => {
        useAppStore.setState({ user: null, theme: "dark", scaleOverride: 1.0 });
        vi.clearAllMocks();
    });

    it("告警数 > 0 时显示徽标", () => {
        render(
            <CommandSection unacknowledgedAlarmCount={1} unacknowledgedWarningCount={2} />,
        );
        expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("点击主题按钮会切换主题", () => {
        render(
            <CommandSection unacknowledgedAlarmCount={0} unacknowledgedWarningCount={0} />,
        );

        expect(useAppStore.getState().theme).toBe("dark");
        fireEvent.click(screen.getByLabelText("common.theme"));
        expect(useAppStore.getState().theme).toBe("light");
    });

    it("点击缩放按钮可打开弹窗并应用预设", () => {
        render(
            <CommandSection unacknowledgedAlarmCount={0} unacknowledgedWarningCount={0} />,
        );

        fireEvent.click(screen.getByLabelText("common.scale"));
        expect(screen.getByText("scale.title")).toBeInTheDocument();

        const slider = screen
            .getAllByLabelText("common.scale")
            .find((el) => el.tagName === "INPUT") as HTMLInputElement;
        expect(slider.value).toBe("1");

        fireEvent.click(screen.getByRole("button", { name: "125%" }));
        expect(slider.value).toBe("1.25");

        fireEvent.click(screen.getByRole("button", { name: "scale.reset" }));
        expect(slider.value).toBe("1");
    });

    it("点击登录按钮可打开弹窗，并可快速登录操作员", () => {
        render(
            <CommandSection unacknowledgedAlarmCount={0} unacknowledgedWarningCount={0} />,
        );

        fireEvent.click(screen.getByLabelText("title.loginHere"));
        expect(screen.getByText("title.loginHere")).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "title.roles.operator" }),
        );

        expect(useAppStore.getState().user?.role).toBe("operator");
        // 弹窗关闭：取消按钮不再存在
        expect(screen.queryByText("common.cancel")).not.toBeInTheDocument();
    });

    it("已登录时再次点击登录按钮会登出", () => {
        useAppStore.setState({
            user: { id: "operator", name: "operator", role: "operator" },
        });

        render(
            <CommandSection unacknowledgedAlarmCount={0} unacknowledgedWarningCount={0} />,
        );

        fireEvent.click(screen.getByLabelText("title.loginHere"));
        expect(useAppStore.getState().user).toBeNull();
    });

    it("点击全屏/退出按钮会触发窗口操作", () => {
        render(
            <CommandSection unacknowledgedAlarmCount={0} unacknowledgedWarningCount={0} />,
        );

        fireEvent.click(screen.getByLabelText("common.fullscreen"));
        fireEvent.click(screen.getByLabelText("common.exit"));

        expect(vi.mocked(toggleFullscreen)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(closeWindow)).toHaveBeenCalledTimes(1);
    });

    it("工程师登录密码错误时显示错误提示", async () => {
        vi.mocked(getStoredCredentials).mockReturnValue([
            { role: "engineer", passwordHash: "hash" },
        ]);
        vi.mocked(verifyPassword).mockResolvedValue(false);

        render(
            <CommandSection unacknowledgedAlarmCount={0} unacknowledgedWarningCount={0} />,
        );

        fireEvent.click(screen.getByLabelText("title.loginHere"));
        fireEvent.click(
            screen.getByRole("button", { name: "title.roles.engineer" }),
        );

        fireEvent.change(screen.getByLabelText("title.passwordPlaceholder"), {
            target: { value: "bad" },
        });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "common.ok" }));
        });

        expect(
            await screen.findByText("title.errors.invalidPassword"),
        ).toBeInTheDocument();
    });
});

