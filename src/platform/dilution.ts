import { invoke } from "@/platform/invoke";

export type DilutionBatchStatus =
    | "draft"
    | "scanning_raw_resist"
    | "mapping_resolved"
    | "recipe_locked"
    | "raw_loading"
    | "solvent_loading"
    | "mixing"
    | "settling"
    | "viscosity_testing"
    | "viscosity_synced"
    | "barcode_requested"
    | "printing"
    | "dispensing"
    | "report_pending"
    | "completed"
    | "suspended"
    | "failed";

export type ScanValidationStatus = "accepted" | "rejected";
export type MeteringKind = "raw" | "solvent" | "output";
export type MeteringStatus = "completed";
export type BarcodeStatus = "pending" | "assigned";
export type PrintStatus = "pending" | "printed" | "failed";
export type PrmsOperation =
    | "query_mapping"
    | "upload_viscosity"
    | "request_dilution_barcodes";
export type SyncStatus = "succeeded" | "failed";

export interface CreateBatchRequest {
    machineId: string;
    operatorId: string;
    reviewerIds?: string[];
    plannedBottleCount: number;
    targetBottleMassG: number;
}

export interface ScanRawResistRequest {
    batchId: string;
    barcode: string;
    operatorId: string;
}

export interface SelectConcentrationRequest {
    batchId: string;
    concentration: string;
}

export interface RunBatchRequest {
    batchId: string;
    rawLoad: RawLoadRequest;
    viscosityReadingsCp: number[];
}

export type RunMockBatchRequest = RunBatchRequest;

export type RawLoadRequest =
    | { mode: "mass"; targetMassG: number }
    | { mode: "bottle_count"; bottleCount: number };

export interface RawResistScan {
    scanId: string;
    barcode: string;
    scannedAtMs: number;
    operatorId: string;
    materialName?: string;
    lotId?: string;
    prmsQueryId?: string;
    validationStatus: ScanValidationStatus;
    validationMessage?: string;
}

export interface RatioDefinition {
    raw: number;
    solvent: number;
}

export interface DilutionOption {
    concentration: string;
    dilutionResistName: string;
    ratio: RatioDefinition;
    recipeKey: string;
    viscosityMinCp?: number;
    viscosityMaxCp?: number;
}

export interface PrmsMapping {
    mappingId: string;
    rawResistName: string;
    rawResistCode: string;
    allowedMachineIds: string[];
    dilutionOptions: DilutionOption[];
    returnedAtMs: number;
    rawPayload: unknown;
}

export interface DilutionRecipeSnapshot {
    id: string;
    version: string;
    rawResistName: string;
    concentration: string;
    dilutionResistName: string;
    ratio: RatioDefinition;
    rawDensityGPerMl?: number;
    solventDensityGPerMl?: number;
    mixTimeMs: number;
    settleTimeMs: number;
    viscosityMinCp?: number;
    viscosityMaxCp?: number;
    standardBottleMassG: number;
}

export interface MeteringRecord {
    id: string;
    kind: MeteringKind;
    targetMassG?: number;
    actualVolumeMl?: number;
    densityGPerMl?: number;
    actualMassG: number;
    toleranceG?: number;
    deviationG?: number;
    startedAtMs: number;
    finishedAtMs: number;
    sourceDeviceId: string;
    runtimeRunId?: number;
    status: MeteringStatus;
}

export interface ViscosityReading {
    index: number;
    valueCp: number;
    measuredAtMs: number;
    sourceDeviceId: string;
}

export interface ViscosityTest {
    testId: string;
    readingsCp: ViscosityReading[];
    averageCp?: number;
    prmsResult?: string;
    uploadedAtMs?: number;
    syncRecordId?: string;
}

export interface OutputBottle {
    index: number;
    targetMassG: number;
    actualMassG?: number;
    dilutionBarcode?: string;
    barcodeStatus: BarcodeStatus;
    printStatus: PrintStatus;
    dispensedAtMs?: number;
    isLastUnderfilled: boolean;
    meteringRecordId?: string;
}

export interface PrmsSyncRecord {
    id: string;
    operation: PrmsOperation;
    idempotencyKey: string;
    requestPayload: unknown;
    responsePayload?: unknown;
    status: SyncStatus;
    attemptCount: number;
    lastError?: string;
    createdAtMs: number;
    updatedAtMs: number;
}

export interface ReportBottleLine {
    index: number;
    dilutionBarcode: string;
    actualMassG: number;
}

export interface DilutionReport {
    reportId: string;
    batchId: string;
    rawResistName: string;
    rawBarcodes: string[];
    rawMassG: number;
    machineId: string;
    operatorId: string;
    reviewerIds: string[];
    viscosityAverageCp?: number;
    dilutionResistName: string;
    outputBottles: ReportBottleLine[];
    comment?: string;
}

export interface DilutionBatch {
    id: string;
    machineId: string;
    status: DilutionBatchStatus;
    operatorId: string;
    reviewerIds: string[];
    plannedBottleCount: number;
    targetBottleMassG: number;
    createdAtMs: number;
    completedAtMs?: number;
    rawScans: RawResistScan[];
    prmsMapping?: PrmsMapping;
    selectedRecipe?: DilutionRecipeSnapshot;
    meteringRecords: MeteringRecord[];
    viscosity?: ViscosityTest;
    outputBottles: OutputBottle[];
    prmsSync: PrmsSyncRecord[];
    report?: DilutionReport;
    alarms: string[];
}

export function dilutionCreateBatch(
    request: CreateBatchRequest,
): Promise<DilutionBatch> {
    return invoke<DilutionBatch>("dilution_create_batch", { request });
}

export function dilutionGetBatch(batchId: string): Promise<DilutionBatch> {
    return invoke<DilutionBatch>("dilution_get_batch", { batchId });
}

export function dilutionListBatches(): Promise<DilutionBatch[]> {
    return invoke<DilutionBatch[]>("dilution_list_batches");
}

export function dilutionGetReport(batchId: string): Promise<DilutionReport> {
    return invoke<DilutionReport>("dilution_get_report", { batchId });
}

export function dilutionScanRawResist(
    request: ScanRawResistRequest,
): Promise<DilutionBatch> {
    return invoke<DilutionBatch>("dilution_scan_raw_resist", { request });
}

export function dilutionSelectConcentration(
    request: SelectConcentrationRequest,
): Promise<DilutionBatch> {
    return invoke<DilutionBatch>("dilution_select_concentration", { request });
}

export function dilutionRunBatch(
    request: RunBatchRequest,
): Promise<DilutionBatch> {
    return invoke<DilutionBatch>("dilution_run_batch", { request });
}

export function dilutionRunMockBatch(
    request: RunMockBatchRequest,
): Promise<DilutionBatch> {
    return invoke<DilutionBatch>("dilution_run_mock_batch", { request });
}
