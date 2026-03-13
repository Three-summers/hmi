import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock("@/platform/invoke", () => ({
    invoke: invokeMock,
}));

import {
    secsRpcCreateSession,
    secsRpcGetLibraryInfo,
    TransportKind,
} from "../secsRpc";

describe("platform/secsRpc", () => {
    beforeEach(() => {
        invokeMock.mockReset();
    });

    it("查询库信息时应透传 target", async () => {
        invokeMock.mockResolvedValue({ version: "1.0.0" });

        await secsRpcGetLibraryInfo({
            endpoint: "127.0.0.1:50051",
            requestTimeoutMs: 1200,
        });

        expect(invokeMock).toHaveBeenCalledWith("secs_rpc_get_library_info", {
            target: {
                endpoint: "127.0.0.1:50051",
                requestTimeoutMs: 1200,
            },
        });
    });

    it("创建会话时应同时透传 request 与 target", async () => {
        invokeMock.mockResolvedValue({ status: { ok: true } });

        await secsRpcCreateSession(
            {
                name: "demo",
                transport: {
                    kind: TransportKind.HSMS,
                    hsms: {
                        ip: "127.0.0.1",
                        port: 5000,
                    },
                },
            },
            {
                endpoint: "http://127.0.0.1:50051",
            },
        );

        expect(invokeMock).toHaveBeenCalledWith("secs_rpc_create_session", {
            target: {
                endpoint: "http://127.0.0.1:50051",
            },
            request: {
                name: "demo",
                transport: {
                    kind: TransportKind.HSMS,
                    hsms: {
                        ip: "127.0.0.1",
                        port: 5000,
                    },
                },
            },
        });
    });
});
