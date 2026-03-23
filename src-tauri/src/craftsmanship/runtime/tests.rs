use super::manager::RecipeRuntimeManager;
use super::types::{RecipeRuntimePhase, RecipeRuntimeStatus, RecipeRuntimeStepStatus};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "transport": {
                "kind": "tcp",
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
                "rootDir": gpio_root.to_string_lossy().to_string()
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
    manager.start(None).await.unwrap();

    let snapshot = wait_for_terminal_status(&manager).await;
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
