use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CraftsmanshipDiagnostic {
    pub level: String,
    pub code: String,
    pub message: String,
    pub source_path: Option<String>,
    pub entity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionCompletionDefinition {
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub signal_id: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub stable_time_ms: Option<u64>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionDispatchDefinition {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub msg_type: Option<u8>,
    #[serde(default)]
    pub flags: Option<u8>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub payload_mode: Option<String>,
    #[serde(default)]
    pub payload_hex: Option<String>,
    #[serde(default)]
    pub value: Option<bool>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionParameterDefinition {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub parameter_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub min: Option<Value>,
    #[serde(default)]
    pub max: Option<Value>,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub options: Vec<Value>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub target_mode: Option<String>,
    #[serde(default)]
    pub allowed_device_types: Vec<String>,
    #[serde(default)]
    pub parameters: Vec<ActionParameterDefinition>,
    #[serde(default)]
    pub completion: Option<ActionCompletionDefinition>,
    #[serde(default)]
    pub dispatch: Option<ActionDispatchDefinition>,
    #[serde(default)]
    pub summary_template: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTypeDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub allowed_actions: Vec<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TcpConnectionConfigDefinition {
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SerialConnectionConfigDefinition {
    #[serde(default)]
    pub port: Option<String>,
    #[serde(default)]
    pub baud_rate: Option<u32>,
    #[serde(default)]
    pub data_bits: Option<u8>,
    #[serde(default)]
    pub stop_bits: Option<u8>,
    #[serde(default)]
    pub parity: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub tcp: Option<TcpConnectionConfigDefinition>,
    #[serde(default)]
    pub serial: Option<SerialConnectionConfigDefinition>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInstance {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    pub type_id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub transport: Option<DeviceTransportDefinition>,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTransportDefinition {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub channel: Option<u8>,
    #[serde(default)]
    pub pin: Option<u32>,
    #[serde(default)]
    pub active_low: Option<bool>,
    #[serde(default, alias = "rootDir")]
    pub chip_path: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMatchDefinition {
    pub connection_id: String,
    #[serde(default)]
    pub channel: Option<u8>,
    #[serde(default)]
    pub msg_type: Option<u8>,
    #[serde(default)]
    pub summary_kind: Option<String>,
    #[serde(default)]
    pub request_id: Option<u32>,
    #[serde(default)]
    pub status: Option<u16>,
    #[serde(default)]
    pub event_id: Option<u16>,
    #[serde(default)]
    pub error_code: Option<u16>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackTargetDefinition {
    #[serde(default)]
    pub signal_id: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub feedback_key: Option<String>,
    #[serde(default)]
    pub value_from: Option<String>,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMappingDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(rename = "match")]
    pub matcher: FeedbackMatchDefinition,
    pub target: FeedbackTargetDefinition,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SignalDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InterlockCondition {
    #[serde(default)]
    pub signal_id: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub logic: Option<String>,
    #[serde(default)]
    pub items: Vec<InterlockCondition>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InterlockRule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub action_ids: Vec<String>,
    pub condition: InterlockCondition,
    #[serde(default)]
    pub on_violation: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InterlockFile {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    #[serde(default)]
    pub rules: Vec<InterlockRule>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SafeStopDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub steps: Vec<SafeStopStep>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeStep {
    pub id: String,
    pub seq: u32,
    pub name: String,
    pub action_id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub parameters: BTreeMap<String, Value>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub on_error: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeDefinition {
    #[serde(default, skip_deserializing)]
    pub source_path: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub steps: Vec<RecipeStep>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CraftsmanshipSystemBundle {
    #[serde(default)]
    pub actions: Vec<ActionDefinition>,
    #[serde(default)]
    pub device_types: Vec<DeviceTypeDefinition>,
    #[serde(default)]
    pub schemas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CraftsmanshipWorkspaceSummary {
    pub workspace_root: String,
    pub system: CraftsmanshipSystemBundle,
    #[serde(default)]
    pub projects: Vec<ProjectDefinition>,
    #[serde(default)]
    pub diagnostics: Vec<CraftsmanshipDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CraftsmanshipProjectBundle {
    pub workspace_root: String,
    pub system: CraftsmanshipSystemBundle,
    pub project: ProjectDefinition,
    #[serde(default)]
    pub connections: Vec<ConnectionDefinition>,
    #[serde(default)]
    pub devices: Vec<DeviceInstance>,
    #[serde(default)]
    pub feedback_mappings: Vec<FeedbackMappingDefinition>,
    #[serde(default)]
    pub signals: Vec<SignalDefinition>,
    #[serde(default)]
    pub interlocks: Option<InterlockFile>,
    #[serde(default)]
    pub safe_stop: Option<SafeStopDefinition>,
    #[serde(default)]
    pub recipes: Vec<RecipeDefinition>,
    #[serde(default)]
    pub diagnostics: Vec<CraftsmanshipDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CraftsmanshipRecipeBundle {
    pub workspace_root: String,
    pub system: CraftsmanshipSystemBundle,
    pub project: ProjectDefinition,
    #[serde(default)]
    pub connections: Vec<ConnectionDefinition>,
    #[serde(default)]
    pub devices: Vec<DeviceInstance>,
    #[serde(default)]
    pub feedback_mappings: Vec<FeedbackMappingDefinition>,
    #[serde(default)]
    pub signals: Vec<SignalDefinition>,
    #[serde(default)]
    pub interlocks: Option<InterlockFile>,
    #[serde(default)]
    pub safe_stop: Option<SafeStopDefinition>,
    pub recipe: RecipeDefinition,
    #[serde(default)]
    pub related_actions: Vec<ActionDefinition>,
    #[serde(default)]
    pub diagnostics: Vec<CraftsmanshipDiagnostic>,
}

pub(super) trait HasSourcePath {
    fn set_source_path(&mut self, source_path: String);
}

impl HasSourcePath for ActionDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for DeviceTypeDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for ProjectDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for ConnectionDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for DeviceInstance {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for FeedbackMappingDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for SignalDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for InterlockFile {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for SafeStopDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

impl HasSourcePath for RecipeDefinition {
    fn set_source_path(&mut self, source_path: String) {
        self.source_path = source_path;
    }
}

pub(super) fn diagnostic_error(
    code: &str,
    message: String,
    source_path: Option<String>,
    entity_id: Option<String>,
) -> CraftsmanshipDiagnostic {
    CraftsmanshipDiagnostic {
        level: "error".to_string(),
        code: code.to_string(),
        message,
        source_path,
        entity_id,
    }
}

pub(super) fn diagnostic_warning(
    code: &str,
    message: String,
    source_path: Option<String>,
    entity_id: Option<String>,
) -> CraftsmanshipDiagnostic {
    CraftsmanshipDiagnostic {
        level: "warning".to_string(),
        code: code.to_string(),
        message,
        source_path,
        entity_id,
    }
}

fn default_true() -> bool {
    true
}
