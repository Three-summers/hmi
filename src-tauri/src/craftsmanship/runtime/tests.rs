use super::manager::RecipeRuntimeManager;
use super::types::{RecipeRuntimePhase, RecipeRuntimeStatus, RecipeRuntimeStepStatus};
use bytes::Bytes;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{test::mock_app, Listener, Manager};
use tokio::io::{duplex, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

struct TestWorkspace {
    root: PathBuf,
}

impl TestWorkspace {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "hmi-recipe-runtime-{unique}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("failed to create temp workspace");
        Self { root }
    }

    fn path(&self) -> &Path {
        &self.root
    }

    fn write_json(&self, relative_path: &str, value: Value) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("failed to create parent directory");
        }
        fs::write(&path, serde_json::to_vec_pretty(&value).unwrap())
            .expect("failed to write fixture");
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn e2e_transport_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct CommOverrideReset;

impl Drop for CommOverrideReset {
    fn drop(&mut self) {
        crate::comm::set_tcp_stream_override(None);
        crate::comm::set_serial_stream_override(None);
    }
}

fn setup_runtime_app(manager: &RecipeRuntimeManager) -> tauri::App<tauri::test::MockRuntime> {
    let app = mock_app();
    assert!(app.manage(crate::comm::CommState::default()));
    assert!(app.manage(manager.clone()));
    app
}

async fn read_hmip_frame<S>(stream: &mut S) -> crate::comm::proto::Frame
where
    S: AsyncRead + Unpin,
{
    let mut decoder =
        crate::comm::proto::FrameDecoder::new(crate::comm::proto::DecoderConfig::default());
    let mut buf = [0u8; 512];

    loop {
        if let Some(frame) = decoder.next_frame().expect("failed to decode HMIP frame") {
            return frame;
        }

        let size = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut buf))
            .await
            .expect("timed out while waiting for HMIP frame")
            .expect("failed to read HMIP frame bytes");
        assert!(
            size > 0,
            "HMIP stream closed before a full frame was received"
        );
        decoder
            .push(&buf[..size])
            .expect("failed to push HMIP frame bytes into decoder");
    }
}

async fn write_hmip_frame<S>(stream: &mut S, frame_bytes: &[u8])
where
    S: AsyncWrite + Unpin,
{
    tokio::time::timeout(Duration::from_secs(2), stream.write_all(frame_bytes))
        .await
        .expect("timed out while writing HMIP frame")
        .expect("failed to write HMIP frame");
    tokio::time::timeout(Duration::from_secs(2), stream.flush())
        .await
        .expect("timed out while flushing HMIP frame")
        .expect("failed to flush HMIP frame");
}

fn read_hmip_frame_blocking<S>(stream: &mut S) -> crate::comm::proto::Frame
where
    S: std::io::Read,
{
    let mut decoder =
        crate::comm::proto::FrameDecoder::new(crate::comm::proto::DecoderConfig::default());
    let mut buf = [0u8; 512];
    let started = std::time::Instant::now();

    loop {
        if let Some(frame) = decoder.next_frame().expect("failed to decode HMIP frame") {
            return frame;
        }

        let size = match stream.read(&mut buf) {
            Ok(size) if size > 0 => size,
            Ok(_) => {
                assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "HMIP stream closed before a full frame was received"
                );
                continue;
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::BrokenPipe
                ) =>
            {
                assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "timed out while waiting for HMIP frame"
                );
                continue;
            }
            Err(error) if matches!(error.raw_os_error(), Some(5) | Some(32)) => {
                assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "timed out while waiting for HMIP frame after transient PTY error"
                );
                continue;
            }
            Err(error) => panic!("failed to read HMIP frame bytes: {error}"),
        };

        decoder
            .push(&buf[..size])
            .expect("failed to push HMIP frame bytes into decoder");
    }
}

fn write_hmip_frame_blocking<S>(stream: &mut S, frame_bytes: &[u8])
where
    S: std::io::Write,
{
    stream
        .write_all(frame_bytes)
        .expect("failed to write HMIP frame");
    stream.flush().expect("failed to flush HMIP frame");
}

fn write_system_bundle(workspace: &TestWorkspace) {
    workspace.write_json(
        "system/actions/common.delay.json",
        json!({
            "id": "common.delay",
            "name": "延时",
            "targetMode": "none",
            "parameters": [
                {
                    "key": "durationMs",
                    "name": "时长",
                    "type": "number",
                    "required": true,
                    "min": 0,
                    "max": 10000
                }
            ]
        }),
    );
    workspace.write_json(
        "system/actions/common.wait-signal.json",
        json!({
            "id": "common.wait-signal",
            "name": "等待信号",
            "targetMode": "none",
            "parameters": [
                {
                    "key": "signalId",
                    "name": "信号",
                    "type": "string",
                    "required": true
                },
                {
                    "key": "operator",
                    "name": "比较符",
                    "type": "enum",
                    "required": false,
                    "options": ["eq", "ne", "gt", "ge", "lt", "le"]
                },
                {
                    "key": "value",
                    "name": "目标值",
                    "type": "number",
                    "required": true
                },
                {
                    "key": "stableTimeMs",
                    "name": "稳定时间",
                    "type": "number",
                    "required": false,
                    "min": 0,
                    "max": 10000
                }
            ]
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
            "completion": {
                "type": "deviceFeedback",
                "key": "running",
                "operator": "eq",
                "value": true
            }
        }),
    );
    workspace.write_json(
        "system/actions/pump.stop.json",
        json!({
            "id": "pump.stop",
            "name": "停泵",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "parameters": []
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["pump.start", "pump.stop"]
        }),
    );
}

fn write_project_base(workspace: &TestWorkspace) {
    workspace.write_json(
        "projects/project-a/project.json",
        json!({
            "id": "project-a",
            "name": "项目A",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/chamber_pressure.json",
        json!({
            "id": "chamber_pressure",
            "name": "腔压",
            "dataType": "number",
            "source": "signal.chamber_pressure",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/door_closed.json",
        json!({
            "id": "door_closed",
            "name": "门关闭",
            "dataType": "boolean",
            "source": "signal.door_closed",
            "enabled": true
        }),
    );
}

async fn wait_for_terminal_status(
    manager: &RecipeRuntimeManager,
) -> super::types::RecipeRuntimeSnapshot {
    let started = std::time::Instant::now();
    loop {
        let snapshot = manager.get_status().await;
        if matches!(
            snapshot.status,
            RecipeRuntimeStatus::Completed
                | RecipeRuntimeStatus::Failed
                | RecipeRuntimeStatus::Stopped
        ) {
            return snapshot;
        }

        assert!(
            started.elapsed() < Duration::from_secs(3),
            "runtime did not reach terminal status in time"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn runtime_should_complete_delay_recipe() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/delay.json",
        json!({
            "id": "delay",
            "name": "延时工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "延时",
                    "actionId": "common.delay",
                    "parameters": {
                        "durationMs": 40
                    },
                    "timeoutMs": 200,
                    "onError": "stop"
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
            "delay".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
}

#[tokio::test]
async fn runtime_should_resume_when_signal_is_written() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                        "value": 10,
                        "stableTimeMs": 10
                    },
                    "timeoutMs": 500,
                    "onError": "stop"
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

    tokio::time::sleep(Duration::from_millis(40)).await;
    manager
        .write_signal(None, "chamber_pressure".to_string(), json!(5))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(5))
    );
}

#[tokio::test]
async fn runtime_should_complete_device_action_after_feedback() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/pump-start.json",
        json!({
            "id": "pump-start",
            "name": "启动前级泵",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "parameters": {},
                    "timeoutMs": 500,
                    "onError": "stop"
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
            "pump-start".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    tokio::time::sleep(Duration::from_millis(40)).await;
    manager
        .write_device_feedback(
            None,
            "pump_01".to_string(),
            "running".to_string(),
            json!(true),
        )
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
}

#[tokio::test]
async fn runtime_should_fail_when_interlock_is_not_satisfied() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/safety/interlocks.json",
        json!({
            "rules": [
                {
                    "id": "door-closed-before-start",
                    "name": "开泵前门必须关闭",
                    "actionIds": ["pump.start"],
                    "condition": {
                        "signalId": "door_closed",
                        "operator": "eq",
                        "value": true
                    },
                    "onViolation": "block"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/pump-start.json",
        json!({
            "id": "pump-start",
            "name": "启动前级泵",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "parameters": {},
                    "timeoutMs": 500,
                    "onError": "stop"
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
            "pump-start".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Failed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("interlock_blocked")
    );
}

#[tokio::test]
async fn runtime_should_enter_safe_stop_after_timeout() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        snapshot.safe_stop_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("step_timeout")
    );
}

#[tokio::test]
async fn runtime_should_stop_when_stop_command_is_called() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/long-delay.json",
        json!({
            "id": "long-delay",
            "name": "长延时",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "延时",
                    "actionId": "common.delay",
                    "parameters": {
                        "durationMs": 500
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
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
            "long-delay".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    tokio::time::sleep(Duration::from_millis(40)).await;
    let snapshot = manager
        .stop(None, Some("manual stop".to_string()))
        .await
        .unwrap();

    assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Stopped
    );
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("stop_requested")
    );
}

#[tokio::test]
async fn runtime_should_reject_control_commands_before_load() {
    let manager = RecipeRuntimeManager::default();

    let start_error = manager.start(None).await.unwrap_err();
    assert!(start_error.contains("no recipe has been loaded"));

    let signal_error = manager
        .write_signal(None, "chamber_pressure".to_string(), json!(5))
        .await
        .unwrap_err();
    assert!(signal_error.contains("no recipe has been loaded"));

    let feedback_error = manager
        .write_device_feedback(
            None,
            "pump_01".to_string(),
            "running".to_string(),
            json!(true),
        )
        .await
        .unwrap_err();
    assert!(feedback_error.contains("no recipe has been loaded"));

    let snapshot = manager.get_status().await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Idle);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::Idle);
}

#[tokio::test]
async fn runtime_should_reject_duplicate_start_and_load_while_running() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/long-delay.json",
        json!({
            "id": "long-delay",
            "name": "长延时",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "延时",
                    "actionId": "common.delay",
                    "parameters": {
                        "durationMs": 300
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
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
            "long-delay".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let duplicate_start_error = manager.start(None).await.unwrap_err();
    assert!(duplicate_start_error.contains("already active"));

    let duplicate_load_error = manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "long-delay".to_string(),
        )
        .await
        .unwrap_err();
    assert!(duplicate_load_error.contains("stop it before loading another recipe"));

    let snapshot = manager
        .stop(None, Some("duplicate guard".to_string()))
        .await
        .unwrap();
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
}

#[tokio::test]
async fn runtime_should_reject_unknown_runtime_value_targets() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/delay.json",
        json!({
            "id": "delay",
            "name": "延时工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "延时",
                    "actionId": "common.delay",
                    "parameters": {
                        "durationMs": 10
                    },
                    "timeoutMs": 200,
                    "onError": "stop"
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
            "delay".to_string(),
        )
        .await
        .unwrap();

    let signal_error = manager
        .write_signal(None, "missing_signal".to_string(), json!(1))
        .await
        .unwrap_err();
    assert!(signal_error.contains("does not exist"));

    let device_error = manager
        .write_device_feedback(
            None,
            "missing_device".to_string(),
            "running".to_string(),
            json!(true),
        )
        .await
        .unwrap_err();
    assert!(device_error.contains("does not exist"));

    let key_error = manager
        .write_device_feedback(
            None,
            "pump_01".to_string(),
            "missing_key".to_string(),
            json!(true),
        )
        .await
        .unwrap_err();
    assert!(key_error.contains("does not define feedback key"));
}

#[tokio::test]
async fn runtime_should_reject_start_when_loaded_recipe_has_error_diagnostics() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/broken.json",
        json!({
            "id": "broken",
            "name": "错误工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵但缺设备",
                    "actionId": "pump.start",
                    "parameters": {},
                    "timeoutMs": 100,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let snapshot = manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "broken".to_string(),
        )
        .await
        .unwrap();
    assert!(snapshot
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.level == "error"));

    let error = manager.start(None).await.unwrap_err();
    assert!(error.contains("error diagnostics"));
}

#[tokio::test]
async fn runtime_should_reject_start_when_project_is_disabled() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/project.json",
        json!({
            "id": "project-a",
            "name": "项目A",
            "enabled": false
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/valid-delay.json",
        json!({
            "id": "valid-delay",
            "name": "有效延时工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "延时",
                    "actionId": "common.delay",
                    "parameters": {
                        "durationMs": 10
                    },
                    "timeoutMs": 200,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let snapshot = manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "valid-delay".to_string(),
        )
        .await
        .unwrap();
    assert!(snapshot
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "project_disabled"));

    let error = manager.start(None).await.unwrap_err();
    assert!(error.contains("error diagnostics"));
}

#[tokio::test]
async fn runtime_should_clear_runtime_values_between_runs() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/wait-pressure.json",
        json!({
            "id": "wait-pressure",
            "name": "等待压力",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待压力达到",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "value": 1
                    },
                    "timeoutMs": 500,
                    "onError": "stop"
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
    tokio::time::sleep(Duration::from_millis(40)).await;
    manager
        .write_signal(None, "chamber_pressure".to_string(), json!(1))
        .await
        .unwrap();

    let first_snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(first_snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        first_snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(1))
    );

    manager.start(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(60)).await;

    let second_snapshot = manager.get_status().await;
    assert_eq!(second_snapshot.status, RecipeRuntimeStatus::Running);
    assert_eq!(second_snapshot.active_step_id.as_deref(), Some("S010"));
    assert!(second_snapshot.signal_values.is_empty());

    let stopped = manager
        .stop(None, Some("clear between runs".to_string()))
        .await
        .unwrap();
    assert_eq!(stopped.status, RecipeRuntimeStatus::Stopped);
}

#[tokio::test]
async fn runtime_should_start_when_unrelated_recipe_has_error_diagnostics() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/valid-delay.json",
        json!({
            "id": "valid-delay",
            "name": "有效延时工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "延时",
                    "actionId": "common.delay",
                    "parameters": {
                        "durationMs": 10
                    },
                    "timeoutMs": 200,
                    "onError": "stop"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/broken-other.json",
        json!({
            "id": "broken-other",
            "name": "无关错误工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "未知动作",
                    "actionId": "missing.action",
                    "parameters": {}
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
            "valid-delay".to_string(),
        )
        .await
        .unwrap();

    manager.start(None).await.unwrap();
    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
}

#[tokio::test]
async fn runtime_should_ignore_failed_step_and_continue() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/ignore-timeout.json",
        json!({
            "id": "ignore-timeout",
            "name": "忽略超时并继续",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵等待反馈",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "parameters": {},
                    "timeoutMs": 40,
                    "onError": "ignore"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "停泵",
                    "actionId": "pump.stop",
                    "deviceId": "pump_01",
                    "parameters": {},
                    "timeoutMs": 100,
                    "onError": "stop"
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
            "ignore-timeout".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        snapshot.recipe_steps[1].status,
        RecipeRuntimeStepStatus::Completed
    );
}

#[tokio::test]
async fn runtime_should_complete_signal_compare_action_after_signal_write() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "system/actions/common.await-pressure.json",
        json!({
            "id": "common.await-pressure",
            "name": "等待压力动作完成",
            "targetMode": "none",
            "parameters": [],
            "completion": {
                "type": "signalCompare",
                "signalId": "chamber_pressure",
                "operator": "lt",
                "value": 10,
                "stableTimeMs": 10
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/await-pressure.json",
        json!({
            "id": "await-pressure",
            "name": "等待压力动作",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待动作完成",
                    "actionId": "common.await-pressure",
                    "parameters": {},
                    "timeoutMs": 500,
                    "onError": "stop"
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
            "await-pressure".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    tokio::time::sleep(Duration::from_millis(30)).await;
    manager
        .write_signal(None, "chamber_pressure".to_string(), json!(5))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
}

#[tokio::test]
async fn runtime_should_wait_for_stable_signal_before_completion() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/stable-wait.json",
        json!({
            "id": "stable-wait",
            "name": "稳定等待",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待稳定腔压",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 10,
                        "stableTimeMs": 120
                    },
                    "timeoutMs": 600,
                    "onError": "stop"
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
            "stable-wait".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    tokio::time::sleep(Duration::from_millis(30)).await;
    manager
        .write_signal(None, "chamber_pressure".to_string(), json!(5))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(40)).await;
    manager
        .write_signal(None, "chamber_pressure".to_string(), json!(30))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(90)).await;

    let mid_snapshot = manager.get_status().await;
    assert_eq!(mid_snapshot.status, RecipeRuntimeStatus::Running);
    assert_eq!(
        mid_snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Running
    );

    manager
        .write_signal(None, "chamber_pressure".to_string(), json!(5))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
}

#[tokio::test]
async fn runtime_should_handle_high_frequency_signal_updates() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/recipes/high-frequency-wait.json",
        json!({
            "id": "high-frequency-wait",
            "name": "高频信号等待",
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
                    "timeoutMs": 1000,
                    "onError": "stop"
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
            "high-frequency-wait".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let writer = {
        let manager = manager.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            for index in 0..128u32 {
                manager
                    .write_signal(
                        None,
                        "chamber_pressure".to_string(),
                        json!(100 + (index % 7)),
                    )
                    .await
                    .unwrap();
            }
            manager
                .write_signal(None, "chamber_pressure".to_string(), json!(5))
                .await
                .unwrap();
        })
    };

    writer.await.unwrap();
    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(5))
    );
}

#[tokio::test]
async fn runtime_should_complete_long_immediate_step_sequence() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    let steps = (1..=48u32)
        .map(|index| {
            json!({
                "id": format!("S{:03}", index * 10),
                "seq": index * 10,
                "name": format!("停泵步骤 {index}"),
                "actionId": "pump.stop",
                "deviceId": "pump_01",
                "parameters": {},
                "timeoutMs": 100,
                "onError": "stop"
            })
        })
        .collect::<Vec<_>>();
    workspace.write_json(
        "projects/project-a/recipes/long-sequence.json",
        json!({
            "id": "long-sequence",
            "name": "长序列工艺",
            "steps": steps
        }),
    );

    let manager = RecipeRuntimeManager::default();
    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "long-sequence".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(snapshot.recipe_steps.len(), 48);
    assert!(snapshot
        .recipe_steps
        .iter()
        .all(|step| step.status == RecipeRuntimeStepStatus::Completed));
}

#[tokio::test]
async fn runtime_should_complete_explicit_immediate_completion_action() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "system/actions/common.noop.json",
        json!({
            "id": "common.noop",
            "name": "空动作",
            "targetMode": "none",
            "parameters": [],
            "completion": {
                "type": "immediate"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/noop.json",
        json!({
            "id": "noop",
            "name": "空动作工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "空动作",
                    "actionId": "common.noop",
                    "parameters": {},
                    "timeoutMs": 100,
                    "onError": "stop"
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
            "noop".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
}

#[tokio::test]
async fn runtime_should_report_stopped_when_stop_is_requested_during_safe_stop() {
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

    let started = std::time::Instant::now();
    loop {
        let snapshot = manager.get_status().await;
        if snapshot.phase == RecipeRuntimePhase::SafeStop {
            break;
        }
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "runtime did not enter safe-stop in time"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let snapshot = manager
        .stop(None, Some("operator stop during safe-stop".to_string()))
        .await
        .unwrap();
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Stopped);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
    assert_eq!(
        snapshot.safe_stop_steps[0].status,
        RecipeRuntimeStepStatus::Stopped
    );
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("step_timeout")
    );
}

#[tokio::test]
async fn runtime_should_preserve_original_failure_when_safe_stop_step_fails() {
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
                "operator": "gt",
                "value": 0
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

    let writer = {
        let manager = manager.clone();
        tokio::spawn(async move {
            let started = std::time::Instant::now();
            loop {
                let snapshot = manager.get_status().await;
                if snapshot.phase == RecipeRuntimePhase::SafeStop
                    && snapshot.active_step_id.is_some()
                {
                    manager
                        .write_device_feedback(
                            None,
                            "pump_01".to_string(),
                            "running".to_string(),
                            json!("bad"),
                        )
                        .await
                        .unwrap();
                    break;
                }
                assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "runtime did not start safe-stop step in time"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
    };

    writer.await.unwrap();
    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Failed);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::SafeStop);
    assert_eq!(
        snapshot.safe_stop_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("step_timeout")
    );
    assert!(snapshot
        .last_message
        .as_deref()
        .is_some_and(|message| message.contains("condition_compare_error")));
}

#[tokio::test]
async fn runtime_should_fail_dispatched_action_when_app_handle_is_missing() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                "msgType": 16,
                "payloadHex": "0101"
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
        "projects/project-a/connections/pump_tcp.json",
        json!({
            "id": "pump-tcp",
            "name": "前级泵 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15020,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "pump-tcp",
                "channel": 1
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/pump-start.json",
        json!({
            "id": "pump-start",
            "name": "开泵工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 200,
                    "onError": "stop"
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
            "pump-start".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Failed);
    assert_eq!(snapshot.phase, RecipeRuntimePhase::Recipe);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("missing_app_handle")
    );
}

#[tokio::test]
async fn runtime_should_dispatch_gpio_action_to_configured_pin() {
    let workspace = TestWorkspace::new();
    let gpio_root = workspace.path().join("mock-gpio");
    let gpio_dir = gpio_root.join("gpio17");
    fs::create_dir_all(&gpio_dir).expect("failed to create gpio fixture directory");
    fs::write(gpio_dir.join("value"), "0").expect("failed to write gpio value fixture");
    fs::write(gpio_dir.join("direction"), "in").expect("failed to write gpio direction fixture");
    fs::write(gpio_dir.join("active_low"), "0").expect("failed to write gpio active_low fixture");

    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "system/actions/valve.open.json",
        json!({
            "id": "valve.open",
            "name": "开阀",
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
        "system/device-types/valve.json",
        json!({
            "id": "valve",
            "name": "阀",
            "allowedActions": ["valve.open"]
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/valve_01.json",
        json!({
            "id": "valve_01",
            "name": "进气阀",
            "typeId": "valve",
            "enabled": true,
            "transport": {
                "kind": "gpio",
                "pin": 17,
                "activeLow": false,
                "chipPath": "/dev/gpiochip-test"
            },
            "tags": {}
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/valve-open.json",
        json!({
            "id": "valve-open",
            "name": "开阀工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "打开进气阀",
                    "actionId": "valve.open",
                    "deviceId": "valve_01",
                    "timeoutMs": 200,
                    "onError": "stop"
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
            "valve-open".to_string(),
        )
        .await
        .unwrap();
    super::dispatch::set_gpio_write_override(Some(Arc::new({
        let gpio_dir = gpio_dir.clone();
        move |chip_path, pin, active_low, value| {
            assert_eq!(chip_path, "/dev/gpiochip-test");
            assert_eq!(pin, 17);
            fs::write(gpio_dir.join("direction"), "out")
                .map_err(|error| format!("failed to write gpio direction fixture: {error}"))?;
            fs::write(
                gpio_dir.join("active_low"),
                if active_low { "1" } else { "0" },
            )
            .map_err(|error| format!("failed to write gpio active_low fixture: {error}"))?;
            fs::write(gpio_dir.join("value"), if value { "1" } else { "0" })
                .map_err(|error| format!("failed to write gpio value fixture: {error}"))?;
            Ok(())
        }
    })));
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    super::dispatch::set_gpio_write_override(None);
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(fs::read_to_string(gpio_dir.join("value")).unwrap(), "1");
    assert_eq!(
        fs::read_to_string(gpio_dir.join("direction")).unwrap(),
        "out"
    );
    assert_eq!(
        fs::read_to_string(gpio_dir.join("active_low")).unwrap(),
        "0"
    );
}

#[tokio::test]
async fn runtime_should_run_recipe_over_fake_tcp_transport_end_to_end() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = CommOverrideReset;

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                "msgType": 16,
                "payloadHex": "0101"
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
        "projects/project-a/connections/main_tcp.json",
        json!({
            "id": "main-tcp",
            "name": "主控 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15060,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp",
                "channel": 1
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/chamber_pressure.json",
        json!({
            "id": "tcp-pressure-feedback",
            "name": "TCP 腔压反馈",
            "match": {
                "connectionId": "main-tcp",
                "channel": 1,
                "summaryKind": "event",
                "eventId": 32
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 3
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running.json",
        json!({
            "id": "tcp-running-feedback",
            "name": "TCP 运行反馈",
            "match": {
                "connectionId": "main-tcp",
                "channel": 1,
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
        "projects/project-a/recipes/tcp-e2e.json",
        json!({
            "id": "tcp-e2e",
            "name": "TCP 端到端工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 500,
                    "onError": "stop"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 500,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let (actor_stream, mut device_stream) = duplex(4096);
    let stream_slot = Arc::new(Mutex::new(Some(actor_stream)));
    crate::comm::set_tcp_stream_override(Some(Arc::new({
        let stream_slot = stream_slot.clone();
        move |config| {
            assert_eq!(config.host, "127.0.0.1");
            assert_eq!(config.port, 15060);
            let stream = stream_slot
                .lock()
                .expect("tcp stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "tcp override stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "tcp-e2e".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let device_task = tokio::spawn(async move {
        let frame = read_hmip_frame(&mut device_stream).await;
        assert_eq!(frame.header.msg_type, 16);
        assert_eq!(frame.header.channel, 1);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x01, 0x01]);

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 32,
            timestamp_ms: 1234,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 1,
            seq: 700,
            payload: &event_payload,
        });
        write_hmip_frame(&mut device_stream, &event_frame).await;

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 99,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 1,
                seq: 701,
                payload: &response_payload,
            });
        write_hmip_frame(&mut device_stream, &response_frame).await;
    });

    let snapshot = wait_for_terminal_status(&manager).await;
    device_task.await.unwrap();

    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.recipe_steps[1].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(3))
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-tcp")
        .await
        .unwrap();
}

#[tokio::test]
async fn runtime_should_recover_on_second_run_after_fake_tcp_connect_failure() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = CommOverrideReset;

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                "msgType": 24,
                "payloadHex": "0a0b"
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
        "projects/project-a/connections/main_tcp_recovery.json",
        json!({
            "id": "main-tcp-recovery",
            "name": "主控 TCP 恢复",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15063,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp-recovery",
                "channel": 3
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running_tcp_recovery.json",
        json!({
            "id": "tcp-running-recovery",
            "name": "TCP 恢复运行反馈",
            "match": {
                "connectionId": "main-tcp-recovery",
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
        "projects/project-a/recipes/tcp-recovery.json",
        json!({
            "id": "tcp-recovery",
            "name": "TCP 失败恢复工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
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
    let (actor_stream, mut device_stream) = duplex(4096);
    let call_count = Arc::new(Mutex::new(0usize));
    let stream_slot = Arc::new(Mutex::new(Some(actor_stream)));
    crate::comm::set_tcp_stream_override(Some(Arc::new({
        let call_count = call_count.clone();
        let stream_slot = stream_slot.clone();
        move |config| {
            assert_eq!(config.host, "127.0.0.1");
            assert_eq!(config.port, 15063);

            let mut call_count = call_count
                .lock()
                .expect("tcp recovery call count mutex poisoned");
            *call_count += 1;
            if *call_count == 1 {
                return Err("simulated tcp connect failure".to_string());
            }

            let stream = stream_slot
                .lock()
                .expect("tcp recovery stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "tcp recovery stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "tcp-recovery".to_string(),
        )
        .await
        .unwrap();

    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();
    let first_snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(first_snapshot.status, RecipeRuntimeStatus::Failed);
    assert_eq!(
        first_snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        first_snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("dispatch_connect_failed")
    );
    assert!(first_snapshot
        .last_error
        .as_ref()
        .is_some_and(|failure| failure.message.contains("simulated tcp connect failure")));

    let device_task = tokio::spawn(async move {
        let frame = read_hmip_frame(&mut device_stream).await;
        assert_eq!(frame.header.msg_type, 24);
        assert_eq!(frame.header.channel, 3);
        assert_eq!(frame.payload.as_ref(), &[0x0a, 0x0b]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 41,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 3,
                seq: 904,
                payload: &response_payload,
            });
        write_hmip_frame(&mut device_stream, &response_frame).await;
    });

    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();
    let second_snapshot = wait_for_terminal_status(&manager).await;
    device_task.await.unwrap();

    assert_eq!(second_snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        second_snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        second_snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        *call_count
            .lock()
            .expect("tcp recovery call count mutex poisoned"),
        2
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-tcp-recovery")
        .await
        .unwrap();
}

#[tokio::test]
async fn runtime_should_run_recipe_over_fake_serial_transport_end_to_end() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = CommOverrideReset;

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                "msgType": 17,
                "payloadHex": "0202"
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
        "projects/project-a/connections/main_serial.json",
        json!({
            "id": "main-serial",
            "name": "主控串口",
            "kind": "serial",
            "serial": {
                "port": "/dev/ttyFAKE0",
                "baudRate": 115200,
                "dataBits": 8,
                "stopBits": 1,
                "parity": "none"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "serial",
                "connectionId": "main-serial",
                "channel": 2
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/chamber_pressure_serial.json",
        json!({
            "id": "serial-pressure-feedback",
            "name": "串口腔压反馈",
            "match": {
                "connectionId": "main-serial",
                "channel": 2,
                "summaryKind": "event",
                "eventId": 48
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 2
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running_serial.json",
        json!({
            "id": "serial-running-feedback",
            "name": "串口运行反馈",
            "match": {
                "connectionId": "main-serial",
                "channel": 2,
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
        "projects/project-a/recipes/serial-e2e.json",
        json!({
            "id": "serial-e2e",
            "name": "串口端到端工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 500,
                    "onError": "stop"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 500,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let (actor_stream, mut device_stream) = duplex(4096);
    let stream_slot = Arc::new(Mutex::new(Some(actor_stream)));
    crate::comm::set_serial_stream_override(Some(Arc::new({
        let stream_slot = stream_slot.clone();
        move |config| {
            assert_eq!(config.port, "/dev/ttyFAKE0");
            assert_eq!(config.baud_rate, 115200);
            let stream = stream_slot
                .lock()
                .expect("serial stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "serial override stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "serial-e2e".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let device_task = tokio::spawn(async move {
        let frame = read_hmip_frame(&mut device_stream).await;
        assert_eq!(frame.header.msg_type, 17);
        assert_eq!(frame.header.channel, 2);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x02, 0x02]);

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 48,
            timestamp_ms: 5678,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 2,
            seq: 800,
            payload: &event_payload,
        });
        write_hmip_frame(&mut device_stream, &event_frame).await;

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 7,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 2,
                seq: 801,
                payload: &response_payload,
            });
        write_hmip_frame(&mut device_stream, &response_frame).await;
    });

    let snapshot = wait_for_terminal_status(&manager).await;
    device_task.await.unwrap();

    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.recipe_steps[1].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(2))
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-serial")
        .await
        .unwrap();
}

#[tokio::test]
async fn runtime_should_recover_on_second_run_after_fake_serial_connect_failure() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = CommOverrideReset;

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                "msgType": 25,
                "payloadHex": "0c0d"
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
        "projects/project-a/connections/main_serial_recovery.json",
        json!({
            "id": "main-serial-recovery",
            "name": "主控串口恢复",
            "kind": "serial",
            "serial": {
                "port": "/dev/ttyFAKE2",
                "baudRate": 115200,
                "dataBits": 8,
                "stopBits": 1,
                "parity": "none"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "serial",
                "connectionId": "main-serial-recovery",
                "channel": 4
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running_serial_recovery.json",
        json!({
            "id": "serial-running-recovery",
            "name": "串口恢复运行反馈",
            "match": {
                "connectionId": "main-serial-recovery",
                "channel": 4,
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
        "projects/project-a/recipes/serial-recovery.json",
        json!({
            "id": "serial-recovery",
            "name": "串口失败恢复工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
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
    let (actor_stream, mut device_stream) = duplex(4096);
    let call_count = Arc::new(Mutex::new(0usize));
    let stream_slot = Arc::new(Mutex::new(Some(actor_stream)));
    crate::comm::set_serial_stream_override(Some(Arc::new({
        let call_count = call_count.clone();
        let stream_slot = stream_slot.clone();
        move |config| {
            assert_eq!(config.port, "/dev/ttyFAKE2");
            assert_eq!(config.baud_rate, 115200);

            let mut call_count = call_count
                .lock()
                .expect("serial recovery call count mutex poisoned");
            *call_count += 1;
            if *call_count == 1 {
                return Err("simulated serial connect failure".to_string());
            }

            let stream = stream_slot
                .lock()
                .expect("serial recovery stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "serial recovery stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "serial-recovery".to_string(),
        )
        .await
        .unwrap();

    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();
    let first_snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(first_snapshot.status, RecipeRuntimeStatus::Failed);
    assert_eq!(
        first_snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Failed
    );
    assert_eq!(
        first_snapshot
            .last_error
            .as_ref()
            .map(|failure| failure.code.as_str()),
        Some("dispatch_connect_failed")
    );
    assert!(first_snapshot
        .last_error
        .as_ref()
        .is_some_and(|failure| failure.message.contains("simulated serial connect failure")));

    let device_task = tokio::spawn(async move {
        let frame = read_hmip_frame(&mut device_stream).await;
        assert_eq!(frame.header.msg_type, 25);
        assert_eq!(frame.header.channel, 4);
        assert_eq!(frame.payload.as_ref(), &[0x0c, 0x0d]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 42,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 4,
                seq: 905,
                payload: &response_payload,
            });
        write_hmip_frame(&mut device_stream, &response_frame).await;
    });

    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();
    let second_snapshot = wait_for_terminal_status(&manager).await;
    device_task.await.unwrap();

    assert_eq!(second_snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        second_snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        second_snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        *call_count
            .lock()
            .expect("serial recovery call count mutex poisoned"),
        2
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-serial-recovery")
        .await
        .unwrap();
}

#[tokio::test]
async fn runtime_should_run_recipe_over_fake_multi_transport_multi_device_end_to_end() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");
    let _override_reset = CommOverrideReset;

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
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
                "msgType": 20,
                "payloadHex": "0505"
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
        "projects/project-a/connections/main_tcp_multi.json",
        json!({
            "id": "main-tcp-multi",
            "name": "多设备 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15062,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/connections/main_serial_multi.json",
        json!({
            "id": "main-serial-multi",
            "name": "多设备串口",
            "kind": "serial",
            "serial": {
                "port": "/dev/ttyFAKE1",
                "baudRate": 115200,
                "dataBits": 8,
                "stopBits": 1,
                "parity": "none"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "TCP 前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp-multi",
                "channel": 5
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_02.json",
        json!({
            "id": "pump_02",
            "name": "串口前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "serial",
                "connectionId": "main-serial-multi",
                "channel": 6
            },
            "tags": {
                "running": "device.pump_02.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/foreline_pressure.json",
        json!({
            "id": "foreline_pressure",
            "name": "前级压力",
            "dataType": "number",
            "source": "signal.foreline_pressure",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/tcp_running_multi.json",
        json!({
            "id": "tcp-running-feedback-multi",
            "name": "TCP 运行反馈",
            "match": {
                "connectionId": "main-tcp-multi",
                "channel": 5,
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
        "projects/project-a/feedback-mappings/serial_running_multi.json",
        json!({
            "id": "serial-running-feedback-multi",
            "name": "串口运行反馈",
            "match": {
                "connectionId": "main-serial-multi",
                "channel": 6,
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
        "projects/project-a/feedback-mappings/tcp_pressure_multi.json",
        json!({
            "id": "tcp-pressure-feedback-multi",
            "name": "TCP 腔压反馈",
            "match": {
                "connectionId": "main-tcp-multi",
                "channel": 5,
                "summaryKind": "event",
                "eventId": 96
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 3
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/serial_pressure_multi.json",
        json!({
            "id": "serial-pressure-feedback-multi",
            "name": "串口前级压力反馈",
            "match": {
                "connectionId": "main-serial-multi",
                "channel": 6,
                "summaryKind": "event",
                "eventId": 97
            },
            "target": {
                "signalId": "foreline_pressure",
                "value": 2
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/multi-transport-e2e.json",
        json!({
            "id": "multi-transport-e2e",
            "name": "多设备多通信工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "启动 TCP 前级泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "启动串口前级泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_02",
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S030",
                    "seq": 30,
                    "name": "等待 TCP 腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S040",
                    "seq": 40,
                    "name": "等待串口前级压力到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "foreline_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);

    let (tcp_actor_stream, mut tcp_device_stream) = duplex(4096);
    let tcp_stream_slot = Arc::new(Mutex::new(Some(tcp_actor_stream)));
    crate::comm::set_tcp_stream_override(Some(Arc::new({
        let tcp_stream_slot = tcp_stream_slot.clone();
        move |config| {
            assert_eq!(config.host, "127.0.0.1");
            assert_eq!(config.port, 15062);
            let stream = tcp_stream_slot
                .lock()
                .expect("tcp stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "tcp override stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));

    let (serial_actor_stream, mut serial_device_stream) = duplex(4096);
    let serial_stream_slot = Arc::new(Mutex::new(Some(serial_actor_stream)));
    crate::comm::set_serial_stream_override(Some(Arc::new({
        let serial_stream_slot = serial_stream_slot.clone();
        move |config| {
            assert_eq!(config.port, "/dev/ttyFAKE1");
            assert_eq!(config.baud_rate, 115200);
            let stream = serial_stream_slot
                .lock()
                .expect("serial stream slot mutex poisoned")
                .take()
                .ok_or_else(|| "serial override stream already consumed".to_string())?;
            Ok(Box::new(stream))
        }
    })));

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "multi-transport-e2e".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let tcp_task = tokio::spawn(async move {
        let frame = read_hmip_frame(&mut tcp_device_stream).await;
        assert_eq!(frame.header.msg_type, 20);
        assert_eq!(frame.header.channel, 5);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x05, 0x05]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 21,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 5,
                seq: 1001,
                payload: &response_payload,
            });
        write_hmip_frame(&mut tcp_device_stream, &response_frame).await;

        tokio::time::sleep(Duration::from_millis(150)).await;

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 96,
            timestamp_ms: 6001,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 5,
            seq: 1002,
            payload: &event_payload,
        });
        write_hmip_frame(&mut tcp_device_stream, &event_frame).await;
    });

    let serial_task = tokio::spawn(async move {
        let frame = read_hmip_frame(&mut serial_device_stream).await;
        assert_eq!(frame.header.msg_type, 20);
        assert_eq!(frame.header.channel, 6);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x05, 0x05]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 22,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 6,
                seq: 1101,
                payload: &response_payload,
            });
        write_hmip_frame(&mut serial_device_stream, &response_frame).await;

        tokio::time::sleep(Duration::from_millis(260)).await;

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 97,
            timestamp_ms: 6002,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 6,
            seq: 1102,
            payload: &event_payload,
        });
        write_hmip_frame(&mut serial_device_stream, &event_frame).await;
    });

    let snapshot = wait_for_terminal_status(&manager).await;
    tcp_task.await.unwrap();
    serial_task.await.unwrap();

    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(snapshot.recipe_steps.len(), 4);
    assert!(snapshot
        .recipe_steps
        .iter()
        .all(|step| step.status == RecipeRuntimeStepStatus::Completed));
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_02.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(3))
    );
    assert_eq!(
        snapshot.signal_values.get("foreline_pressure"),
        Some(&json!(2))
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-tcp-multi")
        .await
        .unwrap();
    crate::comm::disconnect_connection(&comm_state, "main-serial-multi")
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires local tcp host resources"]
async fn runtime_should_run_recipe_over_real_tcp_transport_end_to_end() {
    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind tcp listener");
    let port = listener
        .local_addr()
        .expect("failed to read tcp listener local address")
        .port();

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
                "msgType": 18,
                "payloadHex": "0303"
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
        "projects/project-a/connections/main_tcp_real.json",
        json!({
            "id": "main-tcp-real",
            "name": "真实 TCP 主控",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": port,
                "timeoutMs": 500
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp-real",
                "channel": 3
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/chamber_pressure_real_tcp.json",
        json!({
            "id": "real-tcp-pressure-feedback",
            "name": "真实 TCP 腔压反馈",
            "match": {
                "connectionId": "main-tcp-real",
                "channel": 3,
                "summaryKind": "event",
                "eventId": 64
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 4
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running_real_tcp.json",
        json!({
            "id": "real-tcp-running-feedback",
            "name": "真实 TCP 运行反馈",
            "match": {
                "connectionId": "main-tcp-real",
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
        "projects/project-a/recipes/real-tcp-e2e.json",
        json!({
            "id": "real-tcp-e2e",
            "name": "真实 TCP 端到端工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let device_task = tokio::spawn(async move {
        let (mut device_stream, _) =
            tokio::time::timeout(Duration::from_secs(3), listener.accept())
                .await
                .expect("timed out while waiting for runtime tcp connection")
                .expect("failed to accept runtime tcp connection");

        let frame = read_hmip_frame(&mut device_stream).await;
        assert_eq!(frame.header.msg_type, 18);
        assert_eq!(frame.header.channel, 3);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x03, 0x03]);

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 64,
            timestamp_ms: 2468,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 3,
            seq: 900,
            payload: &event_payload,
        });
        write_hmip_frame(&mut device_stream, &event_frame).await;

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 11,
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
    });

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "real-tcp-e2e".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    device_task.await.unwrap();

    assert_eq!(
        snapshot.status,
        RecipeRuntimeStatus::Completed,
        "runtime did not complete over real tcp: last_error={:?}, last_message={:?}, active_step_id={:?}",
        snapshot.last_error,
        snapshot.last_message,
        snapshot.active_step_id
    );
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.recipe_steps[1].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(4))
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-tcp-real")
        .await
        .unwrap();
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires local tty host resources"]
async fn runtime_should_run_recipe_over_real_serial_transport_end_to_end() {
    use serialport::SerialPort;

    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);

    let (master_port, mut slave_port) =
        serialport::TTYPort::pair().expect("failed to create pseudo terminal pair");
    slave_port
        .set_exclusive(false)
        .expect("failed to disable slave pty exclusive lock");
    let slave_path = slave_port
        .name()
        .expect("pseudo terminal slave path should exist");
    drop(slave_port);

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
                "msgType": 19,
                "payloadHex": "0404"
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
        "projects/project-a/connections/main_serial_real.json",
        json!({
            "id": "main-serial-real",
            "name": "真实串口主控",
            "kind": "serial",
            "serial": {
                "port": slave_path,
                "baudRate": 115200,
                "dataBits": 8,
                "stopBits": 1,
                "parity": "none"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "serial",
                "connectionId": "main-serial-real",
                "channel": 4
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/chamber_pressure_real_serial.json",
        json!({
            "id": "real-serial-pressure-feedback",
            "name": "真实串口腔压反馈",
            "match": {
                "connectionId": "main-serial-real",
                "channel": 4,
                "summaryKind": "event",
                "eventId": 80
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 1
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running_real_serial.json",
        json!({
            "id": "real-serial-running-feedback",
            "name": "真实串口运行反馈",
            "match": {
                "connectionId": "main-serial-real",
                "channel": 4,
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
        "projects/project-a/recipes/real-serial-e2e.json",
        json!({
            "id": "real-serial-e2e",
            "name": "真实串口端到端工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let comm_events = Arc::new(Mutex::new(Vec::<String>::new()));
    let hmip_events = Arc::new(Mutex::new(Vec::<String>::new()));
    let runtime_events = Arc::new(Mutex::new(Vec::<String>::new()));
    let comm_listener = app.listen_any("comm-event", {
        let comm_events = comm_events.clone();
        move |event| {
            comm_events
                .lock()
                .expect("comm event collector mutex poisoned")
                .push(event.payload().to_string());
        }
    });
    let hmip_listener = app.listen_any("hmip-event", {
        let hmip_events = hmip_events.clone();
        move |event| {
            hmip_events
                .lock()
                .expect("hmip event collector mutex poisoned")
                .push(event.payload().to_string());
        }
    });
    let runtime_listener = app.listen_any(super::manager::RECIPE_RUNTIME_EVENT_NAME, {
        let runtime_events = runtime_events.clone();
        move |event| {
            runtime_events
                .lock()
                .expect("runtime event collector mutex poisoned")
                .push(event.payload().to_string());
        }
    });
    let device_task = tokio::task::spawn_blocking(move || {
        let mut device_stream = master_port;
        device_stream
            .set_timeout(Duration::from_millis(200))
            .expect("failed to set master pty timeout");

        let frame = read_hmip_frame_blocking(&mut device_stream);
        assert_eq!(frame.header.msg_type, 19);
        assert_eq!(frame.header.channel, 4);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x04, 0x04]);

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 80,
            timestamp_ms: 9753,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 4,
            seq: 950,
            payload: &event_payload,
        });
        write_hmip_frame_blocking(&mut device_stream, &event_frame);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 12,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 4,
                seq: 951,
                payload: &response_payload,
            });
        write_hmip_frame_blocking(&mut device_stream, &response_frame);
        std::thread::sleep(Duration::from_millis(300));
    });

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "real-serial-e2e".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    device_task.await.unwrap();
    app.unlisten(comm_listener);
    app.unlisten(hmip_listener);
    app.unlisten(runtime_listener);
    let comm_events = comm_events
        .lock()
        .expect("comm event collector mutex poisoned")
        .clone();
    let hmip_events = hmip_events
        .lock()
        .expect("hmip event collector mutex poisoned")
        .clone();
    let runtime_events = runtime_events
        .lock()
        .expect("runtime event collector mutex poisoned")
        .clone();

    assert_eq!(
        snapshot.status,
        RecipeRuntimeStatus::Completed,
        "runtime did not complete over real serial: last_error={:?}, last_message={:?}, active_step_id={:?}, comm_events={:?}, hmip_events={:?}, runtime_events={:?}",
        snapshot.last_error,
        snapshot.last_message,
        snapshot.active_step_id,
        comm_events,
        hmip_events,
        runtime_events
    );
    assert_eq!(
        snapshot.recipe_steps[0].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.recipe_steps[1].status,
        RecipeRuntimeStepStatus::Completed
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(1))
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-serial-real")
        .await
        .unwrap();
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires local tcp + tty host resources"]
async fn runtime_should_run_recipe_over_real_multi_transport_multi_device_end_to_end() {
    use serialport::SerialPort;

    let _transport_guard = e2e_transport_lock()
        .lock()
        .expect("e2e transport lock poisoned");

    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind tcp listener");
    let tcp_port = listener
        .local_addr()
        .expect("failed to read tcp listener local address")
        .port();

    let (master_port, mut slave_port) =
        serialport::TTYPort::pair().expect("failed to create pseudo terminal pair");
    slave_port
        .set_exclusive(false)
        .expect("failed to disable slave pty exclusive lock");
    let slave_path = slave_port
        .name()
        .expect("pseudo terminal slave path should exist");
    drop(slave_port);

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
                "msgType": 20,
                "payloadHex": "0505"
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
        "projects/project-a/connections/main_tcp_real_multi.json",
        json!({
            "id": "main-tcp-real-multi",
            "name": "真实 TCP 多设备主控",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": tcp_port,
                "timeoutMs": 500
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/connections/main_serial_real_multi.json",
        json!({
            "id": "main-serial-real-multi",
            "name": "真实串口多设备主控",
            "kind": "serial",
            "serial": {
                "port": slave_path,
                "baudRate": 115200,
                "dataBits": 8,
                "stopBits": 1,
                "parity": "none"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "TCP 前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "connectionId": "main-tcp-real-multi",
                "channel": 7
            },
            "tags": {
                "running": "device.pump_01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/pump_02.json",
        json!({
            "id": "pump_02",
            "name": "串口前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "serial",
                "connectionId": "main-serial-real-multi",
                "channel": 8
            },
            "tags": {
                "running": "device.pump_02.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/foreline_pressure.json",
        json!({
            "id": "foreline_pressure",
            "name": "前级压力",
            "dataType": "number",
            "source": "signal.foreline_pressure",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/tcp_running_real_multi.json",
        json!({
            "id": "real-multi-tcp-running-feedback",
            "name": "真实多通信 TCP 运行反馈",
            "match": {
                "connectionId": "main-tcp-real-multi",
                "channel": 7,
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
        "projects/project-a/feedback-mappings/serial_running_real_multi.json",
        json!({
            "id": "real-multi-serial-running-feedback",
            "name": "真实多通信串口运行反馈",
            "match": {
                "connectionId": "main-serial-real-multi",
                "channel": 8,
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
        "projects/project-a/feedback-mappings/tcp_pressure_real_multi.json",
        json!({
            "id": "real-multi-tcp-pressure-feedback",
            "name": "真实多通信 TCP 腔压反馈",
            "match": {
                "connectionId": "main-tcp-real-multi",
                "channel": 7,
                "summaryKind": "event",
                "eventId": 96
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 3
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/serial_pressure_real_multi.json",
        json!({
            "id": "real-multi-serial-pressure-feedback",
            "name": "真实多通信串口前级压力反馈",
            "match": {
                "connectionId": "main-serial-real-multi",
                "channel": 8,
                "summaryKind": "event",
                "eventId": 97
            },
            "target": {
                "signalId": "foreline_pressure",
                "value": 2
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/real-multi-transport-e2e.json",
        json!({
            "id": "real-multi-transport-e2e",
            "name": "真实多设备多通信工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "启动 TCP 前级泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "启动串口前级泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_02",
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S030",
                    "seq": 30,
                    "name": "等待 TCP 腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                },
                {
                    "id": "S040",
                    "seq": 40,
                    "name": "等待串口前级压力到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "foreline_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                }
            ]
        }),
    );

    let manager = RecipeRuntimeManager::default();
    let app = setup_runtime_app(&manager);
    let comm_events = Arc::new(Mutex::new(Vec::<String>::new()));
    let hmip_events = Arc::new(Mutex::new(Vec::<String>::new()));
    let runtime_events = Arc::new(Mutex::new(Vec::<String>::new()));
    let comm_listener = app.listen_any("comm-event", {
        let comm_events = comm_events.clone();
        move |event| {
            comm_events
                .lock()
                .expect("comm event collector mutex poisoned")
                .push(event.payload().to_string());
        }
    });
    let hmip_listener = app.listen_any("hmip-event", {
        let hmip_events = hmip_events.clone();
        move |event| {
            hmip_events
                .lock()
                .expect("hmip event collector mutex poisoned")
                .push(event.payload().to_string());
        }
    });
    let runtime_listener = app.listen_any(super::manager::RECIPE_RUNTIME_EVENT_NAME, {
        let runtime_events = runtime_events.clone();
        move |event| {
            runtime_events
                .lock()
                .expect("runtime event collector mutex poisoned")
                .push(event.payload().to_string());
        }
    });

    let tcp_task = tokio::spawn(async move {
        let (mut device_stream, _) =
            tokio::time::timeout(Duration::from_secs(3), listener.accept())
                .await
                .expect("timed out while waiting for runtime tcp connection")
                .expect("failed to accept runtime tcp connection");

        let frame = read_hmip_frame(&mut device_stream).await;
        assert_eq!(frame.header.msg_type, 20);
        assert_eq!(frame.header.channel, 7);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x05, 0x05]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 31,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 7,
                seq: 1201,
                payload: &response_payload,
            });
        write_hmip_frame(&mut device_stream, &response_frame).await;

        tokio::time::sleep(Duration::from_millis(150)).await;

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 96,
            timestamp_ms: 7001,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 7,
            seq: 1202,
            payload: &event_payload,
        });
        write_hmip_frame(&mut device_stream, &event_frame).await;
    });

    let serial_task = tokio::task::spawn_blocking(move || {
        let mut device_stream = master_port;
        device_stream
            .set_timeout(Duration::from_millis(500))
            .expect("failed to set master pty timeout");

        let frame = read_hmip_frame_blocking(&mut device_stream);
        assert_eq!(frame.header.msg_type, 20);
        assert_eq!(frame.header.channel, 8);
        assert!(frame.header.seq > 0);
        assert_eq!(frame.payload.as_ref(), &[0x05, 0x05]);

        let response_payload = crate::comm::proto::encode_response(&crate::comm::proto::Response {
            request_id: 32,
            status: 0,
            body: Bytes::new(),
        });
        let response_frame =
            crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 8,
                seq: 1301,
                payload: &response_payload,
            });
        write_hmip_frame_blocking(&mut device_stream, &response_frame);

        std::thread::sleep(Duration::from_millis(260));

        let event_payload = crate::comm::proto::encode_event(&crate::comm::proto::Event {
            event_id: 97,
            timestamp_ms: 7002,
            body: Bytes::new(),
        });
        let event_frame = crate::comm::proto::encode_frame(crate::comm::proto::EncodeFrameParams {
            msg_type: crate::comm::proto::msg_type::EVENT,
            flags: 0,
            channel: 8,
            seq: 1302,
            payload: &event_payload,
        });
        write_hmip_frame_blocking(&mut device_stream, &event_frame);

        std::thread::sleep(Duration::from_millis(300));
    });

    manager
        .load_recipe(
            None,
            workspace.path().to_string_lossy().to_string(),
            "project-a".to_string(),
            "real-multi-transport-e2e".to_string(),
        )
        .await
        .unwrap();
    manager
        .start_with_app(Some(app.handle().clone()))
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    tcp_task.await.unwrap();
    serial_task.await.unwrap();
    app.unlisten(comm_listener);
    app.unlisten(hmip_listener);
    app.unlisten(runtime_listener);
    let comm_events = comm_events
        .lock()
        .expect("comm event collector mutex poisoned")
        .clone();
    let hmip_events = hmip_events
        .lock()
        .expect("hmip event collector mutex poisoned")
        .clone();
    let runtime_events = runtime_events
        .lock()
        .expect("runtime event collector mutex poisoned")
        .clone();

    assert_eq!(
        snapshot.status,
        RecipeRuntimeStatus::Completed,
        "runtime did not complete over real multi transport: last_error={:?}, last_message={:?}, active_step_id={:?}, comm_events={:?}, hmip_events={:?}, runtime_events={:?}",
        snapshot.last_error,
        snapshot.last_message,
        snapshot.active_step_id,
        comm_events,
        hmip_events,
        runtime_events
    );
    assert_eq!(snapshot.recipe_steps.len(), 4);
    assert!(snapshot
        .recipe_steps
        .iter()
        .all(|step| step.status == RecipeRuntimeStepStatus::Completed));
    assert_eq!(
        snapshot.runtime_values.get("device.pump_01.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.runtime_values.get("device.pump_02.running"),
        Some(&json!(true))
    );
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(3))
    );
    assert_eq!(
        snapshot.signal_values.get("foreline_pressure"),
        Some(&json!(2))
    );

    let comm_state = app.state::<crate::comm::CommState>();
    crate::comm::disconnect_connection(&comm_state, "main-tcp-real-multi")
        .await
        .unwrap();
    crate::comm::disconnect_connection(&comm_state, "main-serial-real-multi")
        .await
        .unwrap();
}

#[tokio::test]
async fn runtime_should_complete_wait_step_from_hmip_feedback_mapping() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/connections/main_tcp.json",
        json!({
            "id": "main-tcp",
            "name": "主控 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15030,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/chamber_pressure.json",
        json!({
            "id": "chamber-pressure-feedback",
            "name": "腔压反馈",
            "match": {
                "connectionId": "main-tcp",
                "channel": 1,
                "summaryKind": "event",
                "eventId": 32
            },
            "target": {
                "signalId": "chamber_pressure",
                "value": 3
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/wait-door.json",
        json!({
            "id": "wait-door",
            "name": "等待门关闭",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待腔压到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "operator": "lt",
                        "value": 5
                    },
                    "timeoutMs": 500,
                    "onError": "stop"
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
            "wait-door".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    tokio::time::sleep(Duration::from_millis(40)).await;
    let message = crate::comm::proto::Message::Event(crate::comm::proto::Event {
        event_id: 32,
        timestamp_ms: 1234,
        body: Bytes::new(),
    });
    manager
        .apply_hmip_feedback(
            None,
            "main-tcp",
            crate::comm::proto::FrameHeader {
                msg_type: crate::comm::proto::msg_type::EVENT,
                flags: 0,
                channel: 1,
                seq: 7,
                payload_len: 0,
                payload_crc32: None,
            },
            Some(&message),
            &[],
        )
        .await
        .unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
    assert_eq!(snapshot.status, RecipeRuntimeStatus::Completed);
    assert_eq!(
        snapshot.signal_values.get("chamber_pressure"),
        Some(&json!(3))
    );
}

#[tokio::test]
async fn runtime_should_complete_device_step_from_hmip_feedback_mapping() {
    let workspace = TestWorkspace::new();
    write_system_bundle(&workspace);
    write_project_base(&workspace);
    workspace.write_json(
        "projects/project-a/connections/main_tcp.json",
        json!({
            "id": "main-tcp",
            "name": "主控 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 15031,
                "timeoutMs": 200
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/feedback-mappings/pump_running.json",
        json!({
            "id": "pump-running-feedback",
            "name": "前级泵运行反馈",
            "match": {
                "connectionId": "main-tcp",
                "channel": 1,
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
        "projects/project-a/recipes/pump-start-mapped.json",
        json!({
            "id": "pump-start-mapped",
            "name": "开泵映射工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "开泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "timeoutMs": 500,
                    "onError": "stop"
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
            "pump-start-mapped".to_string(),
        )
        .await
        .unwrap();
    manager.start(None).await.unwrap();

    tokio::time::sleep(Duration::from_millis(40)).await;
    let message = crate::comm::proto::Message::Response(crate::comm::proto::Response {
        request_id: 99,
        status: 0,
        body: Bytes::new(),
    });
    manager
        .apply_hmip_feedback(
            None,
            "main-tcp",
            crate::comm::proto::FrameHeader {
                msg_type: crate::comm::proto::msg_type::RESPONSE,
                flags: 0,
                channel: 1,
                seq: 9,
                payload_len: 0,
                payload_crc32: None,
            },
            Some(&message),
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
