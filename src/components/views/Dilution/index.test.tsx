import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewCommandProvider } from "@/components/layout/ViewCommandContext";
import { SubViewCommandProvider } from "@/components/layout/SubViewCommandContext";
import { ViewContextProvider } from "@/components/layout/ViewContext";
import { CommandPanel } from "@/components/layout/CommandPanel";
import { render } from "@/test/utils";
import { useAppStore, useNotificationStore } from "@/stores";
import type {
    Batch,
    DilutionConfig,
} from "@/types/dilution";
import DilutionView from "./index";

const dilutionApi = vi.hoisted(() => ({
    dilutionCreateBatch: vi.fn(),
    dilutionGetConfig: vi.fn(),
    dilutionGetReport: vi.fn(),
    dilutionListBatches: vi.fn(),
    dilutionRunBatch: vi.fn(),
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

const config: DilutionConfig = {
    machine: { eqptId: "EQPT-001" },
    personnel: { operator: "张工", checker: "李工" },
    dilutionOptions: [
        {
            concentration: "70%",
            recipeId: "dilute-70",
            ratio: { raw: 7, solvent: 3 },
            mixTimeMs: 300_000,
            settleTimeMs: 120_000,
        },
    ],
};

function baseBatch(overrides: Partial<Batch> = {}): Batch {
    return {
        id: "DIL-0001",
        machineId: "EQPT-001",
        status: "draft",
        operatorId: "张工",
        reviewerIds: [],
        plannedBottleCount: 3,
        targetBottleMassG: 500,
        createdAtMs: now,
        rawScans: [],
        meteringRecords: [],
        outputBottles: [],
        prmsSync: [],
        resistBarcodes: [],
        resistSysRrns: [],
        alarms: [],
        ...overrides,
    };
}

function scannedBatch(overrides: Partial<Batch> = {}): Batch {
    return baseBatch({
        status: "resist_info_resolved",
        rawScans: [
            {
                scanId: "scan-1",
                barcode: "MZJTST11234567826050700003",
                scannedAtMs: now,
                operatorId: "张工",
                materialName: "TMR-IK02 PM 5.4cP",
                lotId: "12345678",
                prmsQueryId: "MZJTST11234567826050700003",
                validationStatus: "accepted",
                validationMessage: "accepted",
            },
        ],
        resistInfo: {
            resistNo: "MZJTST1",
            resistName: "TMR-IK02 PM 5.4cP",
            concentration: "1.0",
            mtrNO: "MTR001",
            defrostTime: "08:00",
            defrostBufferDays: 0,
            warningDay: 7,
            extendDays: 30,
            viscosityUpperLimit: 10,
            viscosityLowerLimit: 1,
            vendorBarcode: "MZJTST11234567826050700003",
            defBatchNO: "12345678",
            toResistNo: "MZJTST1",
            expireTime: "260507",
            dilutionRelationships: [
                {
                    resistNo: "IK02-D",
                    resistName: "IK02-D 70%",
                    concentration: "70%",
                    sysRrn: "2011636530905427800",
                },
            ],
        },
        ...overrides,
    });
}

function multiOptionBatch(): Batch {
    return baseBatch({
        status: "resist_info_resolved",
        rawScans: [
            {
                scanId: "scan-1",
                barcode: "MULTI-LOT01-B01",
                scannedAtMs: now,
                operatorId: "张工",
                materialName: "TMR-MULTI PM 5.4cP",
                lotId: "12345678",
                prmsQueryId: "MULTI-LOT01-B01",
                validationStatus: "accepted",
                validationMessage: "accepted",
            },
        ],
        resistInfo: {
            resistNo: "MULTI",
            resistName: "TMR-MULTI PM 5.4cP",
            concentration: "1.0",
            mtrNO: "MTR001",
            defrostTime: "08:00",
            defrostBufferDays: 0,
            warningDay: 7,
            extendDays: 30,
            viscosityUpperLimit: 10,
            viscosityLowerLimit: 1,
            vendorBarcode: "MULTI-LOT01-B01",
            defBatchNO: "12345678",
            toResistNo: "MULTI",
            expireTime: "260507",
            dilutionRelationships: [
                {
                    resistNo: "MULTI-D",
                    resistName: "MULTI-D 60%",
                    concentration: "60%",
                    sysRrn: "2004086388857843700",
                },
                {
                    resistNo: "MULTI-D2",
                    resistName: "MULTI-D2 70%",
                    concentration: "70%",
                    sysRrn: "2011636530905427900",
                },
            ],
        },
    });
}

function lockedBatch(overrides: Partial<Batch> = {}): Batch {
    return scannedBatch({
        status: "recipe_locked",
        selectedConcentration: "70%",
        resistDefRrn: "2011636530905427800",
        checkResult: {
            resistNO: "MZJTST1",
            defResistNO: "IK02-D",
            resistDefRrn: "2011636530905427800",
            batchNO: "12345678",
            expireDate: "260507",
            concentration: "70%",
            barcodeCount: 1,
        },
        selectedRecipe: {
            id: "dilute-70",
            version: "config-v1",
            rawResistName: "TMR-IK02 PM 5.4cP",
            concentration: "70%",
            dilutionResistName: "IK02-D 70%",
            ratio: { raw: 7, solvent: 3 },
            mixTimeMs: 300_000,
            settleTimeMs: 120_000,
            standardBottleMassG: 500,
            recipeId: "dilute-70",
        },
        ...overrides,
    });
}

function completedBatch(): Batch {
    return lockedBatch({
        status: "completed",
        completedAtMs: now + 60_000,
        resistBarcodes: ["MZJTST11234567826050701001", "MZJTST11234567826050701002"],
        resistSysRrns: ["2030625845182312501", "2030625845182312502"],
        printSuccess: true,
        outputBottles: [
            {
                index: 1,
                targetMassG: 500,
                actualMassG: 500,
                dilutionBarcode: "MZJTST11234567826050701001",
                barcodeStatus: "assigned",
                printStatus: "printed",
                isLastUnderfilled: false,
            },
            {
                index: 2,
                targetMassG: 500,
                actualMassG: 400,
                dilutionBarcode: "MZJTST11234567826050701002",
                barcodeStatus: "assigned",
                printStatus: "printed",
                isLastUnderfilled: true,
            },
        ],
        report: {
            reportId: "report-DIL-0001",
            batchId: "DIL-0001",
            eqptId: "EQPT-001",
            operator: "张工",
            checker: "李工",
            sourceResistName: "TMR-IK02 PM 5.4cP",
            sourceResistBarcode: "MZJTST11234567826050700003",
            sourceResistWeight: 1000,
            sourceBottleCount: 1,
            viscosity: 5.4,
            dilutionResistName: "IK02-D 70%",
            dilutionBottleCount: 2,
            dilutionWeight: 1400,
            outputBottles: [
                {
                    index: 1,
                    dilutionBarcode: "MZJTST11234567826050701001",
                    actualMassG: 500,
                },
                {
                    index: 2,
                    dilutionBarcode: "MZJTST11234567826050701002",
                    actualMassG: 400,
                },
            ],
            resistSysRrns: ["2030625845182312501", "2030625845182312502"],
            printSuccess: true,
        },
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
    dilutionApi.dilutionGetConfig.mockResolvedValue(config);
    useAppStore.getState().login({
        id: "u-001",
        name: "tester",
        role: "engineer",
    });
});

describe("DilutionView", () => {
    it("should prefill machine and operator from config", async () => {
        renderDilutionView();
        await waitFor(() => {
            expect(dilutionApi.dilutionGetConfig).toHaveBeenCalled();
        });
        const machineInput = screen.getByLabelText("机台") as HTMLInputElement;
        expect(machineInput.value).toBe("EQPT-001");
        const operatorInput = screen.getByLabelText("操作员") as HTMLInputElement;
        expect(operatorInput.value).toBe("张工");
    });

    it("should create batch with config-prefilled values", async () => {
        dilutionApi.dilutionCreateBatch.mockResolvedValue(baseBatch());
        renderDilutionView();
        await waitFor(() => {
            expect(screen.getByLabelText("机台")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("新建批次"));
        await waitFor(() => {
            expect(dilutionApi.dilutionCreateBatch).toHaveBeenCalledWith({
                machineId: "EQPT-001",
                operatorId: "张工",
                checkerId: "李工",
                plannedBottleCount: 3,
                targetBottleMassG: 500,
            });
        });
        expect(await screen.findByText("DIL-0001")).toBeInTheDocument();
    });

    it("should scan barcode and show resist info", async () => {
        dilutionApi.dilutionCreateBatch.mockResolvedValue(baseBatch());
        dilutionApi.dilutionScanRawResist.mockResolvedValue(scannedBatch());
        renderDilutionView();
        await waitFor(() => {
            expect(screen.getByLabelText("机台")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("新建批次"));
        await screen.findByText("DIL-0001");

        // 浏览到原液扫码步骤
        fireEvent.click(screen.getByText("原液扫码"));
        const barcodeInput = screen.getByLabelText("Barcode") as HTMLInputElement;
        fireEvent.change(barcodeInput, {
            target: { value: "MZJTST11234567826050700003" },
        });
        fireEvent.click(screen.getByText("扫码查询"));
        await waitFor(() => {
            expect(dilutionApi.dilutionScanRawResist).toHaveBeenCalledWith({
                batchId: "DIL-0001",
                barcode: "MZJTST11234567826050700003",
                operatorId: "张工",
            });
        });
        // 单浓度自动锁定 → 展示锁定信息
        expect(await screen.findByText("IK02-D 70%")).toBeInTheDocument();
    });

    it("should lock concentration and show recipe", async () => {
        dilutionApi.dilutionCreateBatch.mockResolvedValue(baseBatch());
        dilutionApi.dilutionScanRawResist.mockResolvedValue(multiOptionBatch());
        dilutionApi.dilutionSelectConcentration.mockResolvedValue(lockedBatch());
        renderDilutionView();
        await waitFor(() => {
            expect(screen.getByLabelText("机台")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("新建批次"));
        await screen.findByText("DIL-0001");

        fireEvent.click(screen.getByText("原液扫码"));
        const barcodeInput = screen.getByLabelText("Barcode") as HTMLInputElement;
        fireEvent.change(barcodeInput, {
            target: { value: "MULTI-LOT01-B01" },
        });
        fireEvent.click(screen.getByText("扫码查询"));
        await screen.findByText("TMR-MULTI PM 5.4cP");

        // 多浓度 → 进入 recipe 步骤选择浓度
        const select = screen.getByRole("combobox") as HTMLSelectElement;
        fireEvent.change(select, { target: { value: "70%" } });
        fireEvent.click(screen.getByText("锁定浓度"));
        await waitFor(() => {
            expect(dilutionApi.dilutionSelectConcentration).toHaveBeenCalledWith({
                batchId: "DIL-0001",
                concentration: "70%",
            });
        });
        await waitFor(() => {
            expect(screen.getAllByText("dilute-70").length).toBeGreaterThan(0);
        });
    });

    it("should run batch and show completed barcodes", async () => {
        dilutionApi.dilutionCreateBatch.mockResolvedValue(baseBatch());
        dilutionApi.dilutionScanRawResist.mockResolvedValue(lockedBatch());
        dilutionApi.dilutionRunBatch.mockResolvedValue(completedBatch());
        renderDilutionView();
        await waitFor(() => {
            expect(screen.getByLabelText("机台")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("新建批次"));
        await screen.findByText("DIL-0001");

        fireEvent.click(screen.getByText("原液扫码"));
        const barcodeInput = screen.getByLabelText("Barcode") as HTMLInputElement;
        fireEvent.change(barcodeInput, {
            target: { value: "MZJTST11234567826050700003" },
        });
        fireEvent.click(screen.getByText("扫码查询"));
        await screen.findByText("IK02-D 70%");

        fireEvent.click(screen.getByText("开始执行"));
        await waitFor(() => {
            expect(dilutionApi.dilutionRunBatch).toHaveBeenCalledWith({
                batchId: "DIL-0001",
                rawLoad: { mode: "mass", targetMassG: 1000 },
            });
        });
        // 完成后自动进入报表步骤
        expect(
            await screen.findByText(/MZJTST11234567826050701001/),
        ).toBeInTheDocument();
        expect(screen.getAllByText("5.4 cP").length).toBeGreaterThan(0);
    });

    it("should disable run when recipe is not locked", async () => {
        renderDilutionView();
        await waitFor(() => {
            expect(screen.getByText("新建批次")).toBeInTheDocument();
        });
        const runButton = screen.getByText("开始执行").closest("button");
        expect(runButton).toBeDisabled();
    });

    it("should show error notification when create fails", async () => {
        dilutionApi.dilutionCreateBatch.mockRejectedValue(
            new Error("machineId is required"),
        );
        renderDilutionView();
        await waitFor(() => {
            expect(screen.getByText("新建批次")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("新建批次"));
        await waitFor(() => {
            const notifications = useNotificationStore.getState().notifications;
            expect(
                notifications.some(
                    (notification) =>
                        notification.type === "error" &&
                        notification.message?.includes("machineId is required"),
                ),
            ).toBe(true);
        });
    });
});
