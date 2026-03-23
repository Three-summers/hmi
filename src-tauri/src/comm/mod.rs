pub mod actor;
pub mod proto;
pub mod serial;
pub mod tcp;

use actor::CommPriority;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::Mutex;

/// Communication state managed by Tauri
#[derive(Default)]
pub struct CommState {
    pub serial: Arc<Mutex<Option<actor::CommActorHandle>>>,
    pub tcp: Arc<Mutex<Option<actor::CommActorHandle>>>,
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

pub async fn send_serial_data_bytes(
    state: &CommState,
    data: Vec<u8>,
    priority: CommPriority,
) -> Result<(), String> {
    let (tx_high, tx_normal) = {
        let serial_lock = state.serial.lock().await;
        let handle = serial_lock
            .as_ref()
            .ok_or_else(|| "Serial port not connected".to_string())?;
        (handle.tx_high.clone(), handle.tx_normal.clone())
    };

    let tx = match priority {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(data).map_err(|err| match err {
        TrySendError::Full(_) => "Serial write queue is full".to_string(),
        TrySendError::Closed(_) => "Serial connection is closed".to_string(),
    })
}

pub async fn send_tcp_data_bytes(
    state: &CommState,
    data: Vec<u8>,
    priority: CommPriority,
) -> Result<(), String> {
    let (tx_high, tx_normal) = {
        let tcp_lock = state.tcp.lock().await;
        let handle = tcp_lock
            .as_ref()
            .ok_or_else(|| "TCP not connected".to_string())?;
        (handle.tx_high.clone(), handle.tx_normal.clone())
    };

    let tx = match priority {
        CommPriority::High => tx_high,
        CommPriority::Normal => tx_normal,
    };

    tx.try_send(data).map_err(|err| match err {
        TrySendError::Full(_) => "TCP write queue is full".to_string(),
        TrySendError::Closed(_) => "TCP connection is closed".to_string(),
    })
}

pub async fn send_tcp_hmip_frame(
    state: &CommState,
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

    send_tcp_data_bytes(state, bytes, frame.priority).await?;
    Ok(seq)
}

pub async fn send_serial_hmip_frame(
    state: &CommState,
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

    send_serial_data_bytes(state, bytes, frame.priority).await?;
    Ok(seq)
}
