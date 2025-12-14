use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TcpConfig {
    pub host: String,
    pub port: u16,
    pub timeout_ms: u64,
}

impl Default for TcpConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 502,
            timeout_ms: 5000,
        }
    }
}

pub struct TcpConnection {
    stream: TcpStream,
    config: TcpConfig,
}

impl TcpConnection {
    pub async fn new(config: TcpConfig) -> Result<Self, String> {
        let addr = format!("{}:{}", config.host, config.port);
        let stream = tokio::time::timeout(
            Duration::from_millis(config.timeout_ms),
            TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| "Connection timeout".to_string())?
        .map_err(|e| format!("Failed to connect: {}", e))?;

        Ok(Self { stream, config })
    }

    pub async fn send(&mut self, data: &[u8]) -> Result<(), String> {
        self.stream
            .write_all(data)
            .await
            .map_err(|e| format!("Failed to send data: {}", e))
    }

    pub async fn receive(&mut self, buffer: &mut [u8]) -> Result<usize, String> {
        self.stream
            .read(buffer)
            .await
            .map_err(|e| format!("Failed to receive data: {}", e))
    }

    pub fn config(&self) -> &TcpConfig {
        &self.config
    }
}
