use super::*;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

struct TestWorkspace {
    root: PathBuf,
}

impl TestWorkspace {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("hmi-craftsmanship-{unique}-{}", std::process::id()));
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

fn write_minimal_system(workspace: &TestWorkspace) {
    workspace.write_json(
        "system/actions/pump.start.json",
        json!({
            "id": "pump.start",
            "name": "开泵",
            "category": "pump",
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
            "allowedActions": ["pump.start"]
        }),
    );
}

fn write_project_definition(workspace: &TestWorkspace, directory_name: &str, project_id: &str) {
    workspace.write_json(
        &format!("projects/{directory_name}/project.json"),
        json!({
            "id": project_id,
            "name": format!("项目 {project_id}"),
            "enabled": true
        }),
    );
}

fn has_diagnostic(diagnostics: &[CraftsmanshipDiagnostic], code: &str) -> bool {
    diagnostics.iter().any(|diagnostic| diagnostic.code == code)
}

fn count_diagnostic(diagnostics: &[CraftsmanshipDiagnostic], code: &str) -> usize {
    diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == code)
        .count()
}

fn build_workspace_fixture() -> TestWorkspace {
    let workspace = TestWorkspace::new();

    write_minimal_system(&workspace);
    workspace.write_json(
        "system/actions/pump.start.json",
        json!({
            "id": "pump.start",
            "name": "开泵",
            "category": "pump",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "parameters": [],
            "summaryTemplate": "{device.name} 开泵"
        }),
    );
    workspace.write_json(
        "system/actions/common.wait-signal.json",
        json!({
            "id": "common.wait-signal",
            "name": "等待信号",
            "category": "common",
            "targetMode": "none",
            "parameters": [
                {
                    "key": "signalId",
                    "name": "信号",
                    "type": "string",
                    "required": true
                },
                {
                    "key": "value",
                    "name": "目标值",
                    "type": "number",
                    "required": true
                }
            ]
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["pump.start"],
            "group": "vacuum"
        }),
    );
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/project.json",
        json!({
            "id": "project-a",
            "name": "项目A",
            "description": "刻蚀设备A线",
            "version": "1.0",
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
                "start": "device.pump01.start",
                "running": "device.pump01.running"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/chamber_pressure.json",
        json!({
            "id": "chamber_pressure",
            "name": "腔体压力",
            "dataType": "number",
            "unit": "Pa",
            "source": "signal.chamber.pressure",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/safety/interlocks.json",
        json!({
            "rules": [
                {
                    "id": "door-must-close-before-pump-start",
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
        "projects/project-a/safety/safe-stop.json",
        json!({
            "id": "safe-stop",
            "name": "安全停机",
            "steps": [
                {
                    "seq": 20,
                    "actionId": "pump.start",
                    "deviceId": "pump_01"
                },
                {
                    "seq": 10,
                    "actionId": "pump.start",
                    "deviceId": "pump_01"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/pumpdown.json",
        json!({
            "id": "pumpdown",
            "name": "抽真空",
            "description": "标准抽真空工艺",
            "steps": [
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "等待压力到位",
                    "actionId": "common.wait-signal",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "value": 1000
                    },
                    "timeoutMs": 30000,
                    "onError": "stop"
                },
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "启动前级泵",
                    "actionId": "pump.start",
                    "deviceId": "pump_01",
                    "parameters": {},
                    "timeoutMs": 5000,
                    "onError": "safe-stop"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/broken.json",
        json!({
            "id": "broken",
            "name": "错误工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "错误步骤",
                    "actionId": "pump.start",
                    "parameters": {
                        "unexpected": 1
                    },
                    "timeoutMs": 1000,
                    "onError": "stop"
                }
            ]
        }),
    );

    workspace
}

#[test]
fn scan_workspace_should_load_system_and_project_summaries() {
    let workspace = build_workspace_fixture();
    let summary = scan_workspace(workspace.path().to_str().unwrap()).unwrap();

    assert_eq!(summary.projects.len(), 1);
    assert_eq!(summary.system.actions.len(), 2);
    assert_eq!(summary.system.device_types.len(), 1);
    assert!(summary
        .projects
        .iter()
        .any(|project| project.id == "project-a"));
}

#[test]
fn scan_workspace_should_collect_system_level_diagnostics() {
    let workspace = TestWorkspace::new();
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "system/actions/missing-target.json",
        json!({
            "id": "pump.stop",
            "name": "停泵",
            "targetMode": "required",
            "allowedDeviceTypes": []
        }),
    );
    workspace.write_json(
        "system/actions/unknown-type.json",
        json!({
            "id": "valve.open",
            "name": "开阀",
            "targetMode": "required",
            "allowedDeviceTypes": ["valve"]
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["missing.action"]
        }),
    );

    let summary = scan_workspace(workspace.path().to_str().unwrap()).unwrap();

    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_missing_allowed_device_types"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_unknown_device_type"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "device_type_unknown_action"
    ));
}

#[test]
fn scan_workspace_should_collect_action_schema_diagnostics() {
    let workspace = TestWorkspace::new();
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "system/actions/broken-completion.json",
        json!({
            "id": "common.configure",
            "name": "配置",
            "targetMode": "optional",
            "parameters": [
                {
                    "key": "level",
                    "name": "级别",
                    "type": "number",
                    "min": 10,
                    "max": 0
                },
                {
                    "key": "mode",
                    "name": "模式",
                    "type": "enum",
                    "options": []
                },
                {
                    "key": "payload",
                    "name": "载荷",
                    "type": "object"
                }
            ],
            "completion": {
                "type": "signalCompare",
                "operator": "between"
            }
        }),
    );
    workspace.write_json(
        "system/actions/broken-feedback.json",
        json!({
            "id": "pump.feedback",
            "name": "检查反馈",
            "targetMode": "required",
            "allowedDeviceTypes": ["pump"],
            "completion": {
                "type": "deviceFeedback"
            }
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["pump.feedback"]
        }),
    );

    let summary = scan_workspace(workspace.path().to_str().unwrap()).unwrap();

    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_invalid_target_mode"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_parameter_invalid_range"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_enum_parameter_missing_options"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_invalid_parameter_type"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_missing_completion_signal"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_invalid_completion_operator"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_missing_completion_value"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_missing_completion_key"
    ));
    assert!(has_diagnostic(
        &summary.diagnostics,
        "action_missing_completion_operator"
    ));
}

#[test]
fn get_project_bundle_should_sort_steps_and_collect_diagnostics() {
    let workspace = build_workspace_fixture();
    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert_eq!(bundle.recipes.len(), 2);
    let safe_stop = bundle.safe_stop.as_ref().unwrap();
    assert_eq!(safe_stop.steps[0].seq, 10);
    assert_eq!(safe_stop.steps[1].seq, 20);

    let pumpdown = bundle
        .recipes
        .iter()
        .find(|recipe| recipe.id == "pumpdown")
        .unwrap();
    assert_eq!(pumpdown.steps[0].id, "S010");
    assert_eq!(pumpdown.steps[1].id, "S020");

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "interlock_unknown_signal"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "missing_required_device"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "recipe_unknown_parameter"
    ));
}

#[test]
fn get_recipe_bundle_should_return_related_actions_only() {
    let workspace = build_workspace_fixture();
    let bundle =
        get_recipe_bundle(workspace.path().to_str().unwrap(), "project-a", "pumpdown").unwrap();

    assert_eq!(bundle.recipe.id, "pumpdown");
    assert_eq!(bundle.related_actions.len(), 2);
    assert!(bundle
        .related_actions
        .iter()
        .any(|action| action.id == "pump.start"));
    assert!(bundle
        .related_actions
        .iter()
        .any(|action| action.id == "common.wait-signal"));
}

#[test]
fn get_project_bundle_should_warn_when_optional_resources_are_missing() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-a");

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(bundle.connections.is_empty());
    assert!(bundle.devices.is_empty());
    assert!(bundle.feedback_mappings.is_empty());
    assert!(bundle.signals.is_empty());
    assert!(bundle.recipes.is_empty());
    assert!(bundle.interlocks.is_none());
    assert!(bundle.safe_stop.is_none());
    assert_eq!(
        count_diagnostic(&bundle.diagnostics, "missing_directory"),
        5
    );
    assert_eq!(count_diagnostic(&bundle.diagnostics, "missing_file"), 2);
}

#[test]
fn get_project_bundle_should_find_project_using_project_json_id() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "renamed-directory", "project-a");

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert_eq!(bundle.project.id, "project-a");
    assert_eq!(bundle.project.name, "项目 project-a");
}

#[test]
fn get_project_bundle_should_load_connections_and_feedback_mappings() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/connections/main_tcp.json",
        json!({
            "id": "main-tcp",
            "name": "主控 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 502,
                "timeoutMs": 1000
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
                "running": "device.pump01.running"
            }
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
        "projects/project-a/feedback-mappings/door_closed.json",
        json!({
            "id": "door-closed-feedback",
            "name": "门关闭反馈",
            "match": {
                "connectionId": "main-tcp",
                "channel": 1,
                "summaryKind": "event",
                "eventId": 32
            },
            "target": {
                "signalId": "door_closed",
                "value": true
            }
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert_eq!(bundle.connections.len(), 1);
    assert_eq!(bundle.feedback_mappings.len(), 1);
    assert_eq!(bundle.connections[0].id, "main-tcp");
    assert_eq!(bundle.feedback_mappings[0].id, "door-closed-feedback");
}

#[test]
fn get_project_bundle_should_accept_hello_ack_feedback_summary_kind() {
    let workspace = TestWorkspace::new();
    write_minimal_system(&workspace);
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/connections/main_tcp.json",
        json!({
            "id": "main-tcp",
            "name": "主控 TCP",
            "kind": "tcp",
            "tcp": {
                "host": "127.0.0.1",
                "port": 502,
                "timeoutMs": 1000
            }
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
        "projects/project-a/feedback-mappings/door_closed.json",
        json!({
            "id": "door-closed-feedback",
            "name": "门关闭反馈",
            "match": {
                "connectionId": "main-tcp",
                "channel": 1,
                "summaryKind": "hello_ack"
            },
            "target": {
                "signalId": "door_closed",
                "value": true
            }
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(!has_diagnostic(
        &bundle.diagnostics,
        "feedback_mapping_invalid_summary_kind"
    ));
}

#[test]
fn get_project_bundle_should_validate_recipe_parameter_schema_constraints() {
    let workspace = TestWorkspace::new();
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "system/actions/common.configure.json",
        json!({
            "id": "common.configure",
            "name": "配置参数",
            "targetMode": "none",
            "parameters": [
                {
                    "key": "count",
                    "name": "次数",
                    "type": "number",
                    "required": true,
                    "min": 0,
                    "max": 10
                },
                {
                    "key": "mode",
                    "name": "模式",
                    "type": "enum",
                    "required": true,
                    "options": ["auto", "manual"]
                },
                {
                    "key": "enabled",
                    "name": "启用",
                    "type": "boolean",
                    "required": true
                },
                {
                    "key": "label",
                    "name": "标签",
                    "type": "string",
                    "required": true
                }
            ]
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": []
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/invalid-parameters.json",
        json!({
            "id": "invalid-parameters",
            "name": "参数错误工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "类型错误",
                    "actionId": "common.configure",
                    "parameters": {
                        "count": "three",
                        "mode": "auto",
                        "enabled": "yes",
                        "label": 42
                    }
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "范围和枚举错误",
                    "actionId": "common.configure",
                    "parameters": {
                        "count": 20,
                        "mode": "invalid",
                        "enabled": true,
                        "label": "valid"
                    }
                }
            ]
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert_eq!(
        count_diagnostic(&bundle.diagnostics, "recipe_parameter_type_mismatch"),
        3
    );
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "recipe_parameter_value_above_max"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "recipe_parameter_option_not_allowed"
    ));
}

#[test]
fn get_project_bundle_should_report_binding_conflicts() {
    let workspace = build_workspace_fixture();
    workspace.write_json(
        "system/actions/valve.open.json",
        json!({
            "id": "valve.open",
            "name": "开阀",
            "targetMode": "required",
            "allowedDeviceTypes": ["valve"],
            "parameters": []
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
        "projects/project-a/recipes/conflicts.json",
        json!({
            "id": "conflicts",
            "name": "冲突工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "不该绑定设备的等待",
                    "actionId": "common.wait-signal",
                    "deviceId": "pump_01",
                    "parameters": {
                        "signalId": "chamber_pressure",
                        "value": 1000
                    }
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "错误设备类型",
                    "actionId": "valve.open",
                    "deviceId": "pump_01",
                    "parameters": {}
                },
                {
                    "id": "S030",
                    "seq": 30,
                    "name": "未知设备",
                    "actionId": "pump.start",
                    "deviceId": "missing_device",
                    "parameters": {}
                }
            ]
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "unexpected_device_binding"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "device_type_not_allowed"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "action_not_allowed_for_device_type"
    ));
    assert!(has_diagnostic(&bundle.diagnostics, "unknown_device"));
}

#[test]
fn get_project_bundle_should_validate_completion_signal_and_interlock_operator() {
    let workspace = TestWorkspace::new();
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "system/actions/common.wait-pressure.json",
        json!({
            "id": "common.wait-pressure",
            "name": "等待压力",
            "targetMode": "none",
            "parameters": [],
            "completion": {
                "type": "signalCompare",
                "signalId": "missing_signal",
                "operator": "lt",
                "value": 100
            }
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": []
        }),
    );
    workspace.write_json(
        "projects/project-a/signals/chamber_pressure.json",
        json!({
            "id": "chamber_pressure",
            "name": "腔体压力",
            "dataType": "number",
            "enabled": true
        }),
    );
    workspace.write_json(
        "projects/project-a/safety/interlocks.json",
        json!({
            "rules": [
                {
                    "id": "invalid-operator",
                    "name": "错误操作符联锁",
                    "actionIds": ["common.wait-pressure"],
                    "condition": {
                        "signalId": "chamber_pressure",
                        "operator": "between",
                        "value": 100
                    },
                    "onViolation": "block"
                }
            ]
        }),
    );
    workspace.write_json(
        "projects/project-a/recipes/wait-pressure.json",
        json!({
            "id": "wait-pressure",
            "name": "等待压力工艺",
            "steps": [
                {
                    "id": "S010",
                    "seq": 10,
                    "name": "等待",
                    "actionId": "common.wait-pressure",
                    "parameters": {}
                }
            ]
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "action_completion_unknown_signal"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "interlock_invalid_operator"
    ));
}

#[test]
fn get_project_bundle_should_validate_device_feedback_completion_key_binding() {
    let workspace = TestWorkspace::new();
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
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["pump.start"]
        }),
    );
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "tags": {
                "start": "device.pump01.start"
            }
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
                    "parameters": {}
                }
            ]
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "device_feedback_key_not_defined"
    ));
}

#[test]
fn get_project_bundle_should_validate_missing_transport_for_dispatched_action() {
    let workspace = TestWorkspace::new();
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
            }
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["pump.start"]
        }),
    );
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/devices/pump_01.json",
        json!({
            "id": "pump_01",
            "name": "前级泵",
            "typeId": "pump",
            "enabled": true,
            "tags": {
                "running": "device.pump01.running"
            }
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
                    "parameters": {}
                }
            ]
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "missing_device_transport"
    ));
}

#[test]
fn get_project_bundle_should_validate_invalid_dispatch_payload_hex() {
    let workspace = TestWorkspace::new();
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
                "payloadHex": "01ZZ"
            }
        }),
    );
    workspace.write_json(
        "system/device-types/pump.json",
        json!({
            "id": "pump",
            "name": "泵",
            "allowedActions": ["pump.start"]
        }),
    );
    write_project_definition(&workspace, "project-a", "project-a");

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "action_invalid_dispatch_payload_hex"
    ));
}

#[test]
fn get_project_bundle_should_validate_gpio_transport_pin_and_dispatch_transport_mismatch() {
    let workspace = TestWorkspace::new();
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
    write_project_definition(&workspace, "project-a", "project-a");
    workspace.write_json(
        "projects/project-a/devices/valve_gpio_missing_pin.json",
        json!({
            "id": "valve_gpio_missing_pin",
            "name": "GPIO 阀",
            "typeId": "valve",
            "enabled": true,
            "transport": {
                "kind": "gpio"
            }
        }),
    );
    workspace.write_json(
        "projects/project-a/devices/valve_tcp_wrong_transport.json",
        json!({
            "id": "valve_tcp_wrong_transport",
            "name": "TCP 阀",
            "typeId": "valve",
            "enabled": true,
            "transport": {
                "kind": "tcp",
                "channel": 1
            }
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
                    "name": "GPIO 缺 pin",
                    "actionId": "valve.open",
                    "deviceId": "valve_gpio_missing_pin",
                    "parameters": {}
                },
                {
                    "id": "S020",
                    "seq": 20,
                    "name": "GPIO 配错 transport",
                    "actionId": "valve.open",
                    "deviceId": "valve_tcp_wrong_transport",
                    "parameters": {}
                }
            ]
        }),
    );

    let bundle = get_project_bundle(workspace.path().to_str().unwrap(), "project-a").unwrap();

    assert!(has_diagnostic(
        &bundle.diagnostics,
        "device_missing_transport_pin"
    ));
    assert!(has_diagnostic(
        &bundle.diagnostics,
        "dispatch_transport_not_supported"
    ));
}

#[test]
fn get_recipe_bundle_should_error_when_recipe_is_missing() {
    let workspace = build_workspace_fixture();
    let error =
        get_recipe_bundle(workspace.path().to_str().unwrap(), "project-a", "missing").unwrap_err();

    assert!(error.contains("recipe `missing` not found"));
}

#[test]
fn scan_workspace_should_error_when_workspace_root_is_empty() {
    let error = scan_workspace("").unwrap_err();

    assert_eq!(error, "workspace_root is empty");
}
