use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_serial::{SerialPortBuilderExt, SerialStream};

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

pub struct SerialConnection {
    port: SerialStream,
    config: SerialConfig,
}

impl SerialConnection {
    pub fn new(config: SerialConfig) -> Result<Self, String> {
        let port = tokio_serial::new(&config.port, config.baud_rate)
            .timeout(Duration::from_millis(100))
            .open_native_async()
            .map_err(|e| format!("Failed to open serial port: {}", e))?;

        Ok(Self { port, config })
    }

    pub async fn send(&mut self, data: &[u8]) -> Result<(), String> {
        AsyncWriteExt::write_all(&mut self.port, data)
            .await
            .map_err(|e| format!("Failed to send data: {}", e))
    }

    pub async fn receive(&mut self, buffer: &mut [u8]) -> Result<usize, String> {
        AsyncReadExt::read(&mut self.port, buffer)
            .await
            .map_err(|e| format!("Failed to receive data: {}", e))
    }

    pub fn config(&self) -> &SerialConfig {
        &self.config
    }
}

/// List available serial ports
pub fn list_ports() -> Result<Vec<String>, String> {
    let ports = tokio_serial::available_ports()
        .map_err(|e| format!("Failed to list ports: {}", e))?;

    Ok(ports.into_iter().map(|p| p.port_name).collect())
}
