import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@/test/utils";
import { useAlarmStore, useNavigationStore } from "@/stores";
import { NavPanel } from "@/components/layout/NavPanel";
import { CommandPanel } from "@/components/layout/CommandPanel";
import {
    ViewCommandProvider,
    useViewCommandActions,
} from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";

function getNavButton(id: string) {
    return document.querySelector(`button[data-id="${id}"]`);
}

function ConfirmTrigger({ title }: { title: string }) {
    const { showConfirm } = useViewCommandActions();
    return (
        <button
            type="button"
            onClick={() => showConfirm(title, "MESSAGE", () => {})}
        >
            打开确认对话框
        </button>
    );
}

function LayoutUnderTest() {
    const currentView = useNavigationStore((state) => state.currentView);
    const setCurrentView = useNavigationStore((state) => state.setCurrentView);

    return (
        <ViewCommandProvider>
            <SubViewCommandProvider>
                <NavPanel currentView={currentView} onViewChange={setCurrentView} />
                <CommandPanel currentView={currentView} />
                <ConfirmTrigger title={`TITLE:${currentView}`} />
            </SubViewCommandProvider>
        </ViewCommandProvider>
    );
}

describe("CommandPanel Confirm（SEMI E95：可切页、按视图持久化）", () => {
    beforeEach(() => {
        useAlarmStore.setState({
            alarms: [],
            unacknowledgedAlarmCount: 0,
            unacknowledgedWarningCount: 0,
        });
        useNavigationStore.setState({
            currentView: "jobs",
            viewHistory: [],
            unfinishedTasks: {
                jobs: false,
                system: false,
                monitor: false,
                recipes: false,
                files: false,
                setup: false,
                alarms: false,
                help: false,
            },
            viewDialogStates: {},
        });
    });

    it("切换视图时：对话框隐藏但状态保留；导航按钮高亮提示未完成任务", async () => {
        render(<LayoutUnderTest />);

        // Jobs：打开确认对话框
        fireEvent.click(screen.getByRole("button", { name: "打开确认对话框" }));
        expect(screen.getByText("TITLE:jobs")).toBeInTheDocument();
        expect(useNavigationStore.getState().unfinishedTasks.jobs).toBe(true);

        const jobsBtn = getNavButton("jobs");
        expect(jobsBtn).toHaveAttribute("data-highlight", "processing");

        // 切换到 Monitor：对话框不显示，但 Jobs 仍保持“未完成任务”高亮
        fireEvent.click(getNavButton("monitor") as Element);
        expect(screen.queryByText("TITLE:jobs")).not.toBeInTheDocument();
        expect(useNavigationStore.getState().unfinishedTasks.jobs).toBe(true);

        expect(getNavButton("jobs")).toHaveAttribute(
            "data-highlight",
            "processing",
        );

        // 切回 Jobs：对话框恢复
        fireEvent.click(getNavButton("jobs") as Element);
        expect(await screen.findByText("TITLE:jobs")).toBeInTheDocument();

        // 取消：清理对话框与未完成任务提示
        fireEvent.click(screen.getByRole("button", { name: "取消" }));
        expect(screen.queryByText("TITLE:jobs")).not.toBeInTheDocument();
        expect(useNavigationStore.getState().unfinishedTasks.jobs).toBe(false);
        expect(getNavButton("jobs")).not.toHaveAttribute("data-highlight");
    });

    it("不同视图可各自保留未确认对话框，互不影响", () => {
        render(<LayoutUnderTest />);

        // Jobs 打开对话框
        fireEvent.click(screen.getByRole("button", { name: "打开确认对话框" }));
        expect(screen.getByText("TITLE:jobs")).toBeInTheDocument();
        expect(useNavigationStore.getState().unfinishedTasks.jobs).toBe(true);

        // 切换到 Monitor 并打开另一个对话框
        fireEvent.click(getNavButton("monitor") as Element);
        fireEvent.click(screen.getByRole("button", { name: "打开确认对话框" }));
        expect(screen.getByText("TITLE:monitor")).toBeInTheDocument();
        expect(useNavigationStore.getState().unfinishedTasks.monitor).toBe(true);
        expect(useNavigationStore.getState().unfinishedTasks.jobs).toBe(true);

        // 切回 Jobs：应显示 Jobs 的对话框（Monitor 的对话框隐藏）
        fireEvent.click(getNavButton("jobs") as Element);
        expect(screen.getByText("TITLE:jobs")).toBeInTheDocument();
        expect(screen.queryByText("TITLE:monitor")).not.toBeInTheDocument();
    });
});
