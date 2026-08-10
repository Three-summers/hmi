mod comm;
mod commands;
mod craftsmanship;
mod dilution;
mod log_paths;
mod secs_rpc;
mod system;

use tauri::Manager;
use tauri_plugin_log::{Builder as LogBuilder, Target, TargetKind};

// cfg_attr(条件, 属性...) 意思是当条件为真则将后面的属性贴到这个项上，如果为假则无作用
// 这里如果为真，就为 #[tauri::mobile_entry_point]
// #[cfg(条件) 与 cfg! 不同，第一个在条件为假时根本不参与编译
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 统一日志输出：使用 tauri-plugin-log 将 Rust/前端转发日志输出到终端（Stdout）
    // 说明：
    // - 开发模式默认更详细，便于调试
    // - 发布模式保持较低日志等级，避免影响正常使用性能
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
        .plugin(
            LogBuilder::default()
                .level(log_level)
                // 仅输出到终端，避免默认 LogDir 产生额外文件写入开销
                .clear_targets()
                .target(Target::new(TargetKind::Stdout))
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_system_overview,
            commands::craftsmanship_scan_workspace,
            commands::craftsmanship_get_project_bundle,
            commands::craftsmanship_get_recipe_bundle,
            commands::craftsmanship_runtime_load_recipe,
            commands::craftsmanship_runtime_start,
            commands::craftsmanship_runtime_start_with_input,
            commands::craftsmanship_runtime_stop,
            commands::craftsmanship_runtime_get_status,
            commands::craftsmanship_runtime_write_signal,
            commands::craftsmanship_runtime_write_device_feedback,
            commands::craftsmanship_runtime_apply_input,
            commands::dilution_create_batch,
            commands::dilution_get_batch,
            commands::dilution_list_batches,
            commands::dilution_get_report,
            commands::dilution_scan_raw_resist,
            commands::dilution_select_concentration,
            commands::dilution_run_batch,
            commands::dilution_get_config,
            commands::get_log_dir,
            commands::get_serial_ports,
            commands::connect_serial,
            commands::disconnect_serial,
            commands::send_serial_data,
            commands::connect_tcp,
            commands::disconnect_tcp,
            commands::send_tcp_data,
            commands::send_tcp_hmip_frame,
            commands::send_serial_hmip_frame,
            commands::frontend_log_batch,
            commands::secs_rpc_get_library_info,
            commands::secs_rpc_list_sessions,
            commands::secs_rpc_get_session,
            commands::secs_rpc_create_session,
            commands::secs_rpc_start_session,
            commands::secs_rpc_stop_session,
            commands::secs_rpc_delete_session,
            commands::secs_rpc_send,
            commands::secs_rpc_request,
        ])
        .setup(|app| {
            // 初始化通信状态
            app.manage(comm::CommState::default());
            // 初始化工艺运行时
            app.manage(craftsmanship::RecipeRuntimeManager::default());
            // 初始化光阻稀释领域状态
            let log_dir =
                log_paths::ensure_log_dir(log_paths::resolve_log_dir(Some(app.handle()))?)?;
            let workspace_root = if cfg!(debug_assertions) {
                dilution::default_workspace_root()
            } else {
                app.path()
                    .resource_dir()
                    .map_err(|error| format!("failed to resolve bundled workspace: {error}"))?
                    .join("workspace")
            };
            // PRMS SOAP 地址通过 env PRMS_SOAP_ENDPOINT 配置；未配置时使用 mock adapter
            let dilution_manager = match std::env::var("PRMS_SOAP_ENDPOINT") {
                Ok(endpoint) if !endpoint.trim().is_empty() => {
                    log::info!("dilution: using real PRMS SOAP endpoint {endpoint}");
                    dilution::DilutionManager::new_with(
                        log_dir,
                        workspace_root.clone(),
                        dilution::DEFAULT_PROJECT_ID.to_string(),
                        std::sync::Arc::new(dilution::SoapPrmsClient::new(endpoint)),
                        std::sync::Arc::new(dilution::MockDilutionDeviceGateway),
                    )
                }
                _ => {
                    log::info!("dilution: PRMS_SOAP_ENDPOINT not set; using mock PRMS adapter");
                    dilution::DilutionManager::new_mock_with_log_root_and_workspace(
                        log_dir,
                        workspace_root,
                    )
                }
            };
            app.manage(dilution_manager);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
