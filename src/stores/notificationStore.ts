import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message?: string;
    duration?: number;
    createdAt: Date;
}

interface NotificationState {
    notifications: Notification[];
    addNotification: (
        notification: Omit<Notification, "id" | "createdAt">,
    ) => void;
    removeNotification: (id: string) => void;
    clearAll: () => void;
}

let notificationId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
    notifications: [],

    addNotification: (notification) => {
        const id = `notification-${++notificationId}`;
        const newNotification: Notification = {
            ...notification,
            id,
            createdAt: new Date(),
            duration: notification.duration ?? 5000,
        };

        set((state) => ({
            notifications: [...state.notifications, newNotification],
        }));

        // Auto-remove after duration
        if (newNotification.duration && newNotification.duration > 0) {
            setTimeout(() => {
                set((state) => ({
                    notifications: state.notifications.filter(
                        (n) => n.id !== id,
                    ),
                }));
            }, newNotification.duration);
        }
    },

    removeNotification: (id) =>
        set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
        })),

    clearAll: () => set({ notifications: [] }),
}));
