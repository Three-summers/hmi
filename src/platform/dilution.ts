/**
 * 稀释流程 RPC 封装
 *
 * 统一通过 @/platform/invoke 调用后端 dilution_* 命令。
 *
 * @module platform/dilution
 */

import { invoke } from "./invoke";
import type {
    Batch,
    CreateBatchRequest,
    DilutionConfig,
    RunBatchRequest,
    ScanRawResistRequest,
    SelectConcentrationRequest,
} from "@/types/dilution";

export function dilutionCreateBatch(request: CreateBatchRequest): Promise<Batch> {
    return invoke<Batch>("dilution_create_batch", { request });
}

export function dilutionGetBatch(batchId: string): Promise<Batch> {
    return invoke<Batch>("dilution_get_batch", { batchId });
}

export function dilutionListBatches(): Promise<Batch[]> {
    return invoke<Batch[]>("dilution_list_batches");
}

export function dilutionGetReport(batchId: string): Promise<Batch["report"]> {
    return invoke<Batch["report"]>("dilution_get_report", { batchId });
}

export function dilutionScanRawResist(request: ScanRawResistRequest): Promise<Batch> {
    return invoke<Batch>("dilution_scan_raw_resist", { request });
}

export function dilutionSelectConcentration(
    request: SelectConcentrationRequest,
): Promise<Batch> {
    return invoke<Batch>("dilution_select_concentration", { request });
}

export function dilutionRunBatch(request: RunBatchRequest): Promise<Batch> {
    return invoke<Batch>("dilution_run_batch", { request });
}

export function dilutionGetConfig(): Promise<DilutionConfig> {
    return invoke<DilutionConfig>("dilution_get_config");
}

export const DILUTION_POLL_INTERVAL_MS = 500;
