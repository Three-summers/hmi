# Craftsmanship Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the backend craftsmanship runtime by bounding safe-stop waits, rejecting invalid recovery and serial config values, detecting duplicate top-level identifiers, and adding six backend process-flow acceptance tests.

**Architecture:** Keep the implementation local to the existing craftsmanship backend modules. Use TDD in two layers: first tighten loader and validation behavior in `src-tauri/src/craftsmanship/tests.rs`, then harden runtime behavior and add acceptance-style flow coverage in `src-tauri/src/craftsmanship/runtime/tests.rs` using the existing fake transport helpers, GPIO override support, and mock Tauri runtime.

**Tech Stack:** Rust, Tokio, serde_json fixtures, Tauri mock runtime, fake HMIP/TCP/serial transport overrides, cargo test

---

## File Map

- Modify: `src-tauri/src/craftsmanship/types.rs`
  - Add optional `timeout_ms` to `SafeStopStep`
- Modify: `src-tauri/src/craftsmanship/validation.rs`
  - Add recovery-policy validation, duplicate system-ID checks, and serial framing validation helpers
- Modify: `src-tauri/src/craftsmanship/loader.rs`
  - Detect duplicate workspace project IDs during scan and during `get_project_bundle()` lookup
- Modify: `src-tauri/src/craftsmanship/runtime/engine.rs`
  - Add default safe-stop timeout handling and preserve the approved safe-stop failure semantics
- Modify: `src-tauri/src/craftsmanship/tests.rs`
  - Add loader and validation regression tests for policy values, duplicate IDs, and serial framing
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs`
  - Add safe-stop timeout regression tests, process-flow helper utilities, and six acceptance tests under `process_flow_tests`

## Task 1: Reject Invalid Recovery Policies And Serial Framing

**Files:**
- Modify: `src-tauri/src/craftsmanship/validation.rs`
- Test: `src-tauri/src/craftsmanship/tests.rs`

- [ ] **Step 1: Write the failing validation tests**

Add these tests near the existing validation coverage in `src-tauri/src/craftsmanship/tests.rs`:

```rust
#[test]
fn get_project_bundle_should_reject_invalid_recovery_policy_values() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/safety/interlocks.json",
        json!({
            "rules": [
                {
                    "id": "door-check",
                    "name": "门联锁",
                    "actionIds": ["pump.start"],
                    "condition": {
                        "signalId": "door_closed",
                        "operator": "eq",
                        "value": true
                    },
                    "onViolation": "alaram"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/door_closed.json",
        json!({
            "id": "door_closed",
            "name": "门关闭",
            "dataType": "boolean",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/pumpdown.json",
        json!({
            "id": "pumpdown",
            "name": "抽真空",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "启动前级泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 1000,
                    "onError": "safe_stop"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(&bundle.diagnostics, "recipe_invalid_on_error"));
    assert!(has_diagnostic(&bundle.diagnostics, "interlock_invalid_on_violation"));
}

#[test]
fn get_project_bundle_should_reject_invalid_serial_framing_values() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/connections/main-serial.json",
        json!({
            "id": "main-serial",
            "name": "主串口",
            "kind": "serial",
            "serial": {
                "port": "/dev/ttyUSB0",
                "baudRate": 0,
                "dataBits": 9,
                "stopBits": 3,
                "parity": "mark"
            }
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(&bundle.diagnostics, "connection_invalid_serial_baud_rate"));
    assert!(has_diagnostic(&bundle.diagnostics, "connection_invalid_serial_data_bits"));
    assert!(has_diagnostic(&bundle.diagnostics, "connection_invalid_serial_stop_bits"));
    assert!(has_diagnostic(&bundle.diagnostics, "connection_invalid_serial_parity"));
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cargo test craftsmanship::tests::get_project_bundle_should_reject_invalid_recovery_policy_values -- --nocapture
cargo test craftsmanship::tests::get_project_bundle_should_reject_invalid_serial_framing_values -- --nocapture
```

Expected:
- Both tests fail because the diagnostics do not exist yet.

- [ ] **Step 3: Add the validation helpers and wire them into existing validation paths**

Add small helpers in `src-tauri/src/craftsmanship/validation.rs` and call them from `validate_recipe_step`, `validate_project_resources`, and `validate_connection_definition`:

```rust
fn is_valid_recipe_on_error(value: &str) -> bool {
    matches!(value, "stop" | "ignore" | "safe-stop")
}

fn is_valid_interlock_on_violation(value: &str) -> bool {
    matches!(value, "block" | "alarm")
}

fn is_valid_serial_data_bits(value: u64) -> bool {
    matches!(value, 5 | 6 | 7 | 8)
}

fn is_valid_serial_stop_bits(value: u64) -> bool {
    matches!(value, 1 | 2)
}

fn is_valid_serial_parity(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "none" | "even" | "odd")
}
```

Extend the recipe-step validation branch:

```rust
if let Some(on_error) = step.on_error.as_deref() {
    if !is_valid_recipe_on_error(on_error) {
        diagnostics.push(diagnostic_error(
            "recipe_invalid_on_error",
            format!(
                "recipe `{}` step `{}` declares unsupported onError `{}`",
                recipe_id, step.id, on_error
            ),
            Some(source_path.to_string()),
            Some(step.id.clone()),
        ));
    }
}
```

Extend the interlock validation branch:

```rust
if let Some(on_violation) = rule.on_violation.as_deref() {
    if !is_valid_interlock_on_violation(on_violation) {
        diagnostics.push(diagnostic_error(
            "interlock_invalid_on_violation",
            format!(
                "interlock `{}` declares unsupported onViolation `{}`",
                rule.id, on_violation
            ),
            Some(source_path.to_string()),
            Some(rule.id.clone()),
        ));
    }
}
```

Extend the serial branch in `validate_connection_definition`:

```rust
if let Some(baud_rate) = serial.baud_rate {
    if baud_rate == 0 {
        diagnostics.push(diagnostic_error(
            "connection_invalid_serial_baud_rate",
            format!("connection `{}` has non-positive serial `baudRate`", connection.id),
            Some(connection.source_path.clone()),
            Some(connection.id.clone()),
        ));
    }
}

if let Some(data_bits) = serial.data_bits.map(u64::from) {
    if !is_valid_serial_data_bits(data_bits) {
        diagnostics.push(diagnostic_error(
            "connection_invalid_serial_data_bits",
            format!("connection `{}` declares unsupported serial `dataBits` `{}`", connection.id, data_bits),
            Some(connection.source_path.clone()),
            Some(connection.id.clone()),
        ));
    }
}
```

Repeat the same pattern for `stopBits` and `parity`.

- [ ] **Step 4: Run the focused validation tests again**

Run:

```bash
cargo test craftsmanship::tests::get_project_bundle_should_reject_invalid_recovery_policy_values -- --nocapture
cargo test craftsmanship::tests::get_project_bundle_should_reject_invalid_serial_framing_values -- --nocapture
```

Expected:
- Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/validation.rs src-tauri/src/craftsmanship/tests.rs
git commit -m "fix: reject invalid craftsmanship policy values"
```

## Task 2: Detect Duplicate System And Workspace Identifiers

**Files:**
- Modify: `src-tauri/src/craftsmanship/validation.rs`
- Modify: `src-tauri/src/craftsmanship/loader.rs`
- Test: `src-tauri/src/craftsmanship/tests.rs`

- [ ] **Step 1: Write the failing duplicate-ID tests**

Add these tests in `src-tauri/src/craftsmanship/tests.rs` after the existing duplicate runtime-resource coverage:

```rust
#[test]
fn scan_workspace_should_report_duplicate_system_identifiers() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    workspace.write_json(
        "system/actions/pump.start-copy.json",
        json!({
            "id": "pump.start",
            "name": "开泵复制",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "parameters": []
        }),
    );
    workspace.write_json(
        "system/device-types/pump-copy.json",
        json!({
            "id": "pump",
            "name": "泵复制",
            "allowedActions": ["pump.start"]
        }),
    );
    write_project_definition(&workspace, "project-a", "project-a");

    let summary = scan_workspace(workspace.path().to_str().unwrap()).unwrap();

    assert!(has_diagnostic(&summary.diagnostics, "duplicate_action_id"));
    assert!(has_diagnostic(&summary.diagnostics, "duplicate_device_type_id"));
}

#[test]
fn scan_workspace_should_report_duplicate_project_ids() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-dup");
    write_project_definition(&workspace, "project-b", "project-dup");

    let summary = scan_workspace(workspace.path().to_str().unwrap()).unwrap();

    assert!(has_diagnostic(&summary.diagnostics, "duplicate_project_id"));
}

#[test]
fn get_project_bundle_should_error_when_project_id_is_ambiguous() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-dup");
    write_project_definition(&workspace, "project-b", "project-dup");

    let error = get_project_bundle(workspace.path().to_str().unwrap(), "project-dup")
        .unwrap_err();

    assert!(error.contains("ambiguous"));
    assert!(error.contains("project-dup"));
}
```

- [ ] **Step 2: Run the failing duplicate-ID tests**

Run:

```bash
cargo test craftsmanship::tests::scan_workspace_should_report_duplicate_system_identifiers -- --nocapture
cargo test craftsmanship::tests::scan_workspace_should_report_duplicate_project_ids -- --nocapture
cargo test craftsmanship::tests::get_project_bundle_should_error_when_project_id_is_ambiguous -- --nocapture
```

Expected:
- The tests fail because duplicate diagnostics and ambiguous lookup errors are not implemented yet.

- [ ] **Step 3: Add duplicate-ID validation in system and loader paths**

In `src-tauri/src/craftsmanship/validation.rs`, add duplicate checks before building downstream maps:

```rust
let mut seen_action_ids = HashSet::new();
let mut seen_device_type_ids = HashSet::new();

for action in &system.actions {
    if !seen_action_ids.insert(action.id.as_str()) {
        diagnostics.push(diagnostic_error(
            "duplicate_action_id",
            format!("system defines duplicate action `{}`", action.id),
            Some(action.source_path.clone()),
            Some(action.id.clone()),
        ));
    }
}

for device_type in &system.device_types {
    if !seen_device_type_ids.insert(device_type.id.as_str()) {
        diagnostics.push(diagnostic_error(
            "duplicate_device_type_id",
            format!("system defines duplicate device type `{}`", device_type.id),
            Some(device_type.source_path.clone()),
            Some(device_type.id.clone()),
        ));
    }
}
```

In `src-tauri/src/craftsmanship/loader.rs`, collect and validate project IDs during scan:

```rust
let mut seen_project_ids = HashSet::new();

for project_dir in project_dirs {
    let bundle = load_project_bundle_from_dir(&root, &system, &project_dir, Vec::new())?;
    if !seen_project_ids.insert(bundle.project.id.clone()) {
        diagnostics.push(diagnostic_error(
            "duplicate_project_id",
            format!("workspace defines duplicate project id `{}`", bundle.project.id),
            Some(bundle.project.source_path.clone()),
            Some(bundle.project.id.clone()),
        ));
    }
    diagnostics.extend(bundle.diagnostics);
    projects.push(bundle.project);
}
```

Replace the single-match lookup in `find_project_dir()` with an ambiguity check:

```rust
let mut matches = Vec::new();

if project.id == project_id {
    matches.push(child_dir.clone());
}

match matches.as_slice() {
    [] => Err(format!("project `{project_id}` not found under {}", projects_dir.display())),
    [path] => Ok(path.clone()),
    _ => Err(format!(
        "project `{project_id}` is ambiguous; multiple project directories declare the same id"
    )),
}
```

- [ ] **Step 4: Run the duplicate-ID tests again**

Run:

```bash
cargo test craftsmanship::tests::scan_workspace_should_report_duplicate_system_identifiers -- --nocapture
cargo test craftsmanship::tests::scan_workspace_should_report_duplicate_project_ids -- --nocapture
cargo test craftsmanship::tests::get_project_bundle_should_error_when_project_id_is_ambiguous -- --nocapture
```

Expected:
- All three tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/validation.rs src-tauri/src/craftsmanship/loader.rs src-tauri/src/craftsmanship/tests.rs
git commit -m "fix: reject duplicate craftsmanship identifiers"
```

## Task 3: Bound Safe-Stop Waiting With Default And Explicit Timeouts

**Files:**
- Modify: `src-tauri/src/craftsmanship/types.rs`
- Modify: `src-tauri/src/craftsmanship/runtime/engine.rs`
- Test: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Write the failing safe-stop timeout tests**

Add these runtime tests near the existing safe-stop coverage in `src-tauri/src/craftsmanship/runtime/tests.rs`:

```rust
#[tokio::test]
async fn runtime_should_timeout_safe_stop_step_without_feedback_using_default_timeout() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "system/actions/pump.stop.json",
        json!({
            "id": "pump.stop",
            "name": "停泵",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "parameters": [],
            "completion": {
                "type": "deviceFeedback",
                "key": "running",
                "operator": "eq",
                "value": false
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/safety/safe-stop.json",
        json!({
            "id": "safe-stop",
            "name": "安全停机",
            "steps": [
                {
                    "seq": 10,
                    "actionId": "pump.stop",
                    "deviceId": "pump_01"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/wait-pressure.json",
        json!({
            "id": "wait-pressure",
            "name": "等待腔压",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 10
                    },
                    "timeoutMs": 60,
                    "onError": "safe-stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "wait-pressure".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
    assert_eq!(snapshot.safe_stop_steps[0].status, RecipeRuntimeStepStatus::Failed);
    assert_eq!(
        snapshot.last_error.as_ref().map(|failure| failure.code.as_str()),
        Some("step_timeout")
    );
}

#[tokio::test]
async fn runtime_should_honor_explicit_safe_stop_timeout_ms() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "system/actions/pump.stop.json",
        json!({
            "id": "pump.stop",
            "name": "停泵",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "parameters": [],
            "completion": {
                "type": "deviceFeedback",
                "key": "running",
                "operator": "eq",
                "value": false
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/safety/safe-stop.json",
        json!({
            "id": "safe-stop",
            "name": "安全停机",
            "steps": [
                {
                    "seq": 10,
                    "actionId": "pump.stop",
                    "deviceId": "pump_01",
                    "timeoutMs": 120
                }
            ]
        }),
    );

    workspace.write_json(
        "projects/project-a/recipes/wait-pressure.json",
        json!({
            "id": "wait-pressure",
            "name": "等待腔压",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 10
                    },
                    "timeoutMs": 60,
                    "onError": "safe-stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "wait-pressure".to_string(),
        )
        .await
        .unwrap();

    let started = std::time::Instant::now();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert!(started.elapsed() < Duration::from_millis(600));
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
    assert_eq!(snapshot.safe_stop_steps[0].status, RecipeRuntimeStepStatus::Failed);
```

- [ ] **Step 2: Run the failing safe-stop tests**

Run:

```bash
cargo test craftsmanship::runtime::tests::runtime_should_timeout_safe_stop_step_without_feedback_using_default_timeout -- --nocapture
cargo test craftsmanship::runtime::tests::runtime_should_honor_explicit_safe_stop_timeout_ms -- --nocapture
```

Expected:
- The tests fail because safe-stop completion currently waits forever unless interrupted externally.

- [ ] **Step 3: Add the optional field and route the timeout through the runtime**

In `src-tauri/src/craftsmanship/types.rs`, extend `SafeStopStep`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SafeStopStep {
    pub seq: u32,
    pub action_id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}
```

In `src-tauri/src/craftsmanship/runtime/engine.rs`, add a default constant and helper:

```rust
const DEFAULT_SAFE_STOP_TIMEOUT_MS: u64 = 5_000;

fn safe_stop_timeout_ms(step: &SafeStopStep) -> Option<u64> {
    Some(step.timeout_ms.unwrap_or(DEFAULT_SAFE_STOP_TIMEOUT_MS))
}
```

Pass that timeout into both safe-stop completion paths:

```rust
let completion_message = execute_action_completion(
    manager,
    loaded,
    run_control,
    action,
    step.device_id.as_deref(),
    safe_stop_timeout_ms(step),
    step_id,
    Some("safe-stop".to_string()),
)
.await?;
```

Update the existing safe-stop failure assertion in `runtime_should_preserve_original_failure_when_safe_stop_step_fails` to match the approved semantics:

```rust
assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
assert_eq!(snapshot.safe_stop_steps[0].status, RecipeRuntimeStepStatus::Failed);
```

- [ ] **Step 4: Run the safe-stop tests and the existing safe-stop regression coverage**

Run:

```bash
cargo test craftsmanship::runtime::tests::runtime_should_timeout_safe_stop_step_without_feedback_using_default_timeout -- --nocapture
cargo test craftsmanship::runtime::tests::runtime_should_honor_explicit_safe_stop_timeout_ms -- --nocapture
cargo test craftsmanship::runtime::tests::runtime_should_enter_safe_stop_after_timeout -- --nocapture
cargo test craftsmanship::runtime::tests::runtime_should_preserve_original_failure_when_safe_stop_step_fails -- --nocapture
```

Expected:
- All four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/types.rs src-tauri/src/craftsmanship/runtime/engine.rs src-tauri/src/craftsmanship/runtime/tests.rs
git commit -m "fix: bound craftsmanship safe-stop timeouts"
```

## Task 4: Add Process-Flow Test Helpers And The First Complete Flow

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Write the failing helper additions and first acceptance test**

Near the existing helper section in `src-tauri/src/craftsmanship/runtime/tests.rs`, add the small process-flow support helpers:

```rust
struct ProcessFlowOverrideReset;

impl Drop for ProcessFlowOverrideReset {
    fn drop(&mut self) {
        crate::comm::set_tcp_stream_override(None);
        crate::comm::set_serial_stream_override(None);
        super::dispatch::set_gpio_write_override(None);
    }
}

async fn wait_until_step(
    manager: &RecipeRuntimeManager,
    phase: RecipeRuntimePhase,
    step_id: &str,
    status: RecipeRuntimeStepStatus,
) -> super::types::RecipeRuntimeSnapshot {
    let started = std::time::Instant::now();
    loop {
        let snapshot = manager.get_status().await;
        let step_matches = snapshot
            .recipe_steps
            .iter()
            .chain(snapshot.safe_stop_steps.iter())
            .any(|step| step.id == step_id && step.status == status);
        if snapshot.phase == phase && step_matches {
            return snapshot;
        }

        assert!(started.elapsed() < Duration::from_secs(3), "step did not reach expected state in time");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
```

Then append the first acceptance test module at the end of the file:

```rust
mod process_flow_tests {
    use super::*;

    #[tokio::test]
    async fn mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal() {
        let _transport_guard = e2e_transport_lock()
            .lock()
            .expect("e2e transport lock poisoned");
        let _override_reset = ProcessFlowOverrideReset;

        let workspace = TestWorkspace::new();
        write_process_flow_base(&workspace);
        workspace.write_json(
            "projects/project-a/feedback-mappings/pump_running_flow.json",
            json!({
                "id": "pump-running-flow",
                "name": "流程开泵反馈",
                "match": {
                    "connectionId": "main-tcp-flow",
                    "channel": 3,
                    "summaryKind": "response",
                    "status": 0
                },
                "target": {
                    "deviceId": "pump_01",
                    "feedbackKey": "running",
                    "value": true
                }
            }),
        );
        workspace.write_json(
            "projects/project-a/feedback-mappings/process_ready_flow.json",
            json!({
                "id": "process-ready-flow",
                "name": "流程就绪反馈",
                "match": {
                    "connectionId": "main-tcp-flow",
                    "channel": 3,
                    "summaryKind": "event",
                    "eventId": 301
                },
                "target": {
                    "signalId": "process_ready",
                    "value": 1
                }
            }),
        );

        workspace.write_json(
            "projects/project-a/recipes/mixed-flow.json",
            json!({
                "id": "mixed-flow",
                "name": "GPIO + HMIP + Wait 完整流程",
                "steps": [
                    {
                        "id": "S010",
                        "seq": 10,
                        "name": "打开阀门使能",
                        "actionId": "valve.enable",
                        "deviceId": "valve_01",
                        "timeoutMs": 300,
                        "onError": "stop"
                    },
                    {
                        "id": "S020",
                        "seq": 20,
                        "name": "启动泵",
                        "actionId": "pump.start",
                        "deviceId": "pump_01",
                        "timeoutMs": 500,
                        "onError": "stop"
                    },
                    {
                        "id": "S030",
                        "seq": 30,
                        "name": "等待流程就绪",
                        "actionId": "common.wait-signal",
                        "parameters": {
                            "signalId": "process_ready",
                            "operator": "eq",
                            "value": 1
                        },
                        "timeoutMs": 500,
                        "onError": "stop"
                    }
                ]
            }),
        );

        let gpio_events = Arc::new(Mutex::new(Vec::<(String, u32, bool, bool)>::new()));
        super::dispatch::set_gpio_write_override(Some(Arc::new({
            let gpio_events = gpio_events.clone();
            move |chip_path, pin, active_low, value| {
                gpio_events
                    .lock()
                    .expect("gpio events mutex poisoned")
                    .push((chip_path.to_string(), pin, active_low, value));
                Ok(())
            }
        })));

        let manager = RecipeRuntimeManager::default();
        let app = setup_runtime_app(&manager);
        let mut device_stream = spawn_fake_hmip_device("127.0.0.1", 15070);

        manager
            .load_recipe(
                None,
                workspace.path().to_string_lossy().to_string(),
                "project-a".to_string(),
                "mixed-flow".to_string(),
            )
            .await
            .unwrap();
        manager
            .start_with_app(Some(app.handle().clone()))
            .await
            .unwrap();

        let mid_snapshot = wait_until_step(
            &manager,
            RecipeRuntimePhase::Recipe,
            "S020",
            RecipeRuntimeStepStatus::Running,
        )
        .await;
        assert_eq!(mid_snapshot.recipe_steps[0].status, RecipeRuntimeStepStatus::Completed);
        assert_eq!(
            gpio_events.lock().expect("gpio events mutex poisoned").as_slice(),
            &[("/dev/gpiochip-test".to_string(), 17, false, true)]
        );

        let outbound = read_hmip_frame(&mut device_stream).await;
        assert_eq!(outbound.header.channel, 3);
        assert_eq!(outbound.payload.as_ref(), &[0xAA, 0x55]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 401,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::RESPONSE,
            flags: 0,
            channel: 3,
            seq: 901,
            payload: &response_payload,
        });
        write_hmip_frame(&mut device_stream, &response_frame).await;

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 301,
            timestamp_ms: 999,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 3,
            seq: 902,
            payload: &event_payload,
        });
        write_hmip_frame(&mut device_stream, &event_frame).await;

        let snapshot = wait_for_terminal_status(&manager).await;
        assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
        assert_eq!(snapshot.recipe_steps[0].status, RecipeRuntimeStepStatus::Completed);
        assert_eq!(snapshot.recipe_steps[1].status, RecipeRuntimeStepStatus::Completed);
        assert_eq!(snapshot.recipe_steps[2].status, RecipeRuntimeStepStatus::Completed);
        assert_eq!(snapshot.runtime_values.get("device.pump_01.running"), Some(&json!(true)));
        assert_eq!(snapshot.signal_values.get("process_ready"), Some(&json!(1)));
    }
}
```

Also add a local `write_process_flow_base(&TestWorkspace)` helper that writes the common valve, pump, connection, signal, and device fixtures used across all six acceptance tests.

- [ ] **Step 2: Run the failing first acceptance test**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal -- --nocapture
```

Expected:
- The test fails because the new helpers and fixtures are not complete yet.

- [ ] **Step 3: Fill in the shared fixtures and make the first complete-flow test pass**

Complete `write_process_flow_base()` with these core fixtures:

```rust
workspace.write_json(
    "system/actions/valve.enable.json",
    json!({
        "id": "valve.enable",
        "name": "阀使能",
        "targetMode": "required",
        "allowedDeviceTypes": ["valve"],
        "parameters": [],
        "dispatch": {
            "kind": "gpioWrite",
            "value": true
        }
    }),
);
workspace.write_json(
    "projects/project-a/connections/main_tcp_flow.json",
    json!({
        "id": "main-tcp-flow",
        "name": "主控 TCP",
        "kind": "tcp",
        "tcp": {
            "host": "127.0.0.1",
            "port": 15070,
            "timeoutMs": 200
        }
    }),
);
```

Finish the test using:
- `setup_runtime_app(&manager)`
- `spawn_fake_hmip_device("127.0.0.1", 15070)`
- `wait_until_step(&manager, RecipeRuntimePhase::Recipe, "S020", RecipeRuntimeStepStatus::Running)`
- `read_hmip_frame(&mut device_stream).await`
- `write_hmip_frame(&mut device_stream, &response_frame).await`
- `write_hmip_frame(&mut device_stream, &event_frame).await`
- `wait_for_terminal_status(&manager).await`

- [ ] **Step 4: Run the focused complete-flow test again**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal -- --nocapture
```

Expected:
- The test passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs
git commit -m "test: add first craftsmanship process flow"
```

## Task 5: Add Cross-Transport Isolation And Out-Of-Order Feedback Tests

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Write the next two failing acceptance tests**

Append these tests inside `process_flow_tests`:

```rust
#[tokio::test]
async fn multi_device_process_should_complete_with_cross_transport_feedback_isolation() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = ProcessFlowOverrideReset;

    let workspace = TestWorkspace::new();
    write_process_flow_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/cross-transport-flow.json",
        json!({
            "id": "cross-transport-flow",
            "name": "跨传输隔离流程",
            "steps": [
                { "id": "S010", "seq": 10, "name": "打开阀门", "actionId": "valve.enable", "deviceId": "valve_01", "timeoutMs": 300, "onError": "stop" },
                { "id": "S020", "seq": 20, "name": "启动泵", "actionId": "pump.start", "deviceId": "pump_01", "timeoutMs": 500, "onError": "stop" },
                { "id": "S030", "seq": 30, "name": "等待流程就绪", "actionId": "common.wait-signal", "parameters": { "signalId": "process_ready", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" }
            ]
        }),
    );

    // Install a serial override for `valve_01` and a TCP override for `pump_01`.
    // Drive the runtime to `S020`, inject wrong-device feedback for `valve_01`, assert `S020` stays Running,
    // then inject `pump_01.running=true` and the `process_ready=1` mapping event.
    // Finish by asserting `Completed` and the expected final runtime values for both devices.
}

#[tokio::test]
async fn process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = ProcessFlowOverrideReset;

    let workspace = TestWorkspace::new();
    write_process_flow_base(&workspace);
    workspace.write_json(
        "projects/project-a/signals/process_done.json",
        json!({
            "id": "process_done",
            "name": "流程完成",
            "dataType": "number",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/out-of-order-flow.json",
        json!({
            "id": "out-of-order-flow",
            "name": "乱序反馈流程",
            "steps": [
                { "id": "S010", "seq": 10, "name": "启动泵", "actionId": "pump.start", "deviceId": "pump_01", "timeoutMs": 500, "onError": "stop" },
                { "id": "S020", "seq": 20, "name": "等待流程就绪", "actionId": "common.wait-signal", "parameters": { "signalId": "process_ready", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" },
                { "id": "S030", "seq": 30, "name": "等待流程完成", "actionId": "common.wait-signal", "parameters": { "signalId": "process_done", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" }
            ]
        }),
    );

    // Inject `process_done=1` while `S020` is still active, assert `S020` remains Running,
    // then inject `process_ready=1`, wait for `S030` to become Running, and inject `process_done=1` again.
    // Finish by asserting the full recipe reaches `Completed`.
}
```

In both tests, assert the mid-run snapshot before the correct feedback is injected:

```rust
let mid_snapshot = manager.get_status().await;
assert_eq!(mid_snapshot.status, RecipeRuntimeStatus::Running);
assert_eq!(mid_snapshot.active_step_id.as_deref(), Some("S020"));
```

- [ ] **Step 2: Run the two new failing tests**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::multi_device_process_should_complete_with_cross_transport_feedback_isolation -- --nocapture
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step -- --nocapture
```

Expected:
- Both tests fail until the recipes, overrides, and negative assertions are fully wired in.

- [ ] **Step 3: Complete the fixtures and assertions for the two complete-flow scenarios**

Use these building blocks:

```rust
crate::comm::set_serial_stream_override(Some(Arc::new({
    let stream = Arc::new(Mutex::new(Some(client_stream)));
    move |_| {
        let stream = stream.clone();
        Box::pin(async move {
            stream
                .lock()
                .expect("serial override mutex poisoned")
                .take()
                .ok_or_else(|| "serial override stream already consumed".to_string())
        })
    }
})));
```

And for the negative assertion before the correct feedback arrives:

```rust
let snapshot_before = manager.get_status().await;
assert_eq!(snapshot_before.active_step_id.as_deref(), Some("S020"));
assert_eq!(snapshot_before.recipe_steps[1].status, RecipeRuntimeStepStatus::Running);
assert_eq!(snapshot_before.recipe_steps[2].status, RecipeRuntimeStepStatus::Pending);
```

Then finish both tests by asserting:
- final `snapshot.status == RecipeRuntimeStatus::Completed`
- all intended step statuses are `Completed`
- the expected final `runtime_values` for both devices or the expected signal value

- [ ] **Step 4: Run the three complete-flow tests together**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal -- --nocapture
cargo test craftsmanship::runtime::tests::process_flow_tests::multi_device_process_should_complete_with_cross_transport_feedback_isolation -- --nocapture
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step -- --nocapture
```

Expected:
- All three tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs
git commit -m "test: add craftsmanship complete flow coverage"
```

## Task 6: Add Ignore And Safe-Stop Branch Flow Tests

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Write the two failing branch-flow tests**

Append these tests inside `process_flow_tests`:

```rust
#[tokio::test]
async fn process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = ProcessFlowOverrideReset;

    let workspace = TestWorkspace::new();
    write_process_flow_base(&workspace);
    workspace.write_json(
        "projects/project-a/signals/process_done.json",
        json!({
            "id": "process_done",
            "name": "流程完成",
            "dataType": "number",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/ignore-branch-flow.json",
        json!({
            "id": "ignore-branch-flow",
            "name": "忽略分支流程",
            "steps": [
                { "id": "S010", "seq": 10, "name": "打开阀门", "actionId": "valve.enable", "deviceId": "valve_01", "timeoutMs": 300, "onError": "stop" },
                { "id": "S020", "seq": 20, "name": "发送启动命令", "actionId": "pump.start", "deviceId": "pump_01", "timeoutMs": 300, "onError": "ignore" },
                { "id": "S030", "seq": 30, "name": "等待流程就绪", "actionId": "common.wait-signal", "parameters": { "signalId": "process_ready", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" },
                { "id": "S040", "seq": 40, "name": "等待流程完成", "actionId": "common.wait-signal", "parameters": { "signalId": "process_done", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" }
            ]
        }),
    );

    // Force `dispatch_send_failed` on the HMIP-backed `S020` path, then inject `process_ready=1`
    // and `process_done=1`. Finish by asserting `S020` is Failed, `S030` and `S040` are Completed,
    // and the runtime status is Completed.
}

#[tokio::test]
async fn process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = ProcessFlowOverrideReset;

    let workspace = TestWorkspace::new();
    write_process_flow_base(&workspace);
    workspace.write_json(
        "projects/project-a/signals/safe_stop_confirmed.json",
        json!({
            "id": "safe_stop_confirmed",
            "name": "安全停机确认",
            "dataType": "number",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/safety/safe-stop.json",
        json!({
            "id": "safe-stop",
            "name": "安全停机",
            "steps": [
                { "seq": 10, "actionId": "valve.disable", "deviceId": "valve_01", "timeoutMs": 300 },
                { "seq": 20, "actionId": "common.wait-signal", "parameters": { "signalId": "safe_stop_confirmed", "operator": "eq", "value": 1 }, "timeoutMs": 500 }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/safe-stop-branch-flow.json",
        json!({
            "id": "safe-stop-branch-flow",
            "name": "安全停机分支流程",
            "steps": [
                { "id": "S010", "seq": 10, "name": "打开阀门", "actionId": "valve.enable", "deviceId": "valve_01", "timeoutMs": 300, "onError": "stop" },
                { "id": "S020", "seq": 20, "name": "发送启动命令", "actionId": "pump.start", "deviceId": "pump_01", "timeoutMs": 300, "onError": "safe-stop" },
                { "id": "S030", "seq": 30, "name": "等待流程就绪", "actionId": "common.wait-signal", "parameters": { "signalId": "process_ready", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" }
            ]
        }),
    );

    // Complete `S010`, force `dispatch_send_failed` on `S020`, wait for `SafeStop`,
    // write `safe_stop_confirmed=1`, and finish by asserting the safe-stop chain completes
    // with final status `Stopped` and original `dispatch_send_failed` preserved in `last_error`.
}
```

The first test must assert the ignored failure explicitly:

```rust
assert_eq!(snapshot.recipe_steps[1].status, RecipeRuntimeStepStatus::Failed);
assert_eq!(snapshot.recipe_steps[2].status, RecipeRuntimeStepStatus::Completed);
assert_eq!(snapshot.recipe_steps[3].status, RecipeRuntimeStepStatus::Completed);
assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
```

The second test must assert the safe-stop chain explicitly:

```rust
assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
assert!(snapshot.safe_stop_steps.iter().all(|step| step.status == RecipeRuntimeStepStatus::Completed));
assert_eq!(
    snapshot.last_error.as_ref().map(|failure| failure.code.as_str()),
    Some("dispatch_send_failed")
);
```

- [ ] **Step 2: Run the failing branch-flow tests**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps -- --nocapture
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain -- --nocapture
```

Expected:
- Both tests fail before the fixtures and overrides are complete.

- [ ] **Step 3: Complete the branch-flow fixtures using existing override hooks**

Use the fake HMIP and GPIO hooks already present in the runtime tests to force a dispatch send failure at the right step boundary. Use this override shape for the HMIP side:

```rust
crate::comm::set_tcp_stream_override(Some(Arc::new({
    let stream = Arc::new(Mutex::new(Some(client_stream)));
    move |_| {
        let stream = stream.clone();
        Box::pin(async move {
            stream
                .lock()
                .expect("tcp override mutex poisoned")
                .take()
                .ok_or_else(|| "tcp override stream already consumed".to_string())
        })
    }
})));
```

Build one recipe with `onError = "ignore"` on the failing step and one recipe with `onError = "safe-stop"` plus a two-step safe-stop chain. For the safe-stop case, include a GPIO shutdown action followed by a wait-signal confirmation step so the acceptance test proves the full branch executes rather than only the phase transition.

- [ ] **Step 4: Run the two branch-flow tests plus the existing safe-stop regression test**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps -- --nocapture
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain -- --nocapture
cargo test craftsmanship::runtime::tests::runtime_should_enter_safe_stop_after_timeout -- --nocapture
```

Expected:
- All three tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs
git commit -m "test: add craftsmanship branch flow coverage"
```

## Task 7: Add Wrong-Connection Protection Flow And Run The Full Backend Suite

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs`
- Test: `src-tauri/src/craftsmanship/tests.rs`

- [ ] **Step 1: Write the final failing protection-flow test**

Append this final acceptance test inside `process_flow_tests`:

```rust
#[tokio::test]
async fn process_should_not_complete_when_feedback_connection_or_channel_is_wrong() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = ProcessFlowOverrideReset;

    let workspace = TestWorkspace::new();
    write_process_flow_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/protection-flow.json",
        json!({
            "id": "protection-flow",
            "name": "保护性流程",
            "steps": [
                { "id": "S010", "seq": 10, "name": "打开阀门", "actionId": "valve.enable", "deviceId": "valve_01", "timeoutMs": 300, "onError": "stop" },
                { "id": "S020", "seq": 20, "name": "启动泵", "actionId": "pump.start", "deviceId": "pump_01", "timeoutMs": 500, "onError": "stop" },
                { "id": "S030", "seq": 30, "name": "等待流程就绪", "actionId": "common.wait-signal", "parameters": { "signalId": "process_ready", "operator": "eq", "value": 1 }, "timeoutMs": 500, "onError": "stop" }
            ]
        }),
    );

    // After `S030` becomes Running, inject one HMIP frame with the wrong `connectionId` or wrong `channel`,
    // assert `S030` remains Running, then inject the matching frame and finish by asserting `Completed`.
}
```

Use this mid-run assertion before the correct frame is sent:

```rust
let blocked_snapshot = manager.get_status().await;
assert_eq!(blocked_snapshot.status, RecipeRuntimeStatus::Running);
assert_eq!(blocked_snapshot.active_step_id.as_deref(), Some("S030"));
assert_eq!(blocked_snapshot.recipe_steps[2].status, RecipeRuntimeStepStatus::Running);
```

- [ ] **Step 2: Run the final failing acceptance test**

Run:

```bash
cargo test craftsmanship::runtime::tests::process_flow_tests::process_should_not_complete_when_feedback_connection_or_channel_is_wrong -- --nocapture
```

Expected:
- The test fails before the wrong-frame and correct-frame setup is finished.

- [ ] **Step 3: Complete the last protection-flow test and keep the assertions asymmetric**

Implement the test so the wrong feedback does not advance and the correct feedback does. Use `manager.apply_hmip_feedback(...)` directly for the wrong-frame injection, then use the matching fake device stream or `apply_hmip_feedback(...)` again for the correct frame. Finish with these final assertions:

```rust
let snapshot = wait_for_terminal_status(&manager).await;
assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
assert_eq!(snapshot.recipe_steps[0].status, RecipeRuntimeStepStatus::Completed);
assert_eq!(snapshot.recipe_steps[1].status, RecipeRuntimeStepStatus::Completed);
assert_eq!(snapshot.recipe_steps[2].status, RecipeRuntimeStepStatus::Completed);
assert_eq!(snapshot.signal_values.get("process_ready"), Some(&json!(1)));
```

- [ ] **Step 4: Run the full craftsmanship backend suite**

Run:

```bash
cargo test craftsmanship -- --nocapture
```

Expected:
- All existing craftsmanship tests pass.
- The new validation regression tests pass.
- The new safe-stop timeout tests pass.
- The new six-test `process_flow_tests` module passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/tests.rs src-tauri/src/craftsmanship/validation.rs src-tauri/src/craftsmanship/loader.rs src-tauri/src/craftsmanship/runtime/engine.rs src-tauri/src/craftsmanship/types.rs
git commit -m "test: harden craftsmanship runtime flows"
```

## Self-Review Checklist

- Spec coverage:
  - Safe-stop timeout semantics: Task 3
  - Invalid `onError` and `onViolation`: Task 1
  - Duplicate top-level identifiers: Task 2
  - Serial framing validation: Task 1
  - Six acceptance tests: Tasks 4 through 7
- Placeholder scan:
  - No `TODO`, `TBD`, or deferred implementation markers remain.
- Type consistency:
  - Use `timeout_ms` in Rust, `timeoutMs` in JSON fixtures.
  - Use diagnostic codes `recipe_invalid_on_error`, `interlock_invalid_on_violation`, `duplicate_action_id`, `duplicate_device_type_id`, `duplicate_project_id`, and `connection_invalid_serial_*` consistently.
