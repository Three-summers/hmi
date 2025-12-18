import { memo, Suspense, useEffect, useMemo, useState } from "react";
import type { ViewId } from "@/types";
import { HMI_VIEW_COMPONENTS } from "@/hmi/viewRegistry";
import styles from "./InfoPanel.module.css";
import { ViewContextProvider } from "./ViewContext";

interface InfoPanelProps {
    currentView: ViewId;
}

/**
 * 信息面板：承载主页面视图。
 *
 * 关键策略：视图缓存（Keep Alive）
 * - 首次访问后将视图保持挂载，切换时仅通过 `hidden` 隐藏；
 * - 这样可在返回时保留各页面的本地状态（例如：文件选中、目录展开、图表缩放等）。
 *
 * 副作用控制：
 * - 每个视图外包一层 `ViewContextProvider`，让视图内部可通过 `useIsViewActive()` 判断是否可见；
 * - 建议在不可见时暂停动画/轮询/定时器，避免后台消耗资源。
 */
export function InfoPanel({ currentView }: InfoPanelProps) {
    const [mountedViews, setMountedViews] = useState<Set<ViewId>>(
        () => new Set([currentView]),
    );

    useEffect(() => {
        setMountedViews((prev) => {
            if (prev.has(currentView)) return prev;
            const next = new Set(prev);
            next.add(currentView);
            return next;
        });
    }, [currentView]);

    const mountedViewList = useMemo(() => {
        return Array.from(mountedViews);
    }, [mountedViews]);

    return (
        <div className={styles.infoPanel}>
            <div className={styles.viewContainer}>
                {mountedViewList.map((viewId) => (
                    <KeptAliveView
                        key={viewId}
                        viewId={viewId}
                        isActive={viewId === currentView}
                    />
                ))}
            </div>
        </div>
    );
}

const KeptAliveView = memo(function KeptAliveView({
    viewId,
    isActive,
}: {
    viewId: ViewId;
    isActive: boolean;
}) {
    // 性能优化：InfoPanel 切换视图时，只有“刚切出/刚切入”的两个视图需要更新可见性；
    // 其它隐藏视图不应因父组件重渲染而重复执行渲染逻辑。
    const ViewComponent = HMI_VIEW_COMPONENTS[viewId];

    return (
        <div className={styles.viewWrapper} hidden={!isActive}>
            <ViewContextProvider value={{ viewId, isActive }}>
                <Suspense
                    fallback={
                        <div className={styles.placeholder}>Loading...</div>
                    }
                >
                    <ViewComponent />
                </Suspense>
            </ViewContextProvider>
        </div>
    );
});
