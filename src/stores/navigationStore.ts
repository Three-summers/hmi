import { create } from "zustand";
import type { ViewId } from "@/types";

interface NavigationState {
    // Current view
    currentView: ViewId;
    setCurrentView: (view: ViewId) => void;

    // View history for back navigation
    viewHistory: ViewId[];
    goBack: () => void;

    // Unfinished tasks per view (for blue highlight per SEMI E95)
    unfinishedTasks: Record<ViewId, boolean>;
    setUnfinishedTask: (view: ViewId, hasTask: boolean) => void;

    // Dialog state per view (dialogs should persist when navigating away)
    viewDialogStates: Record<ViewId, unknown>;
    setViewDialogState: (view: ViewId, state: unknown) => void;
    getViewDialogState: (view: ViewId) => unknown;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
    // Current view - default to jobs per SEMI E95 (most frequently used first)
    currentView: "jobs",
    setCurrentView: (view) =>
        set((state) => ({
            currentView: view,
            viewHistory: [...state.viewHistory, state.currentView].slice(-10),
        })),

    // View history
    viewHistory: [],
    goBack: () =>
        set((state) => {
            const history = [...state.viewHistory];
            const previousView = history.pop();
            return {
                currentView: previousView || "jobs",
                viewHistory: history,
            };
        }),

    // Unfinished tasks
    unfinishedTasks: {
        jobs: false,
        system: false,
        monitor: false,
        recipes: false,
        datalog: false,
        setup: false,
        alarms: false,
        help: false,
    },
    setUnfinishedTask: (view, hasTask) =>
        set((state) => ({
            unfinishedTasks: {
                ...state.unfinishedTasks,
                [view]: hasTask,
            },
        })),

    // Dialog states
    viewDialogStates: {} as Record<ViewId, unknown>,
    setViewDialogState: (view, dialogState) =>
        set((state) => ({
            viewDialogStates: {
                ...state.viewDialogStates,
                [view]: dialogState,
            },
        })),
    getViewDialogState: (view) => get().viewDialogStates[view],
}));
