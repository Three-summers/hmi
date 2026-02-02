/**
 * HMIP 后端事件桥接 Hook
 *
 * 作用：
 * - 订阅 Tauri 后端的 `hmip-event` 事件
 * - 将事件写入 HMIP Store（读模型）
 * - 将协议解码/错误事件映射为告警（驱动 E95 语义高亮）
 *
 * @module hooks/useHmipEventBridge
 */

import { useEffect } from "react";
import { listen } from "@/platform/events";
import { isTauri } from "@/platform/tauri";
import { useAlarmStore, useHmipStore } from "@/stores";
import type { HmipEvent } from "@/types";

const HMIP_EVENT_NAME = "hmip-event";
const ERROR_ALARM_DEDUP_WINDOW_MS = 10_000;

export function useHmipEventBridge() {
    useEffect(() => {
        if (!isTauri()) return;

        let cancelled = false;
        let unlisten: null | (() => void) = null;

        // 简单去重：避免错误刷屏（例如解码失败/对端噪声导致的持续报错）
        let lastErrorKey = "";
        let lastErrorAtMs = 0;

        const setup = async () => {
            try {
                unlisten = await listen<HmipEvent>(HMIP_EVENT_NAME, (event) => {
                    if (cancelled) return;

                    const payload = event.payload;
                    useHmipStore.getState().handleHmipEvent(payload);

                    const now = Date.now();

                    if (payload.type === "decode_error") {
                        const key = `decode:${payload.transport}:${payload.message}`;
                        const shouldEmit =
                            key !== lastErrorKey ||
                            now - lastErrorAtMs > ERROR_ALARM_DEDUP_WINDOW_MS;
                        if (shouldEmit) {
                            lastErrorKey = key;
                            lastErrorAtMs = now;
                            useAlarmStore.getState().addAlarm({
                                severity: "warning",
                                message: `协议解码失败(${payload.transport})：${payload.message}`,
                            });
                        }
                        return;
                    }

                    if (
                        payload.type === "message" &&
                        payload.summary.kind === "error"
                    ) {
                        const key = `proto_error:${payload.transport}:${payload.summary.code}:${payload.summary.message}`;
                        const shouldEmit =
                            key !== lastErrorKey ||
                            now - lastErrorAtMs > ERROR_ALARM_DEDUP_WINDOW_MS;
                        if (shouldEmit) {
                            lastErrorKey = key;
                            lastErrorAtMs = now;
                            useAlarmStore.getState().addAlarm({
                                severity: "warning",
                                message: `协议错误(${payload.transport})：code=${payload.summary.code} ${payload.summary.message}`,
                            });
                        }
                    }
                });
            } catch (err) {
                console.error("Failed to setup hmip event bridge:", err);
            }
        };

        void setup();

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);
}

