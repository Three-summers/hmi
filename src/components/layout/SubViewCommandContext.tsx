import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useState,
} from "react";
import type { CommandButtonConfig, ViewId } from "@/types";

/**
 * SubViewCommandContext
 *
 * 目的：让主视图内部的“子页面/Tab”（例如 Monitor 的 SpectrumAnalyzer/Overview）也能注册自己的命令集合。
 *
 * 设计要点：
 * - InfoPanel/ Tabs 默认 keepMounted：视图与 tab 在切换时通常不会卸载，只是 hidden；
 *   因此子命令必须支持在 `enabled=false` 时清理，避免切换 tab 后残留命令。
 * - 与 ViewCommandContext 一致，拆分为 actions/state 两个 Context，减少 keep-alive 场景下的无关重渲染。
 *
 * 约定：
 * - 命令数据仍使用 CommandButtonConfig，CommandPanel 会合并显示主命令 + 子命令。
 * - confirm 弹窗仍由 ViewCommandContext 统一管理；子命令如需确认，可直接调用 useViewCommandActions().showConfirm。
 */

type SubCommandsByView = Partial<Record<ViewId, CommandButtonConfig[]>>;

interface SubViewCommandActions {
    setSubViewCommands: (viewId: ViewId, commands: CommandButtonConfig[]) => void;
    clearSubViewCommands: (viewId: ViewId) => void;
}

interface SubViewCommandState {
    subCommandsByView: SubCommandsByView;
}

const SubViewCommandActionsContext = createContext<SubViewCommandActions | null>(
    null,
);
const SubViewCommandStateContext = createContext<SubViewCommandState | null>(
    null,
);

export function SubViewCommandProvider({ children }: { children: React.ReactNode }) {
    const [subCommandsByView, setSubCommandsByView] = useState<SubCommandsByView>(
        () => ({}),
    );

    const setSubViewCommands = useCallback(
        (viewId: ViewId, commands: CommandButtonConfig[]) => {
            setSubCommandsByView((prev) => {
                if (prev[viewId] === commands) return prev;
                return { ...prev, [viewId]: commands };
            });
        },
        [],
    );

    const clearSubViewCommands = useCallback((viewId: ViewId) => {
        setSubCommandsByView((prev) => {
            if (!prev[viewId]) return prev;
            const next = { ...prev };
            delete next[viewId];
            return next;
        });
    }, []);

    const actionsValue = useMemo<SubViewCommandActions>(() => {
        return { setSubViewCommands, clearSubViewCommands };
    }, [clearSubViewCommands, setSubViewCommands]);

    const stateValue = useMemo<SubViewCommandState>(() => {
        return { subCommandsByView };
    }, [subCommandsByView]);

    return (
        <SubViewCommandActionsContext.Provider value={actionsValue}>
            <SubViewCommandStateContext.Provider value={stateValue}>
                {children}
            </SubViewCommandStateContext.Provider>
        </SubViewCommandActionsContext.Provider>
    );
}

export function useSubViewCommandActions(): SubViewCommandActions {
    const ctx = useContext(SubViewCommandActionsContext);
    if (!ctx) {
        throw new Error(
            "useSubViewCommandActions 必须在 <SubViewCommandProvider> 内使用",
        );
    }
    return ctx;
}

export function useSubViewCommandState(): SubViewCommandState {
    const ctx = useContext(SubViewCommandStateContext);
    if (!ctx) {
        throw new Error(
            "useSubViewCommandState 必须在 <SubViewCommandProvider> 内使用",
        );
    }
    return ctx;
}

/**
 * 子页面侧注册命令入口：与 ViewCommandContext 一致使用 useLayoutEffect，
 * 但额外支持在 enabled=false 时主动清理，适配 Tabs keepMounted 的隐藏切换模式。
 *
 * @param viewId - 视图 ID（用于隔离 keep-alive 下多个主视图的子命令互相覆盖）
 * @param commands - 子页面命令按钮配置
 * @param enabled - 是否启用注册（建议传入 useIsViewActive() && activeTab===...）
 */
export function useRegisterSubViewCommands(
    viewId: ViewId,
    commands: CommandButtonConfig[],
    enabled = true,
) {
    const { setSubViewCommands, clearSubViewCommands } = useSubViewCommandActions();

    useLayoutEffect(() => {
        if (!enabled) {
            clearSubViewCommands(viewId);
            return;
        }

        setSubViewCommands(viewId, commands);
        return () => {
            clearSubViewCommands(viewId);
        };
    }, [clearSubViewCommands, commands, enabled, setSubViewCommands, viewId]);
}

