mod comm;
mod commands;
mod sensor;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_serial_ports,
            commands::connect_serial,
            commands::disconnect_serial,
            commands::send_serial_data,
            commands::connect_tcp,
            commands::disconnect_tcp,
            commands::send_tcp_data,
            commands::start_sensor_simulation,
            commands::stop_sensor_simulation,
        ])
        .setup(|app| {
            // Initialize communication state
            app.manage(comm::CommState::default());
            // Initialize sensor simulator
            app.manage(sensor::SensorSimulator::default());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
