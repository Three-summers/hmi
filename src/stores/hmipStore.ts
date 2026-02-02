/**
 * HMIP 事件读模型 Store
 *
 * 作用：
 * - 收敛后端 `hmip-event`（已在 Rust 端解析）到 selector-friendly 的前端读模型
 * - 维护有限长度的事件日志，便于调试与回放
 *
 * 说明：
 * - “告警语义映射”（例如 decode_error → warning）由 `useHmipEventBridge` 负责；
 *   Store 仅负责状态聚合，避免把 UI 语义写进数据层。
 *
 * @module stores/hmipStore
 */

import { create } from "zustand";
import type { CommTransport, HmipEvent } from "@/types";

interface HmipStoreState {
    // 统计/读模型（便于 UI selector）
    serialLastEventAtMs: number | null;
    tcpLastEventAtMs: number | null;

    serialMessageCount: number;
    tcpMessageCount: number;

    serialDecodeErrorCount: number;
    tcpDecodeErrorCount: number;

    serialLastDecodeError: string | null;
    tcpLastDecodeError: string | null;

    serialLastMessage: HmipEvent | null;
    tcpLastMessage: HmipEvent | null;

    /** 最近一次错误（便于在 Setup/Debug 面板展示） */
    lastError: string | undefined;

    /** 事件日志（有限长度） */
    hmipEventLog: HmipEvent[];

    // actions
    handleHmipEvent: (event: HmipEvent) => void;
    clearHmipEventLog: () => void;
    clearError: () => void;
}

const HMIP_EVENT_LOG_MAX = 200;

function updateTransportModel(params: {
    transport: CommTransport;
    event: HmipEvent;
    prev: Pick<
        HmipStoreState,
        | "serialLastEventAtMs"
        | "tcpLastEventAtMs"
        | "serialMessageCount"
        | "tcpMessageCount"
        | "serialDecodeErrorCount"
        | "tcpDecodeErrorCount"
        | "serialLastDecodeError"
        | "tcpLastDecodeError"
        | "serialLastMessage"
        | "tcpLastMessage"
        | "lastError"
    >;
}): Partial<HmipStoreState> {
    const { transport, event, prev } = params;

    const patch: Partial<HmipStoreState> = {
        lastError:
            event.type === "decode_error"
                ? `[${transport}] ${event.message}`
                : prev.lastError,
    };

    if (transport === "serial") {
        patch.serialLastEventAtMs = event.timestamp_ms;
        if (event.type === "decode_error") {
            patch.serialDecodeErrorCount = prev.serialDecodeErrorCount + 1;
            patch.serialLastDecodeError = event.message;
        }
        if (event.type === "message") {
            patch.serialMessageCount = prev.serialMessageCount + 1;
            patch.serialLastMessage = event;
        }
        return patch;
    }

    patch.tcpLastEventAtMs = event.timestamp_ms;
    if (event.type === "decode_error") {
        patch.tcpDecodeErrorCount = prev.tcpDecodeErrorCount + 1;
        patch.tcpLastDecodeError = event.message;
    }
    if (event.type === "message") {
        patch.tcpMessageCount = prev.tcpMessageCount + 1;
        patch.tcpLastMessage = event;
    }

    return patch;
}

export const useHmipStore = create<HmipStoreState>((set) => ({
    serialLastEventAtMs: null,
    tcpLastEventAtMs: null,
    serialMessageCount: 0,
    tcpMessageCount: 0,
    serialDecodeErrorCount: 0,
    tcpDecodeErrorCount: 0,
    serialLastDecodeError: null,
    tcpLastDecodeError: null,
    serialLastMessage: null,
    tcpLastMessage: null,
    lastError: undefined,
    hmipEventLog: [],

    handleHmipEvent: (event) =>
        set((state) => {
            const fullLog = [...state.hmipEventLog, event];
            const nextLog =
                fullLog.length > HMIP_EVENT_LOG_MAX
                    ? fullLog.slice(fullLog.length - HMIP_EVENT_LOG_MAX)
                    : fullLog;

            const patch = updateTransportModel({
                transport: event.transport,
                event,
                prev: state,
            });

            return {
                ...patch,
                hmipEventLog: nextLog,
            };
        }),

    clearHmipEventLog: () => set({ hmipEventLog: [] }),
    clearError: () => set({ lastError: undefined }),
}));

