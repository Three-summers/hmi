use super::engine;
use super::types::{
    update_step_snapshot, RecipeRuntimeEvent, RecipeRuntimeEventKind, RecipeRuntimeFailure,
    RecipeRuntimePhase, RecipeRuntimeSnapshot, RecipeRuntimeStatus, RecipeRuntimeStepStatus,
};
use crate::craftsmanship::{
    get_recipe_bundle, ActionDefinition, ConnectionDefinition, CraftsmanshipRecipeBundle,
    DeviceInstance, FeedbackMappingDefinition, SignalDefinition,
};
use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{Mutex, Notify};

pub const RECIPE_RUNTIME_EVENT_NAME: &str = "craftsmanship-runtime-event";

#[derive(Clone)]
pub struct RecipeRuntimeManager {
    inner: Arc<Mutex<RecipeRuntimeState>>,
    value_changed: Arc<Notify>,
}

impl Default for RecipeRuntimeManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RecipeRuntimeState::default())),
            value_changed: Arc::new(Notify::new()),
        }
    }
}

#[derive(Default)]
pub(super) struct RecipeRuntimeState {
    pub loaded: Option<LoadedRecipeRuntime>,
    pub snapshot: RecipeRuntimeSnapshot,
    pub run_control: Option<RuntimeRunControl>,
    pub next_run_id: u64,
}

#[derive(Debug, Clone)]
pub(super) struct LoadedRecipeRuntime {
    pub bundle: CraftsmanshipRecipeBundle,
    pub actions: HashMap<String, ActionDefinition>,
    pub connections: HashMap<String, ConnectionDefinition>,
    pub devices: HashMap<String, DeviceInstance>,
    pub feedback_mappings: Vec<FeedbackMappingDefinition>,
    pub signals: HashMap<String, SignalDefinition>,
    pub signal_sources: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub(super) struct RuntimeRunControl {
    stop_requested: Arc<AtomicBool>,
    stopped: Arc<Notify>,
}

enum PendingRuntimeWrite {
    Signal {
        signal_id: String,
        value: Value,
    },
    DeviceFeedback {
        device_id: String,
        feedback_key: String,
        value: Value,
    },
}

impl RuntimeRunControl {
    fn new() -> Self {
        Self {
            stop_requested: Arc::new(AtomicBool::new(false)),
            stopped: Arc::new(Notify::new()),
        }
    }

    pub fn is_stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::SeqCst)
    }

    fn request_stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
    }

    pub fn notify_stopped(&self) {
        self.stopped.notify_waiters();
    }
}

impl LoadedRecipeRuntime {
    fn new(bundle: CraftsmanshipRecipeBundle) -> Self {
        let actions = bundle
            .system
            .actions
            .iter()
            .cloned()
            .map(|action| (action.id.clone(), action))
            .collect();
        let devices = bundle
            .devices
            .iter()
            .cloned()
            .map(|device| (device.id.clone(), device))
            .collect();
        let connections = bundle
            .connections
            .iter()
            .cloned()
            .map(|connection| (connection.id.clone(), connection))
            .collect();
        let signals = bundle
            .signals
            .iter()
            .cloned()
            .map(|signal| (signal.id.clone(), signal))
            .collect::<HashMap<_, _>>();
        let signal_sources = bundle
            .signals
            .iter()
            .filter_map(|signal| {
                signal
                    .source
                    .as_ref()
                    .map(|source| (source.clone(), signal.id.clone()))
            })
            .collect();
        let feedback_mappings = bundle.feedback_mappings.clone();

        Self {
            bundle,
            actions,
            connections,
            devices,
            feedback_mappings,
            signals,
            signal_sources,
        }
    }
}

impl RecipeRuntimeManager {
    pub async fn load_recipe(
        &self,
        app: Option<&AppHandle>,
        workspace_root: String,
        project_id: String,
        recipe_id: String,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        {
            let state = self.inner.lock().await;
            if state.run_control.is_some() {
                return Err(
                    "recipe runtime is active; stop it before loading another recipe".to_string(),
                );
            }
        }

        let bundle = get_recipe_bundle(&workspace_root, &project_id, &recipe_id)?;
        let loaded = LoadedRecipeRuntime::new(bundle.clone());

        let snapshot = {
            let mut state = self.inner.lock().await;
            let snapshot = RecipeRuntimeSnapshot::from_bundle(&bundle);
            state.loaded = Some(loaded);
            state.snapshot = snapshot.clone();
            state.run_control = None;
            snapshot
        };

        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::Loaded,
            snapshot.clone(),
            None,
            None,
            Some("recipe loaded".to_string()),
        );

        Ok(snapshot)
    }

    pub async fn start(&self, app: Option<AppHandle>) -> Result<RecipeRuntimeSnapshot, String> {
        self.start_with_app(app).await
    }

    pub async fn start_with_app<R: Runtime>(
        &self,
        app: Option<AppHandle<R>>,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        let (loaded, run_control, snapshot) = {
            let mut state = self.inner.lock().await;
            let Some(loaded) = state.loaded.clone() else {
                return Err("no recipe has been loaded".to_string());
            };

            if state.run_control.is_some() {
                return Err("recipe runtime is already active".to_string());
            }

            if loaded
                .bundle
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.level == "error")
            {
                return Err(
                    "loaded recipe contains error diagnostics; resolve them before start"
                        .to_string(),
                );
            }

            state.next_run_id = state.next_run_id.saturating_add(1);
            let run_id = state.next_run_id;
            let run_control = RuntimeRunControl::new();
            state.snapshot.reset_for_run(run_id, now_ms());
            state.run_control = Some(run_control.clone());
            (loaded, run_control, state.snapshot.clone())
        };

        self.emit_event_with_app(
            app.as_ref(),
            RecipeRuntimeEventKind::Started,
            snapshot.clone(),
            None,
            None,
            Some("recipe runtime started".to_string()),
        );

        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            engine::run_recipe(manager, app, loaded, run_control).await;
        });

        Ok(snapshot)
    }

    pub async fn stop(
        &self,
        _app: Option<&AppHandle>,
        reason: Option<String>,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        {
            let mut state = self.inner.lock().await;
            let Some(run_control) = state.run_control.clone() else {
                return Ok(state.snapshot.clone());
            };

            run_control.request_stop();
            state.snapshot.status = RecipeRuntimeStatus::Stopping;
            state.snapshot.last_message = reason
                .clone()
                .or_else(|| Some("stop requested".to_string()));
        }

        // 尽快唤醒等待中的步骤，让 stop 请求不必额外等待轮询周期。
        self.value_changed.notify_waiters();

        loop {
            let snapshot = self.get_status().await;
            if !matches!(
                snapshot.status,
                RecipeRuntimeStatus::Running | RecipeRuntimeStatus::Stopping
            ) {
                return Ok(snapshot);
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    pub async fn get_status(&self) -> RecipeRuntimeSnapshot {
        let state = self.inner.lock().await;
        state.snapshot.clone()
    }

    pub async fn write_signal(
        &self,
        app: Option<&AppHandle>,
        signal_id: String,
        value: Value,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        self.write_signal_with_app(app, signal_id, value).await
    }

    pub async fn write_signal_with_app<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        signal_id: String,
        value: Value,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        let snapshot = {
            let mut state = self.inner.lock().await;
            let source = state
                .loaded
                .as_ref()
                .ok_or_else(|| "no recipe has been loaded".to_string())?
                .signals
                .get(signal_id.as_str())
                .ok_or_else(|| format!("signal `{signal_id}` does not exist in the loaded recipe"))?
                .source
                .clone();

            state
                .snapshot
                .signal_values
                .insert(signal_id.clone(), value.clone());
            if let Some(source) = source {
                state.snapshot.runtime_values.insert(source, value.clone());
            }
            state.snapshot.last_message = Some(format!("signal `{signal_id}` updated"));
            state.snapshot.clone()
        };

        self.value_changed.notify_waiters();
        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::SignalWritten,
            snapshot.clone(),
            Some(signal_id),
            Some(value),
            Some("signal value updated".to_string()),
        );

        Ok(snapshot)
    }

    pub async fn write_device_feedback(
        &self,
        app: Option<&AppHandle>,
        device_id: String,
        key: String,
        value: Value,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        self.write_device_feedback_with_app(app, device_id, key, value)
            .await
    }

    pub async fn write_device_feedback_with_app<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        device_id: String,
        key: String,
        value: Value,
    ) -> Result<RecipeRuntimeSnapshot, String> {
        let (snapshot, runtime_key) = {
            let mut state = self.inner.lock().await;
            let (runtime_key, signal_id) = {
                let loaded = state
                    .loaded
                    .as_ref()
                    .ok_or_else(|| "no recipe has been loaded".to_string())?;
                let device = loaded.devices.get(device_id.as_str()).ok_or_else(|| {
                    format!("device `{device_id}` does not exist in the loaded recipe")
                })?;
                let runtime_key = device.tags.get(key.as_str()).cloned().ok_or_else(|| {
                    format!("device `{device_id}` does not define feedback key `{key}`")
                })?;
                let signal_id = loaded.signal_sources.get(runtime_key.as_str()).cloned();
                (runtime_key, signal_id)
            };

            state
                .snapshot
                .runtime_values
                .insert(runtime_key.clone(), value.clone());
            if let Some(signal_id) = signal_id {
                state
                    .snapshot
                    .signal_values
                    .insert(signal_id, value.clone());
            }
            state.snapshot.last_message =
                Some(format!("device feedback `{device_id}.{key}` updated"));
            (state.snapshot.clone(), runtime_key)
        };

        self.value_changed.notify_waiters();
        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::DeviceFeedbackWritten,
            snapshot.clone(),
            Some(runtime_key),
            Some(value),
            Some("device feedback updated".to_string()),
        );

        Ok(snapshot)
    }

    pub async fn apply_hmip_feedback(
        &self,
        app: Option<&AppHandle>,
        connection_id: &str,
        header: crate::comm::proto::FrameHeader,
        message: Option<&crate::comm::proto::Message>,
        raw_payload: &[u8],
    ) -> Result<usize, String> {
        self.apply_hmip_feedback_with_app(app, connection_id, header, message, raw_payload)
            .await
    }

    pub async fn apply_hmip_feedback_with_app<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        connection_id: &str,
        header: crate::comm::proto::FrameHeader,
        message: Option<&crate::comm::proto::Message>,
        raw_payload: &[u8],
    ) -> Result<usize, String> {
        let loaded = {
            let state = self.inner.lock().await;
            state.loaded.clone()
        };
        let Some(loaded) = loaded else {
            return Ok(0);
        };

        let mut pending_writes = Vec::new();
        for mapping in &loaded.feedback_mappings {
            if !mapping.enabled {
                continue;
            }
            if !feedback_mapping_matches(mapping, connection_id, header, message) {
                continue;
            }
            let Some(value) = extract_feedback_value(mapping, header, message, raw_payload) else {
                continue;
            };

            if let Some(signal_id) = mapping.target.signal_id.as_ref() {
                pending_writes.push(PendingRuntimeWrite::Signal {
                    signal_id: signal_id.clone(),
                    value,
                });
                continue;
            }

            if let (Some(device_id), Some(feedback_key)) = (
                mapping.target.device_id.as_ref(),
                mapping.target.feedback_key.as_ref(),
            ) {
                pending_writes.push(PendingRuntimeWrite::DeviceFeedback {
                    device_id: device_id.clone(),
                    feedback_key: feedback_key.clone(),
                    value,
                });
            }
        }

        let applied = pending_writes.len();
        for pending in pending_writes {
            match pending {
                PendingRuntimeWrite::Signal { signal_id, value } => {
                    self.write_signal_with_app(app, signal_id, value).await?;
                }
                PendingRuntimeWrite::DeviceFeedback {
                    device_id,
                    feedback_key,
                    value,
                } => {
                    self.write_device_feedback_with_app(app, device_id, feedback_key, value)
                        .await?;
                }
            }
        }

        Ok(applied)
    }

    pub(super) fn value_changed(&self) -> Arc<Notify> {
        self.value_changed.clone()
    }

    pub(super) async fn finish_run<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        status: RecipeRuntimeStatus,
        phase: RecipeRuntimePhase,
        message: Option<String>,
        failure: Option<RecipeRuntimeFailure>,
    ) {
        let (snapshot, run_control) = {
            let mut state = self.inner.lock().await;
            state.snapshot.status = status;
            state.snapshot.phase = phase;
            state.snapshot.finished_at_ms = Some(now_ms());
            state.snapshot.active_step_id = None;
            state.snapshot.active_step_phase = None;
            state.snapshot.last_message = message.clone();
            if failure.is_some() {
                state.snapshot.last_error = failure.clone();
            }
            let run_control = state.run_control.take();
            (state.snapshot.clone(), run_control)
        };

        let kind = match status {
            RecipeRuntimeStatus::Completed => RecipeRuntimeEventKind::Finished,
            RecipeRuntimeStatus::Failed => RecipeRuntimeEventKind::Failed,
            RecipeRuntimeStatus::Stopped => RecipeRuntimeEventKind::Stopped,
            _ => RecipeRuntimeEventKind::Finished,
        };

        self.emit_event_with_app(app, kind, snapshot, None, None, message);

        if let Some(run_control) = run_control {
            run_control.notify_stopped();
        }
    }

    pub(super) async fn begin_step<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        phase: RecipeRuntimePhase,
        step_id: &str,
        message: Option<String>,
    ) {
        let snapshot = {
            let mut state = self.inner.lock().await;
            let timestamp_ms = now_ms();
            state.snapshot.phase = phase;
            state.snapshot.active_step_id = Some(step_id.to_string());
            state.snapshot.active_step_phase = Some(phase);
            state.snapshot.last_message = message.clone();
            match phase {
                RecipeRuntimePhase::Recipe => update_step_snapshot(
                    &mut state.snapshot.recipe_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Running,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::SafeStop => update_step_snapshot(
                    &mut state.snapshot.safe_stop_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Running,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::Idle => {}
            }
            state.snapshot.clone()
        };

        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::StepChanged,
            snapshot,
            None,
            None,
            message,
        );
    }

    pub(super) async fn complete_step<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        phase: RecipeRuntimePhase,
        step_id: &str,
        message: Option<String>,
    ) {
        let snapshot = {
            let mut state = self.inner.lock().await;
            let timestamp_ms = now_ms();
            state.snapshot.last_message = message.clone();
            match phase {
                RecipeRuntimePhase::Recipe => update_step_snapshot(
                    &mut state.snapshot.recipe_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Completed,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::SafeStop => update_step_snapshot(
                    &mut state.snapshot.safe_stop_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Completed,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::Idle => {}
            }
            state.snapshot.active_step_id = None;
            state.snapshot.active_step_phase = None;
            state.snapshot.clone()
        };

        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::StepChanged,
            snapshot,
            None,
            None,
            message,
        );
    }

    pub(super) async fn fail_step<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        phase: RecipeRuntimePhase,
        step_id: &str,
        message: Option<String>,
    ) {
        let snapshot = {
            let mut state = self.inner.lock().await;
            let timestamp_ms = now_ms();
            state.snapshot.last_message = message.clone();
            match phase {
                RecipeRuntimePhase::Recipe => update_step_snapshot(
                    &mut state.snapshot.recipe_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Failed,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::SafeStop => update_step_snapshot(
                    &mut state.snapshot.safe_stop_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Failed,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::Idle => {}
            }
            state.snapshot.active_step_id = None;
            state.snapshot.active_step_phase = None;
            state.snapshot.clone()
        };

        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::StepChanged,
            snapshot,
            None,
            None,
            message,
        );
    }

    pub(super) async fn stop_step<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        phase: RecipeRuntimePhase,
        step_id: &str,
        message: Option<String>,
    ) {
        let snapshot = {
            let mut state = self.inner.lock().await;
            let timestamp_ms = now_ms();
            state.snapshot.last_message = message.clone();
            match phase {
                RecipeRuntimePhase::Recipe => update_step_snapshot(
                    &mut state.snapshot.recipe_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Stopped,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::SafeStop => update_step_snapshot(
                    &mut state.snapshot.safe_stop_steps,
                    step_id,
                    RecipeRuntimeStepStatus::Stopped,
                    timestamp_ms,
                    message.clone(),
                ),
                RecipeRuntimePhase::Idle => {}
            }
            state.snapshot.active_step_id = None;
            state.snapshot.active_step_phase = None;
            state.snapshot.clone()
        };

        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::StepChanged,
            snapshot,
            None,
            None,
            message,
        );
    }

    pub(super) async fn transition_to_safe_stop<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        failure: RecipeRuntimeFailure,
    ) {
        let snapshot = {
            let mut state = self.inner.lock().await;
            state.snapshot.status = RecipeRuntimeStatus::Stopping;
            state.snapshot.phase = RecipeRuntimePhase::SafeStop;
            state.snapshot.last_error = Some(failure);
            state.snapshot.last_message = Some("switching to safe-stop".to_string());
            state.snapshot.clone()
        };

        self.emit_event_with_app(
            app,
            RecipeRuntimeEventKind::StepChanged,
            snapshot,
            None,
            None,
            Some("switching to safe-stop".to_string()),
        );
    }

    pub(super) async fn mark_failure(
        &self,
        phase: RecipeRuntimePhase,
        failure: RecipeRuntimeFailure,
    ) {
        let mut state = self.inner.lock().await;
        state.snapshot.phase = phase;
        state.snapshot.last_error = Some(failure);
    }

    pub(super) async fn snapshot(&self) -> RecipeRuntimeSnapshot {
        let state = self.inner.lock().await;
        state.snapshot.clone()
    }

    fn emit_event_with_app<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        kind: RecipeRuntimeEventKind,
        snapshot: RecipeRuntimeSnapshot,
        updated_key: Option<String>,
        updated_value: Option<Value>,
        message: Option<String>,
    ) {
        let Some(app) = app else {
            return;
        };

        let event = RecipeRuntimeEvent {
            kind,
            snapshot,
            updated_key,
            updated_value,
            message,
        };

        if let Err(error) = app.emit(RECIPE_RUNTIME_EVENT_NAME, &event) {
            log::warn!("Failed to emit craftsmanship runtime event: {}", error);
        }
    }
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn feedback_mapping_matches(
    mapping: &FeedbackMappingDefinition,
    connection_id: &str,
    header: crate::comm::proto::FrameHeader,
    message: Option<&crate::comm::proto::Message>,
) -> bool {
    if mapping.matcher.connection_id != connection_id {
        return false;
    }
    if mapping
        .matcher
        .channel
        .is_some_and(|channel| channel != header.channel)
    {
        return false;
    }
    if mapping
        .matcher
        .msg_type
        .is_some_and(|msg_type| msg_type != header.msg_type)
    {
        return false;
    }

    if let Some(summary_kind) = mapping.matcher.summary_kind.as_deref() {
        if !summary_kind_matches(summary_kind, hmip_summary_kind(message)) {
            return false;
        }
    }
    if mapping
        .matcher
        .request_id
        .is_some_and(|request_id| Some(request_id) != hmip_request_id(message))
    {
        return false;
    }
    if mapping
        .matcher
        .status
        .is_some_and(|status| Some(status) != hmip_status(message))
    {
        return false;
    }
    if mapping
        .matcher
        .event_id
        .is_some_and(|event_id| Some(event_id) != hmip_event_id(message))
    {
        return false;
    }
    if mapping
        .matcher
        .error_code
        .is_some_and(|error_code| Some(error_code) != hmip_error_code(message))
    {
        return false;
    }

    true
}

fn extract_feedback_value(
    mapping: &FeedbackMappingDefinition,
    header: crate::comm::proto::FrameHeader,
    message: Option<&crate::comm::proto::Message>,
    raw_payload: &[u8],
) -> Option<Value> {
    if let Some(value) = mapping.target.value.clone() {
        return Some(value);
    }

    match mapping.target.value_from.as_deref()? {
        "channel" => Some(Value::from(header.channel)),
        "seq" => Some(Value::from(header.seq)),
        "msgType" => Some(Value::from(header.msg_type)),
        "flags" => Some(Value::from(header.flags)),
        "summary.requestId" => hmip_request_id(message).map(Value::from),
        "summary.status" => hmip_status(message).map(Value::from),
        "summary.eventId" => hmip_event_id(message).map(Value::from),
        "summary.errorCode" => hmip_error_code(message).map(Value::from),
        "summary.bodyBase64" => hmip_body_bytes(message)
            .map(|body| Value::String(general_purpose::STANDARD.encode(body))),
        "summary.bodyHex" => hmip_body_bytes(message).map(|body| Value::String(encode_hex(body))),
        "summary.payloadBase64" => {
            Some(Value::String(general_purpose::STANDARD.encode(raw_payload)))
        }
        "summary.payloadHex" => Some(Value::String(encode_hex(raw_payload))),
        _ => None,
    }
}

fn hmip_summary_kind(message: Option<&crate::comm::proto::Message>) -> &'static str {
    match message {
        Some(crate::comm::proto::Message::Hello(_)) => "hello",
        Some(crate::comm::proto::Message::HelloAck(_)) => "helloAck",
        Some(crate::comm::proto::Message::Heartbeat(_)) => "heartbeat",
        Some(crate::comm::proto::Message::Request(_)) => "request",
        Some(crate::comm::proto::Message::Response(_)) => "response",
        Some(crate::comm::proto::Message::Event(_)) => "event",
        Some(crate::comm::proto::Message::Error(_)) => "error",
        Some(crate::comm::proto::Message::Raw { .. }) | None => "raw",
    }
}

fn summary_kind_matches(expected: &str, actual: &str) -> bool {
    expected == actual
        || matches!(
            (expected, actual),
            ("hello_ack", "helloAck") | ("helloAck", "hello_ack")
        )
}

fn hmip_request_id(message: Option<&crate::comm::proto::Message>) -> Option<u32> {
    match message {
        Some(crate::comm::proto::Message::Request(message)) => Some(message.request_id),
        Some(crate::comm::proto::Message::Response(message)) => Some(message.request_id),
        _ => None,
    }
}

fn hmip_status(message: Option<&crate::comm::proto::Message>) -> Option<u16> {
    match message {
        Some(crate::comm::proto::Message::Response(message)) => Some(message.status),
        _ => None,
    }
}

fn hmip_event_id(message: Option<&crate::comm::proto::Message>) -> Option<u16> {
    match message {
        Some(crate::comm::proto::Message::Event(message)) => Some(message.event_id),
        _ => None,
    }
}

fn hmip_error_code(message: Option<&crate::comm::proto::Message>) -> Option<u16> {
    match message {
        Some(crate::comm::proto::Message::Error(message)) => Some(message.code),
        _ => None,
    }
}

fn hmip_body_bytes(message: Option<&crate::comm::proto::Message>) -> Option<&[u8]> {
    match message {
        Some(crate::comm::proto::Message::Request(message)) => Some(message.body.as_ref()),
        Some(crate::comm::proto::Message::Response(message)) => Some(message.body.as_ref()),
        Some(crate::comm::proto::Message::Event(message)) => Some(message.body.as_ref()),
        _ => None,
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}
