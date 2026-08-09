import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerInvokeMock } from "./invoke";
import {
    dilutionCreateBatch,
    dilutionGetBatch,
    dilutionGetConfig,
    dilutionListBatches,
    dilutionRunBatch,
    dilutionScanRawResist,
    dilutionSelectConcentration,
} from "./dilution";
import type { Batch, DilutionConfig } from "@/types/dilution";

const batch: Batch = {
    id: "DIL-1",
    machineId: "EQPT-001",
    status: "draft",
    operatorId: "op",
    reviewerIds: [],
    plannedBottleCount: 1,
    targetBottleMassG: 500,
    createdAtMs: 1,
    rawScans: [],
    resistBarcodes: [],
    resistSysRrns: [],
    outputBottles: [],
    alarms: [],
};

beforeEach(() => {
    vi.restoreAllMocks();
});

describe("dilution rpc", () => {
    it("should invoke create batch", async () => {
        registerInvokeMock("dilution_create_batch", () => batch);
        const result = await dilutionCreateBatch({
            machineId: "EQPT-001",
            plannedBottleCount: 1,
            targetBottleMassG: 500,
        });
        expect(result.id).toBe("DIL-1");
    });

    it("should invoke get batch", async () => {
        registerInvokeMock("dilution_get_batch", () => batch);
        const result = await dilutionGetBatch("DIL-1");
        expect(result.id).toBe("DIL-1");
    });

    it("should invoke list batches", async () => {
        registerInvokeMock("dilution_list_batches", () => [batch]);
        const result = await dilutionListBatches();
        expect(result).toHaveLength(1);
    });

    it("should invoke scan and return batch", async () => {
        registerInvokeMock("dilution_scan_raw_resist", () => batch);
        const result = await dilutionScanRawResist({
            batchId: "DIL-1",
            barcode: "X",
            operatorId: "op",
        });
        expect(result.id).toBe("DIL-1");
    });

    it("should invoke select concentration", async () => {
        registerInvokeMock("dilution_select_concentration", () => batch);
        const result = await dilutionSelectConcentration({
            batchId: "DIL-1",
            concentration: "70%",
        });
        expect(result.id).toBe("DIL-1");
    });

    it("should invoke run batch with raw load", async () => {
        registerInvokeMock("dilution_run_batch", () => batch);
        const result = await dilutionRunBatch({
            batchId: "DIL-1",
            rawLoad: { mode: "mass", targetMassG: 1000 },
        });
        expect(result.id).toBe("DIL-1");
    });

    it("should get config", async () => {
        const config: DilutionConfig = { dilutionOptions: [] };
        registerInvokeMock("dilution_get_config", () => config);
        const result = await dilutionGetConfig();
        expect(result.dilutionOptions).toEqual([]);
    });
});
