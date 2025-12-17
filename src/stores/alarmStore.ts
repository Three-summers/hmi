import { create } from "zustand";
import type { AlarmItem } from "@/types";

interface AlarmState {
    alarms: AlarmItem[];

    // Counts for nav button highlights
    unacknowledgedAlarmCount: number;
    unacknowledgedWarningCount: number;

    // Actions
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

export const useAlarmStore = create<AlarmState>((set) => ({
    alarms: [],
    unacknowledgedAlarmCount: 0,
    unacknowledgedWarningCount: 0,

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
                unacknowledgedAlarmCount: newAlarms.filter(
                    (a) => !a.acknowledged && a.severity === "alarm",
                ).length,
                unacknowledgedWarningCount: newAlarms.filter(
                    (a) => !a.acknowledged && a.severity === "warning",
                ).length,
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
                unacknowledgedAlarmCount: newAlarms.filter(
                    (a) => !a.acknowledged && a.severity === "alarm",
                ).length,
                unacknowledgedWarningCount: newAlarms.filter(
                    (a) => !a.acknowledged && a.severity === "warning",
                ).length,
            };
        }),

    acknowledgeAll: () =>
        set((state) => ({
            alarms: state.alarms.map((a) => ({ ...a, acknowledged: true })),
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,
        })),

    clearAlarm: (id) =>
        set((state) => {
            const newAlarms = state.alarms.filter((a) => a.id !== id);
            return {
                alarms: newAlarms,
                unacknowledgedAlarmCount: newAlarms.filter(
                    (a) => !a.acknowledged && a.severity === "alarm",
                ).length,
                unacknowledgedWarningCount: newAlarms.filter(
                    (a) => !a.acknowledged && a.severity === "warning",
                ).length,
            };
        }),

    clearAll: () =>
        set({
            alarms: [],
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,
        }),

    clearAcknowledged: () =>
        set((state) => {
            const newAlarms = state.alarms.filter((a) => !a.acknowledged);
            return {
                alarms: newAlarms,
                // Counts stay the same since we only cleared acknowledged ones
            };
        }),
}));
