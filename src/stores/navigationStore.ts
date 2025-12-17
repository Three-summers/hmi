import { create } from "zustand";
import type { ViewId } from "@/types";

interface NavigationState {
    currentView: ViewId;
    setCurrentView: (view: ViewId) => void;

    viewHistory: ViewId[];
    goBack: () => void;

    unfinishedTasks: Record<ViewId, boolean>;
    setUnfinishedTask: (view: ViewId, hasTask: boolean) => void;

    // 每个视图的对话框状态（导航时对话框应保持不变）
    viewDialogStates: Record<ViewId, unknown>;
    setViewDialogState: (view: ViewId, state: unknown) => void;
    getViewDialogState: (view: ViewId) => unknown;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
    // 当前视图
    currentView: "jobs",
    setCurrentView: (view) =>
        set((state) => ({
            // 这里是直接替换
            currentView: view,
            viewHistory: [...state.viewHistory, state.currentView].slice(-10),
        })),

    viewHistory: [],
    // 返回到上一个视图
    goBack: () =>
        set((state) => {
            const history = [...state.viewHistory];
            const previousView = history.pop();
            return {
                currentView: previousView || "jobs",
                viewHistory: history,
            };
        }),

    // 未完成任务，当有对话框存在时，对应视图会显示蓝色高亮，表示未完成任务
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
    setUnfinishedTask: (view, hasTask) =>
        set((state) => ({
            unfinishedTasks: {
                ...state.unfinishedTasks,
                [view]: hasTask,
            },
        })),

    viewDialogStates: {} as Record<ViewId, unknown>,
    setViewDialogState: (view, dialogState) =>
        set((state) => ({
            viewDialogStates: {
                ...state.viewDialogStates,
                [view]: dialogState,
            },
        })),
    getViewDialogState: (view) => get().viewDialogStates[view],
}));
