use crate::log_paths;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

static SNAPSHOT_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static BATCH_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    #[default]
    Draft,
    ScanningRawResist,
    MappingResolved,
    RecipeLocked,
    RawLoading,
    SolventLoading,
    Mixing,
    Settling,
    ViscosityTesting,
    ViscositySynced,
    BarcodeRequested,
    Printing,
    Dispensing,
    ReportPending,
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
    QueryMapping,
    UploadViscosity,
    RequestDilutionBarcodes,
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
    pub machine_id: String,
    pub operator_id: String,
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
    pub viscosity_readings_cp: Vec<f64>,
}

pub type RunMockBatchRequest = RunBatchRequest;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DilutionOption {
    pub concentration: String,
    pub dilution_resist_name: String,
    pub ratio: RatioDefinition,
    pub recipe_key: String,
    #[serde(default)]
    pub viscosity_min_cp: Option<f64>,
    #[serde(default)]
    pub viscosity_max_cp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrmsMapping {
    pub mapping_id: String,
    pub raw_resist_name: String,
    pub raw_resist_code: String,
    pub allowed_machine_ids: Vec<String>,
    pub dilution_options: Vec<DilutionOption>,
    pub returned_at_ms: u64,
    pub raw_payload: Value,
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
    pub raw_resist_name: String,
    pub raw_barcodes: Vec<String>,
    pub raw_mass_g: f64,
    pub machine_id: String,
    pub operator_id: String,
    pub reviewer_ids: Vec<String>,
    pub viscosity_average_cp: Option<f64>,
    pub dilution_resist_name: String,
    pub output_bottles: Vec<ReportBottleLine>,
    pub comment: Option<String>,
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
    pub prms_mapping: Option<PrmsMapping>,
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
}

#[derive(Clone)]
pub struct DilutionManager {
    inner: Arc<Mutex<DilutionState>>,
    adapters: Arc<DilutionAdapters>,
    repository: Arc<DilutionRepository>,
}

impl Default for DilutionManager {
    fn default() -> Self {
        Self::new_mock()
    }
}

#[derive(Default)]
struct DilutionState {
    batches: HashMap<String, Batch>,
    next_event_id: u64,
}

struct DilutionAdapters {
    prms: Arc<dyn PrmsClient>,
    devices: Arc<dyn DilutionDeviceGateway>,
}

struct DilutionRepository {
    log_root: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DilutionBatchEvent<'a> {
    event_id: String,
    batch_id: &'a str,
    timestamp_ms: u64,
    kind: &'a str,
    status: BatchStatus,
    payload: Value,
}

struct QueryMappingAdapterRequest {
    machine_id: String,
    barcode: String,
}

struct UploadViscosityAdapterRequest {
    batch_id: String,
    average_cp: f64,
}

struct RequestBarcodesAdapterRequest {
    batch_id: String,
    bottle_count: u32,
}

struct AdapterResult<T> {
    value: T,
    request_payload: Value,
    response_payload: Value,
}

struct ViscosityUploadResult {
    result: String,
}

struct BarcodeRequestResult {
    barcodes: Vec<String>,
}

trait PrmsClient: Send + Sync {
    fn query_mapping(
        &self,
        request: QueryMappingAdapterRequest,
    ) -> Result<AdapterResult<PrmsMapping>, String>;

    fn upload_viscosity(
        &self,
        request: UploadViscosityAdapterRequest,
    ) -> Result<AdapterResult<ViscosityUploadResult>, String>;

    fn request_dilution_barcodes(
        &self,
        request: RequestBarcodesAdapterRequest,
    ) -> Result<AdapterResult<BarcodeRequestResult>, String>;
}

struct MeteringAdapterRequest {
    id: String,
    kind: MeteringKind,
    target_mass_g: Option<f64>,
    actual_mass_g: f64,
    timestamp_ms: u64,
}

struct DispenseOutputRequest {
    total_mass_g: f64,
    bottle_count: u32,
    target_bottle_mass_g: f64,
    timestamp_ms: u64,
}

struct DispensedBottle {
    index: u32,
    actual_mass_g: f64,
    metering_record: MeteringRecord,
}

trait DilutionDeviceGateway: Send + Sync {
    fn meter(&self, request: MeteringAdapterRequest) -> Result<MeteringRecord, String>;

    fn measure_viscosity(
        &self,
        readings_cp: &[f64],
        timestamp_ms: u64,
    ) -> Result<Vec<ViscosityReading>, String>;

    fn print_labels(&self, barcodes: &[String]) -> Result<Vec<PrintStatus>, String>;

    fn dispense_outputs(
        &self,
        request: DispenseOutputRequest,
    ) -> Result<Vec<DispensedBottle>, String>;
}

impl DilutionManager {
    pub fn new_mock() -> Self {
        Self::new_mock_with_log_root(default_log_root())
    }

    pub fn new_mock_with_log_root(log_root: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(DilutionState::default())),
            adapters: Arc::new(DilutionAdapters {
                prms: Arc::new(MockPrmsClient),
                devices: Arc::new(MockDilutionDeviceGateway),
            }),
            repository: Arc::new(DilutionRepository { log_root }),
        }
    }

    pub fn create_batch(&self, request: CreateBatchRequest) -> Result<Batch, String> {
        if request.machine_id.trim().is_empty() {
            return Err("machineId is required".to_string());
        }
        if request.operator_id.trim().is_empty() {
            return Err("operatorId is required".to_string());
        }
        if request.planned_bottle_count == 0 {
            return Err("plannedBottleCount must be greater than 0".to_string());
        }
        if request.target_bottle_mass_g <= 0.0 {
            return Err("targetBottleMassG must be greater than 0".to_string());
        }

        let mut state = self.lock_state()?;
        let batch_sequence = BATCH_ID_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
        let now = now_ms();
        let batch = Batch {
            id: format!("DIL-{now}-{batch_sequence:04}"),
            machine_id: request.machine_id,
            status: BatchStatus::Draft,
            operator_id: request.operator_id,
            reviewer_ids: request.reviewer_ids,
            planned_bottle_count: request.planned_bottle_count,
            target_bottle_mass_g: request.target_bottle_mass_g,
            created_at_ms: now,
            completed_at_ms: None,
            raw_scans: Vec::new(),
            prms_mapping: None,
            selected_recipe: None,
            metering_records: Vec::new(),
            viscosity: None,
            output_bottles: Vec::new(),
            prms_sync: Vec::new(),
            report: None,
            alarms: Vec::new(),
        };
        state.batches.insert(batch.id.clone(), batch.clone());
        self.repository
            .persist_batch_change(&batch, "batch_created", json!({}))?;
        Ok(batch)
    }

    pub fn get_batch(&self, batch_id: &str) -> Result<Batch, String> {
        self.lock_state()?
            .batches
            .get(batch_id)
            .cloned()
            .ok_or_else(|| format!("batch `{batch_id}` not found"))
    }

    pub fn list_batches(&self) -> Result<Vec<Batch>, String> {
        let mut batches = self
            .lock_state()?
            .batches
            .values()
            .cloned()
            .collect::<Vec<_>>();
        batches.sort_by(|left, right| left.created_at_ms.cmp(&right.created_at_ms));
        Ok(batches)
    }

    pub fn get_report(&self, batch_id: &str) -> Result<DilutionReport, String> {
        self.get_batch(batch_id)?
            .report
            .ok_or_else(|| format!("report for batch `{batch_id}` is not ready"))
    }

    pub fn scan_raw_resist(&self, request: ScanRawResistRequest) -> Result<Batch, String> {
        let adapters = Arc::clone(&self.adapters);
        let mut state = self.lock_state()?;
        let event_id = state.next_event_id();
        let batch = state.batch_mut(request.batch_id.as_str())?;
        let mapping_result = adapters.prms.query_mapping(QueryMappingAdapterRequest {
            machine_id: batch.machine_id.clone(),
            barcode: request.barcode.clone(),
        })?;
        let mapping = mapping_result.value;

        if let Some(existing) = batch.prms_mapping.as_ref() {
            if existing.raw_resist_code != mapping.raw_resist_code {
                return Err(format!(
                    "raw resist mismatch: expected `{}`, got `{}`",
                    existing.raw_resist_code, mapping.raw_resist_code
                ));
            }
        }

        let scan = RawResistScan {
            scan_id: format!("scan-{event_id}"),
            barcode: request.barcode,
            scanned_at_ms: now_ms(),
            operator_id: request.operator_id,
            material_name: Some(mapping.raw_resist_name.clone()),
            lot_id: Some("MOCK-LOT".to_string()),
            prms_query_id: Some(mapping.mapping_id.clone()),
            validation_status: ScanValidationStatus::Accepted,
            validation_message: Some("mock PRMS mapping accepted".to_string()),
        };
        batch.raw_scans.push(scan);
        batch.prms_sync.push(sync_record(
            event_id,
            PrmsOperation::QueryMapping,
            mapping_result.request_payload,
            Some(mapping_result.response_payload),
        ));
        batch.prms_mapping = Some(mapping);
        batch.status = BatchStatus::MappingResolved;

        if batch
            .prms_mapping
            .as_ref()
            .is_some_and(|mapping| mapping.dilution_options.len() == 1)
        {
            lock_selected_recipe(batch, 0)?;
        }

        self.repository.persist_batch_change(
            batch,
            "raw_resist_scanned",
            json!({
                "barcode": batch.raw_scans.last().map(|scan| scan.barcode.as_str()),
                "mappingId": batch.prms_mapping.as_ref().map(|mapping| mapping.mapping_id.as_str()),
                "autoRecipeLocked": batch.selected_recipe.is_some(),
            }),
        )?;
        Ok(batch.clone())
    }

    pub fn select_concentration(
        &self,
        request: SelectConcentrationRequest,
    ) -> Result<Batch, String> {
        let mut state = self.lock_state()?;
        let batch = state.batch_mut(request.batch_id.as_str())?;
        let mapping = batch
            .prms_mapping
            .as_ref()
            .ok_or_else(|| "PRMS mapping has not been resolved".to_string())?;
        let index = mapping
            .dilution_options
            .iter()
            .position(|option| option.concentration == request.concentration)
            .ok_or_else(|| format!("concentration `{}` is not available", request.concentration))?;
        lock_selected_recipe(batch, index)?;
        self.repository.persist_batch_change(
            batch,
            "concentration_selected",
            json!({
                "concentration": batch.selected_recipe.as_ref().map(|recipe| recipe.concentration.as_str()),
                "recipeId": batch.selected_recipe.as_ref().map(|recipe| recipe.id.as_str()),
            }),
        )?;
        Ok(batch.clone())
    }

    pub fn run_batch(&self, request: RunBatchRequest) -> Result<Batch, String> {
        if request.viscosity_readings_cp.len() != 2 {
            return Err("batch run requires exactly two viscosity readings".to_string());
        }

        let adapters = Arc::clone(&self.adapters);
        let mut state = self.lock_state()?;
        {
            let batch = state.batch_mut(request.batch_id.as_str())?;
            if batch.status != BatchStatus::RecipeLocked {
                return Err(format!(
                    "cannot run batch `{}` from status {:?}",
                    batch.id, batch.status
                ));
            }
        }
        let upload_event_id = state.next_event_id();
        let barcode_event_id = state.next_event_id();
        let batch = state.batch_mut(request.batch_id.as_str())?;
        let recipe = batch
            .selected_recipe
            .clone()
            .ok_or_else(|| "recipe has not been locked".to_string())?;
        let target_raw_mass_g =
            resolve_raw_load_mass(&request.raw_load, recipe.standard_bottle_mass_g)?;
        let now = now_ms();

        batch.status = BatchStatus::RawLoading;
        let raw_record = adapters.devices.meter(MeteringAdapterRequest {
            id: "raw".to_string(),
            kind: MeteringKind::Raw,
            target_mass_g: Some(target_raw_mass_g),
            actual_mass_g: target_raw_mass_g,
            timestamp_ms: now,
        })?;
        let actual_raw_mass_g = raw_record.actual_mass_g;
        batch.metering_records.push(raw_record);

        batch.status = BatchStatus::SolventLoading;
        let solvent_mass = actual_raw_mass_g * recipe.ratio.solvent / recipe.ratio.raw;
        batch
            .metering_records
            .push(adapters.devices.meter(MeteringAdapterRequest {
                id: "solvent".to_string(),
                kind: MeteringKind::Solvent,
                target_mass_g: Some(solvent_mass),
                actual_mass_g: solvent_mass,
                timestamp_ms: now + 1,
            })?);

        batch.status = BatchStatus::Mixing;
        batch.status = BatchStatus::Settling;
        batch.status = BatchStatus::ViscosityTesting;
        let readings = adapters
            .devices
            .measure_viscosity(&request.viscosity_readings_cp, now + 10)?;
        let average = round1(
            readings.iter().map(|reading| reading.value_cp).sum::<f64>() / readings.len() as f64,
        );
        let upload_result = adapters
            .prms
            .upload_viscosity(UploadViscosityAdapterRequest {
                batch_id: batch.id.clone(),
                average_cp: average,
            })?;
        batch.viscosity = Some(ViscosityTest {
            test_id: format!("visc-{}", batch.id),
            readings_cp: readings,
            average_cp: Some(average),
            prms_result: Some(upload_result.value.result),
            uploaded_at_ms: Some(now + 20),
            sync_record_id: Some(format!("sync-{upload_event_id}")),
        });
        batch.prms_sync.push(sync_record(
            upload_event_id,
            PrmsOperation::UploadViscosity,
            upload_result.request_payload,
            Some(upload_result.response_payload),
        ));
        batch.status = BatchStatus::ViscositySynced;

        let barcode_result =
            adapters
                .prms
                .request_dilution_barcodes(RequestBarcodesAdapterRequest {
                    batch_id: batch.id.clone(),
                    bottle_count: batch.planned_bottle_count,
                })?;
        let barcodes = barcode_result.value.barcodes;
        batch.prms_sync.push(sync_record(
            barcode_event_id,
            PrmsOperation::RequestDilutionBarcodes,
            barcode_result.request_payload,
            Some(barcode_result.response_payload),
        ));
        batch.status = BatchStatus::BarcodeRequested;

        batch.status = BatchStatus::Printing;
        let print_statuses = adapters.devices.print_labels(&barcodes)?;
        let total_mass = actual_raw_mass_g + solvent_mass;
        let dispensed_bottles = adapters.devices.dispense_outputs(DispenseOutputRequest {
            total_mass_g: total_mass,
            bottle_count: batch.planned_bottle_count,
            target_bottle_mass_g: batch.target_bottle_mass_g,
            timestamp_ms: now + 100,
        })?;

        batch.status = BatchStatus::Dispensing;
        batch.output_bottles.clear();
        for dispensed in dispensed_bottles {
            let barcode = barcodes
                .get((dispensed.index - 1) as usize)
                .cloned()
                .ok_or_else(|| {
                    format!("PRMS did not return barcode for bottle {}", dispensed.index)
                })?;
            let print_status = print_statuses
                .get((dispensed.index - 1) as usize)
                .copied()
                .unwrap_or(PrintStatus::Failed);
            let metering_id = dispensed.metering_record.id.clone();
            batch.metering_records.push(dispensed.metering_record);
            batch.output_bottles.push(OutputBottle {
                index: dispensed.index,
                target_mass_g: batch.target_bottle_mass_g,
                actual_mass_g: Some(dispensed.actual_mass_g),
                dilution_barcode: Some(barcode),
                barcode_status: BarcodeStatus::Assigned,
                print_status,
                dispensed_at_ms: Some(now + 200 + dispensed.index as u64),
                is_last_underfilled: dispensed.index == batch.planned_bottle_count
                    && dispensed.actual_mass_g < batch.target_bottle_mass_g,
                metering_record_id: Some(metering_id),
            });
        }
        batch.status = BatchStatus::ReportPending;
        batch.report = Some(build_report(batch, &recipe, actual_raw_mass_g));
        batch.status = BatchStatus::Completed;
        batch.completed_at_ms = Some(now_ms());

        self.repository.persist_batch_change(
            batch,
            "batch_completed",
            json!({
                "outputBottleCount": batch.output_bottles.len(),
                "reportId": batch.report.as_ref().map(|report| report.report_id.as_str()),
            }),
        )?;
        Ok(batch.clone())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, DilutionState>, String> {
        self.inner
            .lock()
            .map_err(|_| "dilution manager mutex poisoned".to_string())
    }
}

impl DilutionState {
    fn batch_mut(&mut self, batch_id: &str) -> Result<&mut Batch, String> {
        self.batches
            .get_mut(batch_id)
            .ok_or_else(|| format!("batch `{batch_id}` not found"))
    }

    fn next_event_id(&mut self) -> u64 {
        self.next_event_id = self.next_event_id.saturating_add(1);
        self.next_event_id
    }
}

impl DilutionRepository {
    fn persist_batch_change(
        &self,
        batch: &Batch,
        kind: &str,
        payload: Value,
    ) -> Result<(), String> {
        let batch_dir = self
            .log_root
            .join("dilution")
            .join("batches")
            .join(batch.id.as_str());
        fs::create_dir_all(&batch_dir)
            .map_err(|err| format!("failed to create dilution batch log directory: {err}"))?;

        let now = now_ms();
        let event = DilutionBatchEvent {
            event_id: format!("evt-{now}-{kind}"),
            batch_id: batch.id.as_str(),
            timestamp_ms: now,
            kind,
            status: batch.status,
            payload,
        };
        let event_line = serde_json::to_string(&event)
            .map_err(|err| format!("failed to serialize dilution batch event: {err}"))?;
        let mut event_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(batch_dir.join("batch.events.jsonl"))
            .map_err(|err| format!("failed to open dilution batch event log: {err}"))?;
        event_file
            .write_all(event_line.as_bytes())
            .and_then(|_| event_file.write_all(b"\n"))
            .map_err(|err| format!("failed to write dilution batch event: {err}"))?;

        let snapshot_path = batch_dir.join("batch.snapshot.json");
        let tmp_path = batch_dir.join(format!(
            "batch.snapshot.json.{}-{}-{}.tmp",
            std::process::id(),
            now,
            SNAPSHOT_TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let snapshot = serde_json::to_vec_pretty(batch)
            .map_err(|err| format!("failed to serialize dilution batch snapshot: {err}"))?;
        fs::write(&tmp_path, snapshot)
            .map_err(|err| format!("failed to write dilution batch snapshot: {err}"))?;
        fs::rename(&tmp_path, &snapshot_path)
            .map_err(|err| format!("failed to replace dilution batch snapshot: {err}"))?;

        if let Some(report) = batch.report.as_ref() {
            let report = serde_json::to_vec_pretty(report)
                .map_err(|err| format!("failed to serialize dilution report: {err}"))?;
            fs::write(batch_dir.join("report.json"), report)
                .map_err(|err| format!("failed to write dilution report: {err}"))?;
        }

        Ok(())
    }
}

struct MockPrmsClient;

impl PrmsClient for MockPrmsClient {
    fn query_mapping(
        &self,
        request: QueryMappingAdapterRequest,
    ) -> Result<AdapterResult<PrmsMapping>, String> {
        let (code, name, options) = if request.barcode.contains("OTHER") {
            (
                "OTHER",
                "OTHER PM 5.4cP",
                vec![mock_option("70%", "OTHER-70%", 7.0, 3.0, "mock-other-70")],
            )
        } else if request.barcode.contains("MULTI") {
            (
                "MULTI",
                "TMR-MULTI PM 5.4cP",
                vec![
                    mock_option("60%", "MULTI-60%", 6.0, 4.0, "mock-multi-60"),
                    mock_option("70%", "MULTI-70%", 7.0, 3.0, "mock-multi-70"),
                ],
            )
        } else if request.barcode.contains("IK02") {
            (
                "IK02",
                "TMR-IK02 PM 5.4cP",
                vec![mock_option("70%", "IK02-70%", 7.0, 3.0, "mock-ik02-70")],
            )
        } else {
            return Err(format!(
                "mock PRMS cannot resolve barcode `{}`",
                request.barcode
            ));
        };
        let request_payload = hsms_mock_payload(json!({
            "operation": "queryMapping",
            "machineId": request.machine_id,
            "barcode": request.barcode,
        }));
        let response_payload = hsms_mock_payload(json!({
            "operation": "queryMapping",
            "rawResistCode": code,
            "rawResistName": name,
            "optionCount": options.len(),
        }));
        let mapping = PrmsMapping {
            mapping_id: format!("mock-map-{code}"),
            raw_resist_name: name.to_string(),
            raw_resist_code: code.to_string(),
            allowed_machine_ids: vec![request_payload["payload"]["machineId"]
                .as_str()
                .unwrap_or_default()
                .to_string()],
            dilution_options: options,
            returned_at_ms: now_ms(),
            raw_payload: response_payload.clone(),
        };
        Ok(AdapterResult {
            value: mapping,
            request_payload,
            response_payload,
        })
    }

    fn upload_viscosity(
        &self,
        request: UploadViscosityAdapterRequest,
    ) -> Result<AdapterResult<ViscosityUploadResult>, String> {
        Ok(AdapterResult {
            value: ViscosityUploadResult {
                result: "pass".to_string(),
            },
            request_payload: hsms_mock_payload(json!({
                "operation": "uploadViscosity",
                "batchId": request.batch_id,
                "averageCp": request.average_cp,
            })),
            response_payload: hsms_mock_payload(json!({
                "operation": "uploadViscosity",
                "hold": false,
                "result": "pass",
            })),
        })
    }

    fn request_dilution_barcodes(
        &self,
        request: RequestBarcodesAdapterRequest,
    ) -> Result<AdapterResult<BarcodeRequestResult>, String> {
        let barcodes = (1..=request.bottle_count)
            .map(|index| format!("DIL-{}-{index:03}", request.batch_id))
            .collect::<Vec<_>>();
        Ok(AdapterResult {
            value: BarcodeRequestResult {
                barcodes: barcodes.clone(),
            },
            request_payload: hsms_mock_payload(json!({
                "operation": "requestDilutionBarcodes",
                "batchId": request.batch_id,
                "bottleCount": request.bottle_count,
            })),
            response_payload: hsms_mock_payload(json!({
                "operation": "requestDilutionBarcodes",
                "barcodes": barcodes,
            })),
        })
    }
}

struct MockDilutionDeviceGateway;

impl DilutionDeviceGateway for MockDilutionDeviceGateway {
    fn meter(&self, request: MeteringAdapterRequest) -> Result<MeteringRecord, String> {
        Ok(metering_record(
            request.id.as_str(),
            request.kind,
            request.target_mass_g,
            request.actual_mass_g,
            request.timestamp_ms,
        ))
    }

    fn measure_viscosity(
        &self,
        readings_cp: &[f64],
        timestamp_ms: u64,
    ) -> Result<Vec<ViscosityReading>, String> {
        Ok(readings_cp
            .iter()
            .enumerate()
            .map(|(index, value)| ViscosityReading {
                index: (index + 1) as u8,
                value_cp: *value,
                measured_at_ms: timestamp_ms + index as u64,
                source_device_id: "mock-viscometer".to_string(),
            })
            .collect())
    }

    fn print_labels(&self, barcodes: &[String]) -> Result<Vec<PrintStatus>, String> {
        Ok(barcodes.iter().map(|_| PrintStatus::Printed).collect())
    }

    fn dispense_outputs(
        &self,
        request: DispenseOutputRequest,
    ) -> Result<Vec<DispensedBottle>, String> {
        let mut remaining_mass = request.total_mass_g;
        let mut bottles = Vec::new();
        for index in 1..=request.bottle_count {
            let is_last = index == request.bottle_count;
            let actual_mass = if is_last {
                round1(remaining_mass.max(0.0))
            } else {
                round1(request.target_bottle_mass_g.min(remaining_mass.max(0.0)))
            };
            remaining_mass -= actual_mass;
            let metering_id = format!("meter-output-{index}");
            bottles.push(DispensedBottle {
                index,
                actual_mass_g: actual_mass,
                metering_record: metering_record(
                    metering_id.as_str(),
                    MeteringKind::Output,
                    Some(request.target_bottle_mass_g),
                    actual_mass,
                    request.timestamp_ms + index as u64,
                ),
            });
        }
        Ok(bottles)
    }
}

fn hsms_mock_payload(payload: Value) -> Value {
    json!({
        "mock": true,
        "transport": "hsms_mock",
        "messageStructure": "pending",
        "payload": payload,
    })
}

fn resolve_raw_load_mass(
    raw_load: &RawLoadRequest,
    standard_bottle_mass_g: f64,
) -> Result<f64, String> {
    let mass = match raw_load {
        RawLoadRequest::ByMass { target_mass_g } => *target_mass_g,
        RawLoadRequest::ByBottleCount { bottle_count } => {
            if *bottle_count == 0 {
                return Err("raw bottle count must be greater than 0".to_string());
            }
            *bottle_count as f64 * standard_bottle_mass_g
        }
    };
    if mass <= 0.0 {
        return Err("raw load mass must be greater than 0".to_string());
    }
    Ok(round1(mass))
}

fn lock_selected_recipe(batch: &mut Batch, option_index: usize) -> Result<(), String> {
    let mapping = batch
        .prms_mapping
        .as_ref()
        .ok_or_else(|| "PRMS mapping has not been resolved".to_string())?;
    let option = mapping
        .dilution_options
        .get(option_index)
        .ok_or_else(|| "dilution option not found".to_string())?;
    batch.selected_recipe = Some(DilutionRecipeSnapshot {
        id: option.recipe_key.clone(),
        version: "mock-v1".to_string(),
        raw_resist_name: mapping.raw_resist_name.clone(),
        concentration: option.concentration.clone(),
        dilution_resist_name: option.dilution_resist_name.clone(),
        ratio: option.ratio.clone(),
        raw_density_g_per_ml: Some(1.0),
        solvent_density_g_per_ml: Some(1.0),
        mix_time_ms: 300_000,
        settle_time_ms: 120_000,
        viscosity_min_cp: option.viscosity_min_cp,
        viscosity_max_cp: option.viscosity_max_cp,
        standard_bottle_mass_g: batch.target_bottle_mass_g,
    });
    batch.status = BatchStatus::RecipeLocked;
    Ok(())
}

fn mock_option(
    concentration: &str,
    dilution_resist_name: &str,
    raw: f64,
    solvent: f64,
    recipe_key: &str,
) -> DilutionOption {
    DilutionOption {
        concentration: concentration.to_string(),
        dilution_resist_name: dilution_resist_name.to_string(),
        ratio: RatioDefinition { raw, solvent },
        recipe_key: recipe_key.to_string(),
        viscosity_min_cp: Some(4.0),
        viscosity_max_cp: Some(7.0),
    }
}

fn metering_record(
    id: &str,
    kind: MeteringKind,
    target_mass_g: Option<f64>,
    actual_mass_g: f64,
    timestamp_ms: u64,
) -> MeteringRecord {
    MeteringRecord {
        id: id.to_string(),
        kind,
        target_mass_g,
        actual_volume_ml: Some(actual_mass_g),
        density_g_per_ml: Some(1.0),
        actual_mass_g: round1(actual_mass_g),
        tolerance_g: Some(2.0),
        deviation_g: target_mass_g.map(|target| round1(actual_mass_g - target)),
        started_at_ms: timestamp_ms,
        finished_at_ms: timestamp_ms.saturating_add(1),
        source_device_id: "mock-meter".to_string(),
        runtime_run_id: None,
        status: MeteringStatus::Completed,
    }
}

fn sync_record(
    event_id: u64,
    operation: PrmsOperation,
    request_payload: Value,
    response_payload: Option<Value>,
) -> PrmsSyncRecord {
    let now = now_ms();
    PrmsSyncRecord {
        id: format!("sync-{event_id}"),
        operation,
        idempotency_key: format!("sync-{event_id}"),
        request_payload,
        response_payload,
        status: SyncStatus::Succeeded,
        attempt_count: 1,
        last_error: None,
        created_at_ms: now,
        updated_at_ms: now,
    }
}

fn build_report(batch: &Batch, recipe: &DilutionRecipeSnapshot, raw_mass_g: f64) -> DilutionReport {
    DilutionReport {
        report_id: format!("report-{}", batch.id),
        batch_id: batch.id.clone(),
        raw_resist_name: recipe.raw_resist_name.clone(),
        raw_barcodes: batch
            .raw_scans
            .iter()
            .map(|scan| scan.barcode.clone())
            .collect(),
        raw_mass_g: round1(raw_mass_g),
        machine_id: batch.machine_id.clone(),
        operator_id: batch.operator_id.clone(),
        reviewer_ids: batch.reviewer_ids.clone(),
        viscosity_average_cp: batch.viscosity.as_ref().and_then(|test| test.average_cp),
        dilution_resist_name: recipe.dilution_resist_name.clone(),
        output_bottles: batch
            .output_bottles
            .iter()
            .filter_map(|bottle| {
                Some(ReportBottleLine {
                    index: bottle.index,
                    dilution_barcode: bottle.dilution_barcode.clone()?,
                    actual_mass_g: bottle.actual_mass_g?,
                })
            })
            .collect(),
        comment: Some("PGMEA as mock dilution solvent".to_string()),
    }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn default_log_root() -> PathBuf {
    log_paths::default_log_dir()
}
