use crate::log_paths;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    #[default]
    Draft,
    ScanningRawResist,
    ResistInfoResolved,
    RecipeLocked,
    LocalProcessRunning,
    LocalProcessCompleted,
    BatchCreating,
    Dispensing,
    Completed,
    Suspended,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScanValidationStatus {
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeteringKind {
    Raw,
    Solvent,
    Output,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeteringStatus {
    Completed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BarcodeStatus {
    Pending,
    Assigned,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrintStatus {
    Pending,
    Printed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrmsOperation {
    ResistInfo,
    Check,
    CreateBatch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBatchRequest {
    #[serde(default)]
    pub machine_id: Option<String>,
    #[serde(default)]
    pub operator_id: Option<String>,
    #[serde(default)]
    pub reviewer_ids: Vec<String>,
    pub planned_bottle_count: u32,
    pub target_bottle_mass_g: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRawResistRequest {
    pub batch_id: String,
    pub barcode: String,
    pub operator_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectConcentrationRequest {
    pub batch_id: String,
    pub concentration: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBatchRequest {
    pub batch_id: String,
    pub raw_load: RawLoadRequest,
    /// 粘度读数（保留兼容；新流程下粘度由本地配方经设备测量，本字段仅作兜底）
    #[serde(default)]
    pub viscosity_readings_cp: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum RawLoadRequest {
    #[serde(rename = "mass")]
    ByMass {
        #[serde(rename = "targetMassG")]
        target_mass_g: f64,
    },
    #[serde(rename = "bottle_count")]
    ByBottleCount {
        #[serde(rename = "bottleCount")]
        bottle_count: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawResistScan {
    pub scan_id: String,
    pub barcode: String,
    pub scanned_at_ms: u64,
    pub operator_id: String,
    #[serde(default)]
    pub material_name: Option<String>,
    #[serde(default)]
    pub lot_id: Option<String>,
    #[serde(default)]
    pub prms_query_id: Option<String>,
    pub validation_status: ScanValidationStatus,
    #[serde(default)]
    pub validation_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatioDefinition {
    pub raw: f64,
    pub solvent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DilutionRelationship {
    pub resist_no: String,
    pub resist_name: String,
    pub concentration: String,
    pub sys_rrn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ResistInfo {
    pub resist_no: String,
    pub resist_name: String,
    pub concentration: String,
    pub mtr_no: String,
    pub defrost_time: String,
    pub defrost_buffer_days: u32,
    pub warning_day: u32,
    pub extend_days: u32,
    pub viscosity_upper_limit: Option<f64>,
    pub viscosity_lower_limit: Option<f64>,
    pub vendor_barcode: String,
    pub def_batch_no: String,
    pub to_resist_no: String,
    pub expire_time: String,
    pub dilution_relationships: Vec<DilutionRelationship>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CheckResult {
    pub resist_no: String,
    pub def_resist_no: String,
    pub resist_def_rrn: String,
    pub batch_no: String,
    pub expire_date: String,
    pub concentration: String,
    pub barcode_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateDilutionBatchRequest {
    pub vendor_barcode_list: Vec<String>,
    pub resist_def_rrn: String,
    pub eqpt_id: Option<String>,
    pub bottle_count: u32,
    pub viscosity: Option<f64>,
    pub batch_no: Option<String>,
    pub exp_date: Option<String>,
    pub label_print_url: Option<String>,
    // 报表字段
    pub source_resist_name: Option<String>,
    pub source_resist_barcode: Option<String>,
    pub source_resist_weight: Option<f64>,
    pub source_bottle_count: Option<u32>,
    pub operator: Option<String>,
    pub checker: Option<String>,
    pub mix_start_time: Option<String>,
    pub mix_end_time: Option<String>,
    pub viscosity_test_time: Option<String>,
    pub dilution_resist_name: Option<String>,
    pub dilution_bottle_count: Option<u32>,
    pub dilution_weight: Option<f64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateDilutionBatchResult {
    pub resist_sys_rrns: Vec<String>,
    pub resist_barcodes: Vec<String>,
    pub print_success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResistInfoRequest {
    pub vendor_barcode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckBatchRequest {
    pub vendor_barcode_list: Vec<String>,
    pub concentration: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DilutionRecipeSnapshot {
    pub id: String,
    pub version: String,
    pub raw_resist_name: String,
    pub concentration: String,
    pub dilution_resist_name: String,
    pub ratio: RatioDefinition,
    pub raw_density_g_per_ml: Option<f64>,
    pub solvent_density_g_per_ml: Option<f64>,
    pub mix_time_ms: u64,
    pub settle_time_ms: u64,
    pub viscosity_min_cp: Option<f64>,
    pub viscosity_max_cp: Option<f64>,
    pub standard_bottle_mass_g: f64,
    #[serde(default)]
    pub recipe_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeteringRecord {
    pub id: String,
    pub kind: MeteringKind,
    #[serde(default)]
    pub target_mass_g: Option<f64>,
    #[serde(default)]
    pub actual_volume_ml: Option<f64>,
    #[serde(default)]
    pub density_g_per_ml: Option<f64>,
    pub actual_mass_g: f64,
    #[serde(default)]
    pub tolerance_g: Option<f64>,
    #[serde(default)]
    pub deviation_g: Option<f64>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub source_device_id: String,
    #[serde(default)]
    pub runtime_run_id: Option<u64>,
    pub status: MeteringStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViscosityReading {
    pub index: u8,
    pub value_cp: f64,
    pub measured_at_ms: u64,
    pub source_device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViscosityTest {
    pub test_id: String,
    pub readings_cp: Vec<ViscosityReading>,
    #[serde(default)]
    pub average_cp: Option<f64>,
    #[serde(default)]
    pub prms_result: Option<String>,
    #[serde(default)]
    pub uploaded_at_ms: Option<u64>,
    #[serde(default)]
    pub sync_record_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputBottle {
    pub index: u32,
    pub target_mass_g: f64,
    #[serde(default)]
    pub actual_mass_g: Option<f64>,
    #[serde(default)]
    pub dilution_barcode: Option<String>,
    pub barcode_status: BarcodeStatus,
    pub print_status: PrintStatus,
    #[serde(default)]
    pub dispensed_at_ms: Option<u64>,
    pub is_last_underfilled: bool,
    #[serde(default)]
    pub metering_record_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrmsSyncRecord {
    pub id: String,
    pub operation: PrmsOperation,
    pub idempotency_key: String,
    pub request_payload: Value,
    #[serde(default)]
    pub response_payload: Option<Value>,
    pub status: SyncStatus,
    pub attempt_count: u32,
    #[serde(default)]
    pub last_error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportBottleLine {
    pub index: u32,
    pub dilution_barcode: String,
    pub actual_mass_g: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DilutionReport {
    pub report_id: String,
    pub batch_id: String,
    pub eqpt_id: Option<String>,
    pub operator: Option<String>,
    pub checker: Option<String>,
    pub source_resist_name: Option<String>,
    pub source_resist_barcode: Option<String>,
    pub source_resist_weight: Option<f64>,
    pub source_bottle_count: Option<u32>,
    pub mix_start_time: Option<String>,
    pub mix_end_time: Option<String>,
    pub viscosity_test_time: Option<String>,
    pub viscosity: Option<f64>,
    pub dilution_resist_name: Option<String>,
    pub dilution_bottle_count: Option<u32>,
    pub dilution_weight: Option<f64>,
    pub comment: Option<String>,
    pub output_bottles: Vec<ReportBottleLine>,
    pub resist_sys_rrns: Vec<String>,
    pub print_success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub machine_id: String,
    pub status: BatchStatus,
    pub operator_id: String,
    pub reviewer_ids: Vec<String>,
    pub planned_bottle_count: u32,
    pub target_bottle_mass_g: f64,
    pub created_at_ms: u64,
    #[serde(default)]
    pub completed_at_ms: Option<u64>,
    #[serde(default)]
    pub raw_scans: Vec<RawResistScan>,
    #[serde(default)]
    pub selected_recipe: Option<DilutionRecipeSnapshot>,
    #[serde(default)]
    pub metering_records: Vec<MeteringRecord>,
    #[serde(default)]
    pub viscosity: Option<ViscosityTest>,
    #[serde(default)]
    pub output_bottles: Vec<OutputBottle>,
    #[serde(default)]
    pub prms_sync: Vec<PrmsSyncRecord>,
    #[serde(default)]
    pub report: Option<DilutionReport>,
    #[serde(default)]
    pub alarms: Vec<String>,
    #[serde(default)]
    pub resist_info: Option<ResistInfo>,
    #[serde(default)]
    pub selected_concentration: Option<String>,
    #[serde(default)]
    pub resist_def_rrn: Option<String>,
    #[serde(default)]
    pub check_result: Option<CheckResult>,
    #[serde(default)]
    pub resist_barcodes: Vec<String>,
    #[serde(default)]
    pub resist_sys_rrns: Vec<String>,
    #[serde(default)]
    pub print_success: Option<bool>,
}

pub struct AdapterResult<T> {
    pub value: T,
    pub request_payload: Value,
    pub response_payload: Value,
}

pub trait PrmsClient: Send + Sync {
    fn query_resist_info(
        &self,
        request: QueryResistInfoRequest,
    ) -> Result<AdapterResult<ResistInfo>, String>;

    fn check_batch(&self, request: CheckBatchRequest) -> Result<AdapterResult<CheckResult>, String>;

    fn create_dilution_batch(
        &self,
        request: CreateDilutionBatchRequest,
    ) -> Result<AdapterResult<CreateDilutionBatchResult>, String>;
}

pub struct DispenseOutputRequest {
    pub total_mass_g: f64,
    pub bottle_count: u32,
    pub target_bottle_mass_g: f64,
    pub timestamp_ms: u64,
}

pub struct DispensedBottle {
    pub index: u32,
    pub actual_mass_g: f64,
    pub metering_record: MeteringRecord,
}

pub trait DilutionDeviceGateway: Send + Sync {
    fn dispense_outputs(
        &self,
        request: DispenseOutputRequest,
    ) -> Result<Vec<DispensedBottle>, String>;
}

pub fn default_log_root() -> PathBuf {
    log_paths::default_log_dir()
}
