import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useState,
} from "react";
import type { CommandButtonConfig, ViewId } from "@/types";
import { useConfirm } from "@/hooks";

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
type ConfirmState = ReturnType<typeof useConfirm>["confirmState"];
type ShowConfirm = ReturnType<typeof useConfirm>["showConfirm"];

interface ViewCommandActions {
    setViewCommands: (viewId: ViewId, commands: CommandButtonConfig[]) => void;
    clearViewCommands: (viewId: ViewId) => void;
    showConfirm: ShowConfirm;
}

interface ViewCommandState {
    commandsByView: CommandsByView;
    confirmState: ConfirmState;
    closeConfirm: () => void;
    handleConfirm: () => void;
}

const ViewCommandActionsContext = createContext<ViewCommandActions | null>(null);
const ViewCommandStateContext = createContext<ViewCommandState | null>(null);

export function ViewCommandProvider({ children }: { children: React.ReactNode }) {
    const [commandsByView, setCommandsByView] = useState<CommandsByView>(() => ({}));
    const { confirmState, showConfirm, closeConfirm, handleConfirm } =
        useConfirm();

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
        return { commandsByView, confirmState, closeConfirm, handleConfirm };
    }, [closeConfirm, commandsByView, confirmState, handleConfirm]);

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

