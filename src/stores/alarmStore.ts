/**
 * 告警状态管理 Store
 *
 * 负责维护告警列表及其“未确认”计数，并提供常用操作：
 * - 新增告警、确认单条/全部
 * - 清除单条/全部、清除已确认告警
 *
 * 同时具备持久化能力：告警历史写入 localStorage，并在恢复时将字符串时间戳还原为 Date。
 *
 * @module alarmStore
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AlarmItem } from "@/types";

interface AlarmState {
    /** 告警列表（通常按时间倒序） */
    alarms: AlarmItem[];

    /**
     * 未确认告警计数（severity=alarm）
     *
     * 用于导航栏/标题栏的徽标与高亮。
     */
    unacknowledgedAlarmCount: number;

    /**
     * 未确认警告计数（severity=warning）
     *
     * 用于导航栏/标题栏的徽标与高亮。
     */
    unacknowledgedWarningCount: number;

    // 动作
    /**
     * 替换告警列表
     *
     * @param alarms - 新的告警列表
     * @description 会同步更新“未确认”计数，并刷新内部 ID 计数器以避免冲突。
     */
    setAlarms: (alarms: AlarmItem[]) => void;

    /**
     * 新增告警
     *
     * @param alarm - 告警信息（由调用方提供 severity/message 等；id/timestamp/acknowledged 由 store 填充）
     */
    addAlarm: (
        alarm: Omit<AlarmItem, "id" | "timestamp" | "acknowledged">,
    ) => void;

    /**
     * 确认单条告警
     *
     * @param id - 告警 ID
     */
    acknowledgeAlarm: (id: string) => void;

    /** 确认全部告警 */
    acknowledgeAll: () => void;

    /**
     * 清除单条告警
     *
     * @param id - 告警 ID
     */
    clearAlarm: (id: string) => void;

    /** 清空告警列表 */
    clearAll: () => void;

    /** 清除已确认的告警（保留未确认） */
    clearAcknowledged: () => void;
}

/**
 * 告警 ID 自增计数器
 *
 * 注意：告警历史持久化后，应用重启时需要根据已有告警同步该计数器，
 * 否则可能出现 ID 重复（影响确认/清除操作）。
 */
let alarmIdCounter = 0;

/**
 * 统计“未确认”的告警/警告数量
 *
 * @param alarms - 告警列表
 * @returns 未确认告警数与未确认警告数
 */
function getUnacknowledgedCounts(alarms: AlarmItem[]) {
    const unacknowledgedAlarmCount = alarms.filter(
        (a) => !a.acknowledged && a.severity === "alarm",
    ).length;
    const unacknowledgedWarningCount = alarms.filter(
        (a) => !a.acknowledged && a.severity === "warning",
    ).length;

    return { unacknowledgedAlarmCount, unacknowledgedWarningCount };
}

/**
 * 同步告警 ID 自增计数器
 *
 * @param alarms - 当前告警列表（通常来自持久化恢复）
 * @description 从既有告警中解析出最大的序号，确保后续 `addAlarm` 生成的 ID 不会重复。
 */
function syncAlarmIdCounter(alarms: AlarmItem[]) {
    let maxId = 0;
    for (const alarm of alarms) {
        // ID 规则：alarm-<number>，若不匹配则跳过
        const match = /^alarm-(\d+)$/.exec(alarm.id);
        if (!match) continue;
        const value = Number.parseInt(match[1], 10);
        if (!Number.isNaN(value)) maxId = Math.max(maxId, value);
    }
    alarmIdCounter = maxId;
}

/**
 * 告警状态 Store Hook（Zustand）
 *
 * 说明：
 * - 使用 `persist` 将告警历史保存到 localStorage
 * - 恢复后会调用 `setAlarms` 同步计数与 ID 计数器
 *
 * @returns 告警状态的 Store Hook
 */
export const useAlarmStore = create<AlarmState>()(
    persist(
        (set) => ({
            alarms: [],
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,

            setAlarms: (alarms) => {
                syncAlarmIdCounter(alarms);
                set({ alarms, ...getUnacknowledgedCounts(alarms) });
            },

            addAlarm: (alarm) => {
                const newAlarm: AlarmItem = {
                    ...alarm,
                    id: `alarm-${++alarmIdCounter}`,
                    timestamp: new Date(),
                    acknowledged: false,
                };

                set((state) => {
                    const newAlarms = [newAlarm, ...state.alarms];
                    return {
                        alarms: newAlarms,
                        ...getUnacknowledgedCounts(newAlarms),
                    };
                });
            },

            acknowledgeAlarm: (id) =>
                set((state) => {
                    const newAlarms = state.alarms.map((a) =>
                        a.id === id ? { ...a, acknowledged: true } : a,
                    );
                    return {
                        alarms: newAlarms,
                        ...getUnacknowledgedCounts(newAlarms),
                    };
                }),

            acknowledgeAll: () =>
                set((state) => ({
                    alarms: state.alarms.map((a) => ({
                        ...a,
                        acknowledged: true,
                    })),
                    unacknowledgedAlarmCount: 0,
                    unacknowledgedWarningCount: 0,
                })),

            clearAlarm: (id) =>
                set((state) => {
                    const newAlarms = state.alarms.filter((a) => a.id !== id);
                    return {
                        alarms: newAlarms,
                        ...getUnacknowledgedCounts(newAlarms),
                    };
                }),

            clearAll: () => {
                alarmIdCounter = 0;
                set({
                    alarms: [],
                    unacknowledgedAlarmCount: 0,
                    unacknowledgedWarningCount: 0,
                });
            },

            clearAcknowledged: () =>
                set((state) => ({
                    alarms: state.alarms.filter((a) => !a.acknowledged),
                })),
        }),
        {
            name: "hmi-alarm-storage",
            partialize: (state) => ({ alarms: state.alarms }),
            storage: createJSONStorage(() => localStorage, {
                reviver: (key, value) => {
                    if (
                        key === "timestamp" &&
                        typeof value === "string" &&
                        value.length > 0
                    ) {
                        // 持久化时 Date 会被序列化为字符串，这里恢复为 Date 以便 UI 格式化展示
                        return new Date(value);
                    }
                    return value;
                },
            }),
            onRehydrateStorage: () => (state) => {
                if (state?.alarms) {
                    state.setAlarms(state.alarms);
                }
            },
        },
    ),
);
