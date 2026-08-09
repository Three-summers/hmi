/** 稀释流程类型（对应后端 src-tauri/src/dilution/types.rs） */

export type BatchStatus =
    | "draft"
    | "scanning_raw_resist"
    | "resist_info_resolved"
    | "recipe_locked"
    | "local_process_running"
    | "local_process_completed"
    | "batch_creating"
    | "dispensing"
    | "completed"
    | "suspended"
    | "failed";

export interface DilutionRelationship {
    resistNo: string;
    resistName: string;
    concentration: string;
    sysRrn: string;
}

export interface ResistInfo {
    resistNo: string;
    resistName: string;
    concentration: string;
    mtrNO: string;
    defrostTime: string;
    defrostBufferDays: number;
    warningDay: number;
    extendDays: number;
    viscosityUpperLimit?: number;
    viscosityLowerLimit?: number;
    vendorBarcode: string;
    defBatchNO: string;
    toResistNo: string;
    expireTime: string;
    dilutionRelationships: DilutionRelationship[];
}

export interface RatioConfig {
    raw: number;
    solvent: number;
}

export interface DilutionOptionConfig {
    concentration: string;
    recipeId: string;
    ratio: RatioConfig;
    mixTimeMs: number;
    settleTimeMs: number;
    rawDensityGPerMl?: number;
    solventDensityGPerMl?: number;
    viscosityMinCp?: number;
    viscosityMaxCp?: number;
}

export interface DilutionConfig {
    machine?: { eqptId?: string };
    personnel?: { operator?: string; checker?: string };
    labelPrintUrl?: string;
    dilutionOptions: DilutionOptionConfig[];
}

export interface RawResistScan {
    scanId: string;
    barcode: string;
    scannedAtMs: number;
    operatorId: string;
    materialName?: string;
    lotId?: string;
    prmsQueryId?: string;
    validationStatus: "accepted" | "rejected";
    validationMessage?: string;
}

export interface CheckResult {
    resistNO: string;
    defResistNO: string;
    resistDefRrn: string;
    batchNO: string;
    expireDate: string;
    concentration: string;
    barcodeCount: number;
}

export interface ReportBottleLine {
    index: number;
    dilutionBarcode: string;
    actualMassG: number;
}

export interface DilutionReport {
    reportId: string;
    batchId: string;
    eqptId?: string;
    operator?: string;
    checker?: string;
    sourceResistName?: string;
    sourceResistBarcode?: string;
    sourceResistWeight?: number;
    sourceBottleCount?: number;
    mixStartTime?: string;
    mixEndTime?: string;
    viscosityTestTime?: string;
    viscosity?: number;
    dilutionResistName?: string;
    dilutionBottleCount?: number;
    dilutionWeight?: number;
    comment?: string;
    outputBottles: ReportBottleLine[];
    resistSysRrns: string[];
    printSuccess?: boolean;
}

export interface OutputBottle {
    index: number;
    targetMassG: number;
    actualMassG?: number;
    dilutionBarcode?: string;
    barcodeStatus: "pending" | "assigned";
    printStatus: "pending" | "printed" | "failed";
    dispensedAtMs?: number;
    isLastUnderfilled: boolean;
    meteringRecordId?: string;
}

export interface Batch {
    id: string;
    machineId: string;
    status: BatchStatus;
    operatorId: string;
    reviewerIds: string[];
    plannedBottleCount: number;
    targetBottleMassG: number;
    createdAtMs: number;
    completedAtMs?: number;
    rawScans: RawResistScan[];
    selectedConcentration?: string;
    resistDefRrn?: string;
    resistInfo?: ResistInfo;
    checkResult?: CheckResult;
    resistBarcodes: string[];
    resistSysRrns: string[];
    printSuccess?: boolean;
    outputBottles: OutputBottle[];
    report?: DilutionReport;
    alarms: string[];
}

export interface CreateBatchRequest {
    machineId?: string;
    operatorId?: string;
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

export type RawLoadRequest =
    | { mode: "mass"; targetMassG: number }
    | { mode: "bottle_count"; bottleCount: number };

export interface RunBatchRequest {
    batchId: string;
    rawLoad: RawLoadRequest;
    viscosityReadingsCp?: number[];
}
