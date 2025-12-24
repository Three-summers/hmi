import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "@/test/utils";
import { useAlarmStore } from "@/stores";
import type { AlarmItem } from "@/types";
import { AlarmList } from "./AlarmList";

describe("Monitor/AlarmList", () => {
    it("无告警时应显示空态", () => {
        useAlarmStore.getState().clearAll();
        render(<AlarmList />);

        expect(screen.getByText("报警列表")).toBeInTheDocument();
        expect(screen.getByText("无报警")).toBeInTheDocument();
    });

    it("默认仅显示未确认告警", () => {
        const now = new Date("2025-01-01T00:00:00Z");
        const alarms: AlarmItem[] = [
            {
                id: "alarm-1",
                severity: "alarm",
                message: "A1",
                timestamp: now,
                acknowledged: false,
            },
            {
                id: "alarm-2",
                severity: "warning",
                message: "W1",
                timestamp: now,
                acknowledged: true,
            },
        ];

        useAlarmStore.getState().setAlarms(alarms);
        render(<AlarmList />);

        expect(screen.getByText("A1")).toBeInTheDocument();
        expect(screen.queryByText("W1")).not.toBeInTheDocument();
    });

    it("includeAcknowledged=true 时应包含已确认告警", () => {
        const now = new Date("2025-01-01T00:00:00Z");
        const alarms: AlarmItem[] = [
            {
                id: "alarm-1",
                severity: "alarm",
                message: "A1",
                timestamp: now,
                acknowledged: false,
            },
            {
                id: "alarm-2",
                severity: "warning",
                message: "W1",
                timestamp: now,
                acknowledged: true,
            },
        ];

        useAlarmStore.getState().setAlarms(alarms);
        render(<AlarmList includeAcknowledged />);

        expect(screen.getByText("A1")).toBeInTheDocument();
        expect(screen.getByText("W1")).toBeInTheDocument();
    });
});

