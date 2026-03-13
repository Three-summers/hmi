import { invoke } from "@/platform/invoke";

export interface SecsRpcTarget {
    endpoint?: string;
    connectTimeoutMs?: number;
    requestTimeoutMs?: number;
}

export interface RpcError {
    category?: string;
    value?: number;
    message?: string;
}

export interface RpcStatus {
    ok?: boolean;
    error?: RpcError;
}

export const TransportKind = {
    UNSPECIFIED: 0,
    HSMS: 1,
    SECS1: 2,
} as const;

export type TransportKind =
    (typeof TransportKind)[keyof typeof TransportKind];

export const SessionState = {
    UNSPECIFIED: 0,
    CREATED: 1,
    RUNNING: 2,
    STOPPED: 3,
} as const;

export type SessionState = (typeof SessionState)[keyof typeof SessionState];

export const ItemType = {
    UNSPECIFIED: 0,
    LIST: 1,
    ASCII: 2,
    BINARY: 3,
    BOOLEAN: 4,
    I1: 5,
    I2: 6,
    I4: 7,
    I8: 8,
    U1: 9,
    U2: 10,
    U4: 11,
    U8: 12,
    F4: 13,
    F8: 14,
} as const;

export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export interface HsmsConfig {
    ip?: string;
    port?: number;
    sessionId?: number;
    passive?: boolean;
    autoReconnect?: boolean;
    t3Ms?: number;
    t5Ms?: number;
    t6Ms?: number;
    t7Ms?: number;
    t8Ms?: number;
}

export interface Secs1Config {
    serialPath?: string;
    baud?: number;
    deviceId?: number;
    reverseBit?: boolean;
    equipmentRole?: boolean;
}

export interface TransportConfig {
    kind?: TransportKind;
    hsms?: HsmsConfig;
    secs1?: Secs1Config;
}

export interface SessionRuntimeConfig {
    requestTimeoutMs?: number;
    pollIntervalMs?: number;
    maxPendingRequests?: number;
    enableDump?: boolean;
    dumpTx?: boolean;
    dumpRx?: boolean;
    enableSecs2DecodeInDump?: boolean;
}

export interface SessionInfo {
    sessionId?: string;
    name?: string;
    state?: SessionState;
    running?: boolean;
    selectedGeneration?: number;
    transport?: TransportConfig;
    runtime?: SessionRuntimeConfig;
    lastError?: RpcError;
}

export interface ItemNode {
    type?: ItemType;
    items?: ItemNode[];
    asciiValue?: string;
    binaryValue?: number[];
    boolValues?: boolean[];
    i1Values?: number[];
    i2Values?: number[];
    i4Values?: number[];
    i8Values?: number[];
    u1Values?: number[];
    u2Values?: number[];
    u4Values?: number[];
    u8Values?: number[];
    f4Values?: number[];
    f8Values?: number[];
}

export interface MessageEnvelope {
    stream?: number;
    function?: number;
    wBit?: boolean;
    systemBytes?: number;
    body?: number[];
    decodedItem?: ItemNode;
}

export interface GetLibraryInfoRequest {}

export interface GetLibraryInfoResponse {
    status?: RpcStatus;
    version?: string;
    supportedTransports?: string[];
    supportedFeatures?: string[];
}

export interface CreateSessionRequest {
    name?: string;
    transport?: TransportConfig;
    runtime?: SessionRuntimeConfig;
}

export interface CreateSessionResponse {
    status?: RpcStatus;
    session?: SessionInfo;
}

export interface GetSessionRequest {
    sessionId?: string;
}

export interface GetSessionResponse {
    status?: RpcStatus;
    session?: SessionInfo;
}

export interface ListSessionsRequest {}

export interface ListSessionsResponse {
    status?: RpcStatus;
    sessions?: SessionInfo[];
}

export interface StartSessionRequest {
    sessionId?: string;
}

export interface StartSessionResponse {
    status?: RpcStatus;
    session?: SessionInfo;
}

export interface StopSessionRequest {
    sessionId?: string;
    reason?: string;
}

export interface StopSessionResponse {
    status?: RpcStatus;
    session?: SessionInfo;
}

export interface DeleteSessionRequest {
    sessionId?: string;
}

export interface DeleteSessionResponse {
    status?: RpcStatus;
    session?: SessionInfo;
}

export interface SendRequest {
    sessionId?: string;
    message?: MessageEnvelope;
}

export interface SendResponse {
    status?: RpcStatus;
    accepted?: MessageEnvelope;
}

export interface RequestRequest {
    sessionId?: string;
    request?: MessageEnvelope;
    timeoutMs?: number;
}

export interface RequestResponse {
    status?: RpcStatus;
    reply?: MessageEnvelope;
}

function buildArgs(
    target?: SecsRpcTarget,
    request?: object,
): Record<string, unknown> | undefined {
    const args: Record<string, unknown> = {};

    if (target) {
        args.target = target;
    }

    if (request) {
        args.request = request;
    }

    return Object.keys(args).length > 0 ? args : undefined;
}

export function secsRpcGetLibraryInfo(
    target?: SecsRpcTarget,
): Promise<GetLibraryInfoResponse> {
    return invoke<GetLibraryInfoResponse>(
        "secs_rpc_get_library_info",
        buildArgs(target),
    );
}

export function secsRpcListSessions(
    target?: SecsRpcTarget,
): Promise<ListSessionsResponse> {
    return invoke<ListSessionsResponse>(
        "secs_rpc_list_sessions",
        buildArgs(target),
    );
}

export function secsRpcGetSession(
    request: GetSessionRequest,
    target?: SecsRpcTarget,
): Promise<GetSessionResponse> {
    return invoke<GetSessionResponse>(
        "secs_rpc_get_session",
        buildArgs(target, request),
    );
}

export function secsRpcCreateSession(
    request: CreateSessionRequest,
    target?: SecsRpcTarget,
): Promise<CreateSessionResponse> {
    return invoke<CreateSessionResponse>(
        "secs_rpc_create_session",
        buildArgs(target, request),
    );
}

export function secsRpcStartSession(
    request: StartSessionRequest,
    target?: SecsRpcTarget,
): Promise<StartSessionResponse> {
    return invoke<StartSessionResponse>(
        "secs_rpc_start_session",
        buildArgs(target, request),
    );
}

export function secsRpcStopSession(
    request: StopSessionRequest,
    target?: SecsRpcTarget,
): Promise<StopSessionResponse> {
    return invoke<StopSessionResponse>(
        "secs_rpc_stop_session",
        buildArgs(target, request),
    );
}

export function secsRpcDeleteSession(
    request: DeleteSessionRequest,
    target?: SecsRpcTarget,
): Promise<DeleteSessionResponse> {
    return invoke<DeleteSessionResponse>(
        "secs_rpc_delete_session",
        buildArgs(target, request),
    );
}

export function secsRpcSend(
    request: SendRequest,
    target?: SecsRpcTarget,
): Promise<SendResponse> {
    return invoke<SendResponse>("secs_rpc_send", buildArgs(target, request));
}

export function secsRpcRequest(
    request: RequestRequest,
    target?: SecsRpcTarget,
): Promise<RequestResponse> {
    return invoke<RequestResponse>("secs_rpc_request", buildArgs(target, request));
}
