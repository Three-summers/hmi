//! 稀释批次状态机：PRMS SOAP 三步 + craftsmanship 本地工艺

use super::config::{default_workspace_root, load_dilution_config, DilutionConfig, DilutionOptionConfig};
use super::types::*;
use crate::craftsmanship::{RecipeRuntimeManager, RecipeRuntimeRunInput, RecipeRuntimeStatus};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

static SNAPSHOT_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static BATCH_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct DilutionManager {
    inner: Arc<Mutex<DilutionState>>,
    adapters: Arc<DilutionAdapters>,
    repository: Arc<DilutionRepository>,
    workspace_root: PathBuf,
    project_id: String,
    config: DilutionConfig,
}

#[derive(Default)]
pub(super) struct DilutionState {
    pub batches: HashMap<String, Batch>,
    pub next_event_id: u64,
}

struct DilutionAdapters {
    prms: Arc<dyn PrmsClient>,
    devices: Arc<dyn DilutionDeviceGateway>,
}

struct DilutionRepository {
    log_root: PathBuf,
}

impl Default for DilutionManager {
    fn default() -> Self {
        Self::new_mock()
    }
}

impl DilutionManager {
    pub fn new_mock() -> Self {
        Self::new_mock_with_log_root(default_log_root())
    }

    pub fn new_mock_with_log_root(log_root: PathBuf) -> Self {
        Self::new_with(
            log_root,
            default_workspace_root(),
            super::config::DEFAULT_PROJECT_ID.to_string(),
            Arc::new(MockPrmsClient),
            Arc::new(MockDilutionDeviceGateway),
        )
    }

    pub fn new_with(
        log_root: PathBuf,
        workspace_root: PathBuf,
        project_id: String,
        prms: Arc<dyn PrmsClient>,
        devices: Arc<dyn DilutionDeviceGateway>,
    ) -> Self {
        let config = load_dilution_config(&workspace_root).unwrap_or_default();
        Self {
            inner: Arc::new(Mutex::new(DilutionState::default())),
            adapters: Arc::new(DilutionAdapters { prms, devices }),
            repository: Arc::new(DilutionRepository { log_root }),
            workspace_root,
            project_id,
            config,
        }
    }

    pub fn config(&self) -> &DilutionConfig {
        &self.config
    }

    pub fn create_batch(&self, request: CreateBatchRequest) -> Result<Batch, String> {
        let eqpt_id = request
            .machine_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| self.config.eqpt_id().map(str::to_string))
            .ok_or_else(|| "machineId is required (and no default eqptId configured)".to_string())?;
        let operator = request
            .operator_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| self.config.operator().map(str::to_string))
            .ok_or_else(|| "operatorId is required (and no default operator configured)".to_string())?;
        if request.planned_bottle_count == 0 {
            return Err("plannedBottleCount must be greater than 0".to_string());
        }
        if request.target_bottle_mass_g <= 0.0 {
            return Err("targetBottleMassG must be greater than 0".to_string());
        }

        let mut state = self.lock_state()?;
        let now = now_ms();
        let batch_sequence = BATCH_ID_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
        let batch = Batch {
            id: format!("DIL-{now}-{batch_sequence:04}"),
            machine_id: eqpt_id.clone(),
            status: BatchStatus::Draft,
            operator_id: operator.clone(),
            reviewer_ids: request.reviewer_ids,
            planned_bottle_count: request.planned_bottle_count,
            target_bottle_mass_g: request.target_bottle_mass_g,
            created_at_ms: now,
            completed_at_ms: None,
            raw_scans: Vec::new(),
            selected_recipe: None,
            metering_records: Vec::new(),
            viscosity: None,
            output_bottles: Vec::new(),
            prms_sync: Vec::new(),
            report: None,
            alarms: Vec::new(),
            resist_info: None,
            selected_concentration: None,
            resist_def_rrn: None,
            check_result: None,
            resist_barcodes: Vec::new(),
            resist_sys_rrns: Vec::new(),
            print_success: None,
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
        let scan_event_id = state.next_event_id();
        let sync_event_id = state.next_event_id();
        let batch = state.batch_mut(request.batch_id.as_str())?;
        if !matches!(
            batch.status,
            BatchStatus::Draft
                | BatchStatus::ScanningRawResist
                | BatchStatus::ResistInfoResolved
                | BatchStatus::RecipeLocked
        ) {
            return Err(format!(
                "cannot scan raw resist for batch `{}` in status {:?}",
                batch.id, batch.status
            ));
        }
        batch.status = BatchStatus::ScanningRawResist;

        let mapping_result = adapters.prms.query_resist_info(QueryResistInfoRequest {
            vendor_barcode: request.barcode.clone(),
        })?;
        let info = mapping_result.value;

        if let Some(existing) = batch.resist_info.as_ref() {
            if existing.resist_no != info.resist_no {
                return Err(format!(
                    "raw resist mismatch: expected `{}`, got `{}`",
                    existing.resist_no, info.resist_no
                ));
            }
        }

        let scan = RawResistScan {
            scan_id: format!("scan-{scan_event_id}"),
            barcode: request.barcode,
            scanned_at_ms: now_ms(),
            operator_id: request.operator_id,
            material_name: Some(info.resist_name.clone()),
            lot_id: Some(info.def_batch_no.clone()),
            prms_query_id: Some(info.vendor_barcode.clone()),
            validation_status: ScanValidationStatus::Accepted,
            validation_message: Some("PRMS resistInfo accepted".to_string()),
        };
        batch.raw_scans.push(scan);
        batch.prms_sync.push(sync_record(
            sync_event_id,
            PrmsOperation::ResistInfo,
            mapping_result.request_payload,
            Some(mapping_result.response_payload),
        ));
        if batch.resist_info.is_none() {
            batch.resist_info = Some(info.clone());
            batch.status = BatchStatus::ResistInfoResolved;
        }

        if batch
            .resist_info
            .as_ref()
            .is_some_and(|info| info.dilution_relationships.len() == 1)
        {
            let concentration = info.dilution_relationships[0].concentration.clone();
            if let Some(option) = self
                .config
                .option_for_concentration(&concentration)
                .cloned()
            {
                lock_selected_option(batch, &info.dilution_relationships[0], &option)?;
            }
        }

        self.repository.persist_batch_change(
            batch,
            "raw_resist_scanned",
            json!({ "barcode": info.vendor_barcode, "resistNo": info.resist_no }),
        )?;
        Ok(batch.clone())
    }

    pub fn select_concentration(
        &self,
        request: SelectConcentrationRequest,
    ) -> Result<Batch, String> {
        let mut state = self.lock_state()?;
        let batch = state.batch_mut(request.batch_id.as_str())?;
        if batch.status != BatchStatus::ResistInfoResolved {
            return Err(format!(
                "cannot select concentration for batch `{}` in status {:?}",
                batch.id, batch.status
            ));
        }
        let info = batch
            .resist_info
            .clone()
            .ok_or_else(|| "resist info has not been resolved; scan a raw resist barcode first")?;
        let relationship = info
            .dilution_relationships
            .iter()
            .find(|relationship| relationship.concentration == request.concentration)
            .cloned()
            .ok_or_else(|| format!("concentration `{}` is not available", request.concentration))?;
        let option = self
            .config
            .option_for_concentration(&request.concentration)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "concentration `{}` is not configured in workspace system/dilution.json",
                    request.concentration
                )
            })?;
        lock_selected_option(batch, &relationship, &option)?;
        // 预校验（check 接口）：校验条码与浓度匹配，失败则不锁定配方
        let check_result = self.adapters.prms.check_batch(CheckBatchRequest {
            vendor_barcode_list: batch
                .raw_scans
                .iter()
                .map(|scan| scan.barcode.clone())
                .collect(),
            concentration: request.concentration.clone(),
        })?;
        batch.check_result = Some(check_result.value);
        self.repository.persist_batch_change(
            batch,
            "concentration_selected",
            json!({ "concentration": request.concentration, "resistDefRrn": batch.resist_def_rrn }),
        )?;
        Ok(batch.clone())
    }

    pub async fn run_batch_with_app<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        request: RunBatchRequest,
    ) -> Result<Batch, String> {
        let app_handle = app
            .cloned()
            .ok_or_else(|| "app handle is required to run the local recipe".to_string())?;
        let rt = app_handle.state::<RecipeRuntimeManager>().inner().clone();

        let (
            batch_id,
            recipe_id,
            bottle_count,
            target_mass,
            raw_load,
            selected_concentration,
            resist_info,
            resist_def_rrn,
            raw_barcodes,
            created_at_ms,
        ) = {
            let state = self.lock_state()?;
            let batch = state
                .batches
                .get(request.batch_id.as_str())
                .ok_or_else(|| format!("batch `{}` not found", request.batch_id))?;
            if batch.status != BatchStatus::RecipeLocked {
                return Err(format!(
                    "cannot run batch `{}` from status {:?}",
                    batch.id, batch.status
                ));
            }
            let concentration = batch
                .selected_concentration
                .clone()
                .ok_or_else(|| "selected concentration is missing".to_string())?;
            let option = self
                .config
                .option_for_concentration(&concentration)
                .cloned()
                .ok_or_else(|| format!("concentration `{concentration}` config is missing"))?;
            (
                batch.id.clone(),
                option.recipe_id.clone(),
                batch.planned_bottle_count,
                batch.target_bottle_mass_g,
                request.raw_load.clone(),
                concentration,
                batch.resist_info.clone(),
                batch.resist_def_rrn.clone(),
                batch
                    .raw_scans
                    .iter()
                    .map(|scan| scan.barcode.clone())
                    .collect::<Vec<_>>(),
                batch.created_at_ms,
            )
        };
        let operator = self.config.operator().map(str::to_string);
        let checker = self.config.checker().map(str::to_string);
        let resist_def_rrn = resist_def_rrn.ok_or_else(|| "resistDefRrn is missing".to_string())?;

        // 1. 加载本地配方
        rt.load_recipe(
            None,
            self.workspace_root.to_string_lossy().to_string(),
            self.project_id.clone(),
            recipe_id,
        )
        .await?;

        // 2. 启动（runInputs.parameters 传本地执行参数）
        let raw_target_mass = resolve_raw_load_mass(&raw_load, target_mass)?;
        let mut parameters = BTreeMap::new();
        parameters.insert("rawLoadTargetMassG".to_string(), json!(raw_target_mass));
        parameters.insert("bottleCount".to_string(), json!(bottle_count));
        parameters.insert("ratioRaw".to_string(), json!(self.config_ratio_raw()));
        parameters.insert("ratioSolvent".to_string(), json!(self.config_ratio_solvent()));
        parameters.insert("targetBottleMassG".to_string(), json!(target_mass));
        rt.start_with_input_with_app(
            Some(app_handle.clone()),
            Some(RecipeRuntimeRunInput {
                correlation_id: Some(batch_id.clone()),
                operator_id: operator.clone(),
                reviewer_ids: Vec::new(),
                parameters,
                domain: None,
            }),
        )
        .await?;

        // 3. 轮询直到终态
        loop {
            let snapshot = rt.get_status().await;
            match snapshot.status {
                RecipeRuntimeStatus::Completed => break,
                RecipeRuntimeStatus::Failed | RecipeRuntimeStatus::Stopped => {
                    let message = snapshot
                        .last_error
                        .map(|failure| failure.message)
                        .or(snapshot.last_message)
                        .unwrap_or_else(|| "local recipe did not complete".to_string());
                    return Err(format!("local recipe failed: {message}"));
                }
                _ => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        }

        // 4. 读取结果
        let snapshot = rt.get_status().await;
        let runtime_values = &snapshot.runtime_values;
        let raw_mass = runtime_values
            .get("rawActualMassG")
            .and_then(Value::as_f64)
            .unwrap_or(raw_target_mass);
        let solvent_mass = runtime_values
            .get("solventActualMassG")
            .and_then(Value::as_f64)
            .unwrap_or_else(|| raw_mass * self.config_ratio_solvent() / self.config_ratio_raw());
        let viscosity = runtime_values
            .get("viscosityAvgCp")
            .and_then(Value::as_f64)
            .or_else(|| request.viscosity_readings_cp.first().copied())
            .ok_or_else(|| "local recipe did not produce a viscosity result".to_string())?;

        // 5. PRMS batchCreate（不放锁跨 IO）
        {
            let mut state = self.lock_state()?;
            state.batch_mut(batch_id.as_str())?.status = BatchStatus::BatchCreating;
        }
        let resist_info = resist_info.ok_or_else(|| "resist info is missing".to_string())?;
        let dilution_resist_name = resist_info
            .dilution_relationships
            .iter()
            .find(|relationship| relationship.concentration == selected_concentration)
            .map(|relationship| relationship.resist_name.clone())
            .unwrap_or_default();
        let create_request = CreateDilutionBatchRequest {
            vendor_barcode_list: raw_barcodes,
            resist_def_rrn,
            eqpt_id: Some(self.batch_machine_id(&batch_id)?),
            bottle_count,
            viscosity: Some(round1(viscosity)),
            label_print_url: self
                .config
                .label_print_url
                .clone()
                .filter(|url| !url.is_empty()),
            source_resist_name: Some(resist_info.resist_name.clone()),
            source_resist_barcode: Some(resist_info.vendor_barcode.clone()),
            source_resist_weight: Some(round1(raw_mass)),
            source_bottle_count: Some(self.batch_scan_count(&batch_id)? as u32),
            operator,
            checker,
            mix_start_time: Some(format_unix_ms(created_at_ms)),
            mix_end_time: Some(format_unix_ms(now_ms())),
            viscosity_test_time: Some(format_unix_ms(now_ms())),
            dilution_resist_name: Some(dilution_resist_name),
            dilution_bottle_count: Some(bottle_count),
            dilution_weight: Some(round1(raw_mass + solvent_mass)),
            comment: Some("本地稀释批次".to_string()),
            ..Default::default()
        };
        let create_result = self.adapters.prms.create_dilution_batch(create_request)?;
        let created = create_result.value;
        let barcodes = created.resist_barcodes.clone();
        let sys_rrns = created.resist_sys_rrns.clone();
        let print_success = created.print_success;

        // 6. 分装（条码关联）
        let mut state = self.lock_state()?;
        let create_sync_event_id = state.next_event_id();
        let batch = state.batch_mut(batch_id.as_str())?;
        batch.status = BatchStatus::Dispensing;
        batch.prms_sync.push(sync_record(
            create_sync_event_id,
            PrmsOperation::CreateBatch,
            create_result.request_payload,
            Some(create_result.response_payload),
        ));
        batch.resist_barcodes = barcodes.clone();
        batch.resist_sys_rrns = sys_rrns.clone();
        batch.print_success = print_success;
        drop(state);

        let dispensed = self.adapters.devices.dispense_outputs(DispenseOutputRequest {
            total_mass_g: raw_mass + solvent_mass,
            bottle_count,
            target_bottle_mass_g: target_mass,
            timestamp_ms: now_ms(),
        })?;

        let mut state = self.lock_state()?;
        let batch = state.batch_mut(batch_id.as_str())?;
        batch.output_bottles.clear();
        for dispensed_bottle in dispensed {
            if dispensed_bottle.index == 0 {
                return Err(
                    "dispense gateway returned bottle index 0 (expected 1-based)".to_string(),
                );
            }
            let barcode = barcodes
                .get((dispensed_bottle.index - 1) as usize)
                .cloned()
                .ok_or_else(|| format!("PRMS did not return barcode for bottle {}", dispensed_bottle.index))?;
            batch.metering_records.push(dispensed_bottle.metering_record.clone());
            batch.output_bottles.push(OutputBottle {
                index: dispensed_bottle.index,
                target_mass_g: target_mass,
                actual_mass_g: Some(dispensed_bottle.actual_mass_g),
                dilution_barcode: Some(barcode),
                barcode_status: BarcodeStatus::Assigned,
                print_status: print_success.unwrap_or(false)
                    .then_some(PrintStatus::Printed)
                    .unwrap_or(PrintStatus::Pending),
                dispensed_at_ms: Some(now_ms()),
                is_last_underfilled: dispensed_bottle.index == bottle_count
                    && dispensed_bottle.actual_mass_g < target_mass,
                metering_record_id: Some(dispensed_bottle.metering_record.id.clone()),
            });
        }

        batch.report = Some(build_report(batch, &self.config, viscosity, raw_mass, solvent_mass));
        batch.status = BatchStatus::Completed;
        batch.completed_at_ms = Some(now_ms());

        self.repository.persist_batch_change(
            batch,
            "batch_completed",
            json!({ "barcodeCount": barcodes.len() }),
        )?;
        Ok(batch.clone())
    }

    fn config_ratio_raw(&self) -> f64 {
        self.config
            .dilution_options
            .first()
            .map(|option| option.ratio.raw)
            .unwrap_or(1.0)
    }

    fn config_ratio_solvent(&self) -> f64 {
        self.config
            .dilution_options
            .first()
            .map(|option| option.ratio.solvent)
            .unwrap_or(0.0)
    }

    fn batch_machine_id(&self, batch_id: &str) -> Result<String, String> {
        Ok(self.get_batch(batch_id)?.machine_id)
    }

    fn batch_scan_count(&self, batch_id: &str) -> Result<usize, String> {
        Ok(self.get_batch(batch_id)?.raw_scans.len())
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

struct MockPrmsClient;

impl PrmsClient for MockPrmsClient {
    fn query_resist_info(
        &self,
        request: QueryResistInfoRequest,
    ) -> Result<AdapterResult<ResistInfo>, String> {
        let barcode = request.vendor_barcode;
        let resist_no = barcode.get(..7).unwrap_or(&barcode).to_string();
        let def_batch_no = barcode.get(7..15).unwrap_or("12345678").to_string();
        let expire_time = barcode.get(15..21).unwrap_or("260507").to_string();

        let (resist_name, relationships) = if barcode.contains("MULTI") {
            (
                "TMR-MULTI PM 5.4cP".to_string(),
                vec![
                    DilutionRelationship {
                        resist_no: "MULTI-D".to_string(),
                        resist_name: "MULTI-D 60%".to_string(),
                        concentration: "60%".to_string(),
                        sys_rrn: "2004086388857843700".to_string(),
                    },
                    DilutionRelationship {
                        resist_no: "MULTI-D2".to_string(),
                        resist_name: "MULTI-D2 70%".to_string(),
                        concentration: "70%".to_string(),
                        sys_rrn: "2011636530905427900".to_string(),
                    },
                ],
            )
        } else if barcode.contains("IK02") {
            (
                "TMR-IK02 PM 5.4cP".to_string(),
                vec![DilutionRelationship {
                    resist_no: "IK02-D".to_string(),
                    resist_name: "IK02-D 70%".to_string(),
                    concentration: "70%".to_string(),
                    sys_rrn: "2011636530905427800".to_string(),
                }],
            )
        } else {
            return Err(format!("mock PRMS cannot resolve barcode `{barcode}`"));
        };

        let value = ResistInfo {
            resist_no: resist_no.clone(),
            resist_name,
            concentration: "1.0".to_string(),
            mtr_no: "MTR001".to_string(),
            defrost_time: "08:00".to_string(),
            defrost_buffer_days: 0,
            warning_day: 7,
            extend_days: 30,
            viscosity_upper_limit: Some(10.0),
            viscosity_lower_limit: Some(1.0),
            vendor_barcode: barcode.clone(),
            def_batch_no,
            to_resist_no: resist_no,
            expire_time,
            dilution_relationships: relationships,
        };
        Ok(AdapterResult {
            request_payload: json!({ "method": "resistInfo", "vendorBarcode": barcode }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }

    fn check_batch(
        &self,
        request: CheckBatchRequest,
    ) -> Result<AdapterResult<CheckResult>, String> {
        if request.vendor_barcode_list.is_empty() {
            return Err("vendorBarcode is empty".to_string());
        }
        let first = &request.vendor_barcode_list[0];
        let value = CheckResult {
            resist_no: first.get(..7).unwrap_or(first).to_string(),
            def_resist_no: format!("{}-D", first.get(..7).unwrap_or(first)),
            resist_def_rrn: "2011636530905427800".to_string(),
            batch_no: first.get(7..15).unwrap_or("12345678").to_string(),
            expire_date: first.get(15..21).unwrap_or("260507").to_string(),
            concentration: request.concentration.clone(),
            barcode_count: request.vendor_barcode_list.len() as u32,
        };
        Ok(AdapterResult {
            request_payload: json!({ "method": "check", "concentration": request.concentration }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }

    fn create_dilution_batch(
        &self,
        request: CreateDilutionBatchRequest,
    ) -> Result<AdapterResult<CreateDilutionBatchResult>, String> {
        let resist_no = request
            .vendor_barcode_list
            .first()
            .map(|barcode| barcode.get(..7).unwrap_or(barcode).to_string())
            .ok_or_else(|| "vendorBarcode is empty".to_string())?;
        let batch_no = request
            .batch_no
            .clone()
            .unwrap_or_else(|| "12345678".to_string());
        let expire_date = request
            .exp_date
            .clone()
            .unwrap_or_else(|| "260507".to_string());
        let barcodes = (1..=request.bottle_count)
            .map(|index| format!("{resist_no}{batch_no}{expire_date}{index:03}"))
            .collect::<Vec<_>>();
        let sys_rrns = (1..=request.bottle_count)
            .map(|index| format!("20306258451823125{index:02}"))
            .collect::<Vec<_>>();
        let value = CreateDilutionBatchResult {
            resist_sys_rrns: sys_rrns,
            resist_barcodes: barcodes,
            print_success: Some(true),
        };
        Ok(AdapterResult {
            request_payload: json!({ "method": "batchCreate", "bottleCount": request.bottle_count }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }
}

pub struct MockDilutionDeviceGateway;

impl DilutionDeviceGateway for MockDilutionDeviceGateway {
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

fn lock_selected_option(
    batch: &mut Batch,
    relationship: &DilutionRelationship,
    option: &DilutionOptionConfig,
) -> Result<(), String> {
    batch.resist_def_rrn = Some(relationship.sys_rrn.clone());
    batch.selected_concentration = Some(relationship.concentration.clone());
    batch.selected_recipe = Some(DilutionRecipeSnapshot {
        id: option.recipe_id.clone(),
        version: "config-v1".to_string(),
        raw_resist_name: batch
            .resist_info
            .as_ref()
            .map(|info| info.resist_name.clone())
            .unwrap_or_default(),
        concentration: relationship.concentration.clone(),
        dilution_resist_name: relationship.resist_name.clone(),
        ratio: RatioDefinition {
            raw: option.ratio.raw,
            solvent: option.ratio.solvent,
        },
        raw_density_g_per_ml: option.raw_density_g_per_ml,
        solvent_density_g_per_ml: option.solvent_density_g_per_ml,
        mix_time_ms: option.mix_time_ms,
        settle_time_ms: option.settle_time_ms,
        viscosity_min_cp: option.viscosity_min_cp,
        viscosity_max_cp: option.viscosity_max_cp,
        standard_bottle_mass_g: batch.target_bottle_mass_g,
        recipe_id: option.recipe_id.clone(),
    });
    batch.status = BatchStatus::RecipeLocked;
    Ok(())
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

fn build_report(
    batch: &Batch,
    config: &DilutionConfig,
    viscosity: f64,
    raw_mass: f64,
    solvent_mass: f64,
) -> DilutionReport {
    DilutionReport {
        report_id: format!("report-{}", batch.id),
        batch_id: batch.id.clone(),
        eqpt_id: Some(batch.machine_id.clone()),
        operator: config.operator().map(str::to_string),
        checker: config.checker().map(str::to_string),
        source_resist_name: batch
            .resist_info
            .as_ref()
            .map(|info| info.resist_name.clone()),
        source_resist_barcode: Some(
            batch
                .raw_scans
                .iter()
                .map(|scan| scan.barcode.as_str())
                .collect::<Vec<_>>()
                .join(","),
        ),
        source_resist_weight: Some(round1(raw_mass)),
        source_bottle_count: Some(batch.raw_scans.len() as u32),
        mix_start_time: Some(format_unix_ms(batch.created_at_ms)),
        mix_end_time: Some(format_unix_ms(now_ms())),
        viscosity_test_time: Some(format_unix_ms(now_ms())),
        viscosity: Some(round1(viscosity)),
        dilution_resist_name: batch
            .selected_recipe
            .as_ref()
            .map(|recipe| recipe.dilution_resist_name.clone()),
        dilution_bottle_count: Some(batch.planned_bottle_count),
        dilution_weight: Some(round1(raw_mass + solvent_mass)),
        comment: batch
            .selected_recipe
            .as_ref()
            .map(|recipe| format!("稀释浓度 {}", recipe.concentration)),
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
        resist_sys_rrns: batch.resist_sys_rrns.clone(),
        print_success: batch.print_success,
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

fn format_unix_ms(timestamp_ms: u64) -> String {
    use chrono::TimeZone;
    let seconds = (timestamp_ms / 1000) as i64;
    chrono::Utc
        .timestamp_opt(seconds, 0)
        .single()
        .map(|datetime| datetime.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "1970-01-01 00:00:00".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    fn create_request() -> CreateBatchRequest {
        CreateBatchRequest {
            machine_id: Some("MCP-03".to_string()),
            operator_id: Some("op-001".to_string()),
            reviewer_ids: vec!["qa-001".to_string()],
            planned_bottle_count: 3,
            target_bottle_mass_g: 500.0,
        }
    }

    fn default_log_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "hmi-dilution-log-test-{}-{}",
            std::process::id(),
            name
        ))
    }

    fn build_test_workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hmi-dilution-ws-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("system/actions")).unwrap();
        std::fs::create_dir_all(dir.join("system/device-types")).unwrap();
        std::fs::create_dir_all(dir.join("projects/dilution-machine/recipes")).unwrap();
        std::fs::create_dir_all(dir.join("projects/dilution-machine/signals")).unwrap();
        std::fs::write(
            dir.join("system/dilution.json"),
            r#"{"machine":{"eqptId":"MCP-03"},"personnel":{"operator":"op-001","checker":"qa-001"},"dilutionOptions":[
              {"concentration":"60%","recipeId":"test-recipe","ratio":{"raw":6,"solvent":4},"mixTimeMs":100,"settleTimeMs":100},
              {"concentration":"70%","recipeId":"test-recipe","ratio":{"raw":7,"solvent":3},"mixTimeMs":100,"settleTimeMs":100}
            ]}"#,
        )
        .unwrap();
        // 内建动作必须存在，否则 craftsmanship 校验会产出 error diagnostics，start() 拒绝执行
        std::fs::write(
            dir.join("system/actions/common.delay.json"),
            r#"{"id":"common.delay","name":"延时","targetMode":"none","parameters":[{"key":"durationMs","name":"时长","type":"number","required":true}]}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("system/actions/common.wait-signal.json"),
            r#"{"id":"common.wait-signal","name":"等待信号","targetMode":"none","parameters":[{"key":"signalId","name":"信号","type":"string","required":true},{"key":"operator","name":"比较符","type":"string"},{"key":"value","name":"目标值","type":"number","required":true}]}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("projects/dilution-machine/project.json"),
            r#"{"id":"dilution-machine","name":"测试项目","enabled":true}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("projects/dilution-machine/signals/viscosity_ready.json"),
            r#"{"id":"viscosity_ready","name":"粘度就绪","dataType":"double","source":"viscosityAvgCp","enabled":true}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("projects/dilution-machine/recipes/test-recipe.json"),
            r#"{
              "id":"test-recipe",
              "name":"测试配方",
              "steps":[
                {"id":"S010","seq":10,"name":"延时","actionId":"common.delay","parameters":{"durationMs":300},"timeoutMs":5000,"onError":"stop"},
                {"id":"S020","seq":20,"name":"等待粘度","actionId":"common.wait-signal","parameters":{"signalId":"viscosity_ready","operator":"ge","value":0},"timeoutMs":5000,"onError":"stop"}
              ]
            }"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn run_batch_request_should_deserialize_frontend_mass_raw_load_payload() {
        let payload = serde_json::json!({
            "batchId": "DIL-1",
            "rawLoad": {
                "mode": "mass",
                "targetMassG": 1000.0
            },
            "viscosityReadingsCp": [5.2, 5.4]
        });

        let request: RunBatchRequest = serde_json::from_value(payload).unwrap();

        assert_eq!(request.batch_id, "DIL-1");
        assert_eq!(request.viscosity_readings_cp, vec![5.2, 5.4]);
        match request.raw_load {
            RawLoadRequest::ByMass { target_mass_g } => assert_eq!(target_mass_g, 1000.0),
            RawLoadRequest::ByBottleCount { .. } => panic!("expected mass raw load"),
        }
    }

    #[test]
    fn run_batch_request_should_deserialize_frontend_bottle_count_raw_load_payload() {
        let payload = serde_json::json!({
            "batchId": "DIL-1",
            "rawLoad": {
                "mode": "bottle_count",
                "bottleCount": 2
            }
        });

        let request: RunBatchRequest = serde_json::from_value(payload).unwrap();

        assert_eq!(request.batch_id, "DIL-1");
        match request.raw_load {
            RawLoadRequest::ByBottleCount { bottle_count } => assert_eq!(bottle_count, 2),
            RawLoadRequest::ByMass { .. } => panic!("expected bottle count raw load"),
        }
    }

    #[test]
    fn create_batch_should_fallback_to_config_defaults() {
        let workspace = build_test_workspace("config-defaults");
        let manager = DilutionManager::new_with(
            default_log_root("config-defaults"),
            workspace,
            "dilution-machine".to_string(),
            Arc::new(MockPrmsClient),
            Arc::new(MockDilutionDeviceGateway),
        );
        let batch = manager
            .create_batch(CreateBatchRequest {
                machine_id: None,
                operator_id: None,
                reviewer_ids: Vec::new(),
                planned_bottle_count: 1,
                target_bottle_mass_g: 500.0,
            })
            .unwrap();
        assert_eq!(batch.machine_id, "MCP-03");
        assert_eq!(batch.operator_id, "op-001");
    }

    #[test]
    fn scan_should_resolve_resist_info_and_auto_lock_single_option() {
        let manager = DilutionManager::new_mock();
        let batch = manager.create_batch(create_request()).unwrap();
        let batch = manager
            .scan_raw_resist(ScanRawResistRequest {
                batch_id: batch.id.clone(),
                barcode: "RAW-IK02-LOT01-B01".to_string(),
                operator_id: "op-001".to_string(),
            })
            .unwrap();
        assert_eq!(batch.status, BatchStatus::RecipeLocked);
        assert!(batch.resist_info.is_some());
        assert!(batch.resist_def_rrn.is_some());
        assert_eq!(batch.selected_concentration.as_deref(), Some("70%"));
    }

    #[test]
    fn scan_should_reject_inconsistent_resist_no_across_scans() {
        let manager = DilutionManager::new_mock();
        let batch = manager.create_batch(create_request()).unwrap();
        manager
            .scan_raw_resist(ScanRawResistRequest {
                batch_id: batch.id.clone(),
                barcode: "RAW-IK02-LOT01-B01".to_string(),
                operator_id: "op-001".to_string(),
            })
            .unwrap();
        let result = manager.scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "MULTI-LOT02-B01".to_string(),
            operator_id: "op-001".to_string(),
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("raw resist mismatch"));
    }

    #[test]
    fn select_concentration_should_set_resist_def_rrn_from_relationship() {
        let manager = DilutionManager::new_mock();
        let batch = manager.create_batch(create_request()).unwrap();
        let batch = manager
            .scan_raw_resist(ScanRawResistRequest {
                batch_id: batch.id.clone(),
                barcode: "MULTI-LOT01-B01".to_string(),
                operator_id: "op-001".to_string(),
            })
            .unwrap();
        assert_eq!(batch.status, BatchStatus::ResistInfoResolved);
        let batch = manager
            .select_concentration(SelectConcentrationRequest {
                batch_id: batch.id.clone(),
                concentration: "70%".to_string(),
            })
            .unwrap();
        assert_eq!(batch.status, BatchStatus::RecipeLocked);
        assert_eq!(batch.resist_def_rrn.as_deref(), Some("2011636530905427900"));
    }

    #[test]
    fn select_concentration_should_reject_missing_config_option() {
        let manager = DilutionManager::new_mock();
        let batch = manager.create_batch(create_request()).unwrap();
        let batch = manager
            .scan_raw_resist(ScanRawResistRequest {
                batch_id: batch.id.clone(),
                barcode: "MULTI-LOT01-B01".to_string(),
                operator_id: "op-001".to_string(),
            })
            .unwrap();
        // MULTI 有 60%/70% 两个浓度，但 repo workspace 配置（mock 默认）只有 70% → 60% 查不到配置应报错
        let result = manager.select_concentration(SelectConcentrationRequest {
            batch_id: batch.id.clone(),
            concentration: "60%".to_string(),
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not configured"));
     }

    #[tokio::test]
    async fn run_batch_should_drive_craftsmanship_recipe_and_complete() {
        let workspace = build_test_workspace("run-e2e");
        let app = mock_app();
        let rt = RecipeRuntimeManager::default();
        assert!(app.manage(rt.clone()));

        let manager = DilutionManager::new_with(
            default_log_root("run-e2e"),
            workspace,
            "dilution-machine".to_string(),
            Arc::new(MockPrmsClient),
            Arc::new(MockDilutionDeviceGateway),
        );
        let batch = manager.create_batch(create_request()).unwrap();
        let batch = manager
            .scan_raw_resist(ScanRawResistRequest {
                batch_id: batch.id.clone(),
                barcode: "MULTI-LOT01-B01".to_string(),
                operator_id: "op-001".to_string(),
            })
            .unwrap();
        let batch = manager
            .select_concentration(SelectConcentrationRequest {
                batch_id: batch.id.clone(),
                concentration: "60%".to_string(),
            })
            .unwrap();

        let manager_run = manager.clone();
        let app_handle = app.handle().clone();
        let run_task: tokio::task::JoinHandle<Result<Batch, String>> = tokio::spawn(async move {
            manager_run
                .run_batch_with_app(
                    Some(&app_handle),
                    RunBatchRequest {
                        batch_id: batch.id.clone(),
                        raw_load: RawLoadRequest::ByMass {
                            target_mass_g: 1000.0,
                        },
                        viscosity_readings_cp: Vec::new(),
                    },
                )
                .await
        });
        // 等 recipe 进入 wait-signal 步骤后写入粘度信号（source=viscosityAvgCp → runtime_values）
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        rt.write_signal_with_app(
            Some(app.handle()),
            "viscosity_ready".to_string(),
            serde_json::json!(5.4),
        )
        .await
        .unwrap();

        let finished = run_task.await.unwrap().unwrap();
        assert_eq!(finished.status, BatchStatus::Completed);
        assert_eq!(finished.resist_barcodes.len(), 3);
        assert!(finished.print_success == Some(true));
        let report = finished.report.unwrap();
        assert_eq!(report.viscosity, Some(5.4));
        assert_eq!(report.output_bottles.len(), 3);
    }

    #[tokio::test]
    async fn run_batch_should_fail_without_viscosity_result() {
        let workspace = build_test_workspace("run-fail");
        let app = mock_app();
        let rt = RecipeRuntimeManager::default();
        assert!(app.manage(rt.clone()));

        let manager = DilutionManager::new_with(
            default_log_root("run-fail"),
            workspace,
            "dilution-machine".to_string(),
            Arc::new(MockPrmsClient),
            Arc::new(MockDilutionDeviceGateway),
        );
        let batch = manager.create_batch(create_request()).unwrap();
        let batch = manager
            .scan_raw_resist(ScanRawResistRequest {
                batch_id: batch.id.clone(),
                barcode: "MULTI-LOT01-B01".to_string(),
                operator_id: "op-001".to_string(),
            })
            .unwrap();
        let batch = manager
            .select_concentration(SelectConcentrationRequest {
                batch_id: batch.id.clone(),
                concentration: "60%".to_string(),
            })
            .unwrap();

        // 不写粘度信号 → 配方在 wait-signal 处超时失败
        let result = manager
            .run_batch_with_app(
                Some(app.handle()),
                RunBatchRequest {
                    batch_id: batch.id.clone(),
                    raw_load: RawLoadRequest::ByMass {
                        target_mass_g: 1000.0,
                    },
                    viscosity_readings_cp: Vec::new(),
                },
            )
            .await;
        assert!(result.is_err());
    }
}
