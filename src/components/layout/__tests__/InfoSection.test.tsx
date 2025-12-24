import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";
import { useCommStore } from "@/stores";
import { InfoSection } from "../InfoSection";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "zh" },
    }),
}));

describe("InfoSection", () => {
    it.each([
        {
            name: "串口连接",
            serialConnected: true,
            tcpConnected: false,
            expectedType: "title.commType.serial",
            expectedStatus: "title.commStatus.connected",
        },
        {
            name: "TCP 连接",
            serialConnected: false,
            tcpConnected: true,
            expectedType: "title.commType.tcp",
            expectedStatus: "title.commStatus.connected",
        },
        {
            name: "串口 + TCP 同时连接",
            serialConnected: true,
            tcpConnected: true,
            expectedType: "title.commType.serialTcp",
            expectedStatus: "title.commStatus.connected",
        },
        {
            name: "未连接",
            serialConnected: false,
            tcpConnected: false,
            expectedType: "title.commStatus.disconnected",
            expectedStatus: "title.commStatus.disconnected",
        },
    ])("$name 时展示通信状态与类型", ({ serialConnected, tcpConnected, expectedType, expectedStatus }) => {
        vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function () {
            return `DATE:${this.getTime()}`;
        });
        vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function () {
            return `TIME:${this.getTime()}`;
        });

        useCommStore.setState({ serialConnected, tcpConnected });

        render(<InfoSection />);

        expect(screen.getByText(expectedStatus)).toBeInTheDocument();
        expect(screen.getByText(expectedType)).toBeInTheDocument();
        expect(screen.getByText(/^DATE:/)).toBeInTheDocument();
        expect(screen.getByText(/^TIME:/)).toBeInTheDocument();
    });

    it("会每秒刷新时间显示", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

        vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function () {
            return `DATE:${this.getTime()}`;
        });
        vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function () {
            return `TIME:${this.getSeconds()}`;
        });

        useCommStore.setState({ serialConnected: false, tcpConnected: false });

        render(<InfoSection />);
        expect(screen.getByText("TIME:0")).toBeInTheDocument();

        vi.setSystemTime(new Date("2025-01-01T00:00:01Z"));
        vi.advanceTimersByTime(1000);

        expect(screen.getByText("TIME:1")).toBeInTheDocument();
        vi.useRealTimers();
    });
});

