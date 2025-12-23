/**
 * 标题面板（顶部栏）
 *
 * 展示全局状态与快捷操作入口，包括：
 * - 通信连接状态（串口/TCP）
 * - 当前时间
 * - 当前视图标题
 * - 主题切换、登录/登出、全屏、退出等快捷按钮
 * - 最新未确认告警/系统运行提示
 *
 * @module TitlePanel
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { ViewId, UserSession } from "@/types";
import { useAlarmStore, useCommStore, useAppStore } from "@/stores";
import { useNotify } from "@/hooks";
import { getStoredCredentials, verifyPassword } from "@/utils/auth";
import {
    AdminIcon,
    AlarmIcon,
    CloseIcon,
    ConnectIcon,
    DateIcon,
    EngineerIcon,
    FullscreenIcon,
    NetworkIcon,
    OkIcon,
    OperatorIcon,
    SerialIcon,
    ThemeIcon,
    UserIcon,
} from "@/components/common/Icons";
import { closeWindow, toggleFullscreen } from "@/platform/window";
import { ActionButton, StatusItem } from "./TitlePanelItems";
import styles from "./TitlePanel.module.css";

interface TitlePanelProps {
    /** 当前激活视图 */
    currentView: ViewId;
}

/** 快速登录角色：直接复用 `UserSession.role` 的联合类型 */
type QuickLoginRole = UserSession["role"];

type StatusItemConfig = Omit<ComponentProps<typeof StatusItem>, "children"> & {
    key: string;
    render: () => ReactNode;
};

type ActionButtonConfig = Omit<
    ComponentProps<typeof ActionButton>,
    "children"
> & {
    key: string;
    renderChildren?: () => ReactNode;
};

/**
 * 标题面板组件
 *
 * @param props - 组件属性
 * @returns 标题面板 JSX
 */
export function TitlePanel({ currentView }: TitlePanelProps) {
    const { t, i18n } = useTranslation();
    const { error: notifyError } = useNotify();
    const [dateTime, setDateTime] = useState(new Date());
    const { serialConnected, tcpConnected } = useCommStore(
        useShallow((state) => ({
            serialConnected: state.serialConnected,
            tcpConnected: state.tcpConnected,
        })),
    );
    const { unacknowledgedAlarmCount, unacknowledgedWarningCount, alarms } =
        useAlarmStore(
            useShallow((state) => ({
                unacknowledgedAlarmCount: state.unacknowledgedAlarmCount,
                unacknowledgedWarningCount: state.unacknowledgedWarningCount,
                alarms: state.alarms,
            })),
        );
    const { user, logout, theme, cycleTheme } = useAppStore(
        useShallow((state) => ({
            user: state.user,
            logout: state.logout,
            theme: state.theme,
            cycleTheme: state.cycleTheme,
        })),
    );
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [pendingRole, setPendingRole] = useState<QuickLoginRole | null>(null);
    const [password, setPassword] = useState("");
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [verifyingPassword, setVerifyingPassword] = useState(false);
    const passwordInputRef = useRef<HTMLInputElement>(null);

    const isConnected = serialConnected || tcpConnected;
    // 展示最新未确认告警（用于顶部消息条），无未确认告警则显示“系统运行中”
    const latestAlarm = alarms.find((a) => !a.acknowledged);

    useEffect(() => {
        // 每秒刷新一次时间显示
        const timer = setInterval(() => {
            setDateTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const resetLoginModalState = () => {
        setPendingRole(null);
        setPassword("");
        setPasswordError(null);
        setVerifyingPassword(false);
    };

    const openLoginModal = () => {
        resetLoginModalState();
        setShowLoginModal(true);
    };

    const closeLoginModal = () => {
        setShowLoginModal(false);
        resetLoginModalState();
    };

    /**
     * 按当前语言格式化日期
     *
     * @param date - 时间对象
     * @returns 格式化后的日期字符串
     */
    const formatDate = (date: Date) => {
        return date.toLocaleDateString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            },
        );
    };

    /**
     * 按当前语言格式化时间
     *
     * @param date - 时间对象
     * @returns 格式化后的时间字符串
     */
    const formatTime = (date: Date) => {
        return date.toLocaleTimeString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            },
        );
    };

    const handleLoginClick = () => {
        if (user) {
            logout();
        } else {
            openLoginModal();
        }
    };

    const handleQuickLogin = (role: QuickLoginRole) => {
        // 使用 getState 直接调用 action，避免为该回调引入额外订阅字段
        useAppStore.getState().login({
            id: role,
            name: t(`title.roles.${role}`),
            role,
        });
        closeLoginModal();
    };

    const handleRoleSelect = (role: QuickLoginRole) => {
        if (role === "operator") {
            handleQuickLogin(role);
            return;
        }

        setPendingRole(role);
        setPassword("");
        setPasswordError(null);
    };

    const handlePasswordSubmit = async () => {
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
    };

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
    }, [showLoginModal]);

    useEffect(() => {
        if (!showLoginModal) return;
        if (pendingRole !== "engineer" && pendingRole !== "admin") return;
        passwordInputRef.current?.focus();
    }, [showLoginModal, pendingRole]);

    const handleToggleFullscreen = async () => {
        try {
            await toggleFullscreen();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            notifyError(t("title.errors.fullscreenFailed"), message);
        }
    };

    const handleCloseWindow = async () => {
        try {
            await closeWindow();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            notifyError(t("title.errors.closeFailed"), message);
        }
    };

    const getConnectionType = () => {
        if (serialConnected && tcpConnected)
            return t("title.commType.serialTcp");
        if (serialConnected) return t("title.commType.serial");
        if (tcpConnected) return t("title.commType.tcp");
        return t("title.commStatus.disconnected");
    };

    const totalAlarms = unacknowledgedAlarmCount + unacknowledgedWarningCount;
    const commTypeText = getConnectionType();

    const commIcon = useMemo<ReactNode>(() => {
        if (serialConnected && tcpConnected) return <ConnectIcon />;
        if (serialConnected) return <SerialIcon />;
        if (tcpConnected) return <NetworkIcon />;
        return <ConnectIcon />;
    }, [serialConnected, tcpConnected]);

    const statusItems: StatusItemConfig[] = [
        {
            key: "comm",
            className: styles.commStatus,
            "data-connected": isConnected,
            icon: commIcon,
            iconClassName: styles.commIcon,
            contentClassName: styles.commInfo,
            trailing: (
                <span
                    className={styles.commIndicator}
                    data-connected={isConnected}
                />
            ),
            render: () => (
                <>
                    <span className={styles.commLabel}>
                        {isConnected
                            ? t("title.commStatus.connected")
                            : t("title.commStatus.disconnected")}
                    </span>
                    <span className={styles.commType}>{commTypeText}</span>
                </>
            ),
        },
        {
            key: "dateTime",
            className: styles.dateTimeContainer,
            icon: <DateIcon />,
            iconClassName: styles.dateIcon,
            contentClassName: styles.dateTimeInfo,
            render: () => (
                <>
                    <span className={styles.date}>
                        {formatDate(dateTime)}
                    </span>
                    <span className={styles.time}>
                        {formatTime(dateTime)}
                    </span>
                </>
            ),
        },
    ];

    const actionButtons: ActionButtonConfig[] = [
        {
            key: "theme",
            className: styles.themeButton,
            icon: <ThemeIcon />,
            onClick: cycleTheme,
            title: `${t("common.theme")}: ${t(`theme.${theme}`)}`,
            "aria-label": t("common.theme"),
        },
        {
            key: "login",
            className: styles.loginButton,
            icon: <UserIcon />,
            iconWrapperAs: "div",
            iconWrapperClassName: styles.userIcon,
            onClick: handleLoginClick,
            "data-logged-in": !!user,
            renderChildren: () => (
                <div className={styles.loginInfo}>
                    <span className={styles.loginLabel}>
                        {user ? user.name : t("title.loginHere")}
                    </span>
                    {user && (
                        <span className={styles.loginRole}>
                            {t(`title.roles.${user.role}`)}
                        </span>
                    )}
                </div>
            ),
        },
        {
            key: "fullscreen",
            className: styles.fullscreenButton,
            icon: <FullscreenIcon />,
            onClick: () => void handleToggleFullscreen(),
            title: t("common.fullscreen"),
            "aria-label": t("common.fullscreen"),
        },
        {
            key: "exit",
            className: styles.exitButton,
            icon: <CloseIcon />,
            onClick: () => void handleCloseWindow(),
            title: t("common.exit"),
            "aria-label": t("common.exit"),
        },
    ];

    const quickLoginOptions: Array<{ role: QuickLoginRole; icon: ReactNode }> =
        [
            { role: "operator", icon: <OperatorIcon /> },
            { role: "engineer", icon: <EngineerIcon /> },
            { role: "admin", icon: <AdminIcon /> },
        ];

    return (
        <div className={styles.titlePanel}>
            <div className={styles.topRow}>
                <div className={styles.leftSection}>
                    {statusItems.map(({ key, render, ...props }) => (
                        <StatusItem key={key} {...props}>
                            {render()}
                        </StatusItem>
                    ))}
                </div>

                <div className={styles.centerSection}>
                    <h1 className={styles.viewName}>
                        {t(`nav.${currentView}`)}
                    </h1>
                </div>

                <div className={styles.rightSection}>
                    {totalAlarms > 0 && (
                        <div
                            className={styles.alarmBadge}
                            data-severity={
                                unacknowledgedAlarmCount > 0
                                    ? "alarm"
                                    : "warning"
                            }
                        >
                            <AlarmIcon />
                            <span>{totalAlarms}</span>
                        </div>
                    )}

                    {actionButtons.map(
                        ({ key, renderChildren, ...buttonProps }) => (
                            <ActionButton key={key} {...buttonProps}>
                                {renderChildren?.()}
                            </ActionButton>
                        ),
                    )}
                </div>
            </div>

            <div
                className={styles.messageArea}
                data-severity={latestAlarm?.severity}
            >
                <div className={styles.messageIcon}>
                    {latestAlarm ? <AlarmIcon /> : <OkIcon />}
                </div>
                <span className={styles.messageText}>
                    {latestAlarm ? latestAlarm.message : t("system.running")}
                </span>
                {latestAlarm && (
                    <span className={styles.messageTime}>
                        {latestAlarm.timestamp.toLocaleTimeString()}
                    </span>
                )}
            </div>

            {showLoginModal && (
                <div
                    className={styles.modalOverlay}
                    onClick={closeLoginModal}
                >
                    <div
                        className={styles.loginModal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className={styles.modalTitle}>
                            {t("title.loginHere")}
                        </h3>
                        <div className={styles.loginOptions}>
                            {quickLoginOptions.map((option) => (
                                <ActionButton
                                    key={option.role}
                                    className={styles.loginOption}
                                    icon={option.icon}
                                    iconWrapperAs="span"
                                    iconWrapperClassName={styles.optionIcon}
                                    disabled={verifyingPassword}
                                    onClick={() => handleRoleSelect(option.role)}
                                >
                                    <span>
                                        {t(`title.roles.${option.role}`)}
                                    </span>
                                </ActionButton>
                            ))}
                        </div>
                        {(pendingRole === "engineer" ||
                            pendingRole === "admin") && (
                            <form
                                className={styles.passwordContainer}
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void handlePasswordSubmit();
                                }}
                            >
                                <input
                                    ref={passwordInputRef}
                                    className={styles.passwordInput}
                                    type="password"
                                    value={password}
                                    placeholder={t("title.passwordPlaceholder")}
                                    aria-label={t("title.passwordPlaceholder")}
                                    disabled={verifyingPassword}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (passwordError)
                                            setPasswordError(null);
                                    }}
                                />
                                {passwordError && (
                                    <div className={styles.errorMessage}>
                                        {passwordError}
                                    </div>
                                )}
                                <button
                                    className={styles.submitButton}
                                    type="submit"
                                    disabled={
                                        verifyingPassword ||
                                        password.trim().length === 0
                                    }
                                >
                                    {t("common.ok")}
                                </button>
                            </form>
                        )}
                        <button
                            className={styles.cancelButton}
                            onClick={closeLoginModal}
                            disabled={verifyingPassword}
                        >
                            {t("common.cancel")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
