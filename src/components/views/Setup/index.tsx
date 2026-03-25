/**
 * 设置视图 - 系统配置与偏好设置
 *
 * 提供系统配置、通信设置、用户偏好等功能。
 * 核心特性：
 * - 语言切换：支持中文/英文
 * - 主题切换：深色/浅色/高对比度
 * - 布局偏好：命令面板位置（左/右）
 * - 日志查看：系统日志和事件记录
 *
 * @module Setup
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import {
    LanguageIcon,
    PaletteIcon,
    LayoutIcon,
    LayoutRightIcon,
    InfoIcon,
    NetworkIcon,
    LogIcon,
    SpeedIcon,
} from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import {
    useRegisterViewCommands,
    useViewCommandActions,
} from "@/components/layout/ViewCommandContext";
import { useAppStore } from "@/stores";
import { useNotify, useStoreWhenActive } from "@/hooks";
import { THEME_ORDER } from "@/constants";
import styles from "./Setup.module.css";
import sharedStyles from "../shared.module.css";

export default function SetupView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { showConfirm } = useViewCommandActions();
    const { success, warning } = useNotify();

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "save",
                labelKey: "common.save",
                requiresLogin: true,
                highlight: "processing",
                onClick: () =>
                    success(
                        t("notification.settingsSaved"),
                        t("notification.configurationSaved"),
                    ),
            },
            {
                id: "reset",
                labelKey: "common.reset",
                requiresLogin: true,
                highlight: "warning",
                onClick: () =>
                    showConfirm(
                        t("setup.resetSettings"),
                        t("setup.resetConfirm"),
                        () =>
                            warning(
                                t("notification.settingsReset"),
                                t("notification.settingsRestoredToDefaults"),
                            ),
                    ),
            },
        ],
        [showConfirm, success, t, warning],
    );

    useRegisterViewCommands("setup", commands, isViewActive);

    const {
        language,
        setLanguage,
        theme,
        setTheme,
        commandPanelPosition,
        setCommandPanelPosition,
        visualEffects,
        setVisualEffects,
        debugLogBridgeEnabled,
        setDebugLogBridgeEnabled,
    } = useStoreWhenActive(
        useAppStore,
        useShallow((state) => ({
            language: state.language,
            setLanguage: state.setLanguage,
            theme: state.theme,
            setTheme: state.setTheme,
            commandPanelPosition: state.commandPanelPosition,
            setCommandPanelPosition: state.setCommandPanelPosition,
            visualEffects: state.visualEffects,
            setVisualEffects: state.setVisualEffects,
            debugLogBridgeEnabled: state.debugLogBridgeEnabled,
            setDebugLogBridgeEnabled: state.setDebugLogBridgeEnabled,
        })),
        { enabled: isViewActive },
    );

    return (
        <div className={sharedStyles.view}>
            <div className={styles.setupGrid}>
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <LanguageIcon />
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.language")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                {t("setup.languageDesc")}
                            </p>
                        </div>
                    </div>
                    <div className={styles.optionRow}>
                        <button
                            className={styles.optionButton}
                            data-selected={language === "zh"}
                            onClick={() => setLanguage("zh")}
                        >
                            <LanguageIcon className={styles.optionIcon} />
                            {t("common.languages.zh")}
                        </button>
                        <button
                            className={styles.optionButton}
                            data-selected={language === "en"}
                            onClick={() => setLanguage("en")}
                        >
                            <NetworkIcon className={styles.optionIcon} />
                            {t("common.languages.en")}
                        </button>
                    </div>
                </div>

                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <PaletteIcon />
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.theme")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                {t("common.theme")}
                            </p>
                        </div>
                    </div>
                    <div className={styles.optionRow}>
                        {THEME_ORDER.map((id) => (
                            <button
                                key={id}
                                className={styles.optionButton}
                                data-selected={theme === id}
                                onClick={() => setTheme(id)}
                            >
                                {t(`theme.${id}`)}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <LayoutIcon />
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.layout")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                {t("setup.layoutDesc")}
                            </p>
                        </div>
                    </div>
                    <div className={styles.optionRow}>
                        <button
                            className={styles.optionButton}
                            data-selected={commandPanelPosition === "right"}
                            onClick={() => setCommandPanelPosition("right")}
                        >
                            <LayoutRightIcon className={styles.optionIcon} />
                            {t("setup.layoutRight")}
                        </button>
                        <button
                            className={styles.optionButton}
                            data-selected={commandPanelPosition === "left"}
                            onClick={() => setCommandPanelPosition("left")}
                        >
                            <LayoutIcon className={styles.optionIcon} />
                            {t("setup.layoutLeft")}
                        </button>
                    </div>
                </div>

                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <SpeedIcon />
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.effects")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                {t("setup.effectsDesc")}
                            </p>
                        </div>
                    </div>
                    <div className={styles.optionRow}>
                        <button
                            className={styles.optionButton}
                            data-selected={visualEffects === "full"}
                            onClick={() => setVisualEffects("full")}
                        >
                            {t("setup.effectsStandard")}
                        </button>
                        <button
                            className={styles.optionButton}
                            data-selected={visualEffects === "reduced"}
                            onClick={() => setVisualEffects("reduced")}
                        >
                            {t("setup.effectsReduced")}
                        </button>
                    </div>
                </div>

                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <InfoIcon />
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.debug")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                {t("setup.debugDesc")}
                            </p>
                        </div>
                    </div>

                    <div className={styles.optionRow}>
                        <button
                            className={styles.optionButton}
                            data-selected={debugLogBridgeEnabled}
                            onClick={() =>
                                setDebugLogBridgeEnabled(
                                    !debugLogBridgeEnabled,
                                )
                            }
                        >
                            <LogIcon className={styles.optionIcon} />
                            {t("setup.logBridge")}：
                            {debugLogBridgeEnabled
                                ? t("setup.enabled")
                                : t("setup.disabled")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
