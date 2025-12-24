/**
 * CommandSection（命令区）
 *
 * 顶部栏右侧区域：展示告警徽标与快捷操作按钮（主题/登录/缩放/全屏/退出）。
 * 同时承载“快速登录弹窗”和“缩放设置弹窗”的交互与渲染。
 *
 * @module CommandSection
 */

import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CommandButtonConfig, UserSession } from "@/types";
import { useCommandHandler } from "@/hooks";
import {
    AdminIcon,
    AlarmIcon,
    CloseIcon,
    EngineerIcon,
    FullscreenIcon,
    OperatorIcon,
    ThemeIcon,
    UserIcon,
    ZoomIcon,
} from "@/components/common/Icons";
import { ActionButton } from "./TitlePanelItems";
import styles from "./TitlePanel.module.css";

interface CommandSectionProps {
    /** 未确认告警数（severity=alarm） */
    unacknowledgedAlarmCount: number;
    /** 未确认警告数（severity=warning） */
    unacknowledgedWarningCount: number;
}

/** 快速登录角色：直接复用 `UserSession.role` 的联合类型 */
type QuickLoginRole = UserSession["role"];

export function CommandSection({
    unacknowledgedAlarmCount,
    unacknowledgedWarningCount,
}: CommandSectionProps) {
    const { t } = useTranslation();
    const {
        user,
        theme,
        cycleTheme,
        scaleOverride,
        setScaleOverride,
        resetScale,
        showLoginModal,
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
    } = useCommandHandler();

    const totalAlarms = unacknowledgedAlarmCount + unacknowledgedWarningCount;

    const scalePresets = useMemo(
        () => [
            { label: "75%", value: 0.75 },
            { label: "100%", value: 1.0 },
            { label: "125%", value: 1.25 },
            { label: "150%", value: 1.5 },
            { label: "200%", value: 2.0 },
        ],
        [],
    );

    const commandButtons = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "theme",
                labelKey: "common.theme",
                icon: <ThemeIcon />,
                onClick: cycleTheme,
                title: `${t("common.theme")}: ${t(`theme.${theme}`)}`,
                ariaLabel: t("common.theme"),
            },
            {
                id: "login",
                labelKey: "title.loginHere",
                icon: <UserIcon />,
                onClick: handleLoginClick,
                ariaLabel: t("title.loginHere"),
            },
            {
                id: "scale",
                labelKey: "common.scale",
                icon: <ZoomIcon />,
                onClick: openScaleModal,
                title: `${t("common.scale")}: ${Math.round(scaleOverride * 100)}%`,
                ariaLabel: t("common.scale"),
            },
            {
                id: "fullscreen",
                labelKey: "common.fullscreen",
                icon: <FullscreenIcon />,
                onClick: handleToggleFullscreen,
                title: t("common.fullscreen"),
                ariaLabel: t("common.fullscreen"),
            },
            {
                id: "exit",
                labelKey: "common.exit",
                icon: <CloseIcon />,
                onClick: handleCloseWindow,
                title: t("common.exit"),
                ariaLabel: t("common.exit"),
            },
        ],
        [
            cycleTheme,
            handleCloseWindow,
            handleLoginClick,
            handleToggleFullscreen,
            openScaleModal,
            scaleOverride,
            t,
            theme,
        ],
    );

    const quickLoginOptions: Array<{ role: QuickLoginRole; icon: ReactNode }> = [
        { role: "operator", icon: <OperatorIcon /> },
        { role: "engineer", icon: <EngineerIcon /> },
        { role: "admin", icon: <AdminIcon /> },
    ];

    return (
        <>
            <div className={styles.rightSection}>
                {totalAlarms > 0 && (
                    <div
                        className={styles.alarmBadge}
                        data-severity={
                            unacknowledgedAlarmCount > 0 ? "alarm" : "warning"
                        }
                    >
                        <AlarmIcon />
                        <span>{totalAlarms}</span>
                    </div>
                )}

                {commandButtons.map((cmd) => {
                    const icon = cmd.icon ?? null;

                    if (cmd.id === "login") {
                        return (
                            <ActionButton
                                key={cmd.id}
                                className={styles.loginButton}
                                icon={icon}
                                iconWrapperAs="div"
                                iconWrapperClassName={styles.userIcon}
                                title={cmd.title}
                                aria-label={cmd.ariaLabel}
                                data-logged-in={!!user}
                                onClick={cmd.onClick}
                            >
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
                            </ActionButton>
                        );
                    }

                    const className =
                        cmd.id === "theme"
                            ? styles.themeButton
                            : cmd.id === "scale"
                              ? styles.scaleButton
                              : cmd.id === "fullscreen"
                                ? styles.fullscreenButton
                                : cmd.id === "exit"
                                  ? styles.exitButton
                                  : styles.themeButton;

                    return (
                        <ActionButton
                            key={cmd.id}
                            className={className}
                            icon={icon}
                            title={cmd.title}
                            aria-label={cmd.ariaLabel}
                            onClick={cmd.onClick}
                        />
                    );
                })}
            </div>

            {showLoginModal && (
                <div className={styles.modalOverlay} onClick={closeLoginModal}>
                    <div
                        className={styles.loginModal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className={styles.modalTitle}>{t("title.loginHere")}</h3>
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
                                    <span>{t(`title.roles.${option.role}`)}</span>
                                </ActionButton>
                            ))}
                        </div>
                        {(pendingRole === "engineer" || pendingRole === "admin") && (
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
                                        if (passwordError) clearPasswordError();
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

            {showScaleModal && (
                <div className={styles.modalOverlay} onClick={closeScaleModal}>
                    <div
                        className={styles.scaleModal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className={styles.modalTitle}>{t("scale.title")}</h3>

                        <div className={styles.scalePresets}>
                            {scalePresets.map((preset) => (
                                <button
                                    key={preset.value}
                                    type="button"
                                    className={styles.scalePresetButton}
                                    data-active={
                                        Math.abs(scaleOverride - preset.value) < 0.01
                                    }
                                    onClick={() => setScaleOverride(preset.value)}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        <div className={styles.scaleSliderContainer}>
                            <input
                                type="range"
                                className={styles.scaleSlider}
                                min="0.75"
                                max="2.0"
                                step="0.05"
                                value={scaleOverride}
                                aria-label={t("common.scale")}
                                onChange={(e) =>
                                    setScaleOverride(Number.parseFloat(e.target.value))
                                }
                            />
                            <div className={styles.scaleValue}>
                                {Math.round(scaleOverride * 100)}%
                            </div>
                        </div>

                        <button
                            type="button"
                            className={styles.resetButton}
                            onClick={resetScale}
                        >
                            {t("scale.reset")}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
