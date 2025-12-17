use crate::comm::{serial, tcp, CommState};
use crate::sensor::SensorSimulator;
use tauri::{AppHandle, Manager, State};
use std::path::PathBuf;

/// Get the Log directory path
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    // Get application data directory for logs
    let log_dir: PathBuf = if cfg!(debug_assertions) {
        // Development mode: use compile-time CARGO_MANIFEST_DIR
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Log")
    } else {
        // Production mode: use exe directory's sibling Log folder
        let exe_dir = app.path().resource_dir()
            .map_err(|e| e.to_string())?;
        exe_dir.parent()
            .map(|p| p.join("Log"))
            .unwrap_or_else(|| exe_dir.join("Log"))
    };

    // Create the directory if it doesn't exist
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create Log directory: {}", e))?;
    }

    log_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

/// Get list of available serial ports
#[tauri::command]
pub async fn get_serial_ports() -> Result<Vec<String>, String> {
    serial::list_ports()
}

/// Connect to a serial port
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

/// Disconnect from serial port
#[tauri::command]
pub async fn disconnect_serial(state: State<'_, CommState>) -> Result<(), String> {
    let mut serial_lock = state.serial.lock().await;
    *serial_lock = None;
    Ok(())
}

/// Send data through serial port
#[tauri::command]
pub async fn send_serial_data(state: State<'_, CommState>, data: Vec<u8>) -> Result<(), String> {
    let mut serial_lock = state.serial.lock().await;
    if let Some(ref mut conn) = *serial_lock {
        conn.send(&data).await
    } else {
        Err("Serial port not connected".to_string())
    }
}

/// Connect to TCP server
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

/// Disconnect from TCP server
#[tauri::command]
pub async fn disconnect_tcp(state: State<'_, CommState>) -> Result<(), String> {
    let mut tcp_lock = state.tcp.lock().await;
    *tcp_lock = None;
    Ok(())
}

/// Send data through TCP connection
#[tauri::command]
pub async fn send_tcp_data(state: State<'_, CommState>, data: Vec<u8>) -> Result<(), String> {
    let mut tcp_lock = state.tcp.lock().await;
    if let Some(ref mut conn) = *tcp_lock {
        conn.send(&data).await
    } else {
        Err("TCP not connected".to_string())
    }
}

/// Start sensor data simulation
#[tauri::command]
pub fn start_sensor_simulation(
    app: AppHandle,
    state: State<'_, SensorSimulator>,
) -> Result<(), String> {
    state.start(app);
    Ok(())
}

/// Stop sensor data simulation
#[tauri::command]
pub fn stop_sensor_simulation(state: State<'_, SensorSimulator>) -> Result<(), String> {
    state.stop();
    Ok(())
}
