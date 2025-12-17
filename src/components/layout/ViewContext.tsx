import { createContext, useContext } from "react";
import type { ViewId } from "@/types";

/**
 * 视图上下文：用于在“视图缓存（Keep Alive）”模式下，给各个页面提供当前是否激活的信息。
 *
 * 设计目的：
 * - 页面在切换时不卸载（保持用户操作与本地状态），但部分页面存在高频渲染/动画/轮询等副作用；
 * - 通过 `isActive` 让页面在不可见时主动暂停耗时逻辑，在再次激活时恢复。
 */
export interface ViewContextValue {
    viewId: ViewId;
    isActive: boolean;
}

const ViewContext = createContext<ViewContextValue | null>(null);

export function ViewContextProvider({
    value,
    children,
}: {
    value: ViewContextValue;
    children: React.ReactNode;
}) {
    return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

/**
 * 获取当前组件所在视图是否处于激活状态。
 *
 * 约定：
 * - 仅在被 `ViewContextProvider` 包裹的视图组件内部使用；
 * - 若未提供上下文，默认认为是激活状态，避免破坏独立渲染能力。
 */
export function useIsViewActive(): boolean {
    const ctx = useContext(ViewContext);
    return ctx ? ctx.isActive : true;
}

