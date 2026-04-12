# Frontend Optimization Design

Date: 2026-04-12

## Goal

Optimize the HMI frontend for low-power Tauri devices using Vercel React best practices, with the biggest focus on reducing unnecessary bundle cost, deferring heavy view work until needed, and tightening Keep-Alive rendering boundaries without changing the existing HMI shell.

## Scope

Included:
- Frontend-only changes under `src/`
- View loading and bundling changes for the main HMI shell
- Rendering and subscription boundary refinements for Keep-Alive views
- Low-power-first behavior for heavy pages, especially the Files and chart flow
- Targeted tests for the new loading, gating, and fallback behavior

Excluded:
- Backend or Tauri Rust changes
- Navigation model redesign
- Large visual redesigns or a new layout system
- Replacing Zustand, CSS Modules, or the current HMI shell architecture
- Broad refactors unrelated to startup, view switching, or heavy-page performance

## Problems To Solve

1. The current frontend already uses `React.lazy()` and `Suspense`, but heavy page behavior is still too eager for low-power Tauri targets.
2. `Files` mixes light shell concerns with heavy chart concerns, so entering the page can pull chart code and chart work into the hot path too early.
3. Keep-Alive preserves useful state, but heavy hidden subtrees can still retain more rendering, subscriptions, and memory than needed.
4. Layout-level subscriptions and shared imports are broader than necessary in a few hot paths, which increases avoidable rerenders and bundle coupling.
5. Visual effects and fallback behavior are not yet tuned around the constraint that low-power industrial hardware should prefer responsiveness over visual richness.

## Design

### 1. Keep The Existing HMI Shell, But Tighten Load Boundaries

The four-region shell stays intact:
- `src/components/layout/MainLayout.tsx`
- `src/components/layout/InfoPanel.tsx`
- `src/components/layout/CommandPanel.tsx`
- `src/components/layout/NavPanel.tsx`

This preserves the current SEMI E95-oriented layout, minimizes UI risk, and avoids a redesign of the navigation model.

The optimization work shifts from changing structure to changing when expensive code is loaded and mounted.

Planned changes:
- Keep main-view `lazy + Suspense` loading for top-level views.
- Split `src/hmi/viewRegistry.tsx` into separate responsibilities for navigation metadata and view loaders.
- Keep icons and labels on the always-available path.
- Move heavy view-loading concerns into a loader-focused module so startup code is less coupled to every view implementation.

This follows the Vercel priorities around bundle isolation and reducing unnecessary work on the hot path.

### 2. Make Heavy View Features Load On Demand

The highest-value target is `src/components/views/Files/index.tsx`.

The Files page will be reorganized into:
- A light page shell that owns tabs, file-tree wiring, preview wiring, and command registration.
- A heavy chart subtree that is only loaded and mounted when chart rendering is actually needed.

The heavy chart subtree should not load until all of the following are true:
- The Files view is active.
- The active tab is `overview`.
- CSV data is available.

Implications:
- Entering Files should show the file tree and preview shell first.
- Selecting a file should allow text or lightweight CSV preview to appear before chart initialization finishes.
- `uPlot` and chart-specific logic should move behind a dedicated lazy boundary so light pages are not penalized by chart code.

Expected file targets in the first pass:
- `src/components/views/Files/index.tsx`
- Existing Files child panels under `src/components/views/Files/`
- `src/hooks/useChartData.ts`
- `vite.config.ts`

### 3. Refine Bundle Strategy Around Heavy Domains

The current `vite.config.ts` already defines manual chunks for `react`, `i18n`, and `zustand`.

That strategy should be extended from generic vendor grouping to domain-aware grouping:
- Keep the lightweight shared chunks already present.
- Add a dedicated chart-oriented chunk for `uplot` and the chart-heavy Files path.
- Avoid accidentally growing the shell entry path with broad barrel imports from shared modules.

Import strategy changes:
- Prefer direct imports over aggregated barrel imports in hot paths such as layout and heavy views.
- Apply this selectively, not mechanically across the whole repo.
- Target modules that sit on shell startup or heavy view entry paths.

This aligns with Vercel guidance on `bundle-barrel-imports` and separating large optional features from the primary route payload.

### 4. Tighten Keep-Alive Rendering And Subscription Boundaries

Keep-Alive remains the correct default because the HMI benefits from preserving page state across navigation.

However, not every preserved subtree should stay fully alive.

Rules for the new boundary model:
- Light views may remain mounted with their local UI state intact.
- Heavy subtrees inside a kept-alive view must gate subscriptions, event streams, timers, chart initialization, and canvas-heavy work behind `isViewActive` or a narrower condition.
- Hidden heavy subtrees should prefer conditional mounting over passive hidden rendering.

Specific planned changes:
- Move high-cost chart work out of the root Files view component so it is not created while inactive.
- Review heavy subscriptions and effects in the Files flow and related hooks to ensure they stop or unmount when the view is inactive.
- Avoid broad layout rerenders caused by app-wide settings that only need DOM synchronization.

For `src/components/layout/MainLayout.tsx`, theme and visual-effect synchronization should move into a very small synchronization component or effect boundary so shell rendering does not expand its rerender surface unnecessarily.

### 5. Use React Priority Controls Only On Real Hotspots

This optimization pass should use React 18 priority tools narrowly and intentionally.

Candidate usage:
- Use `startTransition` for non-urgent tab changes or state updates that trigger heavy chart preparation.
- Use deferred propagation only where it protects responsiveness during chart-heavy updates.
- Do not blanket-add memoization or advanced React primitives to every component.

The goal is not to make the codebase look more advanced. The goal is to keep interactions like file selection, tab switching, and command clicks responsive while slower chart work settles in behind them.

### 6. Low-Power-First Visual And Runtime Degradation

Low-power Tauri devices are the primary target for this work.

The UI should prefer "available now" over "fully enhanced immediately".

Planned behavior:
- Entering a heavy page shows lightweight content and placeholders first.
- Heavy visual effects remain configurable, but the default runtime posture becomes more conservative.
- Expensive background effects, blur, and shadow combinations in `src/styles/global.css` and `src/styles/variables.css` should be reviewed so heavy pages can run with reduced cost more predictably.

This does not require a visual redesign.

It does require a clearer separation between:
- always-on shell visuals
- optional enhanced visuals
- heavy page-specific visuals that should degrade first

### 7. Error Isolation And Fallback Rules

The global error boundary in `src/components/layout/MainLayout.tsx` remains the last-resort shell fallback.

Heavy subtrees should gain their own local isolation so a chart failure does not block the whole Files workflow.

Desired behavior:
- File tree and text preview remain usable even if chart initialization fails.
- The chart area can show a local retry state.
- View-level fallback remains reserved for failures that break the whole page contract.

This preserves operator continuity on industrial devices where partial degradation is better than full-page interruption.

### 8. Success Criteria

This work is successful when all of the following are true:
- The existing shell layout and navigation behavior are preserved.
- Entering light views remains fast and is not affected by chart-related code.
- Entering the Files view no longer requires immediate chart initialization.
- Chart code loads only when the Files overview tab has CSV data and the view is active.
- Hidden heavy subtrees stop updating or unmount cleanly when inactive.
- Reduced visual-effect operation is consistent and predictable on low-power devices.
- A chart failure no longer blocks the rest of the Files page.

## Testing Strategy

Implementation must follow TDD for each behavior change.

Required regression coverage:
- Files does not eagerly mount heavy chart content on initial page entry.
- Heavy chart content mounts only when the view is active, the overview tab is selected, and CSV data is ready.
- Switching away from a heavy view stops or unmounts the heavy subtree.
- Layout-level settings changes do not cause unnecessary shell-wide rerender behavior beyond the intended sync points.
- Local chart failure falls back without breaking file-tree and preview usage.

Likely test targets:
- `src/components/views/Files/`
- `src/components/layout/InfoPanel.tsx`
- `src/components/layout/MainLayout.tsx`
- Relevant hook tests around chart or active-view gating

## Verification

Primary verification commands:

```bash
npm run test
npm run build
```

The work is complete only when:
- Tests covering the new lazy and active-gating behavior pass.
- Existing frontend tests still pass.
- The production build succeeds.
- The build output shows the expected separation of chart-heavy code from the light shell path.

## Implementation Order

Implement in three batches:

1. Load and bundle boundaries
- Split view metadata from view loaders.
- Introduce the heavy chart lazy boundary.
- Update build chunking for the chart domain.

2. Rendering and activity gating
- Move heavy chart work behind active conditions.
- Reduce shell rerender exposure.
- Tighten subscription and mount boundaries for kept-alive heavy content.

3. Fallback and low-power tuning
- Add local heavy-subtree error isolation.
- Refine placeholders and deferred interaction behavior.
- Tune visual-effect degradation for low-power targets.

## Implementation Notes

- Keep edits minimal and localized to the existing frontend architecture.
- Prefer moving heavy work behind smaller boundaries over broad rewrites.
- Apply Vercel best practices where they change real startup, switching, or bundle behavior, not as style-only refactors.
- Preserve the current HMI shell, navigation model, and CSS-token system.
- Allow small interaction adjustments only when they directly improve responsiveness, clarity, or fault isolation.
