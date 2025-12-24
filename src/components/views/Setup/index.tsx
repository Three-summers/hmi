/**
 * 设置视图 - 系统配置与偏好设置
 *
 * 提供系统配置、通信设置、用户偏好等功能。
 * 核心特性：
 * - 语言切换：支持中文/英文
 * - 主题切换：深色/浅色/高对比度
 * - 布局偏好：命令面板位置（左/右）
 * - 通信设置：串口/网络连接配置
 * - 日志查看：系统日志和事件记录
 *
 * @module Setup
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { Tabs } from "@/components/common";
import {
    LanguageIcon,
    PaletteIcon,
    LayoutIcon,
    LayoutRightIcon,
    InfoIcon,
    SerialIcon,
    NetworkIcon,
    LogIcon,
    ConnectIcon,
    CloseIcon,
} from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import {
    useRegisterViewCommands,
    useViewCommandActions,
} from "@/components/layout/ViewCommandContext";
import { useAppStore, useCommStore, useNavigationStore } from "@/stores";
import { useNotify, useStoreWhenActive } from "@/hooks";
import { COMM_CONFIG, THEME_ORDER } from "@/constants";
import styles from "./Setup.module.css";
import sharedStyles from "../shared.module.css";

export default function SetupView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { showConfirm } = useViewCommandActions();
    const { success, warning, error: notifyError } = useNotify();

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "connect",
                labelKey: "setup.connect",
                highlight: "attention",
                onClick: () =>
                    success(
                        t("notification.connected"),
                        t("notification.connectionEstablished"),
                    ),
            },
            {
                id: "disconnect",
                labelKey: "setup.disconnect",
                onClick: () =>
                    warning(
                        t("notification.disconnected"),
                        t("notification.connectionClosed"),
                    ),
            },
            {
                id: "save",
                labelKey: "common.save",
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
            debugLogBridgeEnabled: state.debugLogBridgeEnabled,
            setDebugLogBridgeEnabled: state.setDebugLogBridgeEnabled,
        })),
        { enabled: isViewActive },
    );

    const {
        serialConnected,
        tcpConnected,
        getSerialPorts,
        connectSerial,
        disconnectSerial,
        connectTcp,
        disconnectTcp,
    } = useStoreWhenActive(
        useCommStore,
        useShallow((state) => ({
            serialConnected: state.serialConnected,
            tcpConnected: state.tcpConnected,
            getSerialPorts: state.getSerialPorts,
            connectSerial: state.connectSerial,
            disconnectSerial: state.disconnectSerial,
            connectTcp: state.connectTcp,
            disconnectTcp: state.disconnectTcp,
        })),
        { enabled: isViewActive },
    );

    const [availablePorts, setAvailablePorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState("");
    const [baudRate, setBaudRate] = useState<number>(
        COMM_CONFIG.DEFAULT_BAUD_RATE,
    );
    const [tcpHost, setTcpHost] = useState("127.0.0.1");
    const [tcpPort, setTcpPort] = useState("502");
    const activeTab =
        useStoreWhenActive(
            useNavigationStore,
            (state) => state.viewDialogStates.setup?.activeTab,
            { enabled: isViewActive },
        ) ?? "settings";
    const setViewDialogState = useStoreWhenActive(
        useNavigationStore,
        (state) => state.setViewDialogState,
        { enabled: isViewActive },
    );

    useEffect(() => {
        let cancelled = false;

        const loadPorts = async () => {
            try {
                const ports = await getSerialPorts();
                if (!cancelled) setAvailablePorts(ports);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                notifyError(t("setup.errors.loadSerialPorts"), message);
                if (!cancelled) setAvailablePorts([]);
            }
        };

        loadPorts();
        return () => {
            cancelled = true;
        };
    }, [getSerialPorts, notifyError, t]);

    const handleSerialConnect = async () => {
        try {
            if (serialConnected) {
                await disconnectSerial();
            } else if (selectedPort) {
                await connectSerial({
                    port: selectedPort,
                    baudRate,
                    dataBits: 8,
                    stopBits: 1,
                    parity: "none",
                });
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            notifyError(t("setup.errors.serialOperationFailed"), message);
        }
    };

    const handleTcpConnect = async () => {
        try {
            if (tcpConnected) {
                await disconnectTcp();
            } else {
                const portNum = parseInt(tcpPort, 10);
                if (
                    isNaN(portNum) ||
                    portNum < COMM_CONFIG.TCP_PORT_MIN ||
                    portNum > COMM_CONFIG.TCP_PORT_MAX
                ) {
                    notifyError(t("setup.invalidPort"));
                    return;
                }
                await connectTcp({
                    host: tcpHost,
                    port: portNum,
                    timeoutMs: COMM_CONFIG.TCP_TIMEOUT_MS,
                });
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            notifyError(t("setup.errors.tcpOperationFailed"), message);
        }
    };

    return (
        <div className={sharedStyles.view}>
            <Tabs
                activeId={activeTab}
                onChange={(id) =>
                    setViewDialogState("setup", { activeTab: id })
                }
                tabs={[
                    {
                        id: "settings",
                        label: t("common.tabs.settings"),
                        content: (
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
                                            <span className={styles.optionIcon}>
                                                🇨🇳
                                            </span>
                                            {t("common.languages.zh")}
                                        </button>
                                        <button
                                            className={styles.optionButton}
                                            data-selected={language === "en"}
                                            onClick={() => setLanguage("en")}
                                        >
                                            <span className={styles.optionIcon}>
                                                🇺🇸
                                            </span>
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
                                            data-selected={
                                                commandPanelPosition === "right"
                                            }
                                            onClick={() =>
                                                setCommandPanelPosition("right")
                                            }
                                        >
                                            <LayoutRightIcon
                                                className={styles.optionIcon}
                                            />
                                            {t("setup.layoutRight")}
                                        </button>
                                        <button
                                            className={styles.optionButton}
                                            data-selected={
                                                commandPanelPosition === "left"
                                            }
                                            onClick={() =>
                                                setCommandPanelPosition("left")
                                            }
                                        >
                                            <LayoutIcon
                                                className={styles.optionIcon}
                                            />
                                            {t("setup.layoutLeft")}
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
                                            data-selected={
                                                debugLogBridgeEnabled
                                            }
                                            onClick={() =>
                                                setDebugLogBridgeEnabled(
                                                    !debugLogBridgeEnabled,
                                                )
                                            }
                                        >
                                            <LogIcon
                                                className={styles.optionIcon}
                                            />
                                            {t("setup.logBridge")}：
                                            {debugLogBridgeEnabled
                                                ? t("setup.enabled")
                                                : t("setup.disabled")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ),
                    },
                    {
                        id: "communication",
                        label: t("setup.communication"),
                        content: (
                            <div className={styles.setupGrid}>
                                <div className={styles.section}>
                                    <div className={styles.sectionHeader}>
                                        <div className={styles.sectionIcon}>
                                            <SerialIcon />
                                        </div>
                                        <div>
                                            <h3 className={styles.sectionTitle}>
                                                {t("setup.serial")}
                                            </h3>
                                            <p className={styles.sectionDesc}>
                                                {t("setup.serialDesc")}
                                            </p>
                                        </div>
                                    </div>

                                    <div className={styles.statusIndicator}>
                                        <span
                                            className={styles.statusDot}
                                            data-connected={serialConnected}
                                        />
                                        <span
                                            className={styles.statusText}
                                            data-connected={serialConnected}
                                        >
                                            {serialConnected
                                                ? t("setup.connected")
                                                : t("setup.disconnected")}
                                        </span>
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            {t("setup.port")}
                                        </label>
                                        <select
                                            value={selectedPort}
                                            onChange={(e) =>
                                                setSelectedPort(e.target.value)
                                            }
                                            className={styles.select}
                                            disabled={serialConnected}
                                        >
                                            <option value="">
                                                {t("setup.selectPort")}
                                            </option>
                                            {availablePorts.map((port) => (
                                                <option key={port} value={port}>
                                                    {port}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            {t("setup.baudRate")}
                                        </label>
                                        <select
                                            value={baudRate}
                                            onChange={(e) =>
                                                setBaudRate(
                                                    Number(e.target.value),
                                                )
                                            }
                                            className={styles.select}
                                            disabled={serialConnected}
                                        >
                                            {COMM_CONFIG.BAUD_RATES.map(
                                                (rate) => (
                                                    <option
                                                        key={rate}
                                                        value={rate}
                                                    >
                                                        {rate}
                                                    </option>
                                                ),
                                            )}
                                        </select>
                                    </div>

                                    <button
                                        className={styles.connectButton}
                                        onClick={handleSerialConnect}
                                        data-connected={serialConnected}
                                    >
                                        {serialConnected ? (
                                            <>
                                                <CloseIcon />
                                                {t("setup.disconnect")}
                                            </>
                                        ) : (
                                            <>
                                                <ConnectIcon />
                                                {t("setup.connect")}
                                            </>
                                        )}
                                    </button>
                                </div>

                                <div className={styles.section}>
                                    <div className={styles.sectionHeader}>
                                        <div className={styles.sectionIcon}>
                                            <NetworkIcon />
                                        </div>
                                        <div>
                                            <h3 className={styles.sectionTitle}>
                                                {t("setup.tcp")}
                                            </h3>
                                            <p className={styles.sectionDesc}>
                                                {t("setup.tcpDesc")}
                                            </p>
                                        </div>
                                    </div>

                                    <div className={styles.statusIndicator}>
                                        <span
                                            className={styles.statusDot}
                                            data-connected={tcpConnected}
                                        />
                                        <span
                                            className={styles.statusText}
                                            data-connected={tcpConnected}
                                        >
                                            {tcpConnected
                                                ? t("setup.connected")
                                                : t("setup.disconnected")}
                                        </span>
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            {t("setup.host")}
                                        </label>
                                        <input
                                            type="text"
                                            value={tcpHost}
                                            onChange={(e) =>
                                                setTcpHost(e.target.value)
                                            }
                                            className={styles.input}
                                            disabled={tcpConnected}
                                            placeholder="192.168.1.100"
                                        />
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            {t("setup.port")}
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={tcpPort}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (
                                                    val === "" ||
                                                    /^\d+$/.test(val)
                                                ) {
                                                    setTcpPort(val);
                                                }
                                            }}
                                            className={styles.input}
                                            disabled={tcpConnected}
                                            placeholder="9000"
                                        />
                                    </div>

                                    <button
                                        className={styles.connectButton}
                                        onClick={handleTcpConnect}
                                        data-connected={tcpConnected}
                                    >
                                        {tcpConnected ? (
                                            <>
                                                <CloseIcon />
                                                {t("setup.disconnect")}
                                            </>
                                        ) : (
                                            <>
                                                <ConnectIcon />
                                                {t("setup.connect")}
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
