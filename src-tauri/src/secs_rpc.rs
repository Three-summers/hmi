use serde::{Deserialize, Serialize};
use std::time::Duration;
use tonic::transport::{Channel, Endpoint};

pub mod v1 {
    tonic::include_proto!("secs.rpc.v1");
}

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:50051";
const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_TCP_KEEPALIVE_SECS: u64 = 30;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecsRpcTarget {
    pub endpoint: Option<String>,
    pub connect_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
}

pub fn normalize_endpoint(endpoint: Option<&str>) -> Result<String, String> {
    let endpoint = endpoint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_ENDPOINT);

    if endpoint.contains("://") {
        return Ok(endpoint.to_string());
    }

    Ok(format!("http://{endpoint}"))
}

pub fn request_timeout(target: Option<&SecsRpcTarget>) -> Duration {
    Duration::from_millis(
        target
            .and_then(|value| value.request_timeout_ms)
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS),
    )
}

pub fn into_request<T>(message: T, target: Option<&SecsRpcTarget>) -> tonic::Request<T> {
    let mut request = tonic::Request::new(message);
    request.set_timeout(request_timeout(target));
    request
}

pub async fn connect_channel(target: Option<&SecsRpcTarget>) -> Result<Channel, String> {
    let endpoint = normalize_endpoint(target.and_then(|value| value.endpoint.as_deref()))?;
    let connect_timeout = Duration::from_millis(
        target
            .and_then(|value| value.connect_timeout_ms)
            .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS),
    );

    Endpoint::from_shared(endpoint.clone())
        .map_err(|error| format!("Invalid secs RPC endpoint `{endpoint}`: {error}"))?
        .connect_timeout(connect_timeout)
        .timeout(request_timeout(target))
        .tcp_keepalive(Some(Duration::from_secs(DEFAULT_TCP_KEEPALIVE_SECS)))
        .connect()
        .await
        .map_err(|error| format!("Failed to connect secs RPC endpoint `{endpoint}`: {error}"))
}

pub fn format_status_error(operation: &str, status: tonic::Status) -> String {
    format!(
        "secs RPC {operation} failed (code={}): {}",
        status.code(),
        status.message()
    )
}
