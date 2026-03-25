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
import {
    DEFAULT_SERIAL_CONNECTION_ID,
    DEFAULT_TCP_CONNECTION_ID,
} from "@/types";
import type {
    CommTransport,
    HmipConnectionState,
    HmipEvent,
} from "@/types";

interface HmipStoreState {
    connectionStates: Record<string, HmipConnectionState>;
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

function getDefaultConnectionId(transport: CommTransport): string {
    return transport === "serial"
        ? DEFAULT_SERIAL_CONNECTION_ID
        : DEFAULT_TCP_CONNECTION_ID;
}

function resolveConnectionId(
    transport: CommTransport,
    connectionId?: string,
): string {
    return connectionId ?? getDefaultConnectionId(transport);
}

function createHmipConnectionState(
    connectionId: string,
    transport: CommTransport,
): HmipConnectionState {
    return {
        connectionId,
        transport,
        lastEventAtMs: null,
        messageCount: 0,
        decodeErrorCount: 0,
        lastDecodeError: null,
        lastMessage: null,
        lastError: undefined,
    };
}

function updateConnectionState(params: {
    connection: HmipConnectionState;
    event: HmipEvent;
}): HmipConnectionState {
    const { connection, event } = params;
    const next: HmipConnectionState = {
        ...connection,
        lastEventAtMs: event.timestamp_ms,
    };

    if (event.type === "decode_error") {
        next.decodeErrorCount += 1;
        next.lastDecodeError = event.message;
        next.lastError = `[${event.transport}] ${event.message}`;
        return next;
    }

    next.messageCount += 1;
    next.lastMessage = event;
    return next;
}

function patchDefaultTransportModel(params: {
    transport: CommTransport;
    event: HmipEvent;
    connection: HmipConnectionState;
}): Partial<HmipStoreState> {
    const { transport, event, connection } = params;
    const patch: Partial<HmipStoreState> = {};

    if (transport === "serial") {
        patch.serialLastEventAtMs = connection.lastEventAtMs;
        patch.serialMessageCount = connection.messageCount;
        patch.serialDecodeErrorCount = connection.decodeErrorCount;
        patch.serialLastDecodeError = connection.lastDecodeError;
        patch.serialLastMessage = connection.lastMessage;
        if (event.type === "decode_error") patch.lastError = connection.lastError;
        return patch;
    }

    patch.tcpLastEventAtMs = connection.lastEventAtMs;
    patch.tcpMessageCount = connection.messageCount;
    patch.tcpDecodeErrorCount = connection.decodeErrorCount;
    patch.tcpLastDecodeError = connection.lastDecodeError;
    patch.tcpLastMessage = connection.lastMessage;
    if (event.type === "decode_error") patch.lastError = connection.lastError;

    return patch;
}

export const useHmipStore = create<HmipStoreState>((set) => ({
    connectionStates: {},
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
            const connectionId = resolveConnectionId(
                event.transport,
                event.connection_id,
            );
            const currentConnection =
                state.connectionStates?.[connectionId] ??
                createHmipConnectionState(connectionId, event.transport);
            const nextConnection = updateConnectionState({
                connection: currentConnection,
                event,
            });
            const patch: Partial<HmipStoreState> = {
                connectionStates: {
                    ...(state.connectionStates ?? {}),
                    [connectionId]: nextConnection,
                },
            };

            if (connectionId === getDefaultConnectionId(event.transport)) {
                Object.assign(
                    patch,
                    patchDefaultTransportModel({
                        transport: event.transport,
                        event,
                        connection: nextConnection,
                    }),
                );
            }

            return {
                ...patch,
                hmipEventLog: nextLog,
            };
        }),

    clearHmipEventLog: () => set({ hmipEventLog: [] }),
    clearError: () => set({ lastError: undefined }),
}));
