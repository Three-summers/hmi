use crate::comm::{serial, tcp, CommState};
use crate::sensor::SensorSimulator;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use std::path::PathBuf;

/// 获取 Log 目录路径
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    // 获取日志目录：开发模式使用工程根目录下的 Log；发布模式使用资源目录同级的 Log
    let log_dir: PathBuf = if cfg!(debug_assertions) {
        // 开发模式：使用编译期的 CARGO_MANIFEST_DIR
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Log")
    } else {
        // 发布模式：使用资源目录同级的 Log（找不到父目录则退化到资源目录下）
        let exe_dir = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?;
        exe_dir
            .parent()
            .map(|p| p.join("Log"))
            .unwrap_or_else(|| exe_dir.join("Log"))
    };

    // 目录不存在则创建
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create Log directory: {}", e))?;
    }

    log_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

/// 获取可用串口列表
#[tauri::command]
pub async fn get_serial_ports() -> Result<Vec<String>, String> {
    serial::list_ports()
}

/// 连接串口
#[tauri::command]
pub async fn connect_serial(
    state: State<'_, CommState>,
    config: serial::SerialConfig,
) -> Result<(), String> {
    let conn = serial::SerialConnection::new(config)?;
    let mut serial_lock = state.serial.lock().await;
    *serial_lock = Some(conn);
    Ok(())
}

/// 断开串口
#[tauri::command]
pub async fn disconnect_serial(state: State<'_, CommState>) -> Result<(), String> {
    let mut serial_lock = state.serial.lock().await;
    *serial_lock = None;
    Ok(())
}

/// 通过串口发送数据
#[tauri::command]
pub async fn send_serial_data(state: State<'_, CommState>, data: Vec<u8>) -> Result<(), String> {
    let mut serial_lock = state.serial.lock().await;
    if let Some(ref mut conn) = *serial_lock {
        conn.send(&data).await
    } else {
        Err("Serial port not connected".to_string())
    }
}

/// 连接 TCP 服务
#[tauri::command]
pub async fn connect_tcp(
    state: State<'_, CommState>,
    config: tcp::TcpConfig,
) -> Result<(), String> {
    let conn = tcp::TcpConnection::new(config).await?;
    let mut tcp_lock = state.tcp.lock().await;
    *tcp_lock = Some(conn);
    Ok(())
}

/// 断开 TCP
#[tauri::command]
pub async fn disconnect_tcp(state: State<'_, CommState>) -> Result<(), String> {
    let mut tcp_lock = state.tcp.lock().await;
    *tcp_lock = None;
    Ok(())
}

/// 通过 TCP 发送数据
#[tauri::command]
pub async fn send_tcp_data(state: State<'_, CommState>, data: Vec<u8>) -> Result<(), String> {
    let mut tcp_lock = state.tcp.lock().await;
    if let Some(ref mut conn) = *tcp_lock {
        conn.send(&data).await
    } else {
        Err("TCP not connected".to_string())
    }
}

/// 启动传感器数据模拟
#[tauri::command]
pub fn start_sensor_simulation(
    app: AppHandle,
    state: State<'_, SensorSimulator>,
) -> Result<(), String> {
    state.start(app);
    Ok(())
}

/// 停止传感器数据模拟
#[tauri::command]
pub fn stop_sensor_simulation(state: State<'_, SensorSimulator>) -> Result<(), String> {
    state.stop();
    Ok(())
}

/// 前端日志批量转发：用于把 WebView 内的 console/错误等信息输出到终端，便于调试。
///
/// 设计要点：
/// - 前端通过批量发送减少跨边界调用次数，降低性能影响
/// - 后端统一打到 `frontend` target，便于在终端中过滤/检索
#[derive(Debug, Clone, Deserialize)]
pub struct FrontendLogEntry {
    pub level: String,
    pub message: String,
    pub timestamp_ms: Option<u64>,
    pub source: Option<String>,
}

#[tauri::command]
pub fn frontend_log_batch(entries: Vec<FrontendLogEntry>) {
    for entry in entries {
        let ts = entry
            .timestamp_ms
            .map(|v| format!(" ts={}", v))
            .unwrap_or_default();
        let src = entry
            .source
            .as_ref()
            .map(|v| format!(" src={}", v))
            .unwrap_or_default();
        let prefix = format!("[FE {}{}{}]", entry.level, ts, src);

        match entry.level.as_str() {
            "error" => log::error!(target: "frontend", "{} {}", prefix, entry.message),
            "warn" => log::warn!(target: "frontend", "{} {}", prefix, entry.message),
            _ => log::info!(target: "frontend", "{} {}", prefix, entry.message),
        }
    }
}
