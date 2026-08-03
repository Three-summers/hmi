/**
 * Comm 后端事件桥接 Hook
 *
 * 作用：
 * - 订阅 Tauri 后端的 `comm-event` 事件
 * - 将事件分发到前端的 Comm Store（读模型）
 * - 将关键错误映射为告警（驱动 E95 语义高亮：Nav/Title/Command）
 *
 * @module hooks/useCommEventBridge
 */

import { useEffect } from "react";
import i18n from "@/i18n";
import { listen } from "@/platform/events";
import { isTauri } from "@/platform/tauri";
import { useAlarmStore, useCommStore } from "@/stores";
import type { CommEvent } from "@/types";

const COMM_EVENT_NAME = "comm-event";
const ERROR_ALARM_DEDUP_WINDOW_MS = 10_000;

export function useCommEventBridge() {
    useEffect(() => {
        if (!isTauri()) return;

        let cancelled = false;
        let unlisten: null | (() => void) = null;

        // 简单去重：避免重连期间相同错误刷屏
        let lastErrorKey = "";
        let lastErrorAtMs = 0;

        const setup = async () => {
            try {
                const stop = await listen<CommEvent>(
                    COMM_EVENT_NAME,
                    (event) => {
                        if (cancelled) return;

                        const payload = event.payload;
                        useCommStore.getState().handleCommEvent(payload);

                        if (payload.type === "error") {
                            const now = Date.now();
                            const key = `${payload.transport}:${payload.connection_id ?? "default"}:${payload.message}`;
                            const shouldEmit =
                                key !== lastErrorKey ||
                                now - lastErrorAtMs >
                                    ERROR_ALARM_DEDUP_WINDOW_MS;

                            if (shouldEmit) {
                                lastErrorKey = key;
                                lastErrorAtMs = now;
                                useAlarmStore.getState().addAlarm({
                                    severity: "warning",
                                    message: i18n.t("errors.commError", {
                                        transport: payload.transport,
                                        message: payload.message,
                                    }),
                                });
                            }
                        }
                    },
                );

                // 清理可能在 listen 完成前触发（StrictMode 双调用/快速卸载），
                // 此时必须立即注销，否则监听器泄漏
                if (cancelled) {
                    stop();
                    return;
                }
                unlisten = stop;
            } catch (err) {
                console.error("Failed to setup comm event bridge:", err);
            }
        };

        void setup();

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);
}
