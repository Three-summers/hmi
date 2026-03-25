pub mod actor;
pub mod proto;
pub mod serial;
pub mod tcp;

use actor::CommPriority;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::{mpsc, Mutex};

pub const DEFAULT_SERIAL_CONNECTION_ID: &str = "__default_serial__";
pub const DEFAULT_TCP_CONNECTION_ID: &str = "__default_tcp__";

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

pub async fn ensure_tcp_connection(
    state: &CommState,
    app: &AppHandle,
    connection_id: &str,
    config: tcp::TcpConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Tcp(config.clone());
    match plan_connection_update(state, connection_id, &managed_config).await? {
        EnsureConnectionAction::Reuse => return Ok(()),
        EnsureConnectionAction::Replace(old_actor) => old_actor.shutdown().await,
        EnsureConnectionAction::Connect => {}
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

pub async fn ensure_serial_connection(
    state: &CommState,
    app: &AppHandle,
    connection_id: &str,
    config: serial::SerialConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Serial(config.clone());
    match plan_connection_update(state, connection_id, &managed_config).await? {
        EnsureConnectionAction::Reuse => return Ok(()),
        EnsureConnectionAction::Replace(old_actor) => old_actor.shutdown().await,
        EnsureConnectionAction::Connect => {}
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

pub async fn connect_tcp(
    state: &CommState,
    app: &AppHandle,
    connection_id: &str,
    config: tcp::TcpConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Tcp(config.clone());
    let stream = tcp::open_stream(&config).await?;
    let actor = actor::spawn_tcp_actor(app.clone(), connection_id.to_string(), config, stream);
    if let Some(old_actor) =
        insert_connection(state, connection_id.to_string(), managed_config, actor).await
    {
        old_actor.shutdown().await;
    }
    Ok(())
}

pub async fn connect_serial(
    state: &CommState,
    app: &AppHandle,
    connection_id: &str,
    config: serial::SerialConfig,
) -> Result<(), String> {
    let managed_config = ManagedConnectionConfig::Serial(config.clone());
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
}
