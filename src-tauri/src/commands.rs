use crate::comm::{actor::CommPriority, serial, tcp, CommState, HmipOutboundFrame};
use crate::craftsmanship;
use crate::dilution;
use crate::log_paths;
use crate::secs_rpc::{self, SecsRpcTarget};
use crate::system;
use serde::Deserialize;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_system_overview() -> Result<system::SystemOverview, String> {
    // CPU 采样内部包含 120ms 睡眠 + df 子进程，必须放到阻塞线程池，避免卡 UI/异步线程
    tauri::async_runtime::spawn_blocking(system::read_system_overview)
        .await
        .map_err(|e| format!("system overview task failed: {e}"))?
}

/// 扫描工艺 workspace，读取系统目录与项目摘要。
#[tauri::command]
pub async fn craftsmanship_scan_workspace(
    workspace_root: String,
) -> Result<craftsmanship::CraftsmanshipWorkspaceSummary, String> {
    tauri::async_runtime::spawn_blocking(move || craftsmanship::scan_workspace(&workspace_root))
        .await
        .map_err(|e| format!("workspace scan task failed: {e}"))?
}

/// 读取单个项目的完整工艺资源包。
#[tauri::command]
pub async fn craftsmanship_get_project_bundle(
    workspace_root: String,
    project_id: String,
) -> Result<craftsmanship::CraftsmanshipProjectBundle, String> {
    tauri::async_runtime::spawn_blocking(move || {
        craftsmanship::get_project_bundle(&workspace_root, &project_id)
    })
    .await
    .map_err(|e| format!("project bundle task failed: {e}"))?
}

/// 读取单个工艺文件及其关联资源。
#[tauri::command]
pub async fn craftsmanship_get_recipe_bundle(
    workspace_root: String,
    project_id: String,
    recipe_id: String,
) -> Result<craftsmanship::CraftsmanshipRecipeBundle, String> {
    tauri::async_runtime::spawn_blocking(move || {
        craftsmanship::get_recipe_bundle(&workspace_root, &project_id, &recipe_id)
    })
    .await
    .map_err(|e| format!("recipe bundle task failed: {e}"))?
}

/// 加载一个 recipe 到运行时，并重置当前运行快照。
#[tauri::command]
pub async fn craftsmanship_runtime_load_recipe(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
    workspace_root: String,
    project_id: String,
    recipe_id: String,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state
        .load_recipe(Some(&app), workspace_root, project_id, recipe_id)
        .await
}

/// 启动已加载的 recipe runtime。
#[tauri::command]
pub async fn craftsmanship_runtime_start(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state.start(Some(app)).await
}

/// 使用本次运行输入启动已加载的 recipe runtime。
#[tauri::command]
pub async fn craftsmanship_runtime_start_with_input(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
    input: craftsmanship::RecipeRuntimeRunInput,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state.start_with_input(Some(app), input).await
}

/// 请求停止当前 recipe runtime。
#[tauri::command]
pub async fn craftsmanship_runtime_stop(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
    reason: Option<String>,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state.stop(Some(&app), reason).await
}

/// 读取当前 recipe runtime 快照。
#[tauri::command]
pub async fn craftsmanship_runtime_get_status(
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    Ok(state.get_status().await)
}

/// 向运行时写入逻辑信号值，用于等待条件与联锁判断。
#[tauri::command]
pub async fn craftsmanship_runtime_write_signal(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
    signal_id: String,
    value: serde_json::Value,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state.write_signal(Some(&app), signal_id, value).await
}

/// 向运行时写入设备反馈值，用于 deviceFeedback 完成判定。
#[tauri::command]
pub async fn craftsmanship_runtime_write_device_feedback(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
    device_id: String,
    key: String,
    value: serde_json::Value,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state
        .write_device_feedback(Some(&app), device_id, key, value)
        .await
}

/// 从外部 adapter 写入统一运行输入，并记录 source/timestamp 元数据。
#[tauri::command]
pub async fn craftsmanship_runtime_apply_input(
    app: AppHandle,
    state: State<'_, craftsmanship::RecipeRuntimeManager>,
    input: craftsmanship::RecipeRuntimeExternalInput,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state.apply_external_input(Some(&app), input).await
}

/// 创建一个光阻稀释批次。外部 PRMS/设备由后端 adapter 提供，当前默认注入 mock adapter。
#[tauri::command]
pub fn dilution_create_batch(
    state: State<'_, dilution::DilutionManager>,
    request: dilution::CreateBatchRequest,
) -> Result<dilution::Batch, String> {
    state.create_batch(request)
}

/// 读取单个光阻稀释批次。
#[tauri::command]
pub fn dilution_get_batch(
    state: State<'_, dilution::DilutionManager>,
    batch_id: String,
) -> Result<dilution::Batch, String> {
    state.get_batch(batch_id.as_str())
}

/// 列出当前进程内的光阻稀释批次。
#[tauri::command]
pub fn dilution_list_batches(
    state: State<'_, dilution::DilutionManager>,
) -> Result<Vec<dilution::Batch>, String> {
    state.list_batches()
}

/// 读取已完成批次的报表数据。
#[tauri::command]
pub fn dilution_get_report(
    state: State<'_, dilution::DilutionManager>,
    batch_id: String,
) -> Result<dilution::DilutionReport, String> {
    state.get_report(batch_id.as_str())
}

/// 扫描原液 barcode，并通过 PRMS adapter 返回 mapping。
///
/// async：adapter 调用（未来为真实 PRMS/设备 IO）不应占用 UI 主线程。
#[tauri::command]
pub async fn dilution_scan_raw_resist(
    state: State<'_, dilution::DilutionManager>,
    request: dilution::ScanRawResistRequest,
) -> Result<dilution::Batch, String> {
    state.scan_raw_resist(request)
}

/// 多浓度 mapping 下选择稀释浓度并锁定 recipe。
#[tauri::command]
pub fn dilution_select_concentration(
    state: State<'_, dilution::DilutionManager>,
    request: dilution::SelectConcentrationRequest,
) -> Result<dilution::Batch, String> {
    state.select_concentration(request)
}

/// 执行一条完整批次。当前默认 adapter 使用虚拟 PRMS/设备数据，真实设备接入后复用此入口。
///
/// async：批次执行包含 adapter 顺序调用与多次写盘，不应占用 UI 主线程。
#[tauri::command]
pub async fn dilution_run_batch(
    state: State<'_, dilution::DilutionManager>,
    request: dilution::RunBatchRequest,
) -> Result<dilution::Batch, String> {
    state.run_batch(request)
}

/// 兼容旧前端命令名：内部仍走通用批次执行入口。
#[tauri::command]
pub async fn dilution_run_mock_batch(
    state: State<'_, dilution::DilutionManager>,
    request: dilution::RunMockBatchRequest,
) -> Result<dilution::Batch, String> {
    state.run_batch(request)
}

/// 获取 Log 目录路径
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    let log_dir = log_paths::ensure_log_dir(log_paths::resolve_log_dir(Some(&app))?)?;

    log_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

// 注：save_spectrum_screenshot 已随频谱功能一并移除。
// 本分支前端已无截图入口；该命令等价于由 WebView 任意指定目录/文件名/内容的
// 写文件原语，属于无调用方的攻击面。

/// 获取可用串口列表
#[tauri::command]
pub async fn get_serial_ports() -> Result<Vec<String>, String> {
    // 串口枚举是阻塞调用，放入阻塞线程池执行
    tauri::async_runtime::spawn_blocking(serial::list_ports)
        .await
        .map_err(|e| format!("serial port scan task failed: {e}"))?
}

/// 连接串口
#[tauri::command]
pub async fn connect_serial(
    app: AppHandle,
    state: State<'_, CommState>,
    config: serial::SerialConfig,
    connection_id: Option<String>,
) -> Result<(), String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_SERIAL_CONNECTION_ID);
    crate::comm::connect_serial(&state, &app, connection_id, config).await
}

/// 断开串口
#[tauri::command]
pub async fn disconnect_serial(
    state: State<'_, CommState>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_SERIAL_CONNECTION_ID);
    crate::comm::disconnect_connection(&state, connection_id).await
}

/// 通过串口发送数据
#[tauri::command]
pub async fn send_serial_data(
    state: State<'_, CommState>,
    data: Vec<u8>,
    priority: Option<CommPriority>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_SERIAL_CONNECTION_ID);
    crate::comm::send_serial_data_bytes(&state, connection_id, data, priority.unwrap_or_default())
        .await
}

/// 连接 TCP 服务
#[tauri::command]
pub async fn connect_tcp(
    app: AppHandle,
    state: State<'_, CommState>,
    config: tcp::TcpConfig,
    connection_id: Option<String>,
) -> Result<(), String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_TCP_CONNECTION_ID);
    crate::comm::connect_tcp(&state, &app, connection_id, config).await
}

/// 断开 TCP
#[tauri::command]
pub async fn disconnect_tcp(
    state: State<'_, CommState>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_TCP_CONNECTION_ID);
    crate::comm::disconnect_connection(&state, connection_id).await
}

/// 通过 TCP 发送数据
#[tauri::command]
pub async fn send_tcp_data(
    state: State<'_, CommState>,
    data: Vec<u8>,
    priority: Option<CommPriority>,
    connection_id: Option<String>,
) -> Result<(), String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_TCP_CONNECTION_ID);
    crate::comm::send_tcp_data_bytes(&state, connection_id, data, priority.unwrap_or_default())
        .await
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

#[tauri::command]
pub async fn send_tcp_hmip_frame(
    state: State<'_, CommState>,
    frame: HmipSendFrame,
    connection_id: Option<String>,
) -> Result<u32, String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_TCP_CONNECTION_ID);
    crate::comm::send_tcp_hmip_frame(
        &state,
        connection_id,
        HmipOutboundFrame {
            msg_type: frame.msg_type,
            flags: frame.flags.unwrap_or(0),
            channel: frame.channel.unwrap_or(0),
            seq: frame.seq,
            payload: frame.payload,
            priority: frame.priority.unwrap_or_default(),
        },
    )
    .await
}

#[tauri::command]
pub async fn send_serial_hmip_frame(
    state: State<'_, CommState>,
    frame: HmipSendFrame,
    connection_id: Option<String>,
) -> Result<u32, String> {
    let connection_id = connection_id
        .as_deref()
        .unwrap_or(crate::comm::DEFAULT_SERIAL_CONNECTION_ID);
    crate::comm::send_serial_hmip_frame(
        &state,
        connection_id,
        HmipOutboundFrame {
            msg_type: frame.msg_type,
            flags: frame.flags.unwrap_or(0),
            channel: frame.channel.unwrap_or(0),
            seq: frame.seq,
            payload: frame.payload,
            priority: frame.priority.unwrap_or_default(),
        },
    )
    .await
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
