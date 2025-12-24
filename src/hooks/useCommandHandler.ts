/**
 * useCommandHandler
 *
 * 将 TitlePanel/CommandSection 中的交互逻辑抽离为 Hook，降低布局组件复杂度：
 * - 主题切换、登录/登出、缩放弹窗、全屏、退出
 * - 登录校验（工程师/管理员密码）、错误提示与 ESC 关闭
 *
 * @module useCommandHandler
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { ThemeId, UserSession } from "@/types";
import { useAppStore } from "@/stores";
import { useNotify } from "@/hooks/useNotify";
import { getStoredCredentials, verifyPassword } from "@/utils/auth";
import { closeWindow, toggleFullscreen } from "@/platform/window";

/** 快速登录角色：直接复用 `UserSession.role` 的联合类型 */
export type QuickLoginRole = UserSession["role"];

export interface UseCommandHandlerReturn {
    user: UserSession | null;
    theme: ThemeId;
    cycleTheme: () => void;
    scaleOverride: number;
    setScaleOverride: (scale: number) => void;
    resetScale: () => void;

    showLoginModal: boolean;
    openLoginModal: () => void;
    closeLoginModal: () => void;
    handleLoginClick: () => void;

    pendingRole: QuickLoginRole | null;
    verifyingPassword: boolean;
    password: string;
    passwordError: string | null;
    passwordInputRef: RefObject<HTMLInputElement>;
    handleRoleSelect: (role: QuickLoginRole) => void;
    handlePasswordSubmit: () => Promise<void>;
    setPassword: (value: string) => void;
    clearPasswordError: () => void;

    showScaleModal: boolean;
    openScaleModal: () => void;
    closeScaleModal: () => void;

    handleToggleFullscreen: () => Promise<void>;
    handleCloseWindow: () => Promise<void>;
}

export function useCommandHandler(): UseCommandHandlerReturn {
    const { t } = useTranslation();
    const { error: notifyError } = useNotify();
    const {
        user,
        login,
        logout,
        theme,
        cycleTheme,
        scaleOverride,
        setScaleOverride,
        resetScale,
    } = useAppStore(
        useShallow((state) => ({
            user: state.user,
            login: state.login,
            logout: state.logout,
            theme: state.theme,
            cycleTheme: state.cycleTheme,
            scaleOverride: state.scaleOverride,
            setScaleOverride: state.setScaleOverride,
            resetScale: state.resetScale,
        })),
    );

    const [showLoginModal, setShowLoginModal] = useState(false);
    const [showScaleModal, setShowScaleModal] = useState(false);
    const [pendingRole, setPendingRole] = useState<QuickLoginRole | null>(null);
    const [password, setPassword] = useState("");
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [verifyingPassword, setVerifyingPassword] = useState(false);
    const passwordInputRef = useRef<HTMLInputElement>(null);

    const resetLoginModalState = useCallback(() => {
        setPendingRole(null);
        setPassword("");
        setPasswordError(null);
        setVerifyingPassword(false);
    }, []);

    const openLoginModal = useCallback(() => {
        resetLoginModalState();
        setShowLoginModal(true);
    }, [resetLoginModalState]);

    const closeLoginModal = useCallback(() => {
        setShowLoginModal(false);
        resetLoginModalState();
    }, [resetLoginModalState]);

    const openScaleModal = useCallback(() => setShowScaleModal(true), []);
    const closeScaleModal = useCallback(() => setShowScaleModal(false), []);

    const handleLoginClick = useCallback(() => {
        if (user) {
            logout();
            return;
        }
        openLoginModal();
    }, [logout, openLoginModal, user]);

    const handleQuickLogin = useCallback(
        (role: QuickLoginRole) => {
            // 使用 store action（函数引用稳定），避免为该回调引入额外订阅字段
            login({
                id: role,
                name: t(`title.roles.${role}`),
                role,
            });
            closeLoginModal();
        },
        [closeLoginModal, login, t],
    );

    const handleRoleSelect = useCallback(
        (role: QuickLoginRole) => {
            if (role === "operator") {
                handleQuickLogin(role);
                return;
            }

            setPendingRole(role);
            setPassword("");
            setPasswordError(null);
        },
        [handleQuickLogin],
    );

    const clearPasswordError = useCallback(() => setPasswordError(null), []);

    const handlePasswordSubmit = useCallback(async () => {
        if (pendingRole !== "engineer" && pendingRole !== "admin") return;

        setVerifyingPassword(true);
        setPasswordError(null);

        const storedCredentials = getStoredCredentials();
        const credential = storedCredentials.find(
            (item) => item.role === pendingRole,
        );

        if (!credential) {
            setPasswordError(t("title.errors.missingCredentials"));
            setVerifyingPassword(false);
            return;
        }

        const ok = await verifyPassword(password, credential.passwordHash);
        if (!ok) {
            setPasswordError(t("title.errors.invalidPassword"));
            setVerifyingPassword(false);
            return;
        }

        setVerifyingPassword(false);
        handleQuickLogin(pendingRole);
    }, [handleQuickLogin, password, pendingRole, t]);

    useEffect(() => {
        if (!passwordError) return;

        const timer = window.setTimeout(() => {
            setPasswordError(null);
        }, 3000);

        return () => window.clearTimeout(timer);
    }, [passwordError]);

    useEffect(() => {
        if (!showLoginModal) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            closeLoginModal();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [closeLoginModal, showLoginModal]);

    useEffect(() => {
        if (!showScaleModal) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            closeScaleModal();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [closeScaleModal, showScaleModal]);

    useEffect(() => {
        if (!showLoginModal) return;
        if (pendingRole !== "engineer" && pendingRole !== "admin") return;
        passwordInputRef.current?.focus();
    }, [pendingRole, showLoginModal]);

    const handleToggleFullscreen = useCallback(async () => {
        try {
            await toggleFullscreen();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notifyError(t("title.errors.fullscreenFailed"), message);
        }
    }, [notifyError, t]);

    const handleCloseWindow = useCallback(async () => {
        try {
            await closeWindow();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notifyError(t("title.errors.closeFailed"), message);
        }
    }, [notifyError, t]);

    return {
        user,
        theme,
        cycleTheme,
        scaleOverride,
        setScaleOverride,
        resetScale,

        showLoginModal,
        openLoginModal,
        closeLoginModal,
        handleLoginClick,

        pendingRole,
        verifyingPassword,
        password,
        passwordError,
        passwordInputRef,
        handleRoleSelect,
        handlePasswordSubmit,
        setPassword,
        clearPasswordError,

        showScaleModal,
        openScaleModal,
        closeScaleModal,

        handleToggleFullscreen,
        handleCloseWindow,
    };
}
