/**
 * InfoSection（信息区）
 *
 * 顶部栏左侧区域：展示通信状态（串口/TCP）与当前日期/时间。
 *
 * @module InfoSection
 */

import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useCommStore } from "@/stores";
import {
    ConnectIcon,
    DateIcon,
    NetworkIcon,
    SerialIcon,
} from "@/components/common/Icons";
import { StatusItem } from "./TitlePanelItems";
import styles from "./TitlePanel.module.css";

type StatusItemConfig = Omit<ComponentProps<typeof StatusItem>, "children"> & {
    key: string;
    render: () => ReactNode;
};

/**
 * 信息区组件
 *
 * - 每秒刷新一次日期/时间
 * - 使用 Zustand selector + shallow 订阅，避免无关状态变更触发重渲染
 */
export function InfoSection() {
    const { t, i18n } = useTranslation();
    const [dateTime, setDateTime] = useState(new Date());
    const { serialConnected, tcpConnected } = useCommStore(
        useShallow((state) => ({
            serialConnected: state.serialConnected,
            tcpConnected: state.tcpConnected,
        })),
    );

    const isConnected = serialConnected || tcpConnected;

    useEffect(() => {
        // 每秒刷新一次时间显示
        const timer = window.setInterval(() => {
            setDateTime(new Date());
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

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

    const getConnectionType = () => {
        if (serialConnected && tcpConnected) return t("title.commType.serialTcp");
        if (serialConnected) return t("title.commType.serial");
        if (tcpConnected) return t("title.commType.tcp");
        return t("title.commStatus.disconnected");
    };

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
                <span className={styles.commIndicator} data-connected={isConnected} />
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
                    <span className={styles.date}>{formatDate(dateTime)}</span>
                    <span className={styles.time}>{formatTime(dateTime)}</span>
                </>
            ),
        },
    ];

    return (
        <div className={styles.leftSection}>
            {statusItems.map(({ key, render, ...props }) => (
                <StatusItem key={key} {...props}>
                    {render()}
                </StatusItem>
            ))}
        </div>
    );
}

