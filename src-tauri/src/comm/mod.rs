pub mod actor;
pub mod proto;
pub mod serial;
pub mod tcp;

use actor::CommPriority;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
#[cfg(test)]
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::{mpsc, Mutex};

pub const DEFAULT_SERIAL_CONNECTION_ID: &str = "__default_serial__";
pub const DEFAULT_TCP_CONNECTION_ID: &str = "__default_tcp__";

#[cfg(test)]
pub(crate) trait TestIoStream: AsyncRead + AsyncWrite + Send + Unpin {}

#[cfg(test)]
impl<T> TestIoStream for T where T: AsyncRead + AsyncWrite + Send + Unpin {}

#[cfg(test)]
pub(crate) type BoxedTestIoStream = Box<dyn TestIoStream>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommConnectionKind {
    Serial,
    Tcp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ManagedConnectionConfig {
    Serial(serial::SerialConfig),
    Tcp(tcp::TcpConfig),
}

impl ManagedConnectionConfig {
    fn kind(&self) -> CommConnectionKind {
        match self {
            Self::Serial(_) => CommConnectionKind::Serial,
            Self::Tcp(_) => CommConnectionKind::Tcp,
        }
    }
}

struct ManagedConnectionHandle {
    kind: CommConnectionKind,
    config: ManagedConnectionConfig,
    actor: actor::CommActorHandle,
}

enum EnsureConnectionAction {
    Reuse,
    Connect,
    Replace(actor::CommActorHandle),
}

/// Communication state managed by Tauri
#[derive(Default)]
pub struct CommState {
    connections: Arc<Mutex<HashMap<String, ManagedConnectionHandle>>>,
}

static HMIP_NEXT_SEQ: AtomicU32 = AtomicU32::new(1);

#[cfg(test)]
type TcpStreamOverride =
    Arc<dyn Fn(&tcp::TcpConfig) -> Result<BoxedTestIoStream, String> + Send + Sync>;

#[cfg(test)]
type SerialStreamOverride =
    Arc<dyn Fn(&serial::SerialConfig) -> Result<BoxedTestIoStream, String> + Send + Sync>;

#[cfg(test)]
fn tcp_stream_override() -> &'static std::sync::Mutex<Option<TcpStreamOverride>> {
    static OVERRIDE: std::sync::OnceLock<std::sync::Mutex<Option<TcpStreamOverride>>> =
        std::sync::OnceLock::new();
    OVERRIDE.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(test)]
fn serial_stream_override() -> &'static std::sync::Mutex<Option<SerialStreamOverride>> {
    static OVERRIDE: std::sync::OnceLock<std::sync::Mutex<Option<SerialStreamOverride>>> =
        std::sync::OnceLock::new();
    OVERRIDE.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(test)]
pub(crate) fn set_tcp_stream_override(override_fn: Option<TcpStreamOverride>) {
    let mut guard = tcp_stream_override()
        .lock()
        .expect("tcp stream override mutex poisoned");
    *guard = override_fn;
}

#[cfg(test)]
pub(crate) fn set_serial_stream_override(override_fn: Option<SerialStreamOverride>) {
    let mut guard = serial_stream_override()
        .lock()
        .expect("serial stream override mutex poisoned");
    *guard = override_fn;
}

#[derive(Debug, Clone)]
pub struct HmipOutboundFrame {
    pub msg_type: u8,
    pub flags: u8,
    pub channel: u8,
    pub seq: Option<u32>,
    pub payload: Vec<u8>,
    pub priority: CommPriority,
}

fn next_hmip_seq(seq: Option<u32>) -> u32 {
    seq.unwrap_or_else(|| HMIP_NEXT_SEQ.fetch_add(1, Ordering::Relaxed))
}

async fn clone_senders(
    state: &CommState,
    connection_id: &str,
    expected_kind: Option<CommConnectionKind>,
) -> Result<(mpsc::Sender<Vec<u8>>, mpsc::Sender<Vec<u8>>), String> {
    let connections = state.connections.lock().await;
    let managed = connections
        .get(connection_id)
        .ok_or_else(|| format!("Connection `{connection_id}` is not connected"))?;

    if let Some(expected_kind) = expected_kind {
        if managed.kind != expected_kind {
            return Err(format!(
                "Connection `{connection_id}` is not a {} connection",
                match expected_kind {
                    CommConnectionKind::Serial => "serial",
                    CommConnectionKind::Tcp => "tcp",
                }
            ));
        }
    }

    Ok((
        managed.actor.tx_high.clone(),
        managed.actor.tx_normal.clone(),
    ))
}

async fn insert_connection(
    state: &CommState,
    connection_id: String,
    config: ManagedConnectionConfig,
    actor: actor::CommActorHandle,
) -> Option<actor::CommActorHandle> {
    let mut connections = state.connections.lock().await;
    connections
        .insert(
            connection_id,
            ManagedConnectionHandle {
                kind: config.kind(),
                config,
                actor,
            },
        )
        .map(|managed| managed.actor)
}

async fn plan_connection_update(
    state: &CommState,
    connection_id: &str,
    requested: &ManagedConnectionConfig,
) -> Result<EnsureConnectionAction, String> {
    let mut connections = state.connections.lock().await;
    let Some(managed) = connections.get(connection_id) else {
        return Ok(EnsureConnectionAction::Connect);
    };

    if managed.kind != requested.kind() {
        return Err(format!(
            "Connection `{connection_id}` already exists with a different transport kind"
        ));
    }

    if managed.config == *requested {
        return Ok(EnsureConnectionAction::Reuse);
    }

    let old_actor = connections
        .remove(connection_id)
        .map(|managed| managed.actor)
        .expect("existing connection must still be present");
    Ok(EnsureConnectionAction::Replace(old_actor))
}

pub async fn ensure_tcp_connection<R: Runtime>(
    state: &CommState,
    app: &AppHandle<R>,
    connection_id: &str,
    config: tcp::TcpConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Tcp(config.clone());
    match plan_connection_update(state, connection_id, &managed_config).await? {
        EnsureConnectionAction::Reuse => return Ok(()),
        EnsureConnectionAction::Replace(old_actor) => old_actor.shutdown().await,
        EnsureConnectionAction::Connect => {}
    }

    #[cfg(test)]
    let tcp_override = {
        tcp_stream_override()
            .lock()
            .expect("tcp stream override mutex poisoned")
            .clone()
    };
    #[cfg(test)]
    if let Some(override_fn) = tcp_override {
        let stream = override_fn(&config)?;
        let actor = actor::CommActorHandle::spawn_test_actor(
            app.clone(),
            "tcp",
            connection_id.to_string(),
            stream,
        );
        if let Some(old_actor) =
            insert_connection(state, connection_id.to_string(), managed_config, actor).await
        {
            old_actor.shutdown().await;
        }
        return Ok(());
    }

    let stream = tcp::open_stream(&config).await?;
    let actor = actor::spawn_tcp_actor(app.clone(), connection_id.to_string(), config, stream);
    if let Some(old_actor) =
        insert_connection(state, connection_id.to_string(), managed_config, actor).await
    {
        old_actor.shutdown().await;
    }
    Ok(())
}

pub async fn ensure_serial_connection<R: Runtime>(
    state: &CommState,
    app: &AppHandle<R>,
    connection_id: &str,
    config: serial::SerialConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Serial(config.clone());
    match plan_connection_update(state, connection_id, &managed_config).await? {
        EnsureConnectionAction::Reuse => return Ok(()),
        EnsureConnectionAction::Replace(old_actor) => old_actor.shutdown().await,
        EnsureConnectionAction::Connect => {}
    }

    #[cfg(test)]
    let serial_override = {
        serial_stream_override()
            .lock()
            .expect("serial stream override mutex poisoned")
            .clone()
    };
    #[cfg(test)]
    if let Some(override_fn) = serial_override {
        let stream = override_fn(&config)?;
        let actor = actor::CommActorHandle::spawn_test_actor(
            app.clone(),
            "serial",
            connection_id.to_string(),
            stream,
        );
        if let Some(old_actor) =
            insert_connection(state, connection_id.to_string(), managed_config, actor).await
        {
            old_actor.shutdown().await;
        }
        return Ok(());
    }

    let stream = serial::open_stream(&config)?;
    let actor = actor::spawn_serial_actor(app.clone(), connection_id.to_string(), config, stream);
    if let Some(old_actor) =
        insert_connection(state, connection_id.to_string(), managed_config, actor).await
    {
        old_actor.shutdown().await;
    }
    Ok(())
}

pub async fn connect_tcp<R: Runtime>(
    state: &CommState,
    app: &AppHandle<R>,
    connection_id: &str,
    config: tcp::TcpConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Tcp(config.clone());

    #[cfg(test)]
    let tcp_override = {
        tcp_stream_override()
            .lock()
            .expect("tcp stream override mutex poisoned")
            .clone()
    };
    #[cfg(test)]
    if let Some(override_fn) = tcp_override {
        let stream = override_fn(&config)?;
        let actor = actor::CommActorHandle::spawn_test_actor(
            app.clone(),
            "tcp",
            connection_id.to_string(),
            stream,
        );
        if let Some(old_actor) =
            insert_connection(state, connection_id.to_string(), managed_config, actor).await
        {
            old_actor.shutdown().await;
        }
        return Ok(());
    }

    let stream = tcp::open_stream(&config).await?;
    let actor = actor::spawn_tcp_actor(app.clone(), connection_id.to_string(), config, stream);
    if let Some(old_actor) =
        insert_connection(state, connection_id.to_string(), managed_config, actor).await
    {
        old_actor.shutdown().await;
    }
    Ok(())
}

pub async fn connect_serial<R: Runtime>(
    state: &CommState,
    app: &AppHandle<R>,
    connection_id: &str,
    config: serial::SerialConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Serial(config.clone());

    #[cfg(test)]
    let serial_override = {
        serial_stream_override()
            .lock()
            .expect("serial stream override mutex poisoned")
            .clone()
    };
    #[cfg(test)]
    if let Some(override_fn) = serial_override {
        let stream = override_fn(&config)?;
        let actor = actor::CommActorHandle::spawn_test_actor(
            app.clone(),
            "serial",
            connection_id.to_string(),
            stream,
        );
        if let Some(old_actor) =
            insert_connection(state, connection_id.to_string(), managed_config, actor).await
        {
            old_actor.shutdown().await;
        }
        return Ok(());
    }

    let stream = serial::open_stream(&config)?;
    let actor = actor::spawn_serial_actor(app.clone(), connection_id.to_string(), config, stream);
    if let Some(old_actor) =
        insert_connection(state, connection_id.to_string(), managed_config, actor).await
    {
        old_actor.shutdown().await;
    }
    Ok(())
}

pub async fn disconnect_connection(state: &CommState, connection_id: &str) -> Result<(), String> {
    let actor = {
        let mut connections = state.connections.lock().await;
        connections
            .remove(connection_id)
            .map(|managed| managed.actor)
    };

    if let Some(actor) = actor {
        actor.shutdown().await;
    }
    Ok(())
}

pub async fn send_tcp_data_bytes(
    state: &CommState,
    connection_id: &str,
    data: Vec<u8>,
    priority: CommPriority,
) -> Result<(), String> {
    let (tx_high, tx_normal) =
        clone_senders(state, connection_id, Some(CommConnectionKind::Tcp)).await?;
    let tx = match priority {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(data).map_err(|err| match err {
        TrySendError::Full(_) => format!("TCP connection `{connection_id}` write queue is full"),
        TrySendError::Closed(_) => format!("TCP connection `{connection_id}` is closed"),
    })
}

pub async fn send_serial_data_bytes(
    state: &CommState,
    connection_id: &str,
    data: Vec<u8>,
    priority: CommPriority,
) -> Result<(), String> {
    let (tx_high, tx_normal) =
        clone_senders(state, connection_id, Some(CommConnectionKind::Serial)).await?;
    let tx = match priority {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(data).map_err(|err| match err {
        TrySendError::Full(_) => {
            format!("Serial connection `{connection_id}` write queue is full")
        }
        TrySendError::Closed(_) => format!("Serial connection `{connection_id}` is closed"),
    })
}

pub async fn send_tcp_hmip_frame(
    state: &CommState,
    connection_id: &str,
    frame: HmipOutboundFrame,
) -> Result<u32, String> {
    let seq = next_hmip_seq(frame.seq);
    let bytes = proto::encode_frame(proto::EncodeFrameParams {
        msg_type: frame.msg_type,
        flags: frame.flags,
        channel: frame.channel,
        seq,
        payload: &frame.payload,
    });

    send_tcp_data_bytes(state, connection_id, bytes, frame.priority).await?;
    Ok(seq)
}

pub async fn send_serial_hmip_frame(
    state: &CommState,
    connection_id: &str,
    frame: HmipOutboundFrame,
) -> Result<u32, String> {
    let seq = next_hmip_seq(frame.seq);
    let bytes = proto::encode_frame(proto::EncodeFrameParams {
        msg_type: frame.msg_type,
        flags: frame.flags,
        channel: frame.channel,
        seq,
        payload: &frame.payload,
    });

    send_serial_data_bytes(state, connection_id, bytes, frame.priority).await?;
    Ok(seq)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};
    use tauri::{test::mock_app, Listener};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::time::{timeout, Duration};

    fn dummy_actor() -> actor::CommActorHandle {
        actor::CommActorHandle::new_test_handle()
    }

    async fn insert_test_connection(
        state: &CommState,
        connection_id: &str,
        config: ManagedConnectionConfig,
    ) {
        let mut connections = state.connections.lock().await;
        connections.insert(
            connection_id.to_string(),
            ManagedConnectionHandle {
                kind: config.kind(),
                config,
                actor: dummy_actor(),
            },
        );
    }

    fn serial_test_config(port: &str) -> serial::SerialConfig {
        serial::SerialConfig {
            port: port.to_string(),
            baud_rate: 9600,
            data_bits: 8,
            stop_bits: 1,
            parity: "none".to_string(),
        }
    }

    #[tokio::test]
    async fn plan_connection_update_should_reuse_matching_tcp_config() {
        let state = CommState::default();
        let config = tcp::TcpConfig {
            host: "127.0.0.1".to_string(),
            port: 502,
            timeout_ms: 5000,
        };

        insert_test_connection(
            &state,
            "main-tcp",
            ManagedConnectionConfig::Tcp(config.clone()),
        )
        .await;

        let action =
            plan_connection_update(&state, "main-tcp", &ManagedConnectionConfig::Tcp(config))
                .await
                .unwrap();

        assert!(matches!(action, EnsureConnectionAction::Reuse));
        disconnect_connection(&state, "main-tcp").await.unwrap();
    }

    #[tokio::test]
    async fn plan_connection_update_should_replace_stale_serial_config() {
        let state = CommState::default();
        insert_test_connection(
            &state,
            "main-serial",
            ManagedConnectionConfig::Serial(serial::SerialConfig {
                port: "/dev/ttyUSB0".to_string(),
                baud_rate: 9600,
                data_bits: 8,
                stop_bits: 1,
                parity: "none".to_string(),
            }),
        )
        .await;

        let action = plan_connection_update(
            &state,
            "main-serial",
            &ManagedConnectionConfig::Serial(serial::SerialConfig {
                port: "/dev/ttyUSB1".to_string(),
                baud_rate: 9600,
                data_bits: 8,
                stop_bits: 1,
                parity: "none".to_string(),
            }),
        )
        .await
        .unwrap();

        match action {
            EnsureConnectionAction::Replace(old_actor) => old_actor.shutdown().await,
            _ => panic!("expected stale serial connection to be replaced"),
        }
        assert!(!state.connections.lock().await.contains_key("main-serial"));
    }

    #[tokio::test]
    async fn plan_connection_update_should_reject_transport_kind_mismatch() {
        let state = CommState::default();
        insert_test_connection(
            &state,
            "main",
            ManagedConnectionConfig::Tcp(tcp::TcpConfig {
                host: "127.0.0.1".to_string(),
                port: 502,
                timeout_ms: 5000,
            }),
        )
        .await;

        let err = match plan_connection_update(
            &state,
            "main",
            &ManagedConnectionConfig::Serial(serial::SerialConfig {
                port: "/dev/ttyUSB0".to_string(),
                baud_rate: 9600,
                data_bits: 8,
                stop_bits: 1,
                parity: "none".to_string(),
            }),
        )
        .await
        {
            Ok(_) => panic!("expected transport kind mismatch to fail"),
            Err(err) => err,
        };

        assert!(err.contains("different transport kind"));
        disconnect_connection(&state, "main").await.unwrap();
    }

    #[tokio::test]
    async fn connect_tcp_should_send_bytes_to_real_socket() {
        let app = mock_app();
        let state = CommState::default();
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("skip tcp socket integration test: {error}");
                return;
            }
            Err(error) => panic!("failed to bind tcp listener: {error}"),
        };
        let port = listener.local_addr().unwrap().port();
        let expected = b"PING 01\r\n".to_vec();
        let server_expected_len = expected.len();

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = vec![0u8; server_expected_len];
            socket.read_exact(&mut received).await.unwrap();
            received
        });

        connect_tcp(
            &state,
            app.handle(),
            "tcp-real",
            tcp::TcpConfig {
                host: "127.0.0.1".to_string(),
                port,
                timeout_ms: 1000,
            },
        )
        .await
        .unwrap();

        send_tcp_data_bytes(&state, "tcp-real", expected.clone(), CommPriority::High)
            .await
            .unwrap();

        let received = timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(received, expected);

        disconnect_connection(&state, "tcp-real").await.unwrap();
    }

    #[tokio::test]
    async fn send_tcp_hmip_frame_should_write_encoded_frame_to_real_socket() {
        let app = mock_app();
        let state = CommState::default();
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("skip tcp hmip socket integration test: {error}");
                return;
            }
            Err(error) => panic!("failed to bind tcp listener: {error}"),
        };
        let port = listener.local_addr().unwrap().port();
        let payload = b"{\"cmd\":\"start\"}".to_vec();
        let expected = proto::encode_frame(proto::EncodeFrameParams {
            msg_type: 0x21,
            flags: 0x80,
            channel: 3,
            seq: 42,
            payload: &payload,
        });
        let expected_len = expected.len();

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = vec![0u8; expected_len];
            socket.read_exact(&mut received).await.unwrap();
            received
        });

        connect_tcp(
            &state,
            app.handle(),
            "tcp-hmip",
            tcp::TcpConfig {
                host: "127.0.0.1".to_string(),
                port,
                timeout_ms: 1000,
            },
        )
        .await
        .unwrap();

        let seq = send_tcp_hmip_frame(
            &state,
            "tcp-hmip",
            HmipOutboundFrame {
                msg_type: 0x21,
                flags: 0x80,
                channel: 3,
                seq: Some(42),
                payload,
                priority: CommPriority::Normal,
            },
        )
        .await
        .unwrap();

        assert_eq!(seq, 42);
        let received = timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(received, expected);

        disconnect_connection(&state, "tcp-hmip").await.unwrap();
    }

    #[tokio::test]
    async fn tcp_actor_should_reconnect_after_remote_close_and_resume_io() {
        let app = mock_app();
        let state = CommState::default();
        let comm_events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let listener = app.listen_any("comm-event", {
            let comm_events = comm_events.clone();
            move |event| {
                let payload: Value =
                    serde_json::from_str(event.payload()).expect("comm event payload must be json");
                comm_events
                    .lock()
                    .expect("comm event collector mutex poisoned")
                    .push(payload);
            }
        });

        let tcp_listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("skip tcp reconnect integration test: {error}");
                app.unlisten(listener);
                return;
            }
            Err(error) => panic!("failed to bind tcp listener: {error}"),
        };
        let port = tcp_listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut first_socket, _) = tcp_listener.accept().await.unwrap();
            let mut first_received = vec![0u8; 6];
            first_socket.read_exact(&mut first_received).await.unwrap();
            drop(first_socket);

            let (mut second_socket, _) = tcp_listener.accept().await.unwrap();
            let mut second_received = vec![0u8; 7];
            second_socket.read_exact(&mut second_received).await.unwrap();
            second_socket.write_all(b"RECOVERED").await.unwrap();
            second_socket.flush().await.unwrap();

            (first_received, second_received)
        });

        connect_tcp(
            &state,
            app.handle(),
            "tcp-reconnect",
            tcp::TcpConfig {
                host: "127.0.0.1".to_string(),
                port,
                timeout_ms: 1000,
            },
        )
        .await
        .unwrap();

        send_tcp_data_bytes(
            &state,
            "tcp-reconnect",
            b"FIRST!".to_vec(),
            CommPriority::High,
        )
        .await
        .unwrap();

        timeout(Duration::from_secs(4), async {
            loop {
                let events = comm_events
                    .lock()
                    .expect("comm event collector mutex poisoned")
                    .clone();
                let connected_count = events
                    .iter()
                    .filter(|event| {
                        event.get("type") == Some(&Value::String("connected".to_string()))
                    })
                    .count();
                let has_error = events
                    .iter()
                    .any(|event| event.get("type") == Some(&Value::String("error".to_string())));
                let has_reconnecting = events.iter().any(|event| {
                    event.get("type") == Some(&Value::String("reconnecting".to_string()))
                });
                if connected_count >= 2 && has_error && has_reconnecting {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("timed out while waiting for tcp reconnect events");

        send_tcp_data_bytes(
            &state,
            "tcp-reconnect",
            b"SECOND?".to_vec(),
            CommPriority::Normal,
        )
        .await
        .unwrap();

        let (first_received, second_received) = timeout(Duration::from_secs(4), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first_received, b"FIRST!");
        assert_eq!(second_received, b"SECOND?");

        timeout(Duration::from_secs(4), async {
            loop {
                let has_recovered_rx = comm_events
                    .lock()
                    .expect("comm event collector mutex poisoned")
                    .iter()
                    .any(|event| {
                        event.get("type") == Some(&Value::String("rx".to_string()))
                            && event.get("text") == Some(&Value::String("RECOVERED".to_string()))
                    });
                if has_recovered_rx {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("timed out while waiting for recovered rx event");

        let events = comm_events
            .lock()
            .expect("comm event collector mutex poisoned")
            .clone();
        let connected_count = events
            .iter()
            .filter(|event| event.get("type") == Some(&Value::String("connected".to_string())))
            .count();
        let tx_count = events
            .iter()
            .filter(|event| event.get("type") == Some(&Value::String("tx".to_string())))
            .count();
        assert!(connected_count >= 2);
        assert!(tx_count >= 2);
        assert!(events
            .iter()
            .any(|event| event.get("type") == Some(&Value::String("error".to_string()))));
        assert!(events
            .iter()
            .any(|event| event.get("type") == Some(&Value::String("reconnecting".to_string()))));

        app.unlisten(listener);
        disconnect_connection(&state, "tcp-reconnect").await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn send_serial_data_bytes_should_write_to_paired_serial_stream() {
        let app = mock_app();
        let state = CommState::default();
        let (mut peer, actor_stream) = match tokio_serial::SerialStream::pair() {
            Ok(pair) => pair,
            Err(error) => {
                let message = error.to_string();
                if message.contains("Permission denied")
                    || message.contains("Operation not permitted")
                {
                    eprintln!("skip serial PTY integration test: {message}");
                    return;
                }
                panic!("failed to create serial PTY pair: {message}");
            }
        };
        let config = serial_test_config("__paired_serial__");
        let actor = actor::spawn_serial_actor(
            app.handle().clone(),
            "serial-real".to_string(),
            config.clone(),
            actor_stream,
        );

        insert_connection(
            &state,
            "serial-real".to_string(),
            ManagedConnectionConfig::Serial(config),
            actor,
        )
        .await;

        let expected = b"SERIAL-HELLO".to_vec();
        send_serial_data_bytes(&state, "serial-real", expected.clone(), CommPriority::High)
            .await
            .unwrap();

        let mut received = vec![0u8; expected.len()];
        timeout(Duration::from_secs(2), peer.read_exact(&mut received))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(received, expected);

        disconnect_connection(&state, "serial-real").await.unwrap();
    }
}
