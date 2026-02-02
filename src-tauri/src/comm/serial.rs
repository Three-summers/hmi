use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_serial::{
    DataBits, Parity, SerialPortBuilderExt, SerialPortBuilder, SerialStream, StopBits,
};

// 使用 serde 使其可以序列化和反序列化
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self {
            port: String::new(),
            baud_rate: 9600,
            data_bits: 8,
            stop_bits: 1,
            parity: "none".to_string(),
        }
    }
}

fn map_data_bits(value: u8) -> DataBits {
    match value {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    }
}

fn map_stop_bits(value: u8) -> StopBits {
    match value {
        2 => StopBits::Two,
        _ => StopBits::One,
    }
}

fn map_parity(value: &str) -> Parity {
    match value.to_ascii_lowercase().as_str() {
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        _ => Parity::None,
    }
}

pub fn build_port(config: &SerialConfig) -> SerialPortBuilder {
    tokio_serial::new(&config.port, config.baud_rate)
        .data_bits(map_data_bits(config.data_bits))
        .stop_bits(map_stop_bits(config.stop_bits))
        .parity(map_parity(&config.parity))
        // 读超时：避免永久阻塞在 read
        .timeout(Duration::from_millis(100))
}

pub fn open_stream(config: &SerialConfig) -> Result<SerialStream, String> {
    build_port(config)
        .open_native_async()
        .map_err(|e| format!("Failed to open serial port: {}", e))
}

/// List available serial ports
pub fn list_ports() -> Result<Vec<String>, String> {
    let ports = tokio_serial::available_ports()
        .map_err(|e| format!("Failed to list ports: {}", e))?;

    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

