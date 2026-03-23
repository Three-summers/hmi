use super::manager::{now_ms, LoadedRecipeRuntime};
use super::types::RecipeRuntimeFailure;
use crate::comm::actor::CommPriority;
use crate::comm::{self, HmipOutboundFrame};
use crate::craftsmanship::{ActionDefinition, ActionDispatchDefinition, RecipeStep, SafeStopStep};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub(super) async fn dispatch_recipe_action(
    app: Option<&AppHandle>,
    loaded: &LoadedRecipeRuntime,
    step: &RecipeStep,
    action: &ActionDefinition,
) -> Result<String, RecipeRuntimeFailure> {
    dispatch_action(
        app,
        loaded,
        action,
        step.device_id.as_deref(),
        Some(step.id.as_str()),
        Some(step.action_id.as_str()),
        step.on_error.clone(),
    )
    .await
}

pub(super) async fn dispatch_safe_stop_action(
    app: Option<&AppHandle>,
    loaded: &LoadedRecipeRuntime,
    step: &SafeStopStep,
    step_id: &str,
    action: &ActionDefinition,
) -> Result<String, RecipeRuntimeFailure> {
    dispatch_action(
        app,
        loaded,
        action,
        step.device_id.as_deref(),
        Some(step_id),
        Some(step.action_id.as_str()),
        Some("safe-stop".to_string()),
    )
    .await
}

async fn dispatch_action(
    app: Option<&AppHandle>,
    loaded: &LoadedRecipeRuntime,
    action: &ActionDefinition,
    device_id: Option<&str>,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> Result<String, RecipeRuntimeFailure> {
    let dispatch = action.dispatch.as_ref().ok_or_else(|| {
        dispatch_failure(
            "missing_action_dispatch",
            format!("action `{}` is missing dispatch configuration", action.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    match dispatch.kind.as_deref() {
        Some("hmipFrame") => {
            dispatch_hmip_frame(
                app, loaded, action, dispatch, device_id, step_id, action_id, on_error,
            )
            .await
        }
        Some("gpioWrite") => {
            dispatch_gpio_write(
                loaded, action, dispatch, device_id, step_id, action_id, on_error,
            )
            .await
        }
        Some(other) => Err(dispatch_failure(
            "unsupported_dispatch_kind",
            format!(
                "action `{}` uses unsupported dispatch kind `{other}`",
                action.id
            ),
            step_id,
            action_id,
            on_error,
        )),
        None => Err(dispatch_failure(
            "missing_dispatch_kind",
            format!("action `{}` dispatch misses `kind`", action.id),
            step_id,
            action_id,
            on_error,
        )),
    }
}

#[allow(clippy::too_many_arguments)]
async fn dispatch_hmip_frame(
    app: Option<&AppHandle>,
    loaded: &LoadedRecipeRuntime,
    action: &ActionDefinition,
    dispatch: &ActionDispatchDefinition,
    device_id: Option<&str>,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> Result<String, RecipeRuntimeFailure> {
    let app = app.ok_or_else(|| {
        dispatch_failure(
            "missing_app_handle",
            format!(
                "action `{}` requires AppHandle for real device dispatch",
                action.id
            ),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let device_id = device_id.ok_or_else(|| {
        dispatch_failure(
            "missing_dispatch_device",
            format!("action `{}` requires `deviceId` for dispatch", action.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let device = loaded.devices.get(device_id).ok_or_else(|| {
        dispatch_failure(
            "device_not_found",
            format!("device `{device_id}` is not available during execution"),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let transport = device.transport.as_ref().ok_or_else(|| {
        dispatch_failure(
            "missing_device_transport",
            format!(
                "device `{}` does not define transport for action dispatch",
                device.id
            ),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let payload = build_hmip_payload(action, dispatch, step_id, action_id, on_error.clone())?;
    let frame = HmipOutboundFrame {
        msg_type: dispatch.msg_type.ok_or_else(|| {
            dispatch_failure(
                "missing_dispatch_msg_type",
                format!("action `{}` dispatch misses `msgType`", action.id),
                step_id,
                action_id,
                on_error.clone(),
            )
        })?,
        flags: dispatch.flags.unwrap_or(0),
        channel: transport.channel.unwrap_or(0),
        seq: None,
        payload,
        priority: parse_dispatch_priority(dispatch.priority.as_deref()).ok_or_else(|| {
            dispatch_failure(
                "invalid_dispatch_priority",
                format!(
                    "action `{}` dispatch uses unsupported priority `{}`",
                    action.id,
                    dispatch.priority.as_deref().unwrap_or_default()
                ),
                step_id,
                action_id,
                on_error.clone(),
            )
        })?,
    };

    let state = app.state::<crate::comm::CommState>();
    let seq = match transport.kind.as_deref() {
        Some("tcp") => comm::send_tcp_hmip_frame(&state, frame).await,
        Some("serial") => comm::send_serial_hmip_frame(&state, frame).await,
        Some(other) => {
            return Err(dispatch_failure(
                "unsupported_device_transport",
                format!(
                    "device `{}` uses unsupported transport kind `{other}` for HMIP dispatch",
                    device.id
                ),
                step_id,
                action_id,
                on_error,
            ))
        }
        None => {
            return Err(dispatch_failure(
                "missing_device_transport_kind",
                format!("device `{}` transport misses `kind`", device.id),
                step_id,
                action_id,
                on_error,
            ))
        }
    }
    .map_err(|message| {
        dispatch_failure(
            "dispatch_send_failed",
            format!("failed to dispatch action `{}`: {message}", action.id),
            step_id,
            action_id,
            on_error,
        )
    })?;

    Ok(format!(
        "action `{}` dispatched via {} (seq={seq})",
        action.id,
        transport.kind.as_deref().unwrap_or("unknown")
    ))
}

#[allow(clippy::too_many_arguments)]
async fn dispatch_gpio_write(
    loaded: &LoadedRecipeRuntime,
    action: &ActionDefinition,
    dispatch: &ActionDispatchDefinition,
    device_id: Option<&str>,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> Result<String, RecipeRuntimeFailure> {
    let device_id = device_id.ok_or_else(|| {
        dispatch_failure(
            "missing_dispatch_device",
            format!("action `{}` requires `deviceId` for dispatch", action.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let device = loaded.devices.get(device_id).ok_or_else(|| {
        dispatch_failure(
            "device_not_found",
            format!("device `{device_id}` is not available during execution"),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let transport = device.transport.as_ref().ok_or_else(|| {
        dispatch_failure(
            "missing_device_transport",
            format!(
                "device `{}` does not define transport for action dispatch",
                device.id
            ),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    match transport.kind.as_deref() {
        Some("gpio") => {}
        Some(other) => {
            return Err(dispatch_failure(
                "unsupported_device_transport",
                format!(
                    "device `{}` uses unsupported transport kind `{other}` for GPIO dispatch",
                    device.id
                ),
                step_id,
                action_id,
                on_error,
            ));
        }
        None => {
            return Err(dispatch_failure(
                "missing_device_transport_kind",
                format!("device `{}` transport misses `kind`", device.id),
                step_id,
                action_id,
                on_error,
            ));
        }
    }

    let pin = transport.pin.ok_or_else(|| {
        dispatch_failure(
            "missing_device_transport_pin",
            format!("device `{}` GPIO transport misses `pin`", device.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;
    let value = dispatch.value.ok_or_else(|| {
        dispatch_failure(
            "missing_gpio_dispatch_value",
            format!("action `{}` GPIO dispatch misses `value`", action.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    write_gpio_value(
        transport.root_dir.as_deref(),
        pin,
        transport.active_low,
        value,
    )
    .await
    .map_err(|message| {
        dispatch_failure(
            "dispatch_send_failed",
            format!("failed to dispatch action `{}`: {message}", action.id),
            step_id,
            action_id,
            on_error,
        )
    })?;

    Ok(format!(
        "action `{}` dispatched via gpio (pin={pin}, value={})",
        action.id,
        if value { 1 } else { 0 }
    ))
}

fn build_hmip_payload(
    action: &ActionDefinition,
    dispatch: &ActionDispatchDefinition,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> Result<Vec<u8>, RecipeRuntimeFailure> {
    match dispatch.payload_mode.as_deref().unwrap_or("fixedHex") {
        "fixedHex" => {
            let payload_hex = dispatch.payload_hex.as_deref().ok_or_else(|| {
                dispatch_failure(
                    "missing_dispatch_payload_hex",
                    format!("action `{}` dispatch misses `payloadHex`", action.id),
                    step_id,
                    action_id,
                    on_error.clone(),
                )
            })?;
            decode_hex_payload(payload_hex).map_err(|message| {
                dispatch_failure(
                    "invalid_dispatch_payload_hex",
                    format!("action `{}` payloadHex is invalid: {message}", action.id),
                    step_id,
                    action_id,
                    on_error,
                )
            })
        }
        other => Err(dispatch_failure(
            "unsupported_dispatch_payload_mode",
            format!(
                "action `{}` uses unsupported payload mode `{other}`",
                action.id
            ),
            step_id,
            action_id,
            on_error,
        )),
    }
}

fn decode_hex_payload(raw: &str) -> Result<Vec<u8>, String> {
    let compact = raw
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    if compact.is_empty() {
        return Ok(Vec::new());
    }
    if compact.len() % 2 != 0 {
        return Err("hex length must be even".to_string());
    }

    let mut bytes = Vec::with_capacity(compact.len() / 2);
    let chars = compact.as_bytes();
    let mut index = 0;
    while index < chars.len() {
        let chunk = std::str::from_utf8(&chars[index..index + 2])
            .map_err(|_| "payload contains invalid utf-8 data".to_string())?;
        let value =
            u8::from_str_radix(chunk, 16).map_err(|_| format!("invalid hex byte `{chunk}`"))?;
        bytes.push(value);
        index += 2;
    }

    Ok(bytes)
}

fn parse_dispatch_priority(value: Option<&str>) -> Option<CommPriority> {
    match value.unwrap_or("normal") {
        "high" => Some(CommPriority::High),
        "normal" => Some(CommPriority::Normal),
        _ => None,
    }
}

async fn write_gpio_value(
    root_dir: Option<&str>,
    pin: u32,
    active_low: Option<bool>,
    value: bool,
) -> Result<(), String> {
    let gpio_root = PathBuf::from(root_dir.unwrap_or("/sys/class/gpio"));
    let gpio_dir = ensure_gpio_directory(&gpio_root, pin).await?;
    let direction_path = gpio_dir.join("direction");
    let active_low_path = gpio_dir.join("active_low");
    let value_path = gpio_dir.join("value");

    if direction_path.exists() {
        tokio::fs::write(&direction_path, b"out")
            .await
            .map_err(|error| {
                format!(
                    "failed to configure gpio direction at `{}`: {error}",
                    direction_path.display()
                )
            })?;
    }

    if let Some(active_low) = active_low {
        if !active_low_path.exists() {
            return Err(format!(
                "gpio active_low path `{}` does not exist",
                active_low_path.display()
            ));
        }
        tokio::fs::write(&active_low_path, if active_low { b"1" } else { b"0" })
            .await
            .map_err(|error| {
                format!(
                    "failed to configure gpio active_low at `{}`: {error}",
                    active_low_path.display()
                )
            })?;
    }

    if !value_path.exists() {
        return Err(format!(
            "gpio value path `{}` does not exist",
            value_path.display()
        ));
    }

    tokio::fs::write(&value_path, if value { b"1" } else { b"0" })
        .await
        .map_err(|error| {
            format!(
                "failed to write gpio value at `{}`: {error}",
                value_path.display()
            )
        })
}

async fn ensure_gpio_directory(root_dir: &Path, pin: u32) -> Result<PathBuf, String> {
    let gpio_dir = root_dir.join(format!("gpio{pin}"));
    if gpio_dir.exists() {
        return Ok(gpio_dir);
    }

    let export_path = root_dir.join("export");
    if !export_path.exists() {
        return Err(format!("gpio path `{}` does not exist", gpio_dir.display()));
    }

    tokio::fs::write(&export_path, pin.to_string())
        .await
        .map_err(|error| format!("failed to export gpio pin {pin}: {error}"))?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(200) {
        if gpio_dir.exists() {
            return Ok(gpio_dir);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    Err(format!(
        "gpio pin {pin} did not become ready under `{}`",
        root_dir.display()
    ))
}

fn dispatch_failure(
    code: &str,
    message: String,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> RecipeRuntimeFailure {
    RecipeRuntimeFailure {
        code: code.to_string(),
        message,
        step_id: step_id.map(str::to_string),
        action_id: action_id.map(str::to_string),
        on_error,
        timestamp_ms: now_ms(),
    }
}
