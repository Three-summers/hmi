mod comm;
mod commands;
mod sensor;

use tauri::Manager;
use tauri_plugin_log::{Builder as LogBuilder, Target, TargetKind};

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
            commands::get_log_dir,
            commands::save_spectrum_screenshot,
            commands::get_serial_ports,
            commands::connect_serial,
            commands::disconnect_serial,
            commands::send_serial_data,
            commands::connect_tcp,
            commands::disconnect_tcp,
            commands::send_tcp_data,
            commands::send_tcp_hmip_frame,
            commands::send_serial_hmip_frame,
            commands::start_sensor_simulation,
            commands::stop_sensor_simulation,
            commands::frontend_log_batch,
        ])
        .setup(|app| {
            // 初始化通信状态
            app.manage(comm::CommState::default());
            // 初始化传感器模拟器
            app.manage(sensor::SensorSimulator::default());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
