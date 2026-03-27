# Process Flow Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six high-value backend runtime process-flow acceptance tests covering complete flows, branch flows, and protection flows with fake transports.

**Architecture:** Keep all new coverage in `src-tauri/src/craftsmanship/runtime/tests.rs` under a dedicated `process_flow_tests` submodule. Reuse the current runtime fixture helpers, add only lightweight process-flow helpers near the top of the file, and keep each scenario’s recipe and mapping fixtures explicit so the tests read like real process acceptance scripts.

**Tech Stack:** Rust, Tokio, Tauri mock runtime, serde_json fixtures, HMIP frame helpers, GPIO test override, cargo test

---

## File Map

- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:1-330`
  - Add lightweight process-flow helpers and reset guards
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
  - Add `process_flow_tests` submodule and six new runtime tests
- Reference: `src-tauri/src/craftsmanship/runtime/dispatch.rs:244-308`
  - HMIP `dispatch_connect_failed` and `dispatch_send_failed` behavior
- Reference: `src-tauri/src/craftsmanship/runtime/dispatch.rs:319-420`
  - GPIO `dispatch_send_failed` behavior
- Reference: `src-tauri/src/craftsmanship/runtime/manager.rs:402-451`
  - `apply_hmip_feedback` path for direct protection-flow injection

## Task 1: Add Process-Flow Helpers And First Mixed Flow Test

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:1-330`
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
- Test: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Write the failing test and helper call sites**

Add a new submodule and the first acceptance test at the end of `src-tauri/src/craftsmanship/runtime/tests.rs`:

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
            gpio_events
                .lock()
                .expect("gpio events mutex poisoned")
                .as_slice(),
            &[("/dev/gpiochip-test".to_string(), 17, false, true)]
        );

        let outbound = read_hmip_frame(&mut device_stream).await;
        assert_eq!(outbound.header.msg_type, 0x30);
        assert_eq!(outbound.header.channel, 3);
        assert_eq!(outbound.payload.as_ref(), &[0xAA, 0x55]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 401,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
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
        assert_eq!(
            snapshot.recipe_steps.iter().map(|step| step.status).collect::<Vec<_>>(),
            vec![
                RecipeRuntimeStepStatus::Completed,
                RecipeRuntimeStepStatus::Completed,
                RecipeRuntimeStepStatus::Completed,
            ]
        );
        assert_eq!(
            snapshot.runtime_values.get("device.pump_01.running"),
            Some(&json!(true))
        );
        assert_eq!(snapshot.signal_values.get("process_ready"), Some(&json!(1)));
    }
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal -- --test-threads=1
```

Expected: FAIL with unresolved names such as `ProcessFlowOverrideReset`, `write_process_flow_base`, `spawn_fake_hmip_device`, or `wait_until_step`.

- [ ] **Step 3: Add the minimal helper implementation**

Insert the shared helpers near the existing helper section in `src-tauri/src/craftsmanship/runtime/tests.rs`:

```rust
struct ProcessFlowOverrideReset;

impl Drop for ProcessFlowOverrideReset {
    fn drop(&mut self) {
        crate::comm::set_tcp_stream_override(None);
        crate::comm::set_serial_stream_override(None);
        super::dispatch::set_gpio_write_override(None);
    }
}

fn write_process_flow_base(workspace: &TestWorkspace) {
    write_system_bundle(workspace);
    write_project_base(workspace);

    workspace.write_json(
        "system/device-types/valve.json",
        json!({
            "id": "valve",
            "name": "阀门",
            "allowedActions": ["valve.enable", "valve.disable"]
        }),
    );
    workspace.write_json(
        "system/actions/valve.enable.json",
        json!({
            "id": "valve.enable",
            "name": "打开阀门",
            "targetMode": "required",
            "allowedDeviceTypes": ["valve"],
            "parameters": [],
            "dispatch": {
                "kind": "gpioWrite",
                "value": true
            },
            "completion": {
                "type": "immediate"
            }
        }),
    );
    workspace.write_json(
        "system/actions/valve.disable.json",
        json!({
            "id": "valve.disable",
            "name": "关闭阀门",
            "targetMode": "required",
            "allowedDeviceTypes": ["valve"],
            "parameters": [],
            "dispatch": {
                "kind": "gpioWrite",
                "value": false
            },
            "completion": {
                "type": "immediate"
            }
        }),
    );
    workspace.write_json(
        "system/actions/pump.start.json",
        json!({
            "id": "pump.start",
            "name": "开泵",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "parameters": [],
            "dispatch": {
                "kind": "hmipFrame",
                "msgType": 48,
                "payloadHex": "aa55"
            },
            "completion": {
                "type": "deviceFeedback",
                "key": "running",
                "operator": "eq",
                "value": true
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/connections/main_tcp_flow.json",
        json!({
            "id": "main-tcp-flow",
            "name": "流程 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15070,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/valve_01.json",
        json!({
            "id": "valve_01",
            "name": "使能阀",
            "typeId": "valve",
            "enabled": true,
            "transport": {
                "kind": "gpio",
                "pin": 17,
                "activeLow": false,
                "chipPath": "/dev/gpiochip-test"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "流程泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp-flow",
                "channel": 3
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/process_ready.json",
        json!({
            "id": "process_ready",
            "name": "流程就绪",
            "dataType": "number",
            "source": "signal.process_ready",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/process_confirmed.json",
        json!({
            "id": "process_confirmed",
            "name": "流程确认",
            "dataType": "number",
            "source": "signal.process_confirmed",
            "enabled": true
        }),
    );
}

async fn wait_until_step(
    manager: &RecipeRuntimeManager,
    phase: RecipeRuntimePhase,
    step_id: &str,
    expected_status: RecipeRuntimeStepStatus,
) -> super::types::RecipeRuntimeSnapshot {
    let started = std::time::Instant::now();
    loop {
        let snapshot = manager.get_status().await;
        let steps = match phase {
            RecipeRuntimePhase::Recipe => &snapshot.recipe_steps,
            RecipeRuntimePhase::SafeStop => &snapshot.safe_stop_steps,
            RecipeRuntimePhase::Idle => &snapshot.recipe_steps,
        };
        if steps
            .iter()
            .any(|step| step.step_id == step_id && step.status == expected_status)
        {
            return snapshot;
        }

        assert!(
            started.elapsed() < Duration::from_secs(3),
            "step `{step_id}` did not reach {:?} in time",
            expected_status
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn spawn_fake_hmip_device(expected_host: &'static str, expected_port: u16) -> tokio::io::DuplexStream {
    let (actor_stream, device_stream) = duplex(4096);
    let stream_slot = Arc::new(Mutex::new(Some(actor_stream)));
    crate::comm::set_tcp_stream_override(Some(Arc::new({
        let stream_slot = stream_slot.clone();
        move |config| {
            assert_eq!(config.host, expected_host);
            assert_eq!(config.port, expected_port);
            let stream = stream_slot
                .lock()
                .expect("process flow tcp stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "process flow tcp stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));
    device_stream
}
```

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs
git commit -m "test: add mixed process flow runtime coverage"
```

## Task 2: Add Multi-Device Isolation Flow

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
- Test: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Write the failing isolation test**

Append this test inside `mod process_flow_tests`:

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
        "projects/project-a/devices/pump_02.json",
        json!({
            "id": "pump_02",
            "name": "隔离泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp-flow",
                "channel": 4
            },
            "tags": {
                "running": "device.pump_02.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_01_running.json",
        json!({
            "id": "pump-01-running",
            "name": "流程泵运行反馈",
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
        "projects/project-a/feedback-mappings/pump_02_running.json",
        json!({
            "id": "pump-02-running",
            "name": "隔离泵运行反馈",
            "match": {
                "connectionId": "main-tcp-flow",
                "channel": 4,
                "summaryKind": "response",
                "status": 0
            },
            "target": {
                "deviceId": "pump_02",
                "feedbackKey": "running",
                "value": true
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/device-isolation-flow.json",
        json!({
            "id": "device-isolation-flow",
            "name": "多设备隔离流程",
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
                    "name": "启动流程泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 500,
                    "onError": "stop"
                },
                {
                    "id": "S030",
                    "seq": 30,
                    "name": "启动隔离泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_02",
                    "timeoutMs": 500,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let mut device_stream = spawn_fake_hmip_device("127.0.0.1", 15070);

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "device-isolation-flow".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let first_frame = read_hmip_frame(&mut device_stream).await;
    assert_eq!(first_frame.header.channel, 3);

    let wrong_response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
        request_id: 501,
        status: 0,
        body: Bytes::new(),
    });
    let wrong_response_frame =
        crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::RESPONSE,
            flags: 0,
            channel: 4,
            seq: 1001,
            payload: &wrong_response_payload,
        });
    write_hmip_frame(&mut device_stream, &wrong_response_frame).await;

    let still_waiting = wait_until_step(
        &manager,
        RecipeRuntimePhase::Recipe,
        "S020",
        RecipeRuntimeStepStatus::Running,
    )
    .await;
    assert_eq!(still_waiting.recipe_steps[1].status, RecipeRuntimeStepStatus::Running);
    assert_ne!(
        still_waiting.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );

    let right_response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
        request_id: 502,
        status: 0,
        body: Bytes::new(),
    });
    let right_response_frame =
        crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::RESPONSE,
            flags: 0,
            channel: 3,
            seq: 1002,
            payload: &right_response_payload,
        });
    write_hmip_frame(&mut device_stream, &right_response_frame).await;

    let second_frame = read_hmip_frame(&mut device_stream).await;
    assert_eq!(second_frame.header.channel, 4);

    let final_response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
        request_id: 503,
        status: 0,
        body: Bytes::new(),
    });
    let final_response_frame =
        crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::RESPONSE,
            flags: 0,
            channel: 4,
            seq: 1003,
            payload: &final_response_payload,
        });
    write_hmip_frame(&mut device_stream, &final_response_frame).await;

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_02.running"),
        Some(&json!(true))
    );
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml multi_device_process_should_complete_with_cross_transport_feedback_isolation -- --test-threads=1
```

Expected: FAIL with a timeout or assertion showing that wrong-channel feedback currently advances the wrong step or the later step never completes.

- [ ] **Step 3: Add the minimal implementation**

No new helper should be needed. Adjust only the test fixture or the minimal production code exposed by the red test. If production code is required, inspect these files first:

```rust
// Reference only: do not edit unless the red test proves a runtime bug
// src-tauri/src/craftsmanship/runtime/manager.rs
// src-tauri/src/craftsmanship/runtime/engine.rs
// src-tauri/src/craftsmanship/runtime/dispatch.rs
```

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml multi_device_process_should_complete_with_cross_transport_feedback_isolation -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/runtime/dispatch.rs src-tauri/src/craftsmanship/runtime/engine.rs src-tauri/src/craftsmanship/runtime/manager.rs
git commit -m "test: add multi-device process isolation coverage"
```

## Task 3: Add Out-Of-Order Feedback Flow

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
- Reference: `src-tauri/src/craftsmanship/runtime/manager.rs:402-451`

- [ ] **Step 1: Write the failing out-of-order test**

```rust
#[tokio::test]
async fn process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step() {
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
        "projects/project-a/feedback-mappings/process_confirmed_flow.json",
        json!({
            "id": "process-confirmed-flow",
            "name": "流程确认反馈",
            "match": {
                "connectionId": "main-tcp-flow",
                "channel": 3,
                "summaryKind": "event",
                "eventId": 302
            },
            "target": {
                "signalId": "process_confirmed",
                "value": 1
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/out-of-order-flow.json",
        json!({
            "id": "out-of-order-flow",
            "name": "时序乱序流程",
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
                    "name": "启动流程泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 500,
                    "onError": "stop"
                },
                {
                    "id": "S030",
                    "seq": 30,
                    "name": "等待流程确认",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "process_confirmed",
                        "operator": "eq",
                        "value": 1
                    },
                    "timeoutMs": 500,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let mut device_stream = spawn_fake_hmip_device("127.0.0.1", 15070);

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "out-of-order-flow".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let frame = read_hmip_frame(&mut device_stream).await;
    assert_eq!(frame.header.channel, 3);

    let early_event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
        event_id: 302,
        timestamp_ms: 1010,
        body: Bytes::new(),
    });
    let early_event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
        msg_type: crate::comm::proto::msg_type::EVENT,
        flags: 0,
        channel: 3,
        seq: 1101,
        payload: &early_event_payload,
    });
    write_hmip_frame(&mut device_stream, &early_event_frame).await;

    let mid_snapshot = wait_until_step(
        &manager,
        RecipeRuntimePhase::Recipe,
        "S020",
        RecipeRuntimeStepStatus::Running,
    )
    .await;
    assert_eq!(mid_snapshot.recipe_steps[1].status, RecipeRuntimeStepStatus::Running);

    let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
        request_id: 601,
        status: 0,
        body: Bytes::new(),
    });
    let response_frame =
        crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::RESPONSE,
            flags: 0,
            channel: 3,
            seq: 1102,
            payload: &response_payload,
        });
    write_hmip_frame(&mut device_stream, &response_frame).await;

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(snapshot.signal_values.get("process_confirmed"), Some(&json!(1)));
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step -- --test-threads=1
```

Expected: FAIL if early future-step feedback incorrectly completes the active step or if the process never completes after the correct response.

- [ ] **Step 3: Write the minimal implementation**

Keep the change set minimal. Prefer fixing the assertion or the smallest runtime defect revealed by the red test.

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/runtime/engine.rs src-tauri/src/craftsmanship/runtime/manager.rs
git commit -m "test: add out-of-order process feedback coverage"
```

## Task 4: Add Ignore-Branch Send-Failure Flow

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
- Reference: `src-tauri/src/craftsmanship/runtime/dispatch.rs:244-308`

- [ ] **Step 1: Write the failing ignore-branch test**

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
        "projects/project-a/recipes/ignore-send-failure-flow.json",
        json!({
            "id": "ignore-send-failure-flow",
            "name": "忽略发送失败流程",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "尝试启动流程泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 300,
                    "onError": "ignore"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "打开阀门使能",
                    "actionId": "valve.enable",
                    "deviceId": "valve_01",
                    "timeoutMs": 300,
                    "onError": "stop"
                },
                {
                    "id": "S030",
                    "seq": 30,
                    "name": "等待流程确认",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "process_confirmed",
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
    drop(device_stream);

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "ignore-send-failure-flow".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let after_ignore = wait_until_step(
        &manager,
        RecipeRuntimePhase::Recipe,
        "S020",
        RecipeRuntimeStepStatus::Running,
    )
    .await;
    assert_eq!(after_ignore.recipe_steps[0].status, RecipeRuntimeStepStatus::Failed);

    manager
        .write_signal(None, "process_confirmed".to_string(), json!(1))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(snapshot.recipe_steps[0].status, RecipeRuntimeStepStatus::Failed);
    assert_eq!(snapshot.recipe_steps[1].status, RecipeRuntimeStepStatus::Completed);
    assert_eq!(snapshot.recipe_steps[2].status, RecipeRuntimeStepStatus::Completed);
    assert_eq!(
        gpio_events
            .lock()
            .expect("gpio events mutex poisoned")
            .as_slice(),
        &[("/dev/gpiochip-test".to_string(), 17, false, true)]
    );
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps -- --test-threads=1
```

Expected: FAIL if `dispatch_send_failed` aborts the whole runtime instead of respecting `ignore`, or if the following GPIO step never starts.

- [ ] **Step 3: Write the minimal implementation**

If a runtime fix is needed, inspect `src-tauri/src/craftsmanship/runtime/engine.rs` first because `ignore` behavior is handled there.

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/runtime/engine.rs
git commit -m "test: cover ignored send failure process branch"
```

## Task 5: Add Safe-Stop Send-Failure Flow

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
- Reference: `src-tauri/src/craftsmanship/runtime/dispatch.rs:244-308`
- Reference: `src-tauri/src/craftsmanship/runtime/engine.rs`

- [ ] **Step 1: Write the failing safe-stop branch test**

```rust
#[tokio::test]
async fn process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = ProcessFlowOverrideReset;

    let workspace = TestWorkspace::new();
    write_process_flow_base(&workspace);
    workspace.write_json(
        "projects/project-a/safety/safe-stop.json",
        json!({
            "id": "safe-stop",
            "name": "流程安全停机",
            "steps": [
                {
                    "seq": 10,
                    "actionId": "valve.disable",
                    "deviceId": "valve_01"
                },
                {
                    "seq": 20,
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "process_confirmed",
                        "operator": "eq",
                        "value": 1
                    }
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/safe-stop-send-failure-flow.json",
        json!({
            "id": "safe-stop-send-failure-flow",
            "name": "安全停机发送失败流程",
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
                    "name": "启动流程泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 300,
                    "onError": "safe-stop"
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
    drop(device_stream);

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "safe-stop-send-failure-flow".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let in_safe_stop = wait_until_step(
        &manager,
        RecipeRuntimePhase::SafeStop,
        "safe-stop-0010-valve-disable-valve_01",
        RecipeRuntimeStepStatus::Completed,
    )
    .await;
    assert_eq!(in_safe_stop.phase, RecipeRuntimePhase::SafeStop);

    manager
        .write_signal(None, "process_confirmed".to_string(), json!(1))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("dispatch_send_failed")
    );
    assert!(snapshot
        .safe_stop_steps
        .iter()
        .all(|step| step.status == RecipeRuntimeStepStatus::Completed));
    assert_eq!(
        gpio_events
            .lock()
            .expect("gpio events mutex poisoned")
            .as_slice(),
        &[
            ("/dev/gpiochip-test".to_string(), 17, false, true),
            ("/dev/gpiochip-test".to_string(), 17, false, false)
        ]
    );
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain -- --test-threads=1
```

Expected: FAIL if safe-stop does not begin, the original `dispatch_send_failed` reason is lost, or the shutdown GPIO action does not execute.

- [ ] **Step 3: Write the minimal implementation**

If a production fix is needed, prefer the smallest change in `src-tauri/src/craftsmanship/runtime/engine.rs` or `src-tauri/src/craftsmanship/runtime/manager.rs` that preserves the original error while allowing safe-stop completion.

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/runtime/engine.rs src-tauri/src/craftsmanship/runtime/manager.rs
git commit -m "test: add safe-stop send failure process coverage"
```

## Task 6: Add Wrong Connection And Channel Protection Flow

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs:4307+`
- Reference: `src-tauri/src/craftsmanship/runtime/manager.rs:402-451`

- [ ] **Step 1: Write the failing protection test**

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
        "projects/project-a/recipes/protection-flow.json",
        json!({
            "id": "protection-flow",
            "name": "错误反馈保护流程",
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
                    "name": "启动流程泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 500,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let mut device_stream = spawn_fake_hmip_device("127.0.0.1", 15070);

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "protection-flow".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let _frame = read_hmip_frame(&mut device_stream).await;

    let wrong_message = crate::comm::proto::Message::Response(crate::comm::proto::Response {
        request_id: 701,
        status: 0,
        body: Bytes::new(),
    });
    manager
        .apply_hmip_feedback(
            None,
            "wrong-connection",
            crate::comm::proto::FrameHeader {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 3,
                seq: 1201,
                payload_len: 0,
                payload_crc32: None,
            },
            Some(&wrong_message),
            &[],
        )
        .await
        .unwrap();

    manager
        .apply_hmip_feedback(
            None,
            "main-tcp-flow",
            crate::comm::proto::FrameHeader {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 9,
                seq: 1202,
                payload_len: 0,
                payload_crc32: None,
            },
            Some(&wrong_message),
            &[],
        )
        .await
        .unwrap();

    let still_waiting = wait_until_step(
        &manager,
        RecipeRuntimePhase::Recipe,
        "S020",
        RecipeRuntimeStepStatus::Running,
    )
    .await;
    assert_eq!(still_waiting.recipe_steps[1].status, RecipeRuntimeStepStatus::Running);
    assert_ne!(
        still_waiting.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );

    manager
        .apply_hmip_feedback(
            None,
            "main-tcp-flow",
            crate::comm::proto::FrameHeader {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 3,
                seq: 1203,
                payload_len: 0,
                payload_crc32: None,
            },
            Some(&wrong_message),
            &[],
        )
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_not_complete_when_feedback_connection_or_channel_is_wrong -- --test-threads=1
```

Expected: FAIL if wrong connection or wrong channel feedback incorrectly completes `S020`.

- [ ] **Step 3: Write the minimal implementation**

If this test exposes a runtime bug, inspect matching logic in `src-tauri/src/craftsmanship/runtime/manager.rs` before changing anything else.

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_not_complete_when_feedback_connection_or_channel_is_wrong -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/runtime/manager.rs
git commit -m "test: guard process flow against wrong feedback routing"
```

## Task 7: Run Grouped And Full Verification

**Files:**
- Modify: `src-tauri/src/craftsmanship/runtime/tests.rs`

- [ ] **Step 1: Run the complete-flow group**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal -- --test-threads=1
```

Expected: PASS

- [ ] **Step 2: Run the remaining complete-flow tests**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml multi_device_process_should_complete_with_cross_transport_feedback_isolation -- --test-threads=1
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step -- --test-threads=1
```

Expected: both commands PASS

- [ ] **Step 3: Run the ignore branch-flow test**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps -- --test-threads=1
```

Expected: PASS

- [ ] **Step 4: Run the safe-stop branch-flow test**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain -- --test-threads=1
```

Expected: PASS

- [ ] **Step 5: Run the protection-flow test**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml process_should_not_complete_when_feedback_connection_or_channel_is_wrong -- --test-threads=1
```

Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml -- --test-threads=1
```

Expected: PASS with zero failed tests

- [ ] **Step 7: Run the compile check**

Run:

```bash
cargo check --manifest-path ./src-tauri/Cargo.toml
```

Expected: PASS

- [ ] **Step 8: Commit the final verification state**

```bash
git add src-tauri/src/craftsmanship/runtime/tests.rs src-tauri/src/craftsmanship/runtime/dispatch.rs src-tauri/src/craftsmanship/runtime/engine.rs src-tauri/src/craftsmanship/runtime/manager.rs
git commit -m "test: expand runtime process flow coverage"
```
