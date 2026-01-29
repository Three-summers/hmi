import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useState,
} from "react";
import type { CommandButtonConfig, ViewId } from "@/types";
import { useNavigationStore } from "@/stores";

/**
 * ViewCommandContext
 *
 * 目的：让各个视图（Monitor/Alarms/Jobs/...）自行声明并注册 CommandButtonConfig[]，
 * CommandPanel 只负责“读取当前视图命令并渲染”，从而避免在 CommandPanel 内硬编码全量配置。
 *
 * 性能约束（Keep Alive 场景）：
 * - InfoPanel 会缓存已访问视图，多个视图会长期挂载；
 * - 若把 confirmState/commandsByView 等易变化数据与注册函数放在同一个 Context，
 *   会导致打开确认弹窗或其它视图更新命令时触发所有视图重渲染。
 *
 * 解决：拆分为两个 Context
 * - Actions：只包含稳定引用的注册函数与 showConfirm（供视图调用）
 * - State：包含 commandsByView 与 confirmState（主要供 CommandPanel 消费）
 */

type CommandsByView = Partial<Record<ViewId, CommandButtonConfig[]>>;

/** 确认对话框状态（按视图隔离） */
type ConfirmState = {
    /** 是否打开（用于表达语义；实际渲染以 state 是否存在为准） */
    isOpen: boolean;
    /** 标题 */
    title: string;
    /** 提示消息 */
    message: string;
    /** 确认后的回调函数 */
    onConfirm: () => void;
};

type ConfirmStatesByView = Partial<Record<ViewId, ConfirmState>>;

type ShowConfirm = (title: string, message: string, onConfirm: () => void) => void;

interface ViewCommandActions {
    setViewCommands: (viewId: ViewId, commands: CommandButtonConfig[]) => void;
    clearViewCommands: (viewId: ViewId) => void;
    showConfirm: ShowConfirm;
}

interface ViewCommandState {
    commandsByView: CommandsByView;
    confirmStatesByView: ConfirmStatesByView;
    closeConfirm: (viewId: ViewId) => void;
    handleConfirm: (viewId: ViewId) => void;
}

const ViewCommandActionsContext = createContext<ViewCommandActions | null>(null);
const ViewCommandStateContext = createContext<ViewCommandState | null>(null);

export function ViewCommandProvider({ children }: { children: React.ReactNode }) {
    const [commandsByView, setCommandsByView] = useState<CommandsByView>(() => ({}));
    const [confirmStatesByView, setConfirmStatesByView] =
        useState<ConfirmStatesByView>(() => ({}));

    // 打开确认弹窗：按当前视图写入状态，实现“切页隐藏/切回恢复”
    const showConfirm = useCallback<ShowConfirm>(
        (title: string, message: string, onConfirm: () => void) => {
            const viewId = useNavigationStore.getState().currentView;
            setConfirmStatesByView((prev) => ({
                ...prev,
                [viewId]: { isOpen: true, title, message, onConfirm },
            }));
            // SEMI E95：其他功能区有未完成任务（如打开的对话框）→ 中蓝色高亮提示
            useNavigationStore.getState().setUnfinishedTask(viewId, true);
        },
        [],
    );

    // 关闭确认弹窗：按视图清理，不影响其他视图的未确认对话框
    const closeConfirm = useCallback((viewId: ViewId) => {
        setConfirmStatesByView((prev) => {
            if (!prev[viewId]) return prev;
            const next = { ...prev };
            delete next[viewId];
            return next;
        });
        useNavigationStore.getState().setUnfinishedTask(viewId, false);
    }, []);

    // 执行确认：先回调，再关闭弹窗（并清理导航高亮）
    const handleConfirm = useCallback(
        (viewId: ViewId) => {
            const state = confirmStatesByView[viewId];
            if (!state) return;
            state.onConfirm();
            closeConfirm(viewId);
        },
        [closeConfirm, confirmStatesByView],
    );

    const setViewCommands = useCallback(
        (viewId: ViewId, commands: CommandButtonConfig[]) => {
            setCommandsByView((prev) => {
                if (prev[viewId] === commands) return prev;
                return { ...prev, [viewId]: commands };
            });
        },
        [],
    );

    const clearViewCommands = useCallback((viewId: ViewId) => {
        setCommandsByView((prev) => {
            if (!prev[viewId]) return prev;
            const next = { ...prev };
            delete next[viewId];
            return next;
        });
    }, []);

    const actionsValue = useMemo<ViewCommandActions>(() => {
        return { setViewCommands, clearViewCommands, showConfirm };
    }, [clearViewCommands, setViewCommands, showConfirm]);

    const stateValue = useMemo<ViewCommandState>(() => {
        return {
            commandsByView,
            confirmStatesByView,
            closeConfirm,
            handleConfirm,
        };
    }, [closeConfirm, commandsByView, confirmStatesByView, handleConfirm]);

    return (
        <ViewCommandActionsContext.Provider value={actionsValue}>
            <ViewCommandStateContext.Provider value={stateValue}>
                {children}
            </ViewCommandStateContext.Provider>
        </ViewCommandActionsContext.Provider>
    );
}

export function useViewCommandActions(): ViewCommandActions {
    const ctx = useContext(ViewCommandActionsContext);
    if (!ctx) {
        throw new Error(
            "useViewCommandActions 必须在 <ViewCommandProvider> 内使用",
        );
    }
    return ctx;
}

export function useViewCommandState(): ViewCommandState {
    const ctx = useContext(ViewCommandStateContext);
    if (!ctx) {
        throw new Error(
            "useViewCommandState 必须在 <ViewCommandProvider> 内使用",
        );
    }
    return ctx;
}

/**
 * 视图侧注册命令入口：使用 useLayoutEffect 以减少切换视图时命令面板闪烁。
 *
 * @param viewId - 视图 ID
 * @param commands - 命令按钮配置
 * @param enabled - 是否启用注册（建议传入 useIsViewActive()）
 */
export function useRegisterViewCommands(
    viewId: ViewId,
    commands: CommandButtonConfig[],
    enabled = true,
) {
    const { setViewCommands } = useViewCommandActions();

    useLayoutEffect(() => {
        if (!enabled) return;
        setViewCommands(viewId, commands);
    }, [commands, enabled, setViewCommands, viewId]);
}
