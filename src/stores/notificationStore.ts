/**
 * 通知状态管理 Store
 *
 * 用于管理全局 Toast/通知列表，提供：
 * - 新增通知（支持设置标题/正文/持续时间）
 * - 移除指定通知
 * - 清空通知
 *
 * 注意：该 Store 默认使用内存态，不做持久化；通知会在到期后自动移除。
 *
 * @module notificationStore
 */

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

/** 通知 ID 自增计数器（用于生成稳定的 key） */
let notificationId = 0;

/**
 * 通知状态 Store Hook（Zustand）
 *
 * @returns 通知状态的 Store Hook
 * @description 新增通知时会自动补齐 id/createdAt，并为未指定 duration 的通知提供默认值。
 */
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

        // 到期后自动移除（避免通知列表无限增长）
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
