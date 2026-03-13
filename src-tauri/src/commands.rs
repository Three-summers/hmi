use crate::comm::{actor::CommPriority, proto, serial, tcp, CommState};
use crate::secs_rpc::{self, SecsRpcTarget};
use crate::sensor::SensorSimulator;
use crate::system;
use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc::error::TrySendError;

static HMIP_NEXT_SEQ: AtomicU32 = AtomicU32::new(1);

#[tauri::command]
pub fn get_system_overview() -> Result<system::SystemOverview, String> {
    system::read_system_overview()
}

/// 获取 Log 目录路径
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    // 获取日志目录：开发模式使用工程根目录下的 Log；发布模式使用资源目录同级的 Log
    let log_dir: PathBuf = if cfg!(debug_assertions) {
        // 开发模式：使用编译期的 CARGO_MANIFEST_DIR
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Log")
    } else {
        // 发布模式：使用资源目录同级的 Log（找不到父目录则退化到资源目录下）
        let exe_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
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

/// 保存频谱分析仪截图到系统下载目录
///
/// 说明：
/// - 由前端传入 PNG 的 base64（DataURL 去掉前缀部分）
/// - 默认保存到系统下载目录；若无法获取下载目录则回退到 Log 目录
/// - 后端负责写盘，避免前端引入额外 FS 依赖导致入口 chunk 膨胀
#[tauri::command]
pub fn save_spectrum_screenshot(
    app: AppHandle,
    filename: String,
    data_base64: String,
    directory: Option<String>,
) -> Result<String, String> {
    if filename.trim().is_empty() {
        return Err("filename is empty".to_string());
    }

    // 简单约束：避免 filename 带路径分隔符导致写入到意外位置
    if filename.contains('/') || filename.contains('\\') {
        return Err("filename contains invalid path separator".to_string());
    }

    let base_dir: PathBuf = if let Some(dir) = directory {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            return Err("directory is empty".to_string());
        }
        PathBuf::from(trimmed)
    } else {
        let app_clone = app.clone();
        app.path()
            .download_dir()
            .map_err(|e| e.to_string())
            .or_else(|_| get_log_dir(app_clone).map(PathBuf::from))?
    };

    // 若目录不存在则创建（用户选择目录一般已存在，但这里做兜底）
    if !base_dir.exists() {
        std::fs::create_dir_all(&base_dir)
            .map_err(|e| format!("Failed to create screenshot directory: {}", e))?;
    }

    let file_path = base_dir.join(&filename);

    let png_bytes = general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Failed to decode screenshot base64: {}", e))?;

    std::fs::write(&file_path, png_bytes)
        .map_err(|e| format!("Failed to write screenshot file: {}", e))?;

    file_path
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
    app: AppHandle,
    state: State<'_, CommState>,
    config: serial::SerialConfig,
) -> Result<(), String> {
    let stream = serial::open_stream(&config)?;
    let handle = crate::comm::actor::spawn_serial_actor(app, config.clone(), stream);

    let old = {
        let mut serial_lock = state.serial.lock().await;
        serial_lock.replace(handle)
    };
    if let Some(old) = old {
        old.shutdown().await;
    }
    Ok(())
}

/// 断开串口
#[tauri::command]
pub async fn disconnect_serial(state: State<'_, CommState>) -> Result<(), String> {
    let old = {
        let mut serial_lock = state.serial.lock().await;
        serial_lock.take()
    };
    if let Some(old) = old {
        old.shutdown().await;
    }
    Ok(())
}

/// 通过串口发送数据
#[tauri::command]
pub async fn send_serial_data(
    state: State<'_, CommState>,
    data: Vec<u8>,
    priority: Option<CommPriority>,
) -> Result<(), String> {
    let (tx_high, tx_normal) = {
        let serial_lock = state.serial.lock().await;
        let handle = serial_lock
            .as_ref()
            .ok_or_else(|| "Serial port not connected".to_string())?;
        (handle.tx_high.clone(), handle.tx_normal.clone())
    };

    let tx = match priority.unwrap_or_default() {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(data).map_err(|err| match err {
        TrySendError::Full(_) => "Serial write queue is full".to_string(),
        TrySendError::Closed(_) => "Serial connection is closed".to_string(),
    })
}

/// 连接 TCP 服务
#[tauri::command]
pub async fn connect_tcp(
    app: AppHandle,
    state: State<'_, CommState>,
    config: tcp::TcpConfig,
) -> Result<(), String> {
    let stream = tcp::open_stream(&config).await?;
    let handle = crate::comm::actor::spawn_tcp_actor(app, config.clone(), stream);

    let old = {
        let mut tcp_lock = state.tcp.lock().await;
        tcp_lock.replace(handle)
    };
    if let Some(old) = old {
        old.shutdown().await;
    }
    Ok(())
}

/// 断开 TCP
#[tauri::command]
pub async fn disconnect_tcp(state: State<'_, CommState>) -> Result<(), String> {
    let old = {
        let mut tcp_lock = state.tcp.lock().await;
        tcp_lock.take()
    };
    if let Some(old) = old {
        old.shutdown().await;
    }
    Ok(())
}

/// 通过 TCP 发送数据
#[tauri::command]
pub async fn send_tcp_data(
    state: State<'_, CommState>,
    data: Vec<u8>,
    priority: Option<CommPriority>,
) -> Result<(), String> {
    let (tx_high, tx_normal) = {
        let tcp_lock = state.tcp.lock().await;
        let handle = tcp_lock
            .as_ref()
            .ok_or_else(|| "TCP not connected".to_string())?;
        (handle.tx_high.clone(), handle.tx_normal.clone())
    };

    let tx = match priority.unwrap_or_default() {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(data).map_err(|err| match err {
        TrySendError::Full(_) => "TCP write queue is full".to_string(),
        TrySendError::Closed(_) => "TCP connection is closed".to_string(),
    })
}

// Deserialize 是 serde 生态中的一个特征表示一个类型可以从外部数据格式反序列化回来
// 比如从 Json/Toml 等格式反序列化成 Rust 结构体
#[derive(Debug, Clone, Deserialize)]
pub struct HmipSendFrame {
    pub msg_type: u8,
    pub flags: Option<u8>,
    pub channel: Option<u8>,
    pub seq: Option<u32>,
    pub payload: Vec<u8>,
    pub priority: Option<CommPriority>,
}

fn next_hmip_seq(seq: Option<u32>) -> u32 {
    seq.unwrap_or_else(|| HMIP_NEXT_SEQ.fetch_add(1, Ordering::Relaxed))
}

#[tauri::command]
pub async fn send_tcp_hmip_frame(
    state: State<'_, CommState>,
    frame: HmipSendFrame,
) -> Result<u32, String> {
    let (tx_high, tx_normal) = {
        let tcp_lock = state.tcp.lock().await;
        let handle = tcp_lock
            .as_ref()
            .ok_or_else(|| "TCP not connected".to_string())?;
        (handle.tx_high.clone(), handle.tx_normal.clone())
    };

    let seq = next_hmip_seq(frame.seq);
    let flags = frame.flags.unwrap_or(0);
    let channel = frame.channel.unwrap_or(0);
    let bytes = proto::encode_frame(proto::EncodeFrameParams {
        msg_type: frame.msg_type,
        flags,
        channel,
        seq,
        payload: &frame.payload,
    });

    let tx = match frame.priority.unwrap_or_default() {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(bytes).map_err(|err| match err {
        TrySendError::Full(_) => "TCP write queue is full".to_string(),
        TrySendError::Closed(_) => "TCP connection is closed".to_string(),
    })?;

    Ok(seq)
}

#[tauri::command]
pub async fn send_serial_hmip_frame(
    state: State<'_, CommState>,
    frame: HmipSendFrame,
) -> Result<u32, String> {
    let (tx_high, tx_normal) = {
        let serial_lock = state.serial.lock().await;
        let handle = serial_lock
            .as_ref()
            .ok_or_else(|| "Serial port not connected".to_string())?;
        (handle.tx_high.clone(), handle.tx_normal.clone())
    };

    let seq = next_hmip_seq(frame.seq);
    let flags = frame.flags.unwrap_or(0);
    let channel = frame.channel.unwrap_or(0);
    let bytes = proto::encode_frame(proto::EncodeFrameParams {
        msg_type: frame.msg_type,
        flags,
        channel,
        seq,
        payload: &frame.payload,
    });

    let tx = match frame.priority.unwrap_or_default() {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(bytes).map_err(|err| match err {
        TrySendError::Full(_) => "Serial write queue is full".to_string(),
        TrySendError::Closed(_) => "Serial connection is closed".to_string(),
    })?;

    Ok(seq)
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

#[tauri::command]
pub async fn secs_rpc_get_library_info(
    target: Option<SecsRpcTarget>,
) -> Result<secs_rpc::v1::GetLibraryInfoResponse, String> {
    let mut client = secs_rpc::v1::library_service_client::LibraryServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .get_library_info(secs_rpc::into_request(
            secs_rpc::v1::GetLibraryInfoRequest::default(),
            target.as_ref(),
        ))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("GetLibraryInfo", status))
}

#[tauri::command]
pub async fn secs_rpc_list_sessions(
    target: Option<SecsRpcTarget>,
) -> Result<secs_rpc::v1::ListSessionsResponse, String> {
    let mut client = secs_rpc::v1::session_service_client::SessionServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .list_sessions(secs_rpc::into_request(
            secs_rpc::v1::ListSessionsRequest::default(),
            target.as_ref(),
        ))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("ListSessions", status))
}

#[tauri::command]
pub async fn secs_rpc_get_session(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::GetSessionRequest,
) -> Result<secs_rpc::v1::GetSessionResponse, String> {
    let mut client = secs_rpc::v1::session_service_client::SessionServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .get_session(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("GetSession", status))
}

#[tauri::command]
pub async fn secs_rpc_create_session(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::CreateSessionRequest,
) -> Result<secs_rpc::v1::CreateSessionResponse, String> {
    let mut client = secs_rpc::v1::session_service_client::SessionServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .create_session(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("CreateSession", status))
}

#[tauri::command]
pub async fn secs_rpc_start_session(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::StartSessionRequest,
) -> Result<secs_rpc::v1::StartSessionResponse, String> {
    let mut client = secs_rpc::v1::session_service_client::SessionServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .start_session(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("StartSession", status))
}

#[tauri::command]
pub async fn secs_rpc_stop_session(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::StopSessionRequest,
) -> Result<secs_rpc::v1::StopSessionResponse, String> {
    let mut client = secs_rpc::v1::session_service_client::SessionServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .stop_session(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("StopSession", status))
}

#[tauri::command]
pub async fn secs_rpc_delete_session(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::DeleteSessionRequest,
) -> Result<secs_rpc::v1::DeleteSessionResponse, String> {
    let mut client = secs_rpc::v1::session_service_client::SessionServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .delete_session(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("DeleteSession", status))
}

#[tauri::command]
pub async fn secs_rpc_send(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::SendRequest,
) -> Result<secs_rpc::v1::SendResponse, String> {
    let mut client = secs_rpc::v1::messaging_service_client::MessagingServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .send(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("Send", status))
}

#[tauri::command]
pub async fn secs_rpc_request(
    target: Option<SecsRpcTarget>,
    request: secs_rpc::v1::RequestRequest,
) -> Result<secs_rpc::v1::RequestResponse, String> {
    let mut client = secs_rpc::v1::messaging_service_client::MessagingServiceClient::new(
        secs_rpc::connect_channel(target.as_ref()).await?,
    );

    client
        .request(secs_rpc::into_request(request, target.as_ref()))
        .await
        .map(|response| response.into_inner())
        .map_err(|status| secs_rpc::format_status_error("Request", status))
}
