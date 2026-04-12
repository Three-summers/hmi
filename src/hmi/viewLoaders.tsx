import { lazy, type LazyExoticComponent } from "react";
import type { ViewId } from "@/types";

const JobsView = lazy(() => import("@/components/views/Jobs"));
const RecipesView = lazy(() => import("@/components/views/Recipes"));
const FilesView = lazy(() => import("@/components/views/Files"));
const SetupView = lazy(() => import("@/components/views/Setup"));
const AlarmsView = lazy(() => import("@/components/views/Alarms"));
const HelpView = lazy(() => import("@/components/views/Help"));

export const HMI_VIEW_COMPONENTS: Record<
    ViewId,
    LazyExoticComponent<() => JSX.Element>
> = {
    jobs: JobsView,
    recipes: RecipesView,
    files: FilesView,
    setup: SetupView,
    alarms: AlarmsView,
    help: HelpView,
};
