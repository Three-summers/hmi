import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ViewId } from "@/types";
import styles from "./InfoPanel.module.css";
import { ViewContextProvider } from "./ViewContext";

const JobsView = lazy(() => import("@/components/views/Jobs"));
const SystemView = lazy(() => import("@/components/views/System"));
const MonitorView = lazy(() => import("@/components/views/Monitor"));
const RecipesView = lazy(() => import("@/components/views/Recipes"));
const FilesView = lazy(() => import("@/components/views/Files"));
const SetupView = lazy(() => import("@/components/views/Setup"));
const AlarmsView = lazy(() => import("@/components/views/Alarms"));
const HelpView = lazy(() => import("@/components/views/Help"));

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
const viewComponents: Record<
    ViewId,
    React.LazyExoticComponent<() => JSX.Element>
> = {
    jobs: JobsView,
    system: SystemView,
    monitor: MonitorView,
    recipes: RecipesView,
    files: FilesView,
    setup: SetupView,
    alarms: AlarmsView,
    help: HelpView,
};

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
                {mountedViewList.map((viewId) => {
                    const ViewComponent = viewComponents[viewId];
                    const isActive = viewId === currentView;

                    return (
                        <div
                            key={viewId}
                            className={styles.viewWrapper}
                            hidden={!isActive}
                        >
                            <ViewContextProvider
                                value={{ viewId, isActive }}
                            >
                                <Suspense
                                    fallback={
                                        <div className={styles.placeholder}>
                                            Loading...
                                        </div>
                                    }
                                >
                                    <ViewComponent />
                                </Suspense>
                            </ViewContextProvider>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
