/**
 * 导航状态管理 Store
 *
 * 负责管理应用的“主视图导航”相关状态，主要包含：
 * - 当前视图（currentView）
 * - 视图历史（viewHistory），用于“返回上一页”
 * - 未完成任务提示（unfinishedTasks），用于导航按钮高亮
 * - 各视图的对话框状态（viewDialogStates），切换视图时保持不变
 *
 * 该 Store 仅管理前端 UI 状态，不直接依赖后端通信；导航 ID 遵循 SEMI E95 的 HMI 视图划分。
 *
 * @module navigationStore
 */

import { create } from "zustand";
import type { ViewId } from "@/types";
import type { SetupTabId } from "@/constants";

/**
 * 空对话框状态占位类型
 *
 * 用于明确表示“该视图没有额外对话框状态”，避免误用 `any`。
 */
type EmptyDialogState = Record<string, never>;

/**
 * Setup 视图对话框状态
 *
 * 目前仅包含“当前激活 Tab”，后续可扩展更多字段。
 */
export type SetupViewDialogState = {
    activeTab: SetupTabId;
};

/**
 * 各视图的对话框状态映射表
 *
 * 通过映射表约束：不同视图对应不同的对话框状态结构，避免跨视图误读/误写。
 */
export type ViewDialogStateMap = {
    jobs: EmptyDialogState;
    system: EmptyDialogState;
    monitor: EmptyDialogState;
    recipes: EmptyDialogState;
    files: EmptyDialogState;
    setup: SetupViewDialogState;
    alarms: EmptyDialogState;
    help: EmptyDialogState;
};

/**
 * 视图对话框状态集合（允许缺省）
 *
 * - 视图未打开过/没有对话框状态时，对应 key 可能不存在。
 * - 取值时需处理 `undefined`。
 */
type ViewDialogStates = Partial<ViewDialogStateMap>;

/**
 * 导航 Store 的状态与动作定义
 *
 * 说明：这里的“动作”均是纯前端状态更新，组件应通过 selector 订阅所需字段，避免无关重渲染。
 */
interface NavigationState {
    /** 当前正在显示的主视图 ID */
    currentView: ViewId;

    /**
     * 切换当前视图
     *
     * @param view - 目标视图 ID
     * @description 切换主导航视图，同时记录历史以支持返回操作。
     */
    setCurrentView: (view: ViewId) => void;

    /** 视图历史栈（用于返回），仅保存最近若干条 */
    viewHistory: ViewId[];

    /**
     * 返回到上一个视图
     *
     * @description 弹出历史栈并切换；若历史为空则回到默认视图。
     */
    goBack: () => void;

    /**
     * 未完成任务标记
     *
     * 当某视图存在“未完成流程/需要确认的对话框”等情况时，可设置为 true，
     * 以在导航按钮上显示高亮提示。
     */
    unfinishedTasks: Record<ViewId, boolean>;

    /**
     * 设置指定视图的未完成任务标记
     *
     * @param view - 目标视图 ID
     * @param hasTask - 是否存在未完成任务
     */
    setUnfinishedTask: (view: ViewId, hasTask: boolean) => void;

    /**
     * 每个视图的对话框状态（导航时应保持不变）
     *
     * 例如：Setup 的当前 Tab、各页面弹窗的临时 UI 状态等。
     */
    viewDialogStates: ViewDialogStates;

    /**
     * 写入指定视图的对话框状态
     *
     * @param view - 目标视图 ID
     * @param state - 该视图的对话框状态；传入 `undefined` 表示清除
     */
    setViewDialogState: <V extends ViewId>(
        view: V,
        state: ViewDialogStateMap[V] | undefined,
    ) => void;

    /**
     * 读取指定视图的对话框状态
     *
     * @param view - 目标视图 ID
     * @returns 对应视图的对话框状态；若未设置则为 `undefined`
     */
    getViewDialogState: <V extends ViewId>(
        view: V,
    ) => ViewDialogStateMap[V] | undefined;
}

/**
 * 导航状态 Store Hook（Zustand）
 *
 * 使用建议：
 * - 在组件中通过 selector 订阅所需字段，避免全量订阅导致无关重渲染。
 * - 对话框状态使用 `setViewDialogState/getViewDialogState` 进行按视图隔离。
 *
 * @returns 导航状态的 Store Hook
 */
export const useNavigationStore = create<NavigationState>((set, get) => ({
    // 当前视图
    currentView: "jobs",
    setCurrentView: (view) =>
        set((state) => ({
            // 这里是直接替换
            currentView: view,
            // 记录历史：将“切换前的视图”压栈，并限制历史长度，避免无限增长。
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

    viewDialogStates: {},
    setViewDialogState: (view, dialogState) =>
        set((state) => ({
            viewDialogStates: {
                ...state.viewDialogStates,
                [view]: dialogState,
            },
        })),
    getViewDialogState: (view) => get().viewDialogStates[view],
}));
