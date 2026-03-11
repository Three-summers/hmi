use serde::{Deserialize, Serialize};
use std::time::Duration;
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

pub async fn open_stream(config: &TcpConfig) -> Result<TcpStream, String> {
    let addr = format!("{}:{}", config.host, config.port);
    // 这里是两层 Result, 第一层是 timeout 的错误，第二层是 TcpStream::connect 的错误
    // 所以第一个 map_err 是处理 timeout 的错误，第二个 map_err 是处理连接失败的错误
    let stream = tokio::time::timeout(
        Duration::from_millis(config.timeout_ms),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| "Connection timeout".to_string())?
    .map_err(|e| format!("Failed to connect: {}", e))?;

    // 工业现场常见：希望尽量减少交互延迟，TCP_NODELAY 可以减少小包延迟
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

