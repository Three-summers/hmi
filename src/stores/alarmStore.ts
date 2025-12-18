import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AlarmItem } from "@/types";

interface AlarmState {
    alarms: AlarmItem[];

    // Counts for nav button highlights
    unacknowledgedAlarmCount: number;
    unacknowledgedWarningCount: number;

    // Actions
    setAlarms: (alarms: AlarmItem[]) => void;
    addAlarm: (
        alarm: Omit<AlarmItem, "id" | "timestamp" | "acknowledged">,
    ) => void;
    acknowledgeAlarm: (id: string) => void;
    acknowledgeAll: () => void;
    clearAlarm: (id: string) => void;
    clearAll: () => void;
    clearAcknowledged: () => void;
}

let alarmIdCounter = 0;

function getUnacknowledgedCounts(alarms: AlarmItem[]) {
    const unacknowledgedAlarmCount = alarms.filter(
        (a) => !a.acknowledged && a.severity === "alarm",
    ).length;
    const unacknowledgedWarningCount = alarms.filter(
        (a) => !a.acknowledged && a.severity === "warning",
    ).length;

    return { unacknowledgedAlarmCount, unacknowledgedWarningCount };
}

function syncAlarmIdCounter(alarms: AlarmItem[]) {
    let maxId = 0;
    for (const alarm of alarms) {
        const match = /^alarm-(\d+)$/.exec(alarm.id);
        if (!match) continue;
        const value = Number.parseInt(match[1], 10);
        if (!Number.isNaN(value)) maxId = Math.max(maxId, value);
    }
    alarmIdCounter = maxId;
}

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
