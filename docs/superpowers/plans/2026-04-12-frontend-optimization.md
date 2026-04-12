# Frontend Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the HMI frontend for low-power Tauri devices by shrinking shell subscriptions, separating view loaders from navigation metadata, deferring Files chart work until it is actually needed, and verifying that hidden chart subtrees release work cleanly.

**Architecture:** Keep the existing SEMI E95 shell and Keep-Alive model, but move expensive work behind smaller boundaries. The shell gets a tiny document-sync component, view loading is split out of navigation metadata, and the Files page becomes a lightweight shell that lazy-loads a chart-only subtree with local fallback behavior.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Testing Library, Zustand, CSS Modules, uPlot

---

## File Map

- Create: `src/components/layout/DocumentChromeSync.tsx`
  - Small DOM-sync component that owns `data-theme` and `data-effects` updates so `MainLayout` no longer subscribes to those settings.
- Create: `src/components/layout/__tests__/DocumentChromeSync.test.tsx`
  - Regression coverage for document dataset synchronization through `useAppStore`.
- Modify: `src/components/layout/MainLayout.tsx`
  - Narrow the app-store subscription surface, switch hot-path barrel imports to direct imports, and mount `DocumentChromeSync` at the shell root.
- Create: `src/hmi/viewLoaders.tsx`
  - Dedicated top-level lazy-loader map for HMI views.
- Create: `src/hmi/viewLoaders.test.tsx`
  - Smoke test that the split loader map still covers every top-level view.
- Modify: `src/hmi/viewRegistry.tsx`
  - Keep only navigation metadata and remove loader ownership.
- Modify: `src/components/layout/InfoPanel.tsx`
  - Import the view loader map from `src/hmi/viewLoaders.tsx` instead of the mixed registry file.
- Modify: `src/components/layout/InfoPanel.keepAlive.test.tsx`
  - Update module mocks so Keep-Alive tests continue to drive `InfoPanel` through the new loader module.
- Create: `src/components/views/Files/FilesChartPreview.tsx`
  - Heavy chart-only subtree that owns `theme`, `scaleFactor`, `useDeferredValue`, and `useChartData`.
- Create: `src/components/views/Files/LazyFilesChartPreview.tsx`
  - Local lazy/error boundary wrapper for the chart subtree.
- Modify: `src/components/views/Files/index.tsx`
  - Convert the Files page into a lightweight shell, switch to direct hook imports, and gate chart mounting with `isViewActive`, active tab, and CSV readiness.
- Modify: `src/components/views/Files/FilePreviewPanel.tsx`
  - Accept rendered chart content instead of chart props, and fall back to raw text preview while charts are deferred.
- Modify: `src/components/views/Files/index.test.tsx`
  - Lock in the new Files behavior: refresh command still works, chart subtree stays deferred until needed, and hidden/inactive states skip chart mounting.
- Modify: `src/hooks/useChartData.ts`
  - Explicitly destroy chart instances when charts become hidden and keep hidden chart work from lingering.
- Modify: `src/hooks/useChartData.test.tsx`
  - Verify hidden chart mode tears down existing uPlot instances.
- Modify: `vite.config.ts`
  - Switch `manualChunks` to a function-based split that emits a dedicated `files-charts` chunk.

## Task 1: Shrink MainLayout Store Subscriptions

**Files:**
- Create: `src/components/layout/DocumentChromeSync.tsx`
- Create: `src/components/layout/__tests__/DocumentChromeSync.test.tsx`
- Modify: `src/components/layout/MainLayout.tsx`

- [ ] **Step 1: Write the failing document-sync test**

Create `src/components/layout/__tests__/DocumentChromeSync.test.tsx` with this coverage:

```tsx
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@/test/utils";
import { useAppStore } from "@/stores/appStore";
import { DocumentChromeSync } from "../DocumentChromeSync";

describe("DocumentChromeSync", () => {
    beforeEach(() => {
        document.documentElement.dataset.theme = "";
        document.documentElement.dataset.effects = "";
        useAppStore.setState({
            theme: "dark",
            visualEffects: "full",
        });
    });

    it("同步 theme 与 visualEffects 到 documentElement dataset", () => {
        render(<DocumentChromeSync />);

        expect(document.documentElement.dataset.theme).toBe("dark");
        expect(document.documentElement.dataset.effects).toBe("full");

        act(() => {
            useAppStore.setState({
                theme: "light",
                visualEffects: "reduced",
            });
        });

        expect(document.documentElement.dataset.theme).toBe("light");
        expect(document.documentElement.dataset.effects).toBe("reduced");
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/components/layout/__tests__/DocumentChromeSync.test.tsx
```

Expected:
- FAIL with a module resolution error because `src/components/layout/DocumentChromeSync.tsx` does not exist yet.

- [ ] **Step 3: Implement the sync component and narrow MainLayout imports**

Create `src/components/layout/DocumentChromeSync.tsx`:

```tsx
import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/stores/appStore";

export function DocumentChromeSync() {
    const { theme, visualEffects } = useAppStore(
        useShallow((state) => ({
            theme: state.theme,
            visualEffects: state.visualEffects,
        })),
    );

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    useEffect(() => {
        document.documentElement.dataset.effects = visualEffects;
    }, [visualEffects]);

    return null;
}
```

Update the hot-path imports and store selection in `src/components/layout/MainLayout.tsx`:

```tsx
import { memo, useCallback } from "react";
import { useNavigationStore } from "@/stores/navigationStore";
import { useAppStore } from "@/stores/appStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useFrontendLogBridge } from "@/hooks/useFrontendLogBridge";
import { useCommEventBridge } from "@/hooks/useCommEventBridge";
import { useHmipEventBridge } from "@/hooks/useHmipEventBridge";
import { useHMIScale } from "@/hooks/useHMIScale";
import { useNotify } from "@/hooks/useNotify";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DocumentChromeSync } from "./DocumentChromeSync";

const commandPanelPosition = useAppStore(
    (state) => state.commandPanelPosition,
);
```

Then remove the old `theme` / `visualEffects` subscription and effect block, and mount the new sync component at the top of the provider tree:

```tsx
return (
    <ViewCommandProvider>
        <SubViewCommandProvider>
            <>
                <DocumentChromeSync />
                <div
                    className={styles.mainLayout}
                    data-command-position={commandPanelPosition}
                >
```

- [ ] **Step 4: Run the focused regression tests**

Run:

```bash
npm test -- src/components/layout/__tests__/DocumentChromeSync.test.tsx src/components/layout/InfoPanel.keepAlive.test.tsx
```

Expected:
- PASS for the new document-sync test.
- PASS for the existing Keep-Alive suite, proving the shell changes did not break view persistence.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/DocumentChromeSync.tsx src/components/layout/__tests__/DocumentChromeSync.test.tsx src/components/layout/MainLayout.tsx
git commit -m "refactor: isolate shell document sync"
```

## Task 2: Split View Loaders Out Of Navigation Metadata

**Files:**
- Create: `src/hmi/viewLoaders.tsx`
- Create: `src/hmi/viewLoaders.test.tsx`
- Modify: `src/hmi/viewRegistry.tsx`
- Modify: `src/components/layout/InfoPanel.tsx`
- Modify: `src/components/layout/InfoPanel.keepAlive.test.tsx`

- [ ] **Step 1: Write the failing loader split tests**

Create `src/hmi/viewLoaders.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { HMI_VIEW_COMPONENTS } from "./viewLoaders";

describe("viewLoaders", () => {
    it("为每个顶层视图导出一个 loader", () => {
        expect(Object.keys(HMI_VIEW_COMPONENTS)).toEqual([
            "jobs",
            "recipes",
            "files",
            "setup",
            "alarms",
            "help",
        ]);
    });
});
```

Update every `vi.doMock("@/hmi/viewRegistry", ...)` block in `src/components/layout/InfoPanel.keepAlive.test.tsx` to target the future loader module instead:

```tsx
vi.doMock("@/hmi/viewLoaders", () => ({
    HMI_VIEW_COMPONENTS: {
        jobs: JobsView,
        recipes: DummyView,
        files: DummyView,
        setup: SetupView,
        alarms: DummyView,
        help: DummyView,
    },
}));
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
npm test -- src/hmi/viewLoaders.test.tsx src/components/layout/InfoPanel.keepAlive.test.tsx
```

Expected:
- FAIL because `src/hmi/viewLoaders.tsx` does not exist yet.

- [ ] **Step 3: Create the loader module and update the shell import path**

Create `src/hmi/viewLoaders.tsx`:

```tsx
import { lazy, type LazyExoticComponent } from "react";
import type { ViewId } from "@/types";

const JobsView = lazy(() => import("@/components/views/Jobs"));
const RecipesView = lazy(() => import("@/components/views/Recipes"));
const FilesView = lazy(() => import("@/components/views/Files"));
const SetupView = lazy(() => import("@/components/views/Setup"));
const AlarmsView = lazy(() => import("@/components/views/Alarms"));
const HelpView = lazy(() => import("@/components/views/Help"));

export const HMI_VIEW_COMPONENTS = {
    jobs: JobsView,
    recipes: RecipesView,
    files: FilesView,
    setup: SetupView,
    alarms: AlarmsView,
    help: HelpView,
} satisfies Record<ViewId, LazyExoticComponent<() => JSX.Element>>;
```

Trim `src/hmi/viewRegistry.tsx` down so it keeps only navigation metadata and `HmiNavItem`; remove the `lazy(...)` imports and the `HMI_VIEW_COMPONENTS` export.

Update `src/components/layout/InfoPanel.tsx` to import the loader map from the new file:

```tsx
import { HMI_VIEW_COMPONENTS } from "@/hmi/viewLoaders";
```

- [ ] **Step 4: Run the loader and Keep-Alive tests again**

Run:

```bash
npm test -- src/hmi/viewLoaders.test.tsx src/components/layout/InfoPanel.keepAlive.test.tsx
```

Expected:
- PASS for the new loader smoke test.
- PASS for the Keep-Alive suite with the updated mock target.

- [ ] **Step 5: Commit**

```bash
git add src/hmi/viewLoaders.tsx src/hmi/viewLoaders.test.tsx src/hmi/viewRegistry.tsx src/components/layout/InfoPanel.tsx src/components/layout/InfoPanel.keepAlive.test.tsx
git commit -m "refactor: split hmi view loaders"
```

## Task 3: Defer Files Chart Work Behind A Lazy Subtree

**Files:**
- Create: `src/components/views/Files/FilesChartPreview.tsx`
- Create: `src/components/views/Files/LazyFilesChartPreview.tsx`
- Modify: `src/components/views/Files/index.tsx`
- Modify: `src/components/views/Files/FilePreviewPanel.tsx`
- Modify: `src/components/views/Files/index.test.tsx`

- [ ] **Step 1: Write the failing Files page tests**

Replace the barrel-hook mocks in `src/components/views/Files/index.test.tsx` with direct module mocks so the test matches the planned import structure, then add the new chart-defer coverage:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";

const mocks = vi.hoisted(() => ({
    retryTree: vi.fn(),
    retryPreview: vi.fn().mockResolvedValue(undefined),
    info: vi.fn(),
    isViewActive: true,
    preview: {
        selectedFilePath: null,
        selectedFileName: null,
        loading: false,
        error: null,
        content: "",
        csvData: null,
        isCsvFile: false,
    },
}));

vi.mock("@/hooks/useFileTree", () => ({
    useFileTree: () => ({
        fileTree: [],
        visibleItems: [],
        treeLoading: false,
        treeError: null,
        logBasePath: "",
        toggleDirectory: vi.fn(),
        retryTree: mocks.retryTree,
    }),
}));

vi.mock("@/hooks/useFilePreview", () => ({
    useFilePreview: () => ({
        preview: mocks.preview,
        selectFile: vi.fn(),
        retryPreview: mocks.retryPreview,
    }),
}));

vi.mock("@/hooks/useNotify", () => ({
    useNotify: () => ({ info: mocks.info }),
}));

vi.mock("@/components/layout/ViewContext", () => ({
    useIsViewActive: () => mocks.isViewActive,
}));

vi.mock("./LazyFilesChartPreview", () => ({
    LazyFilesChartPreview: (props: { title: string }) => (
        <div data-testid="lazy-chart-preview">{props.title}</div>
    ),
}));

import FilesView from "./index";

function Wrapper({ children }: { children: React.ReactNode }) {
    return (
        <ViewCommandProvider>
            <SubViewCommandProvider>{children}</SubViewCommandProvider>
        </ViewCommandProvider>
    );
}

function setCsvPreview() {
    mocks.preview = {
        selectedFilePath: "/logs/run.csv",
        selectedFileName: "run.csv",
        loading: false,
        error: null,
        content: "t,a\n0,1\n1,2",
        csvData: {
            headers: ["t", "a"],
            rows: [
                [0, 1],
                [1, 2],
            ],
        },
        isCsvFile: true,
    };
}

describe("FilesView", () => {
    it("刷新命令应触发 retryTree 与 retryPreview", async () => {
        render(
            <div>
                <CommandPanel currentView="files" />
                <FilesView />
            </div>,
            { wrapper: Wrapper },
        );

        await waitFor(() => {
            expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "刷新" }));

        expect(mocks.retryTree).toHaveBeenCalledTimes(1);
        expect(mocks.retryPreview).toHaveBeenCalledTimes(1);
        expect(mocks.info).toHaveBeenCalledTimes(1);
    });

    it("CSV 预览在 overview 且视图激活时才渲染懒加载图表", () => {
        setCsvPreview();
        mocks.isViewActive = true;

        render(<FilesView />, { wrapper: Wrapper });

        expect(screen.getByTestId("lazy-chart-preview")).toHaveTextContent("run.csv");
    });

    it("视图未激活时保留原始 CSV 文本并跳过图表子树", () => {
        setCsvPreview();
        mocks.isViewActive = false;

        render(<FilesView />, { wrapper: Wrapper });

        expect(screen.queryByTestId("lazy-chart-preview")).not.toBeInTheDocument();
        expect(screen.getByText("t,a\n0,1\n1,2")).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the focused Files test and verify it fails**

Run:

```bash
npm test -- src/components/views/Files/index.test.tsx
```

Expected:
- FAIL because `src/components/views/Files/LazyFilesChartPreview.tsx` does not exist yet.

- [ ] **Step 3: Build the lazy chart subtree and lightweight Files shell**

Create `src/components/views/Files/FilesChartPreview.tsx`:

```tsx
import { useDeferredValue } from "react";
import "uplot/dist/uPlot.min.css";
import { useAppStore } from "@/stores/appStore";
import { useCanvasScale } from "@/hooks/useCanvasScale";
import { useChartData } from "@/hooks/useChartData";
import type { CsvData } from "@/types";
import { ChartPanel } from "./ChartPanel";

export interface FilesChartPreviewProps {
    title: string;
    csvData: CsvData;
    isActive: boolean;
    showMoreText: string;
    showLessText: string;
    resetText: string;
    closeText: string;
    zoomHintText: string;
    retryText: string;
    chartInitErrorText: string;
    chartEmptyDataText: string;
    chartEmptySelectionText: string;
}

export default function FilesChartPreview({
    title,
    csvData,
    isActive,
    showMoreText,
    showLessText,
    resetText,
    closeText,
    zoomHintText,
    retryText,
    chartInitErrorText,
    chartEmptyDataText,
    chartEmptySelectionText,
}: FilesChartPreviewProps) {
    const theme = useAppStore((state) => state.theme);
    const scaleFactor = useCanvasScale(16);
    const deferredCsvData = useDeferredValue(csvData);
    const charts = useChartData({
        csvData: deferredCsvData,
        theme,
        scaleFactor,
        isChartsVisible: isActive,
    });

    return (
        <ChartPanel
            title={title}
            csvData={deferredCsvData}
            showMoreText={showMoreText}
            showLessText={showLessText}
            resetText={resetText}
            closeText={closeText}
            zoomHintText={zoomHintText}
            retryText={retryText}
            chartInitErrorText={chartInitErrorText}
            chartEmptyDataText={chartEmptyDataText}
            chartEmptySelectionText={chartEmptySelectionText}
            visibleCharts={charts.visibleCharts}
            enabledColumns={charts.enabledColumns}
            sortedEnabledColumns={charts.sortedEnabledColumns}
            hasMoreCharts={charts.hasMoreCharts}
            chartColors={charts.chartColors}
            chartError={charts.chartError}
            onRetryCharts={charts.retryCharts}
            enlargedColumn={charts.enlargedColumn}
            enlargedChartRef={charts.enlargedChartRef}
            enlargedChartError={charts.enlargedChartError}
            onRetryEnlargedChart={charts.retryEnlargedChart}
            onToggleColumn={charts.toggleColumn}
            onShowMoreCharts={charts.showMoreCharts}
            onShowLessCharts={charts.showLessCharts}
            onSetChartRef={charts.setChartRef}
            onOpenEnlargedChart={(colIndex) => charts.setEnlargedColumn(colIndex)}
            onCloseEnlargedChart={charts.closeEnlargedChart}
            onResetEnlargedZoom={charts.resetEnlargedZoom}
        />
    );
}
```

Create `src/components/views/Files/LazyFilesChartPreview.tsx`:

```tsx
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { StatusIndicator } from "@/components/common/StatusIndicator";
import filesStyles from "./Files.module.css";
import type { FilesChartPreviewProps } from "./FilesChartPreview";

const FilesChartPreview = lazy(() => import("./FilesChartPreview"));

export interface LazyFilesChartPreviewProps extends FilesChartPreviewProps {
    loadingText: string;
}

export function LazyFilesChartPreview({ loadingText, retryText, chartInitErrorText, ...props }: LazyFilesChartPreviewProps) {
    return (
        <ErrorBoundary
            fallback={({ reset }) => (
                <div className={filesStyles.error}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                        <StatusIndicator status="alarm" label={chartInitErrorText} />
                        <button className={filesStyles.refreshBtn} type="button" onClick={reset}>
                            {retryText}
                        </button>
                    </div>
                </div>
            )}
        >
            <Suspense
                fallback={
                    <div className={filesStyles.loading}>
                        <StatusIndicator status="processing" label={loadingText} />
                    </div>
                }
            >
                <FilesChartPreview retryText={retryText} chartInitErrorText={chartInitErrorText} {...props} />
            </Suspense>
        </ErrorBoundary>
    );
}
```

Update `src/components/views/Files/FilePreviewPanel.tsx` so it accepts rendered content instead of the old chart prop bag:

```tsx
import type { ReactNode } from "react";

export interface FilePreviewPanelProps {
    preview: PreviewConfig;
    selectFileText: string;
    loadingText: string;
    retryText: string;
    retryDisabled: boolean;
    onRetryPreview: () => void;
    chartContent: ReactNode | null;
}

if (preview.isCsvFile && preview.csvData) {
    return (
        <div className={filesStyles.preview}>
            {chartContent ?? (
                <div className={filesStyles.textPreview}>
                    <div className={filesStyles.textHeader}>
                        {preview.selectedFileName}
                    </div>
                    <pre className={filesStyles.textContent}>{preview.content}</pre>
                </div>
            )}
        </div>
    );
}
```

Update `src/components/views/Files/index.tsx` to become a lightweight shell:

```tsx
import { useMemo, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/common/Tabs";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useRegisterViewCommands } from "@/components/layout/ViewCommandContext";
import { FILES_CONFIG } from "@/constants";
import { useFilePreview } from "@/hooks/useFilePreview";
import { useFileTree } from "@/hooks/useFileTree";
import { useNotify } from "@/hooks/useNotify";
import { LazyFilesChartPreview } from "./LazyFilesChartPreview";
```

Then replace the old chart hook usage with gated rendering:

```tsx
const [activeTab, setActiveTab] = useState<"overview" | "info">("overview");
const [, startTransition] = useTransition();

const handleTabChange = (nextTab: "overview" | "info") => {
    startTransition(() => setActiveTab(nextTab));
};

const shouldRenderChartPreview =
    isViewActive && activeTab === "overview" && !!preview.csvData;

const showMoreText = preview.csvData
    ? t("files.showMore", {
          count: Math.max(
              0,
              preview.csvData.headers.length -
                  1 -
                  FILES_CONFIG.DEFAULT_VISIBLE_CHARTS,
          ),
      })
    : "";

const chartContent = shouldRenderChartPreview && preview.csvData ? (
    <LazyFilesChartPreview
        title={preview.selectedFileName ?? preview.selectedFilePath ?? t("files.title")}
        csvData={preview.csvData}
        isActive={isViewActive}
        loadingText={t("common.loading")}
        showMoreText={showMoreText}
        showLessText={t("files.showLess")}
        resetText={t("common.reset")}
        closeText={t("common.close")}
        zoomHintText={t("files.chart.zoomHint")}
        retryText={t("common.retry")}
        chartInitErrorText={t("files.chart.initError")}
        chartEmptyDataText={t("files.chart.emptyData")}
        chartEmptySelectionText={t("files.chart.emptySelection")}
    />
) : null;
```

Pass `handleTabChange` to `Tabs` and `chartContent` to `FilePreviewPanel`.

- [ ] **Step 4: Run the focused Files tests again**

Run:

```bash
npm test -- src/components/views/Files/index.test.tsx
```

Expected:
- PASS for the refresh command regression.
- PASS for the new lazy chart gating behavior.

- [ ] **Step 5: Commit**

```bash
git add src/components/views/Files/FilesChartPreview.tsx src/components/views/Files/LazyFilesChartPreview.tsx src/components/views/Files/index.tsx src/components/views/Files/FilePreviewPanel.tsx src/components/views/Files/index.test.tsx
git commit -m "refactor: defer files chart subtree"
```

## Task 4: Tear Down Hidden Charts And Verify Dedicated Chart Bundles

**Files:**
- Modify: `src/hooks/useChartData.ts`
- Modify: `src/hooks/useChartData.test.tsx`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the failing chart teardown test**

Add this regression case to `src/hooks/useChartData.test.tsx`:

```tsx
it("isChartsVisible=false 时应销毁现有 uPlot 实例", async () => {
    const { useChartData } = await import("./useChartData");
    const csvData = buildCsv();

    const { result, rerender } = renderHook(
        ({ visible }) =>
            useChartData({
                csvData,
                theme: "dark",
                scaleFactor: 1,
                isChartsVisible: visible,
            }),
        { initialProps: { visible: true } },
    );

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
        value: 400,
        configurable: true,
    });

    act(() => {
        result.current.setChartRef(1, container);
    });

    await act(async () => {
        flushRaf();
    });

    const uPlotMod = await import("uplot");
    const instance = (uPlotMod.default as any).instances[0];
    expect(instance).toBeDefined();

    rerender({ visible: false });

    await act(async () => {
        flushRaf();
    });

    expect(instance.destroy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the chart hook test and verify it fails**

Run:

```bash
npm test -- src/hooks/useChartData.test.tsx
```

Expected:
- FAIL because the hidden-chart transition does not explicitly destroy existing instances yet.

- [ ] **Step 3: Add hidden-chart teardown and function-based manual chunking**

Add an explicit hidden-chart cleanup effect to `src/hooks/useChartData.ts` immediately after the existing destroy helpers:

```tsx
useEffect(() => {
    if (isChartsVisible) return;

    setEnlargedColumn(null);
    destroySmallCharts();
    destroyEnlargedChart();
}, [destroyEnlargedChart, destroySmallCharts, isChartsVisible]);
```

Keep the existing render effects guarded by:

```tsx
if (!csvData) return;
if (!isChartsVisible) return;
if (chartError) return;
```

Then change `vite.config.ts` so `manualChunks` isolates chart-heavy code under a dedicated chunk name:

```ts
build: {
  emptyOutDir: true,
  target: "esnext",
  minify: "esbuild",
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
          return "react";
        }
        if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) {
          return "i18n";
        }
        if (id.includes("node_modules/zustand")) {
          return "zustand";
        }
        if (
          id.includes("node_modules/uplot") ||
          id.includes("/src/components/views/Files/FilesChartPreview.tsx") ||
          id.includes("/src/components/views/Files/LazyFilesChartPreview.tsx") ||
          id.includes("/src/components/views/Files/ChartPanel.tsx") ||
          id.includes("/src/hooks/useChartData.ts")
        ) {
          return "files-charts";
        }
      },
    },
  },
},
```

- [ ] **Step 4: Run hook, page, and build verification**

Run:

```bash
npm test -- src/hooks/useChartData.test.tsx src/components/views/Files/index.test.tsx
npm run build
rg --files dist/assets | rg "files-charts"
```

Expected:
- PASS for the chart hook suite, including the new teardown test.
- PASS for the Files page suite.
- `npm run build` exits successfully.
- `rg --files dist/assets | rg "files-charts"` prints at least one asset path, proving the dedicated chart chunk exists.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useChartData.ts src/hooks/useChartData.test.tsx vite.config.ts
git commit -m "perf: isolate files chart bundle"
```

## Spec Coverage Check

- Load boundaries: Task 2 splits view loaders from metadata, and Task 3 lazy-loads the heavy Files chart subtree.
- Keep-Alive rendering boundaries: Task 1 reduces shell subscriptions, Task 3 gates chart mounting, and Task 4 explicitly tears down hidden chart work.
- Low-power-first behavior: Task 3 keeps file tree and raw CSV content available before chart hydration, and Task 4 ensures hidden chart resources do not linger.
- Error and fallback behavior: Task 3 adds local lazy fallback behavior around the chart subtree instead of relying on the top-level shell boundary.
- Verification: Task 4 includes both test and build verification, including chunk inspection.

## Placeholder Scan

- No `TODO`, `TBD`, or “similar to Task N” instructions remain.
- Every code-changing step includes the concrete code to add or edit.
- Every verification step includes exact commands and expected results.

## Type Consistency Check

- `DocumentChromeSync` owns `theme` and `visualEffects` synchronization in both the test and implementation steps.
- The new HMI loader file is consistently named `src/hmi/viewLoaders.tsx` in file map, tests, and imports.
- The Files lazy wrapper is consistently named `LazyFilesChartPreview` across tests and implementation.
- `FilesChartPreviewProps` and `LazyFilesChartPreviewProps` share the same strings and chart props throughout the plan.
