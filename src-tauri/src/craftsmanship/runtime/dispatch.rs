use super::manager::{now_ms, LoadedRecipeRuntime};
use super::types::RecipeRuntimeFailure;
use crate::comm::actor::CommPriority;
use crate::comm::{self, HmipOutboundFrame};
use crate::craftsmanship::{
    ActionDefinition, ActionDispatchDefinition, ConnectionDefinition, RecipeStep, SafeStopStep,
};
use gpio_cdev::{Chip, LineHandle, LineRequestFlags};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager, Runtime};

const DEFAULT_GPIO_CHIP_PATH: &str = "/dev/gpiochip0";
const GPIO_CONSUMER_LABEL: &str = "hmi-gpio-write";

#[derive(Clone)]
struct ManagedGpioHandle {
    active_low: bool,
    handle: Arc<Mutex<LineHandle>>,
}

fn gpio_output_handles() -> &'static Mutex<HashMap<String, ManagedGpioHandle>> {
    static HANDLES: OnceLock<Mutex<HashMap<String, ManagedGpioHandle>>> = OnceLock::new();
    HANDLES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
type GpioWriteOverride = Arc<dyn Fn(&str, u32, bool, bool) -> Result<(), String> + Send + Sync>;

#[cfg(test)]
fn gpio_write_override() -> &'static Mutex<Option<GpioWriteOverride>> {
    static OVERRIDE: OnceLock<Mutex<Option<GpioWriteOverride>>> = OnceLock::new();
    OVERRIDE.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
pub(super) fn set_gpio_write_override(override_fn: Option<GpioWriteOverride>) {
    let mut guard = gpio_write_override()
        .lock()
        .expect("gpio override mutex poisoned");
    *guard = override_fn;
}

pub(super) async fn dispatch_recipe_action<R: Runtime>(
    app: Option<&AppHandle<R>>,
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

pub(super) async fn dispatch_safe_stop_action<R: Runtime>(
    app: Option<&AppHandle<R>>,
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

async fn dispatch_action<R: Runtime>(
    app: Option<&AppHandle<R>>,
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
async fn dispatch_hmip_frame<R: Runtime>(
    app: Option<&AppHandle<R>>,
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
    let connection_id = transport.connection_id.as_deref().ok_or_else(|| {
        dispatch_failure(
            "missing_device_transport_connection",
            format!(
                "device `{}` transport misses `connectionId` for HMIP dispatch",
                device.id
            ),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;
    let connection = loaded.connections.get(connection_id).ok_or_else(|| {
        dispatch_failure(
            "connection_not_found",
            format!(
                "device `{}` references unknown connection `{connection_id}` during dispatch",
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
    let seq = match connection.kind.as_deref() {
        Some("tcp") => {
            let config =
                build_tcp_connection_config(connection, step_id, action_id, on_error.clone())?;
            comm::ensure_tcp_connection(&state, app, connection_id, config)
                .await
                .map_err(|message| {
                    dispatch_failure(
                        "dispatch_connect_failed",
                        format!("failed to connect action `{}`: {message}", action.id),
                        step_id,
                        action_id,
                        on_error.clone(),
                    )
                })?;
            comm::send_tcp_hmip_frame(&state, connection_id, frame).await
        }
        Some("serial") => {
            let config =
                build_serial_connection_config(connection, step_id, action_id, on_error.clone())?;
            comm::ensure_serial_connection(&state, app, connection_id, config)
                .await
                .map_err(|message| {
                    dispatch_failure(
                        "dispatch_connect_failed",
                        format!("failed to connect action `{}`: {message}", action.id),
                        step_id,
                        action_id,
                        on_error.clone(),
                    )
                })?;
            comm::send_serial_hmip_frame(&state, connection_id, frame).await
        }
        Some(other) => {
            return Err(dispatch_failure(
                "unsupported_connection_kind",
                format!(
                    "connection `{}` uses unsupported kind `{other}` for HMIP dispatch",
                    connection.id
                ),
                step_id,
                action_id,
                on_error,
            ))
        }
        None => {
            return Err(dispatch_failure(
                "missing_connection_kind",
                format!("connection `{}` misses `kind`", connection.id),
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
        "action `{}` dispatched via {} connection `{}` (seq={seq})",
        action.id,
        connection.kind.as_deref().unwrap_or("unknown"),
        connection_id
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
        transport.chip_path.as_deref(),
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

fn build_tcp_connection_config(
    connection: &ConnectionDefinition,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> Result<crate::comm::tcp::TcpConfig, RecipeRuntimeFailure> {
    let tcp = connection.tcp.as_ref().ok_or_else(|| {
        dispatch_failure(
            "missing_connection_tcp_config",
            format!("connection `{}` misses TCP config", connection.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let defaults = crate::comm::tcp::TcpConfig::default();
    let host = tcp
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            dispatch_failure(
                "missing_connection_tcp_host",
                format!("connection `{}` misses TCP `host`", connection.id),
                step_id,
                action_id,
                on_error.clone(),
            )
        })?;
    let port = tcp.port.ok_or_else(|| {
        dispatch_failure(
            "missing_connection_tcp_port",
            format!("connection `{}` misses TCP `port`", connection.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    Ok(crate::comm::tcp::TcpConfig {
        host: host.to_string(),
        port,
        timeout_ms: tcp.timeout_ms.unwrap_or(defaults.timeout_ms),
    })
}

fn build_serial_connection_config(
    connection: &ConnectionDefinition,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
) -> Result<crate::comm::serial::SerialConfig, RecipeRuntimeFailure> {
    let serial = connection.serial.as_ref().ok_or_else(|| {
        dispatch_failure(
            "missing_connection_serial_config",
            format!("connection `{}` misses serial config", connection.id),
            step_id,
            action_id,
            on_error.clone(),
        )
    })?;

    let defaults = crate::comm::serial::SerialConfig::default();
    let port = serial
        .port
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            dispatch_failure(
                "missing_connection_serial_port",
                format!("connection `{}` misses serial `port`", connection.id),
                step_id,
                action_id,
                on_error.clone(),
            )
        })?;

    Ok(crate::comm::serial::SerialConfig {
        port: port.to_string(),
        baud_rate: serial.baud_rate.unwrap_or(defaults.baud_rate),
        data_bits: serial.data_bits.unwrap_or(defaults.data_bits),
        stop_bits: serial.stop_bits.unwrap_or(defaults.stop_bits),
        parity: serial
            .parity
            .clone()
            .unwrap_or_else(|| defaults.parity.clone()),
    })
}

async fn write_gpio_value(
    chip_path: Option<&str>,
    pin: u32,
    active_low: Option<bool>,
    value: bool,
) -> Result<(), String> {
    let chip_path = chip_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_GPIO_CHIP_PATH)
        .to_string();
    let active_low = active_low.unwrap_or(false);

    #[cfg(test)]
    {
        let override_fn = gpio_write_override()
            .lock()
            .expect("gpio override mutex poisoned")
            .clone();
        if let Some(override_fn) = override_fn {
            return override_fn(&chip_path, pin, active_low, value);
        }
    }

    let chip_path_for_request = chip_path.clone();
    let handle = tokio::task::spawn_blocking(move || {
        ensure_gpio_line_handle(&chip_path_for_request, pin, active_low, value)
    })
    .await
    .map_err(|error| format!("gpio write task join failed: {error}"))??;

    tokio::task::spawn_blocking(move || {
        let guard = handle
            .lock()
            .map_err(|_| "gpio handle mutex poisoned".to_string())?;
        guard
            .set_value(if value { 1 } else { 0 })
            .map_err(|error| format!("failed to write gpio line {pin} on `{chip_path}`: {error}"))
    })
    .await
    .map_err(|error| format!("gpio set_value task join failed: {error}"))?
}

fn ensure_gpio_line_handle(
    chip_path: &str,
    pin: u32,
    active_low: bool,
    initial_value: bool,
) -> Result<Arc<Mutex<LineHandle>>, String> {
    let key = format!("{chip_path}:{pin}");
    let stale_handle = {
        let mut handles = gpio_output_handles()
            .lock()
            .map_err(|_| "gpio handle registry mutex poisoned".to_string())?;
        if let Some(managed) = handles.get(&key) {
            if managed.active_low == active_low {
                return Ok(managed.handle.clone());
            }
        }
        handles.remove(&key)
    };
    drop(stale_handle);

    let mut flags = LineRequestFlags::OUTPUT;
    if active_low {
        flags |= LineRequestFlags::ACTIVE_LOW;
    }
    let mut chip = Chip::new(chip_path)
        .map_err(|error| format!("failed to open gpio chip `{chip_path}`: {error}"))?;
    let line = chip
        .get_line(pin)
        .map_err(|error| format!("failed to access gpio line {pin} on `{chip_path}`: {error}"))?;
    let handle = Arc::new(Mutex::new(
        line.request(
            flags,
            if initial_value { 1 } else { 0 },
            GPIO_CONSUMER_LABEL,
        )
        .map_err(|error| format!("failed to request gpio line {pin} on `{chip_path}`: {error}"))?,
    ));

    let mut handles = gpio_output_handles()
        .lock()
        .map_err(|_| "gpio handle registry mutex poisoned".to_string())?;
    handles.insert(
        key,
        ManagedGpioHandle {
            active_low,
            handle: handle.clone(),
        },
    );

    Ok(handle)
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
