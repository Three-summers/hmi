import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "@/utils/async";

describe("stores/commStore", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("connectSerial 成功时应更新连接状态与配置", async () => {
        const invokeMock = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/platform/invoke", () => ({ invoke: invokeMock }));

        const { useCommStore } = await import("../commStore");

        useCommStore.setState({ serialConnected: false, lastError: undefined });
        await useCommStore.getState().connectSerial({
            port: "COM1",
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
        });

        expect(invokeMock).toHaveBeenCalledWith("connect_serial", {
            config: {
                port: "COM1",
                baud_rate: 9600,
                data_bits: 8,
                stop_bits: 1,
                parity: "none",
            },
        });

        const state = useCommStore.getState();
        expect(state.serialConnected).toBe(true);
        expect(state.serialConfig?.port).toBe("COM1");
        expect(state.lastError).toBeUndefined();
    });

    it("connectSerial 失败时应写入 lastError 并继续抛出原错误", async () => {
        const boom = new Error("boom");
        vi.doMock("@/platform/invoke", () => ({
            invoke: vi.fn().mockRejectedValue(boom),
        }));

        const { useCommStore } = await import("../commStore");

        useCommStore.setState({ serialConnected: false, lastError: undefined });

        await expect(
            useCommStore.getState().connectSerial({
                port: "COM1",
                baudRate: 9600,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
            }),
        ).rejects.toBe(boom);

        expect(useCommStore.getState().lastError).toBe("boom");
        expect(useCommStore.getState().serialConnected).toBe(false);
    });

    it("disconnectSerial 成功时应断开并清理配置", async () => {
        const invokeMock = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/platform/invoke", () => ({ invoke: invokeMock }));

        const { useCommStore } = await import("../commStore");

        useCommStore.setState({
            serialConnected: true,
            serialConfig: {
                port: "COM1",
                baudRate: 9600,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
            },
        });

        await useCommStore.getState().disconnectSerial();
        expect(invokeMock).toHaveBeenCalledWith("disconnect_serial", undefined);
        expect(useCommStore.getState().serialConnected).toBe(false);
        expect(useCommStore.getState().serialConfig).toBeUndefined();
    });

    it("sendSerialData 失败时应写入 lastError 并触发 onError", async () => {
        const boom = new Error("send boom");
        vi.doMock("@/platform/invoke", () => ({
            invoke: vi.fn().mockRejectedValue(boom),
        }));

        const { useCommStore } = await import("../commStore");

        const onError = vi.fn();
        await expect(
            useCommStore.getState().sendSerialData([1, 2, 3], { onError }),
        ).rejects.toBe(boom);

        expect(useCommStore.getState().lastError).toBe("send boom");
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith("send boom", boom);
    });

    it("connectTcp 成功时应更新连接状态与配置（默认使用 config.timeoutMs）", async () => {
        const invokeMock = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/platform/invoke", () => ({ invoke: invokeMock }));

        const { useCommStore } = await import("../commStore");

        await useCommStore.getState().connectTcp({
            host: "127.0.0.1",
            port: 502,
            timeoutMs: 1234,
        });

        expect(invokeMock).toHaveBeenCalledWith("connect_tcp", {
            config: { host: "127.0.0.1", port: 502, timeout_ms: 1234 },
        });
        expect(useCommStore.getState().tcpConnected).toBe(true);
        expect(useCommStore.getState().tcpConfig?.timeoutMs).toBe(1234);
    });

    it("disconnectTcp 成功时应断开并清理配置", async () => {
        const invokeMock = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/platform/invoke", () => ({ invoke: invokeMock }));

        const { useCommStore } = await import("../commStore");

        useCommStore.setState({
            tcpConnected: true,
            tcpConfig: { host: "127.0.0.1", port: 502, timeoutMs: 1000 },
        });

        await useCommStore.getState().disconnectTcp();
        expect(invokeMock).toHaveBeenCalledWith("disconnect_tcp", undefined);
        expect(useCommStore.getState().tcpConnected).toBe(false);
        expect(useCommStore.getState().tcpConfig).toBeUndefined();
    });

    it("sendTcpData 成功时应调用后端命令", async () => {
        const invokeMock = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/platform/invoke", () => ({ invoke: invokeMock }));

        const { useCommStore } = await import("../commStore");

        await useCommStore.getState().sendTcpData([9, 8, 7]);
        expect(invokeMock).toHaveBeenCalledWith("send_tcp_data", { data: [9, 8, 7] });
    });

    it("getSerialPorts 成功时应返回端口列表", async () => {
        const invokeMock = vi.fn().mockResolvedValue(["COM1", "COM2"]);
        vi.doMock("@/platform/invoke", () => ({ invoke: invokeMock }));

        const { useCommStore } = await import("../commStore");

        await expect(useCommStore.getState().getSerialPorts()).resolves.toEqual([
            "COM1",
            "COM2",
        ]);
        expect(invokeMock).toHaveBeenCalledWith("get_serial_ports", undefined);
    });

    it("getSerialPorts 超时时应抛出 TimeoutError，并写入中文超时信息", async () => {
        vi.useFakeTimers();

        const pendingPromise = new Promise(() => {
            /* 永不 resolve */
        });
        const invokeMock = vi
            .fn()
            .mockReturnValue(pendingPromise);
        vi.doMock("@/platform/invoke", () => ({
            invoke: invokeMock,
        }));

        const { useCommStore } = await import("../commStore");

        const promise = useCommStore
            .getState()
            .getSerialPorts({ timeoutMs: 20 });

        // 推进时间触发超时
        await vi.advanceTimersByTimeAsync(20);

        try {
            await promise;
            throw new Error("Expected promise to reject");
        } catch (error) {
            expect(error).toBeInstanceOf(TimeoutError);
            expect((error as Error).message).toContain("通信操作超时");
        }

        expect(useCommStore.getState().lastError).toContain("通信操作超时");

        vi.useRealTimers();
    });

    it("clearError 应清空 lastError", async () => {
        vi.doMock("@/platform/invoke", () => ({
            invoke: vi.fn().mockResolvedValue(undefined),
        }));

        const { useCommStore } = await import("../commStore");

        useCommStore.setState({ lastError: "x" });
        useCommStore.getState().clearError();
        expect(useCommStore.getState().lastError).toBeUndefined();
    });
});
