import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, StatusIndicator, Button } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import {
    useRegisterViewCommands,
    useViewCommandActions,
} from "@/components/layout/ViewCommandContext";
import { useNotify } from "@/hooks";
import styles from "./System.module.css";
import sharedStyles from "../shared.module.css";

interface Subsystem {
    id: string;
    nameKey: string;
    status: "online" | "offline" | "warning" | "error";
    value?: number;
    valueKey?: string;
    unit?: string;
}

interface SystemInfo {
    uptime: number;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    temperature: number;
}

type SystemStatus = "loading" | "ready" | "error";

const demoSubsystems: Subsystem[] = [
    {
        id: "chamber",
        nameKey: "system.subsystemsDemo.chamber",
        status: "online",
        valueKey: "system.subsystemValues.ready",
    },
    {
        id: "vacuum",
        nameKey: "system.subsystemsDemo.vacuum",
        status: "online",
        value: 2.5e-6,
        unit: "Torr",
    },
    {
        id: "rf",
        nameKey: "system.subsystemsDemo.rf",
        status: "online",
        value: 500,
        unit: "W",
    },
    {
        id: "gas",
        nameKey: "system.subsystemsDemo.gas",
        status: "online",
        valueKey: "system.subsystemValues.active",
    },
    {
        id: "exhaust",
        nameKey: "system.subsystemsDemo.exhaust",
        status: "online",
        value: 85,
        unit: "%",
    },
    {
        id: "cooling",
        nameKey: "system.subsystemsDemo.cooling",
        status: "warning",
        value: 42,
        unit: "°C",
    },
    {
        id: "loader",
        nameKey: "system.subsystemsDemo.loader",
        status: "online",
        valueKey: "system.subsystemValues.home",
    },
    {
        id: "plc",
        nameKey: "system.subsystemsDemo.plc",
        status: "online",
        valueKey: "system.subsystemValues.run",
    },
];

const INITIAL_SYSTEM_INFO: SystemInfo = {
    uptime: 86400,
    cpuUsage: 45,
    memoryUsage: 62,
    diskUsage: 35,
    temperature: 48,
};

export default function SystemView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { showConfirm } = useViewCommandActions();
    const { success, error, info } = useNotify();

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "refresh",
                labelKey: "common.refresh",
                onClick: () =>
                    info(
                        t("notification.refreshing"),
                        t("notification.systemDataRefreshed"),
                    ),
            },
            {
                id: "start",
                labelKey: "common.start",
                highlight: "attention",
                onClick: () =>
                    success(
                        t("notification.systemStarted"),
                        t("notification.allSubsystemsOnline"),
                    ),
            },
            {
                id: "stop",
                labelKey: "common.stop",
                highlight: "alarm",
                onClick: () =>
                    showConfirm(
                        t("system.title"),
                        t("system.emergencyStopConfirm"),
                        () =>
                            error(
                                t("notification.systemStopped"),
                                t("notification.allSubsystemsShutdown"),
                            ),
                    ),
            },
            {
                id: "emergency",
                labelKey: "system.emergencyStop",
                highlight: "alarm",
                onClick: () =>
                    showConfirm(
                        t("system.emergencyStop"),
                        t("system.emergencyStopConfirm"),
                        () =>
                            error(
                                t("notification.emergencyStop"),
                                t("notification.allOperationsHalted"),
                            ),
                    ),
            },
        ],
        [error, info, showConfirm, success, t],
    );

    useRegisterViewCommands("system", commands, isViewActive);

    const [activeTab, setActiveTab] = useState<"overview" | "subsystems">(
        "overview",
    );
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [systemStatus, setSystemStatus] = useState<SystemStatus>("loading");
    const [systemError, setSystemError] = useState<string | null>(null);

    const refreshSystemInfo = useCallback(async (isInitial = false) => {
        try {
            if (isInitial) {
                setSystemStatus("loading");
            }
            setSystemError(null);
            await Promise.resolve();
            setSystemInfo((prev) => {
                const base = prev ?? INITIAL_SYSTEM_INFO;
                return {
                    ...base,
                    cpuUsage: Math.min(
                        100,
                        Math.max(
                            20,
                            base.cpuUsage + (Math.random() - 0.5) * 10,
                        ),
                    ),
                    memoryUsage: Math.min(
                        100,
                        Math.max(
                            40,
                            base.memoryUsage + (Math.random() - 0.5) * 5,
                        ),
                    ),
                    temperature: Math.min(
                        80,
                        Math.max(
                            35,
                            base.temperature + (Math.random() - 0.5) * 2,
                        ),
                    ),
                    uptime: base.uptime + 1,
                };
            });
            setSystemStatus("ready");
        } catch (error) {
            console.error("Failed to load system info:", error);
            const message =
                error instanceof Error ? error.message : String(error);
            setSystemStatus("error");
            setSystemError(message);
        }
    }, []);

    useEffect(() => {
        void refreshSystemInfo(true);
    }, [refreshSystemInfo]);

    useEffect(() => {
        // 视图缓存（Keep Alive）模式下，页面不会被卸载；这里在页面不可见时暂停定时刷新，避免后台占用资源。
        if (!isViewActive) return;
        // 出错/加载中时暂停自动刷新，避免后台反复失败；由用户点击重试恢复
        if (systemStatus !== "ready") return;

        const interval = setInterval(() => {
            void refreshSystemInfo();
        }, 1000);
        return () => clearInterval(interval);
    }, [isViewActive, refreshSystemInfo, systemStatus]);

    const formatUptime = (seconds: number) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return t("system.uptimeFormat", { days, hours, mins });
    };

    const formatValue = (sub: Subsystem) => {
        if (typeof sub.valueKey === "string") {
            return t(sub.valueKey) + (sub.unit ? ` ${sub.unit}` : "");
        }

        if (typeof sub.value === "number") {
            if (sub.value < 0.001) {
                return (
                    sub.value.toExponential(1) +
                    (sub.unit ? ` ${sub.unit}` : "")
                );
            }
            return sub.value.toFixed(1) + (sub.unit ? ` ${sub.unit}` : "");
        }
        return "--";
    };

    const getStatusColor = (status: Subsystem["status"]) => {
        switch (status) {
            case "online":
                return "attention";
            case "warning":
                return "warning";
            case "error":
                return "alarm";
            default:
                return "none";
        }
    };

    const onlineCount = demoSubsystems.filter(
        (s) => s.status === "online",
    ).length;

    const handleRetry = () => {
        void refreshSystemInfo(true);
    };

    const renderStatusPlaceholder = () => {
        if (systemStatus !== "error") {
            return (
                <div className={sharedStyles.emptyState}>
                    <StatusIndicator
                        status="processing"
                        label={t("system.loading")}
                    />
                </div>
            );
        }

        return (
            <div className={sharedStyles.emptyState}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <StatusIndicator
                        status="alarm"
                        label={t("system.errors.loadFailed")}
                    />
                    {systemError && (
                        <div
                            style={{
                                maxWidth: 560,
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                textAlign: "center",
                            }}
                        >
                            {systemError}
                        </div>
                    )}
                    <Button onClick={handleRetry}>{t("common.retry")}</Button>
                </div>
            </div>
        );
    };

    return (
        <div className={sharedStyles.view}>
            {systemStatus === "error" && systemInfo && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "center",
                        marginBottom: 12,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                            justifyContent: "center",
                        }}
                    >
                        <StatusIndicator
                            status="alarm"
                            label={t("system.errors.loadFailed")}
                        />
                        <Button onClick={handleRetry}>
                            {t("common.retry")}
                        </Button>
                    </div>
                </div>
            )}
            <Tabs
                activeId={activeTab}
                onChange={setActiveTab}
                tabs={[
                    {
                        id: "overview",
                        label: t("system.overview"),
                        content: !systemInfo ? (
                            renderStatusPlaceholder()
                        ) : (
                            <div
                                className={styles.systemGrid}
                                data-layout="single"
                            >
                                <div className={styles.overviewPanel}>
                                    <h3 className={styles.panelTitle}>
                                        {t("system.overview")}
                                    </h3>
                                    <div className={styles.overviewStats}>
                                        <div className={styles.overviewItem}>
                                            <div
                                                className={styles.overviewIcon}
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
                                                </svg>
                                            </div>
                                            <div
                                                className={styles.overviewInfo}
                                            >
                                                <span
                                                    className={
                                                        styles.overviewLabel
                                                    }
                                                >
                                                    {t("system.labels.uptime")}
                                                </span>
                                                <span
                                                    className={
                                                        styles.overviewValue
                                                    }
                                                >
                                                    {formatUptime(
                                                        systemInfo.uptime,
                                                    )}
                                                </span>
                                            </div>
                                        </div>

                                        <div className={styles.overviewItem}>
                                            <div
                                                className={styles.overviewIcon}
                                                data-status="attention"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                >
                                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                                </svg>
                                            </div>
                                            <div
                                                className={styles.overviewInfo}
                                            >
                                                <span
                                                    className={
                                                        styles.overviewLabel
                                                    }
                                                >
                                                    {t("system.subsystems")}
                                                </span>
                                                <span
                                                    className={
                                                        styles.overviewValue
                                                    }
                                                >
                                                    {t(
                                                        "system.subsystemsOnlineCount",
                                                        {
                                                            online: onlineCount,
                                                            total: demoSubsystems.length,
                                                        },
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={styles.resourceBars}>
                                        <div className={styles.resourceItem}>
                                            <div
                                                className={
                                                    styles.resourceHeader
                                                }
                                            >
                                                <span
                                                    className={
                                                        styles.resourceLabel
                                                    }
                                                >
                                                    {t("system.resources.cpu")}
                                                </span>
                                                <span
                                                    className={
                                                        styles.resourceValue
                                                    }
                                                >
                                                    {systemInfo.cpuUsage.toFixed(
                                                        0,
                                                    )}
                                                    %
                                                </span>
                                            </div>
                                            <div className={styles.resourceBar}>
                                                <div
                                                    className={
                                                        styles.resourceFill
                                                    }
                                                    style={{
                                                        width: `${systemInfo.cpuUsage}%`,
                                                    }}
                                                    data-level={
                                                        systemInfo.cpuUsage > 80
                                                            ? "high"
                                                            : systemInfo.cpuUsage >
                                                                60
                                                              ? "medium"
                                                              : "low"
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className={styles.resourceItem}>
                                            <div
                                                className={
                                                    styles.resourceHeader
                                                }
                                            >
                                                <span
                                                    className={
                                                        styles.resourceLabel
                                                    }
                                                >
                                                    {t(
                                                        "system.resources.memory",
                                                    )}
                                                </span>
                                                <span
                                                    className={
                                                        styles.resourceValue
                                                    }
                                                >
                                                    {systemInfo.memoryUsage.toFixed(
                                                        0,
                                                    )}
                                                    %
                                                </span>
                                            </div>
                                            <div className={styles.resourceBar}>
                                                <div
                                                    className={
                                                        styles.resourceFill
                                                    }
                                                    style={{
                                                        width: `${systemInfo.memoryUsage}%`,
                                                    }}
                                                    data-level={
                                                        systemInfo.memoryUsage >
                                                        80
                                                            ? "high"
                                                            : systemInfo.memoryUsage >
                                                                60
                                                              ? "medium"
                                                              : "low"
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className={styles.resourceItem}>
                                            <div
                                                className={
                                                    styles.resourceHeader
                                                }
                                            >
                                                <span
                                                    className={
                                                        styles.resourceLabel
                                                    }
                                                >
                                                    {t("system.resources.disk")}
                                                </span>
                                                <span
                                                    className={
                                                        styles.resourceValue
                                                    }
                                                >
                                                    {systemInfo.diskUsage.toFixed(
                                                        0,
                                                    )}
                                                    %
                                                </span>
                                            </div>
                                            <div className={styles.resourceBar}>
                                                <div
                                                    className={
                                                        styles.resourceFill
                                                    }
                                                    style={{
                                                        width: `${systemInfo.diskUsage}%`,
                                                    }}
                                                    data-level={
                                                        systemInfo.diskUsage >
                                                        80
                                                            ? "high"
                                                            : systemInfo.diskUsage >
                                                                60
                                                              ? "medium"
                                                              : "low"
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className={styles.resourceItem}>
                                            <div
                                                className={
                                                    styles.resourceHeader
                                                }
                                            >
                                                <span
                                                    className={
                                                        styles.resourceLabel
                                                    }
                                                >
                                                    {t(
                                                        "system.resources.temperature",
                                                    )}
                                                </span>
                                                <span
                                                    className={
                                                        styles.resourceValue
                                                    }
                                                >
                                                    {systemInfo.temperature.toFixed(
                                                        0,
                                                    )}
                                                    °C
                                                </span>
                                            </div>
                                            <div className={styles.resourceBar}>
                                                <div
                                                    className={
                                                        styles.resourceFill
                                                    }
                                                    style={{
                                                        width: `${(systemInfo.temperature / 80) * 100}%`,
                                                    }}
                                                    data-level={
                                                        systemInfo.temperature >
                                                        70
                                                            ? "high"
                                                            : systemInfo.temperature >
                                                                55
                                                              ? "medium"
                                                              : "low"
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ),
                    },
                    {
                        id: "subsystems",
                        label: t("system.subsystems"),
                        content: !systemInfo ? (
                            renderStatusPlaceholder()
                        ) : (
                            <div
                                className={styles.systemGrid}
                                data-layout="single"
                            >
                                <div className={styles.subsystemsPanel}>
                                    <h3 className={styles.panelTitle}>
                                        {t("system.subsystems")}
                                    </h3>
                                    <div className={styles.subsystemsList}>
                                        {demoSubsystems.map((sub) => (
                                            <div
                                                key={sub.id}
                                                className={styles.subsystemCard}
                                                data-status={getStatusColor(
                                                    sub.status,
                                                )}
                                            >
                                                <div
                                                    className={
                                                        styles.subsystemIndicator
                                                    }
                                                    data-status={getStatusColor(
                                                        sub.status,
                                                    )}
                                                />
                                                <div
                                                    className={
                                                        styles.subsystemInfo
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            styles.subsystemName
                                                        }
                                                    >
                                                        {t(sub.nameKey)}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.subsystemValue
                                                        }
                                                    >
                                                        {formatValue(sub)}
                                                    </span>
                                                </div>
                                                <div
                                                    className={
                                                        styles.subsystemStatus
                                                    }
                                                    data-status={getStatusColor(
                                                        sub.status,
                                                    )}
                                                >
                                                    {t(
                                                        `system.subsystemStatus.${sub.status}`,
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
