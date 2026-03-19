use crate::craftsmanship::{CraftsmanshipDiagnostic, CraftsmanshipRecipeBundle, SafeStopStep};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RecipeRuntimeStatus {
    #[default]
    Idle,
    Loaded,
    Running,
    Stopping,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RecipeRuntimePhase {
    #[default]
    Idle,
    Recipe,
    SafeStop,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RecipeRuntimeStepStatus {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecipeRuntimeEventKind {
    Loaded,
    Started,
    StepChanged,
    SignalWritten,
    DeviceFeedbackWritten,
    Finished,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeFailure {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub step_id: Option<String>,
    #[serde(default)]
    pub action_id: Option<String>,
    #[serde(default)]
    pub on_error: Option<String>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeStepSnapshot {
    pub step_id: String,
    pub seq: u32,
    pub name: String,
    pub action_id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    pub phase: RecipeRuntimePhase,
    pub status: RecipeRuntimeStepStatus,
    #[serde(default)]
    pub started_at_ms: Option<u64>,
    #[serde(default)]
    pub finished_at_ms: Option<u64>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeSnapshot {
    pub status: RecipeRuntimeStatus,
    pub phase: RecipeRuntimePhase,
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub recipe_id: Option<String>,
    #[serde(default)]
    pub recipe_name: Option<String>,
    pub run_id: u64,
    #[serde(default)]
    pub started_at_ms: Option<u64>,
    #[serde(default)]
    pub finished_at_ms: Option<u64>,
    #[serde(default)]
    pub active_step_id: Option<String>,
    #[serde(default)]
    pub active_step_phase: Option<RecipeRuntimePhase>,
    #[serde(default)]
    pub recipe_steps: Vec<RecipeRuntimeStepSnapshot>,
    #[serde(default)]
    pub safe_stop_steps: Vec<RecipeRuntimeStepSnapshot>,
    #[serde(default)]
    pub signal_values: BTreeMap<String, Value>,
    #[serde(default)]
    pub runtime_values: BTreeMap<String, Value>,
    #[serde(default)]
    pub diagnostics: Vec<CraftsmanshipDiagnostic>,
    #[serde(default)]
    pub last_error: Option<RecipeRuntimeFailure>,
    #[serde(default)]
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeEvent {
    pub kind: RecipeRuntimeEventKind,
    pub snapshot: RecipeRuntimeSnapshot,
    #[serde(default)]
    pub updated_key: Option<String>,
    #[serde(default)]
    pub updated_value: Option<Value>,
    #[serde(default)]
    pub message: Option<String>,
}

impl RecipeRuntimeSnapshot {
    pub fn from_bundle(bundle: &CraftsmanshipRecipeBundle) -> Self {
        Self {
            status: RecipeRuntimeStatus::Loaded,
            phase: RecipeRuntimePhase::Recipe,
            workspace_root: Some(bundle.workspace_root.clone()),
            project_id: Some(bundle.project.id.clone()),
            project_name: Some(bundle.project.name.clone()),
            recipe_id: Some(bundle.recipe.id.clone()),
            recipe_name: Some(bundle.recipe.name.clone()),
            run_id: 0,
            started_at_ms: None,
            finished_at_ms: None,
            active_step_id: None,
            active_step_phase: None,
            recipe_steps: bundle
                .recipe
                .steps
                .iter()
                .map(RecipeRuntimeStepSnapshot::from_recipe_step)
                .collect(),
            safe_stop_steps: bundle
                .safe_stop
                .as_ref()
                .map(|safe_stop| {
                    safe_stop
                        .steps
                        .iter()
                        .map(|step| RecipeRuntimeStepSnapshot::from_safe_stop_step(step, bundle))
                        .collect()
                })
                .unwrap_or_default(),
            signal_values: BTreeMap::new(),
            runtime_values: BTreeMap::new(),
            diagnostics: bundle.diagnostics.clone(),
            last_error: None,
            last_message: Some("recipe loaded".to_string()),
        }
    }

    pub fn reset_for_run(&mut self, run_id: u64, started_at_ms: u64) {
        self.status = RecipeRuntimeStatus::Running;
        self.phase = RecipeRuntimePhase::Recipe;
        self.run_id = run_id;
        self.started_at_ms = Some(started_at_ms);
        self.finished_at_ms = None;
        self.active_step_id = None;
        self.active_step_phase = None;
        self.last_error = None;
        self.last_message = Some("recipe runtime started".to_string());
        reset_step_collection(&mut self.recipe_steps);
        reset_step_collection(&mut self.safe_stop_steps);
    }
}

impl RecipeRuntimeStepSnapshot {
    fn from_recipe_step(step: &crate::craftsmanship::RecipeStep) -> Self {
        Self {
            step_id: step.id.clone(),
            seq: step.seq,
            name: step.name.clone(),
            action_id: step.action_id.clone(),
            device_id: step.device_id.clone(),
            phase: RecipeRuntimePhase::Recipe,
            status: RecipeRuntimeStepStatus::Pending,
            started_at_ms: None,
            finished_at_ms: None,
            message: None,
        }
    }

    fn from_safe_stop_step(step: &SafeStopStep, bundle: &CraftsmanshipRecipeBundle) -> Self {
        let action_name = bundle
            .system
            .actions
            .iter()
            .find(|action| action.id == step.action_id)
            .map(|action| action.name.clone())
            .unwrap_or_else(|| step.action_id.clone());

        let device_name = step
            .device_id
            .as_ref()
            .and_then(|device_id| {
                bundle
                    .devices
                    .iter()
                    .find(|device| &device.id == device_id)
                    .map(|device| device.name.clone())
            })
            .unwrap_or_default();

        let name = if device_name.is_empty() {
            format!("安全停机 {}", action_name)
        } else {
            format!("安全停机 {} {}", action_name, device_name)
        };

        Self {
            step_id: safe_stop_step_id(step),
            seq: step.seq,
            name,
            action_id: step.action_id.clone(),
            device_id: step.device_id.clone(),
            phase: RecipeRuntimePhase::SafeStop,
            status: RecipeRuntimeStepStatus::Pending,
            started_at_ms: None,
            finished_at_ms: None,
            message: None,
        }
    }
}

pub(super) fn safe_stop_step_id(step: &SafeStopStep) -> String {
    let action = step.action_id.replace('.', "-");
    let device = step
        .device_id
        .as_deref()
        .unwrap_or("no-device")
        .replace('.', "-");
    format!("safe-stop-{:04}-{action}-{device}", step.seq)
}

pub(super) fn update_step_snapshot(
    steps: &mut [RecipeRuntimeStepSnapshot],
    step_id: &str,
    status: RecipeRuntimeStepStatus,
    timestamp_ms: u64,
    message: Option<String>,
) {
    if let Some(step) = steps.iter_mut().find(|step| step.step_id == step_id) {
        step.status = status;
        match status {
            RecipeRuntimeStepStatus::Running => {
                step.started_at_ms = Some(timestamp_ms);
                step.finished_at_ms = None;
            }
            _ => {
                if step.started_at_ms.is_none() {
                    step.started_at_ms = Some(timestamp_ms);
                }
                step.finished_at_ms = Some(timestamp_ms);
            }
        }
        step.message = message;
    }
}

fn reset_step_collection(steps: &mut [RecipeRuntimeStepSnapshot]) {
    for step in steps {
        step.status = RecipeRuntimeStepStatus::Pending;
        step.started_at_ms = None;
        step.finished_at_ms = None;
        step.message = None;
    }
}
