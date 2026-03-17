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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    use tokio::process::{Child, Command};
    use tokio::time::sleep;

    const DEFAULT_SECS_RPC_SERVER_BIN: &str =
        "/home/say/github_project/secs_lib/build_rpc/tools/secs-rpc-server";
    const DEFAULT_SECS_RPC_PEER_BIN: &str =
        "/home/say/github_project/secs_lib/build_rpc/tests/test_rpc_hsms_peer";

    struct ProcessGuard {
        child: Child,
    }

    impl ProcessGuard {
        fn ensure_running(&mut self, process_name: &str, program: &Path) -> Result<(), String> {
            match self.child.try_wait().map_err(|error| {
                format!(
                    "failed to poll {process_name} `{}`: {error}",
                    program.display()
                )
            })? {
                Some(status) => Err(format!(
                    "{process_name} exited early with status {status}: {}",
                    program.display()
                )),
                None => Ok(()),
            }
        }

        async fn stop(mut self) {
            let _ = self.child.kill().await;
            let _ = self.child.wait().await;
        }
    }

    #[derive(Debug, Clone)]
    struct PeerTarget {
        listen_address: String,
        host: String,
        port: u32,
        session_id: u32,
    }

    fn resolve_server_bin() -> PathBuf {
        std::env::var("SECS_RPC_SERVER_BIN")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_SECS_RPC_SERVER_BIN))
    }

    fn resolve_peer_bin() -> PathBuf {
        std::env::var("SECS_RPC_TEST_PEER_BIN")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_SECS_RPC_PEER_BIN))
    }

    fn resolve_test_target() -> SecsRpcTarget {
        let endpoint = std::env::var("SECS_RPC_TEST_ENDPOINT")
            .unwrap_or_else(|_| "127.0.0.1:50051".to_string());

        build_test_target(endpoint)
    }

    fn build_test_target(endpoint: String) -> SecsRpcTarget {
        SecsRpcTarget {
            endpoint: Some(endpoint),
            connect_timeout_ms: Some(500),
            request_timeout_ms: Some(1_500),
        }
    }

    fn reserve_loopback_address() -> Result<String, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("failed to reserve loopback port: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("failed to read reserved loopback port: {error}"))?;
        drop(listener);
        Ok(address.to_string())
    }

    fn resolve_spawned_test_target() -> Result<SecsRpcTarget, String> {
        match std::env::var("SECS_RPC_TEST_ENDPOINT") {
            Ok(endpoint) => Ok(build_test_target(endpoint)),
            Err(_) => reserve_loopback_address().map(build_test_target),
        }
    }

    fn resolve_peer_target() -> Result<PeerTarget, String> {
        let listen_address = std::env::var("SECS_RPC_TEST_PEER_ENDPOINT")
            .unwrap_or_else(|_| "127.0.0.1:50061".to_string());
        build_peer_target(listen_address)
    }

    fn build_peer_target(listen_address: String) -> Result<PeerTarget, String> {
        let session_id = std::env::var("SECS_RPC_TEST_SESSION_ID")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(1);

        let (host, port_text) = listen_address
            .rsplit_once(':')
            .ok_or_else(|| format!("invalid peer endpoint: {listen_address}"))?;
        let port = port_text
            .parse::<u32>()
            .map_err(|error| format!("invalid peer endpoint `{listen_address}`: {error}"))?;
        if port == 0 {
            return Err(format!(
                "invalid peer endpoint `{listen_address}`: port must be > 0"
            ));
        }

        let host = host.to_string();

        Ok(PeerTarget {
            listen_address,
            host,
            port,
            session_id,
        })
    }

    fn resolve_spawned_peer_target() -> Result<PeerTarget, String> {
        match std::env::var("SECS_RPC_TEST_PEER_ENDPOINT") {
            Ok(listen_address) => build_peer_target(listen_address),
            Err(_) => reserve_loopback_address().and_then(build_peer_target),
        }
    }

    async fn spawn_test_server() -> Result<(ProcessGuard, SecsRpcTarget), String> {
        let server_bin = resolve_server_bin();
        if !server_bin.exists() {
            return Err(format!(
                "secs-rpc-server binary not found: {}",
                server_bin.display()
            ));
        }

        let target = resolve_spawned_test_target()?;
        let listen = target
            .endpoint
            .clone()
            .ok_or_else(|| "missing test endpoint".to_string())?;
        let child = Command::new(&server_bin)
            .arg("--listen")
            .arg(&listen)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                format!(
                    "failed to start secs-rpc-server `{}`: {error}",
                    server_bin.display()
                )
            })?;

        let mut guard = ProcessGuard { child };
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            guard.ensure_running("secs-rpc-server", server_bin.as_path())?;
            match connect_channel(Some(&target)).await {
                Ok(channel) => {
                    drop(channel);
                    sleep(Duration::from_millis(100)).await;
                    guard.ensure_running("secs-rpc-server", server_bin.as_path())?;
                    return Ok((guard, target));
                }
                Err(_) if Instant::now() < deadline => {
                    sleep(Duration::from_millis(100)).await;
                }
                Err(error) => {
                    guard.stop().await;
                    return Err(error);
                }
            }
        }
    }

    async fn spawn_test_peer() -> Result<(ProcessGuard, PeerTarget), String> {
        let peer_bin = resolve_peer_bin();
        if !peer_bin.exists() {
            return Err(format!(
                "test_rpc_hsms_peer binary not found: {}",
                peer_bin.display()
            ));
        }

        let target = resolve_spawned_peer_target()?;
        let mut child = Command::new(&peer_bin)
            .arg("--listen")
            .arg(&target.listen_address)
            .arg("--session-id")
            .arg(target.session_id.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                format!(
                    "failed to start hsms peer `{}`: {error}",
                    peer_bin.display()
                )
            })?;

        sleep(Duration::from_millis(300)).await;
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "hsms peer exited early with status {status}: {}",
                peer_bin.display()
            ));
        }

        Ok((ProcessGuard { child }, target))
    }

    async fn prepare_server() -> Result<(Option<ProcessGuard>, SecsRpcTarget), String> {
        if std::env::var("SECS_RPC_TEST_EXTERNAL").as_deref() == Ok("1") {
            return Ok((None, resolve_test_target()));
        }

        let (guard, target) = spawn_test_server().await?;
        Ok((Some(guard), target))
    }

    async fn prepare_peer() -> Result<(Option<ProcessGuard>, PeerTarget), String> {
        if std::env::var("SECS_RPC_TEST_EXTERNAL").as_deref() == Ok("1") {
            return Ok((None, resolve_peer_target()?));
        }

        let (guard, target) = spawn_test_peer().await?;
        Ok((Some(guard), target))
    }

    fn assert_rpc_status_ok(status: Option<v1::RpcStatus>, what: &str) -> v1::RpcStatus {
        let status = status.unwrap_or_default();
        assert!(
            status.ok.unwrap_or(false),
            "{what} status not ok: {status:?}"
        );
        status
    }

    async fn wait_for_selected(
        client: &mut v1::session_service_client::SessionServiceClient<Channel>,
        target: &SecsRpcTarget,
        session_id: &str,
    ) -> Result<v1::SessionInfo, String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let response = client
                .get_session(into_request(
                    v1::GetSessionRequest {
                        session_id: Some(session_id.to_string()),
                    },
                    Some(target),
                ))
                .await
                .map(|value| value.into_inner())
                .map_err(|status| format_status_error("GetSession", status))?;
            let session = response
                .session
                .ok_or_else(|| "GetSession returned missing session".to_string())?;
            let _ = assert_rpc_status_ok(response.status, "GetSession");

            if session.selected_generation.unwrap_or(0) > 0 {
                return Ok(session);
            }

            if session.state == Some(v1::SessionState::Stopped as i32) {
                if let Some(error) = session.last_error {
                    return Err(format!(
                        "session stopped before selected: {}",
                        error.message.unwrap_or_else(|| "unknown error".to_string())
                    ));
                }
                return Err("session stopped before selected".to_string());
            }

            if Instant::now() >= deadline {
                return Err("timed out waiting for session selection".to_string());
            }

            sleep(Duration::from_millis(100)).await;
        }
    }

    fn build_send_item() -> v1::ItemNode {
        v1::ItemNode {
            r#type: Some(v1::ItemType::Ascii as i32),
            ascii_value: Some("ONEWAY".to_string()),
            ..Default::default()
        }
    }

    fn build_request_item() -> v1::ItemNode {
        v1::ItemNode {
            r#type: Some(v1::ItemType::List as i32),
            items: vec![
                v1::ItemNode {
                    r#type: Some(v1::ItemType::Ascii as i32),
                    ascii_value: Some("PING".to_string()),
                    ..Default::default()
                },
                v1::ItemNode {
                    r#type: Some(v1::ItemType::U4 as i32),
                    u4_values: vec![7],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    fn assert_reply_item(reply_item: &v1::ItemNode) {
        assert_eq!(
            reply_item.r#type,
            Some(v1::ItemType::List as i32),
            "unexpected reply root type: {reply_item:?}"
        );
        assert_eq!(
            reply_item.items.len(),
            2,
            "unexpected reply root item count: {reply_item:?}"
        );
        assert_eq!(
            reply_item.items[0].r#type,
            Some(v1::ItemType::Ascii as i32),
            "unexpected reply ack type: {reply_item:?}"
        );
        assert_eq!(
            reply_item.items[0].ascii_value.as_deref(),
            Some("ACK"),
            "unexpected reply ack value: {reply_item:?}"
        );

        let echoed = &reply_item.items[1];
        assert_eq!(
            echoed.r#type,
            Some(v1::ItemType::List as i32),
            "unexpected echoed type: {reply_item:?}"
        );
        assert_eq!(
            echoed.items.len(),
            2,
            "unexpected echoed item count: {reply_item:?}"
        );
        assert_eq!(
            echoed.items[0].ascii_value.as_deref(),
            Some("PING"),
            "unexpected echoed ascii value: {reply_item:?}"
        );
        assert_eq!(
            echoed.items[1].u4_values,
            vec![7],
            "unexpected echoed integer values: {reply_item:?}"
        );
    }

    #[ignore = "requires secs_lib secs-rpc-server access"]
    #[tokio::test]
    async fn get_library_info_interop_with_secs_lib_server() {
        let (guard, target) = prepare_server()
            .await
            .expect("failed to launch secs_lib rpc server");

        let result = async {
            let mut client = v1::library_service_client::LibraryServiceClient::new(
                connect_channel(Some(&target))
                    .await
                    .expect("failed to connect to secs_lib rpc server"),
            );

            client
                .get_library_info(into_request(
                    v1::GetLibraryInfoRequest::default(),
                    Some(&target),
                ))
                .await
                .map(|response| response.into_inner())
        }
        .await;

        if let Some(guard) = guard {
            guard.stop().await;
        }

        let response = result.expect("GetLibraryInfo request failed");
        let status = response.status.expect("missing rpc status");
        assert!(status.ok.unwrap_or(false), "rpc status not ok: {status:?}");
        assert!(
            response
                .supported_transports
                .iter()
                .any(|item| item == "HSMS"),
            "missing HSMS transport: {:?}",
            response.supported_transports
        );
        assert!(
            response
                .supported_features
                .iter()
                .any(|item| item == "grpc-compatible-protocol"),
            "missing grpc-compatible-protocol feature: {:?}",
            response.supported_features
        );
    }

    #[ignore = "requires secs_lib secs-rpc-server access"]
    #[tokio::test]
    async fn list_sessions_interop_with_secs_lib_server() {
        let (guard, target) = prepare_server()
            .await
            .expect("failed to launch secs_lib rpc server");

        let result = async {
            let mut client = v1::session_service_client::SessionServiceClient::new(
                connect_channel(Some(&target))
                    .await
                    .expect("failed to connect to secs_lib rpc server"),
            );

            client
                .list_sessions(into_request(
                    v1::ListSessionsRequest::default(),
                    Some(&target),
                ))
                .await
                .map(|response| response.into_inner())
        }
        .await;

        if let Some(guard) = guard {
            guard.stop().await;
        }

        let response = result.expect("ListSessions request failed");
        let status = response.status.expect("missing rpc status");
        assert!(status.ok.unwrap_or(false), "rpc status not ok: {status:?}");
        assert!(
            response.sessions.is_empty(),
            "expected empty sessions on fresh server, got {:?}",
            response.sessions
        );
    }

    #[ignore = "requires secs_lib rpc server and hsms peer access"]
    #[tokio::test]
    async fn session_messaging_business_interop_with_secs_lib_server() {
        let (server_guard, target) = prepare_server()
            .await
            .expect("failed to prepare secs_lib rpc server");
        let (peer_guard, peer) = prepare_peer()
            .await
            .expect("failed to prepare secs_lib hsms peer");

        let result = async {
            let channel = connect_channel(Some(&target))
                .await
                .expect("failed to connect to secs_lib rpc server");
            let mut session_client =
                v1::session_service_client::SessionServiceClient::new(channel.clone());
            let mut messaging_client =
                v1::messaging_service_client::MessagingServiceClient::new(channel);

            let create_response = session_client
                .create_session(into_request(
                    v1::CreateSessionRequest {
                        name: Some("rust-hsms-client".to_string()),
                        transport: Some(v1::TransportConfig {
                            kind: Some(v1::TransportKind::Hsms as i32),
                            hsms: Some(v1::HsmsConfig {
                                ip: Some(peer.host.clone()),
                                port: Some(peer.port),
                                session_id: Some(peer.session_id),
                                passive: Some(false),
                                auto_reconnect: Some(true),
                                t3_ms: Some(1500),
                                t5_ms: Some(200),
                                t6_ms: Some(1500),
                                t7_ms: Some(1500),
                                t8_ms: Some(1500),
                            }),
                            secs1: None,
                        }),
                        runtime: Some(v1::SessionRuntimeConfig {
                            request_timeout_ms: Some(1500),
                            poll_interval_ms: Some(10),
                            max_pending_requests: Some(16),
                            ..Default::default()
                        }),
                    },
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("CreateSession request failed");
            let _ = assert_rpc_status_ok(create_response.status, "CreateSession");
            let session = create_response
                .session
                .expect("CreateSession returned missing session");
            let session_id = session
                .session_id
                .clone()
                .expect("CreateSession returned empty session_id");

            let start_response = session_client
                .start_session(into_request(
                    v1::StartSessionRequest {
                        session_id: Some(session_id.clone()),
                    },
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("StartSession request failed");
            let _ = assert_rpc_status_ok(start_response.status, "StartSession");

            let selected_session = wait_for_selected(&mut session_client, &target, &session_id)
                .await
                .expect("session failed to reach selected state");
            assert!(
                selected_session.selected_generation.unwrap_or(0) > 0,
                "selected_generation not updated: {selected_session:?}"
            );

            let list_response = session_client
                .list_sessions(into_request(
                    v1::ListSessionsRequest::default(),
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("ListSessions request failed");
            let _ = assert_rpc_status_ok(list_response.status, "ListSessions");
            assert_eq!(
                list_response.sessions.len(),
                1,
                "unexpected sessions list: {:?}",
                list_response.sessions
            );
            assert_eq!(
                list_response.sessions[0].session_id.as_deref(),
                Some(session_id.as_str()),
                "unexpected listed session id: {:?}",
                list_response.sessions
            );

            let send_response = messaging_client
                .send(into_request(
                    v1::SendRequest {
                        session_id: Some(session_id.clone()),
                        message: Some(v1::MessageEnvelope {
                            stream: Some(1),
                            function: Some(3),
                            decoded_item: Some(build_send_item()),
                            ..Default::default()
                        }),
                    },
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("Send request failed");
            let _ = assert_rpc_status_ok(send_response.status, "Send");
            let accepted = send_response
                .accepted
                .expect("Send returned missing accepted envelope");
            assert_eq!(
                accepted.stream,
                Some(1),
                "unexpected send stream: {accepted:?}"
            );
            assert_eq!(
                accepted.function,
                Some(3),
                "unexpected send function: {accepted:?}"
            );

            let request_response = messaging_client
                .request(into_request(
                    v1::RequestRequest {
                        session_id: Some(session_id.clone()),
                        request: Some(v1::MessageEnvelope {
                            stream: Some(1),
                            function: Some(1),
                            decoded_item: Some(build_request_item()),
                            ..Default::default()
                        }),
                        timeout_ms: Some(1500),
                    },
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("Request request failed");
            let _ = assert_rpc_status_ok(request_response.status, "Request");
            let reply = request_response
                .reply
                .expect("Request returned missing reply envelope");
            assert_eq!(reply.stream, Some(1), "unexpected reply stream: {reply:?}");
            assert_eq!(
                reply.function,
                Some(2),
                "unexpected reply function: {reply:?}"
            );
            assert!(
                reply
                    .body
                    .as_ref()
                    .map(|value| !value.is_empty())
                    .unwrap_or(false),
                "reply body is empty: {reply:?}"
            );
            let decoded_item = reply
                .decoded_item
                .as_ref()
                .expect("reply missing decoded item");
            assert_reply_item(decoded_item);

            let stop_response = session_client
                .stop_session(into_request(
                    v1::StopSessionRequest {
                        session_id: Some(session_id.clone()),
                        reason: Some("rust-test".to_string()),
                    },
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("StopSession request failed");
            let _ = assert_rpc_status_ok(stop_response.status, "StopSession");
            let stopped_session = stop_response
                .session
                .expect("StopSession returned missing session");
            assert_eq!(
                stopped_session.state,
                Some(v1::SessionState::Stopped as i32),
                "unexpected stopped session state: {stopped_session:?}"
            );

            let delete_response = session_client
                .delete_session(into_request(
                    v1::DeleteSessionRequest {
                        session_id: Some(session_id.clone()),
                    },
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("DeleteSession request failed");
            let _ = assert_rpc_status_ok(delete_response.status, "DeleteSession");

            let list_after_delete = session_client
                .list_sessions(into_request(
                    v1::ListSessionsRequest::default(),
                    Some(&target),
                ))
                .await
                .map(|value| value.into_inner())
                .expect("ListSessions(after delete) request failed");
            let _ = assert_rpc_status_ok(list_after_delete.status, "ListSessions(after delete)");
            assert!(
                list_after_delete.sessions.is_empty(),
                "sessions should be empty after delete: {:?}",
                list_after_delete.sessions
            );
        }
        .await;

        if let Some(guard) = peer_guard {
            guard.stop().await;
        }
        if let Some(guard) = server_guard {
            guard.stop().await;
        }

        result
    }
}
