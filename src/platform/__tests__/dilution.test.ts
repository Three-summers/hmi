import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const registerInvokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/platform/invoke", () => ({
    invoke: invokeMock,
    registerInvokeMock,
}));

describe("platform/dilution", () => {
    beforeEach(() => {
        invokeMock.mockReset();
        registerInvokeMock.mockReset();
    });

    it("wraps backend Tauri commands without registering a browser business mock", async () => {
        const mod = await import("../dilution");
        const request = {
            machineId: "MCP-03",
            operatorId: "op-001",
            reviewerIds: ["qa-001"],
            plannedBottleCount: 3,
            targetBottleMassG: 500,
        };
        invokeMock.mockResolvedValue({ id: "DIL-1", status: "draft" });

        await expect(mod.dilutionCreateBatch(request)).resolves.toMatchObject({
            id: "DIL-1",
        });

        expect(registerInvokeMock).not.toHaveBeenCalled();
        expect(invokeMock).toHaveBeenCalledWith("dilution_create_batch", {
            request,
        });
    });

    it("uses the stable run batch command for the end-to-end backend flow", async () => {
        const mod = await import("../dilution");
        const request = {
            batchId: "DIL-1",
            rawLoad: { mode: "mass" as const, targetMassG: 1000 },
            viscosityReadingsCp: [5.2, 5.4],
        };
        invokeMock.mockResolvedValue({ id: "DIL-1", status: "completed" });

        await expect(mod.dilutionRunBatch(request)).resolves.toMatchObject({
            status: "completed",
        });

        expect(invokeMock).toHaveBeenCalledWith("dilution_run_batch", {
            request,
        });
    });

    it("lists batches through the backend command", async () => {
        const mod = await import("../dilution");
        invokeMock.mockResolvedValue([{ id: "DIL-1", status: "draft" }]);

        await expect(mod.dilutionListBatches()).resolves.toHaveLength(1);

        expect(invokeMock).toHaveBeenCalledWith("dilution_list_batches");
    });

    it("gets reports through the backend command", async () => {
        const mod = await import("../dilution");
        invokeMock.mockResolvedValue({ reportId: "report-DIL-1" });

        await expect(mod.dilutionGetReport("DIL-1")).resolves.toMatchObject({
            reportId: "report-DIL-1",
        });

        expect(invokeMock).toHaveBeenCalledWith("dilution_get_report", {
            batchId: "DIL-1",
        });
    });
});
