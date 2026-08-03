import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { ViewContextProvider } from "@/components/layout/ViewContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";
import { useAppStore } from "@/stores";
import type { DilutionBatch } from "@/platform/dilution";
import DilutionView from "./index";

const dilutionApi = vi.hoisted(() => ({
    dilutionCreateBatch: vi.fn(),
    dilutionGetReport: vi.fn(),
    dilutionListBatches: vi.fn(),
    dilutionRunBatch: vi.fn(),
    dilutionRunMockBatch: vi.fn(),
    dilutionScanRawResist: vi.fn(),
    dilutionSelectConcentration: vi.fn(),
}));

vi.mock("@/platform/dilution", () => dilutionApi);

function renderDilutionView() {
    return render(
        <ViewContextProvider value={{ viewId: "run", isActive: true }}>
            <ViewCommandProvider>
                <SubViewCommandProvider>
                    <div>
                        <CommandPanel currentView="run" />
                        <DilutionView />
                    </div>
                </SubViewCommandProvider>
            </ViewCommandProvider>
        </ViewContextProvider>,
    );
}

const now = 1_780_000_000_000;

function baseBatch(overrides: Partial<DilutionBatch> = {}): DilutionBatch {
    return {
        id: "DIL-0001",
        machineId: "MCP-03",
        status: "draft",
        operatorId: "op-001",
        reviewerIds: ["qa-001"],
        plannedBottleCount: 3,
        targetBottleMassG: 500,
        createdAtMs: now,
        rawScans: [],
        meteringRecords: [],
        outputBottles: [],
        prmsSync: [],
        alarms: [],
        ...overrides,
    };
}

function scannedBatch(): DilutionBatch {
    const mapping = {
        mappingId: "mock-map-IK02",
        rawResistName: "TMR-IK02 PM 5.4cP",
        rawResistCode: "IK02",
        allowedMachineIds: ["MCP-03"],
        dilutionOptions: [
            {
                concentration: "70%",
                dilutionResistName: "IK02-70%",
                ratio: { raw: 7, solvent: 3 },
                recipeKey: "mock-ik02-70",
                viscosityMinCp: 4,
                viscosityMaxCp: 7,
            },
        ],
        returnedAtMs: now + 1,
        rawPayload: { mock: true },
    };

    return baseBatch({
        status: "recipe_locked",
        rawScans: [
            {
                scanId: "scan-1",
                barcode: "RAW-IK02-LOT01-B01",
                scannedAtMs: now + 1,
                operatorId: "op-001",
                materialName: "TMR-IK02 PM 5.4cP",
                lotId: "MOCK-LOT",
                prmsQueryId: "mock-map-IK02",
                validationStatus: "accepted",
                validationMessage: "mock PRMS mapping accepted",
            },
        ],
        prmsMapping: mapping,
        selectedRecipe: {
            id: "mock-ik02-70",
            version: "mock-v1",
            rawResistName: "TMR-IK02 PM 5.4cP",
            concentration: "70%",
            dilutionResistName: "IK02-70%",
            ratio: { raw: 7, solvent: 3 },
            rawDensityGPerMl: 1,
            solventDensityGPerMl: 1,
            mixTimeMs: 300_000,
            settleTimeMs: 120_000,
            viscosityMinCp: 4,
            viscosityMaxCp: 7,
            standardBottleMassG: 500,
        },
        prmsSync: [
            {
                id: "sync-1",
                operation: "query_mapping",
                idempotencyKey: "mock-sync-1",
                requestPayload: { barcodeCount: 1 },
                responsePayload: { mock: true },
                status: "succeeded",
                attemptCount: 1,
                createdAtMs: now + 1,
                updatedAtMs: now + 1,
            },
        ],
    });
}

function multiOptionBatch(): DilutionBatch {
    const scanned = scannedBatch();
    const option = scanned.prmsMapping!.dilutionOptions[0];
    return {
        ...scanned,
        status: "mapping_resolved",
        selectedRecipe: undefined,
        prmsMapping: {
            ...scanned.prmsMapping!,
            dilutionOptions: [
                {
                    ...option,
                    concentration: "60%",
                    dilutionResistName: "IK02-60%",
                    recipeKey: "mock-ik02-60",
                    ratio: { raw: 6, solvent: 4 },
                },
                option,
            ],
        },
    };
}

function completedBatch(): DilutionBatch {
    const scanned = scannedBatch();
    return {
        ...scanned,
        status: "completed",
        completedAtMs: now + 100,
        meteringRecords: [
            {
                id: "raw",
                kind: "raw",
                targetMassG: 1000,
                actualVolumeMl: 1000,
                densityGPerMl: 1,
                actualMassG: 1000,
                toleranceG: 2,
                deviationG: 0,
                startedAtMs: now + 10,
                finishedAtMs: now + 11,
                sourceDeviceId: "mock-meter",
                status: "completed",
            },
            {
                id: "solvent",
                kind: "solvent",
                targetMassG: 428.6,
                actualVolumeMl: 428.6,
                densityGPerMl: 1,
                actualMassG: 428.6,
                toleranceG: 2,
                deviationG: 0,
                startedAtMs: now + 12,
                finishedAtMs: now + 13,
                sourceDeviceId: "mock-meter",
                status: "completed",
            },
        ],
        viscosity: {
            testId: "visc-DIL-0001",
            readingsCp: [
                {
                    index: 1,
                    valueCp: 5.2,
                    measuredAtMs: now + 20,
                    sourceDeviceId: "mock-viscometer",
                },
                {
                    index: 2,
                    valueCp: 5.4,
                    measuredAtMs: now + 21,
                    sourceDeviceId: "mock-viscometer",
                },
            ],
            averageCp: 5.3,
            prmsResult: "pass",
            uploadedAtMs: now + 22,
            syncRecordId: "sync-2",
        },
        outputBottles: [1, 2, 3].map((index) => ({
            index,
            targetMassG: 500,
            actualMassG: index === 3 ? 428.6 : 500,
            dilutionBarcode: `DIL-DIL-0001-${String(index).padStart(3, "0")}`,
            barcodeStatus: "assigned",
            printStatus: "printed",
            dispensedAtMs: now + 30 + index,
            isLastUnderfilled: index === 3,
            meteringRecordId: `meter-output-${index}`,
        })),
        prmsSync: [
            ...scanned.prmsSync,
            {
                id: "sync-2",
                operation: "upload_viscosity",
                idempotencyKey: "mock-sync-2",
                requestPayload: { averageCp: 5.3 },
                responsePayload: { hold: false },
                status: "succeeded",
                attemptCount: 1,
                createdAtMs: now + 22,
                updatedAtMs: now + 22,
            },
            {
                id: "sync-3",
                operation: "request_dilution_barcodes",
                idempotencyKey: "mock-sync-3",
                requestPayload: { bottleCount: 3 },
                responsePayload: { barcodes: ["DIL-DIL-0001-001"] },
                status: "succeeded",
                attemptCount: 1,
                createdAtMs: now + 23,
                updatedAtMs: now + 23,
            },
        ],
        report: {
            reportId: "report-DIL-0001",
            batchId: "DIL-0001",
            rawResistName: "TMR-IK02 PM 5.4cP",
            rawBarcodes: ["RAW-IK02-LOT01-B01"],
            rawMassG: 1000,
            machineId: "MCP-03",
            operatorId: "op-001",
            reviewerIds: ["qa-001"],
            viscosityAverageCp: 5.3,
            dilutionResistName: "IK02-70%",
            outputBottles: [1, 2, 3].map((index) => ({
                index,
                dilutionBarcode: `DIL-DIL-0001-${String(index).padStart(3, "0")}`,
                actualMassG: index === 3 ? 428.6 : 500,
            })),
            comment: "PGMEA as mock dilution solvent",
        },
    };
}

describe("DilutionView", () => {
    beforeEach(() => {
        dilutionApi.dilutionCreateBatch.mockResolvedValue(baseBatch());
        dilutionApi.dilutionGetReport.mockResolvedValue(completedBatch().report);
        dilutionApi.dilutionListBatches.mockResolvedValue([baseBatch()]);
        dilutionApi.dilutionScanRawResist.mockResolvedValue(scannedBatch());
        dilutionApi.dilutionSelectConcentration.mockResolvedValue(scannedBatch());
        dilutionApi.dilutionRunBatch.mockResolvedValue(completedBatch());
        dilutionApi.dilutionRunMockBatch.mockResolvedValue(completedBatch());
        useAppStore.setState({ user: null });
    });

    it("runs the backend mock command flow from creation through completed report", async () => {
        useAppStore.setState({
            user: { id: "operator", name: "Operator", role: "operator" },
        });
        renderDilutionView();

        fireEvent.change(screen.getByLabelText("上料模式"), {
            target: { value: "bottle_count" },
        });
        fireEvent.change(screen.getByLabelText("原液瓶数"), {
            target: { value: "2" },
        });
        fireEvent.change(screen.getByLabelText("粘度1"), {
            target: { value: "5.1" },
        });
        fireEvent.change(screen.getByLabelText("粘度2"), {
            target: { value: "5.3" },
        });

        fireEvent.click(screen.getByRole("button", { name: "新建批次" }));

        await screen.findByText(/DIL-/);
        expect(screen.getByText("MCP-03")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "扫描原液" }));

        await screen.findByText("TMR-IK02 PM 5.4cP");
        expect(screen.getAllByText("70%").length).toBeGreaterThan(0);
        expect(screen.getAllByText("配方已锁定").length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole("button", { name: "运行 Mock" }));

        await screen.findAllByText("已完成");
        expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
        expect(screen.getAllByText("5.3 cP").length).toBeGreaterThan(0);
        expect(screen.getAllByText("report").length).toBeGreaterThan(0);
        expect(screen.getAllByText(/DIL-DIL-/).length).toBeGreaterThan(0);

        await waitFor(() => {
            expect(screen.getByText("报表完成")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole("button", { name: "导出报表" }));

        expect(dilutionApi.dilutionCreateBatch).toHaveBeenCalledWith({
            machineId: "MCP-03",
            operatorId: "op-001",
            reviewerIds: ["qa-001"],
            plannedBottleCount: 3,
            targetBottleMassG: 500,
        });
        expect(dilutionApi.dilutionScanRawResist).toHaveBeenCalledWith({
            batchId: "DIL-0001",
            barcode: "RAW-IK02-LOT01-B01",
            operatorId: "op-001",
        });
        expect(dilutionApi.dilutionRunMockBatch).toHaveBeenCalledWith({
            batchId: "DIL-0001",
            rawLoad: { mode: "bottle_count", bottleCount: 2 },
            viscosityReadingsCp: [5.1, 5.3],
        });
        expect(dilutionApi.dilutionRunBatch).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(dilutionApi.dilutionGetReport).toHaveBeenCalledWith("DIL-0001");
        });
    });

    it("requires login before running dilution batch mutations", async () => {
        const dispatchSpy = vi.spyOn(window, "dispatchEvent");
        renderDilutionView();

        fireEvent.click(screen.getByRole("button", { name: "新建批次" }));
        expect(dilutionApi.dilutionCreateBatch).not.toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: "hmi:request-login-dialog" }),
        );

        dilutionApi.dilutionListBatches.mockResolvedValueOnce([multiOptionBatch()]);
        fireEvent.click(screen.getByRole("button", { name: "加载批次" }));
        await waitFor(() => {
            expect(dilutionApi.dilutionListBatches).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: "锁定浓度" }),
            ).not.toBeDisabled();
        });
        fireEvent.click(screen.getByRole("button", { name: "扫描原液" }));
        fireEvent.click(screen.getByRole("button", { name: "锁定浓度" }));

        dilutionApi.dilutionListBatches.mockResolvedValueOnce([scannedBatch()]);
        fireEvent.click(screen.getByRole("button", { name: "加载批次" }));
        await waitFor(() => {
            expect(dilutionApi.dilutionListBatches).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: "运行 Mock" }),
            ).not.toBeDisabled();
        });
        fireEvent.click(screen.getByRole("button", { name: "运行 Mock" }));

        expect(dilutionApi.dilutionScanRawResist).not.toHaveBeenCalled();
        expect(dilutionApi.dilutionSelectConcentration).not.toHaveBeenCalled();
        expect(dilutionApi.dilutionRunMockBatch).not.toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledTimes(4);

        dispatchSpy.mockRestore();
    });
});
