// Windows 发布版：防止额外弹出控制台窗口（不要删除）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hmi_lib::run()
}
