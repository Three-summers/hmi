import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";
import { useAlarmStore } from "@/stores";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "zh" },
    }),
}));

// TitlePanel 的职责：拼装布局与消息条；子组件在各自文件内单测覆盖，这里做隔离以减少噪音。
vi.mock("../InfoSection", () => ({
    InfoSection: () => <div data-testid="info-section" />,
}));
vi.mock("../TitleSection", () => ({
    TitleSection: () => <div data-testid="title-section" />,
}));
vi.mock("../CommandSection", () => ({
    CommandSection: () => <div data-testid="command-section" />,
}));

describe("TitlePanel", () => {
    beforeEach(() => {
        useAlarmStore.setState({
            alarms: [],
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,
        });
        vi.clearAllMocks();
    });

    it("无未确认告警时显示系统运行提示", async () => {
        const { TitlePanel } = await import("../TitlePanel");
        render(<TitlePanel currentView="monitor" />);

        expect(screen.getByText("system.running")).toBeInTheDocument();
    });

    it("存在未确认告警时显示最新告警消息与时间", async () => {
        vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("TIME");

        useAlarmStore.setState({
            alarms: [
                {
                    id: "alarm-1",
                    severity: "alarm",
                    message: "boom",
                    timestamp: new Date(),
                    acknowledged: false,
                },
            ],
            unacknowledgedAlarmCount: 1,
            unacknowledgedWarningCount: 0,
        });

        const { TitlePanel } = await import("../TitlePanel");
        render(<TitlePanel currentView="monitor" />);

        expect(screen.getByText("boom")).toBeInTheDocument();
        expect(screen.getByText("TIME")).toBeInTheDocument();
    });
});

