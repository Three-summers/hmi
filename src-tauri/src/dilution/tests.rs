use super::*;

fn create_request() -> CreateBatchRequest {
    CreateBatchRequest {
        machine_id: "MCP-03".to_string(),
        operator_id: "op-001".to_string(),
        reviewer_ids: vec!["qa-001".to_string()],
        planned_bottle_count: 3,
        target_bottle_mass_g: 500.0,
    }
}

fn run_request(batch_id: String) -> RunBatchRequest {
    RunBatchRequest {
        batch_id,
        raw_load: RawLoadRequest::ByMass {
            target_mass_g: 1000.0,
        },
        viscosity_readings_cp: vec![5.2, 5.4],
    }
}

fn locked_batch(manager: &DilutionManager) -> Batch {
    let batch = manager.create_batch(create_request()).unwrap();
    manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id,
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap()
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
        },
        "viscosityReadingsCp": [5.2, 5.4]
    });

    let request: RunBatchRequest = serde_json::from_value(payload).unwrap();

    assert_eq!(request.batch_id, "DIL-1");
    assert_eq!(request.viscosity_readings_cp, vec![5.2, 5.4]);
    match request.raw_load {
        RawLoadRequest::ByBottleCount { bottle_count } => assert_eq!(bottle_count, 2),
        RawLoadRequest::ByMass { .. } => panic!("expected bottle count raw load"),
    }
}

#[test]
fn adapter_mock_flow_should_complete_batch_with_barcodes_prints_and_report() {
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
    assert_eq!(
        batch
            .selected_recipe
            .as_ref()
            .map(|recipe| recipe.concentration.as_str()),
        Some("70%")
    );

    let batch = manager.run_batch(run_request(batch.id.clone())).unwrap();

    assert_eq!(batch.status, BatchStatus::Completed);
    assert_eq!(batch.metering_records.len(), 5);
    assert_eq!(batch.output_bottles.len(), 3);
    assert_eq!(
        batch
            .output_bottles
            .iter()
            .filter(|bottle| bottle.print_status == PrintStatus::Printed)
            .count(),
        3
    );
    assert_eq!(
        batch
            .viscosity
            .as_ref()
            .and_then(|viscosity| viscosity.average_cp),
        Some(5.3)
    );
    assert!(batch
        .output_bottles
        .iter()
        .all(|bottle| bottle.dilution_barcode.is_some()));
    assert_eq!(
        batch
            .report
            .as_ref()
            .map(|report| report.output_bottles.len()),
        Some(3)
    );
    assert!(batch
        .prms_sync
        .iter()
        .any(|record| record.operation == PrmsOperation::RequestDilutionBarcodes));
    let barcode_sync = batch
        .prms_sync
        .iter()
        .find(|record| record.operation == PrmsOperation::RequestDilutionBarcodes)
        .unwrap();
    let response = barcode_sync.response_payload.as_ref().unwrap();
    assert_eq!(response["transport"], "hsms_mock");
    assert_eq!(response["messageStructure"], "pending");
}

#[test]
fn run_batch_should_support_bottle_count_raw_loading() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();

    let batch = manager
        .run_batch(RunBatchRequest {
            batch_id: batch.id.clone(),
            raw_load: RawLoadRequest::ByBottleCount { bottle_count: 2 },
            viscosity_readings_cp: vec![5.1, 5.3],
        })
        .unwrap();

    let raw_record = batch
        .metering_records
        .iter()
        .find(|record| record.kind == MeteringKind::Raw)
        .unwrap();
    assert_eq!(raw_record.actual_mass_g, 1000.0);
    assert_eq!(
        batch.report.as_ref().map(|report| report.raw_mass_g),
        Some(1000.0)
    );
}

#[test]
fn run_batch_should_reject_completed_batch_rerun() {
    let manager = DilutionManager::new_mock();
    let batch = locked_batch(&manager);
    let batch = manager.run_batch(run_request(batch.id.clone())).unwrap();
    let metering_record_count = batch.metering_records.len();
    let sync_record_count = batch.prms_sync.len();
    let output_bottle_count = batch.output_bottles.len();

    let error = manager
        .run_batch(run_request(batch.id.clone()))
        .unwrap_err();

    assert!(error.contains("cannot run batch"));
    let batch = manager.get_batch(batch.id.as_str()).unwrap();
    assert_eq!(batch.status, BatchStatus::Completed);
    assert_eq!(batch.metering_records.len(), metering_record_count);
    assert_eq!(batch.prms_sync.len(), sync_record_count);
    assert_eq!(batch.output_bottles.len(), output_bottle_count);
}

#[test]
fn get_report_should_return_completed_batch_report() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    let batch = manager.run_batch(run_request(batch.id.clone())).unwrap();

    let report = manager.get_report(batch.id.as_str()).unwrap();

    assert_eq!(report.batch_id, batch.id);
    assert_eq!(report.output_bottles.len(), 3);
}

#[test]
fn scan_should_wait_for_concentration_selection_when_mock_prms_returns_multiple_options() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();

    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-MULTI-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    assert_eq!(batch.status, BatchStatus::MappingResolved);
    assert_eq!(
        batch
            .prms_mapping
            .as_ref()
            .map(|mapping| mapping.dilution_options.len()),
        Some(2)
    );

    let batch = manager
        .select_concentration(SelectConcentrationRequest {
            batch_id: batch.id.clone(),
            concentration: "60%".to_string(),
        })
        .unwrap();
    assert_eq!(batch.status, BatchStatus::RecipeLocked);
    assert_eq!(
        batch
            .selected_recipe
            .as_ref()
            .map(|recipe| recipe.concentration.as_str()),
        Some("60%")
    );
}

#[test]
fn scan_should_reject_different_raw_resist_but_allow_reused_barcode() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();

    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    assert_eq!(batch.raw_scans.len(), 2);

    let error = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-OTHER-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap_err();
    assert!(error.contains("raw resist mismatch"));
}

#[test]
fn batch_changes_should_persist_snapshot_and_events() {
    let root = std::env::temp_dir().join(format!(
        "hmi-dilution-persistence-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    let manager = DilutionManager::new_mock_with_log_root(root.clone());
    let batch = manager.create_batch(create_request()).unwrap();
    let batch_dir = root.join("dilution").join("batches").join(&batch.id);

    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    let batch = manager
        .run_batch(RunBatchRequest {
            batch_id: batch.id.clone(),
            raw_load: RawLoadRequest::ByMass {
                target_mass_g: 1000.0,
            },
            viscosity_readings_cp: vec![5.2, 5.4],
        })
        .unwrap();

    let snapshot_text = std::fs::read_to_string(batch_dir.join("batch.snapshot.json")).unwrap();
    let snapshot: Batch = serde_json::from_str(snapshot_text.as_str()).unwrap();
    assert_eq!(snapshot.id, batch.id);
    assert_eq!(snapshot.status, BatchStatus::Completed);
    assert_eq!(snapshot.output_bottles.len(), 3);

    let events_text = std::fs::read_to_string(batch_dir.join("batch.events.jsonl")).unwrap();
    let event_kinds = events_text
        .lines()
        .map(|line| {
            serde_json::from_str::<serde_json::Value>(line).unwrap()["kind"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect::<Vec<_>>();

    assert!(event_kinds.contains(&"batch_created".to_string()));
    assert!(event_kinds.contains(&"raw_resist_scanned".to_string()));
    assert!(event_kinds.contains(&"batch_completed".to_string()));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn concurrent_writers_should_persist_snapshots_without_temp_file_collisions() {
    let root = std::env::temp_dir().join(format!(
        "hmi-dilution-concurrent-persistence-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    let mut handles = Vec::new();

    for _ in 0..16 {
        let root = root.clone();
        handles.push(std::thread::spawn(move || {
            let manager = DilutionManager::new_mock_with_log_root(root);
            let batch = manager.create_batch(create_request()).unwrap();
            manager
                .scan_raw_resist(ScanRawResistRequest {
                    batch_id: batch.id,
                    barcode: "RAW-IK02-LOT01-B01".to_string(),
                    operator_id: "op-001".to_string(),
                })
                .unwrap();
        }));
    }

    for handle in handles {
        handle.join().unwrap();
    }

    let batch_root = root.join("dilution").join("batches");
    let batch_dirs = std::fs::read_dir(batch_root)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    assert!(!batch_dirs.is_empty());
    assert!(batch_dirs
        .iter()
        .all(|dir| dir.join("batch.snapshot.json").exists()));
    assert!(batch_dirs
        .iter()
        .all(|dir| !dir.join("batch.snapshot.json.tmp").exists()));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn default_mock_log_root_should_use_workspace_tmp_log() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir.parent().unwrap();
    let expected_batch_dir = workspace_root
        .join("tmp")
        .join("Log")
        .join("dilution")
        .join("batches")
        .join(&batch.id);
    let watched_batch_dir = manifest_dir
        .join("Log")
        .join("dilution")
        .join("batches")
        .join(&batch.id);

    assert!(
        expected_batch_dir.join("batch.snapshot.json").exists(),
        "default dilution log should be written outside src-tauri so tauri dev does not restart"
    );
    assert!(
        !watched_batch_dir.exists(),
        "default dilution log should not be written under src-tauri/Log"
    );

    let _ = std::fs::remove_dir_all(expected_batch_dir);
}
