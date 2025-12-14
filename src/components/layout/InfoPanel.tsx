import { lazy, Suspense } from "react";
import type { ViewId } from "@/types";
import styles from "./InfoPanel.module.css";

// Lazy load views for better performance on Raspberry Pi
const JobsView = lazy(() => import("@/components/views/Jobs"));
const SystemView = lazy(() => import("@/components/views/System"));
const MonitorView = lazy(() => import("@/components/views/Monitor"));
const RecipesView = lazy(() => import("@/components/views/Recipes"));
const DatalogView = lazy(() => import("@/components/views/Datalog"));
const SetupView = lazy(() => import("@/components/views/Setup"));
const AlarmsView = lazy(() => import("@/components/views/Alarms"));
const HelpView = lazy(() => import("@/components/views/Help"));

interface InfoPanelProps {
  currentView: ViewId;
}

const viewComponents: Record<ViewId, React.LazyExoticComponent<() => JSX.Element>> = {
  jobs: JobsView,
  system: SystemView,
  monitor: MonitorView,
  recipes: RecipesView,
  datalog: DatalogView,
  setup: SetupView,
  alarms: AlarmsView,
  help: HelpView,
};

export function InfoPanel({ currentView }: InfoPanelProps) {
  const ViewComponent = viewComponents[currentView];

  return (
    <div className={styles.infoPanel}>
      <div className={styles.viewContainer}>
        <Suspense fallback={<div className={styles.placeholder}>Loading...</div>}>
          <ViewComponent />
        </Suspense>
      </div>
    </div>
  );
}
