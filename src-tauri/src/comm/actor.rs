use crate::comm::{proto, serial, tcp};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

const COMM_EVENT_NAME: &str = "comm-event";
const HMIP_EVENT_NAME: &str = "hmip-event";

const READ_BUFFER_SIZE: usize = 4096;
const WRITE_TIMEOUT_MS: u64 = 2000;

// 为了避免“把大 payload 直接塞进前端事件”造成 UI 卡顿，
// 默认仅在 payload 较小时携带 base64（用于调试/对接）。
const HMIP_PAYLOAD_EMIT_MAX: usize = 2048;

const RECONNECT_MIN_DELAY_MS: u64 = 200;
const RECONNECT_MAX_DELAY_MS: u64 = 5000;

#[derive(Debug, Clone, Copy, Deserialize)]
// snake_case 在反序列化时使用蛇形命名，但在 Rust 代码中仍然使用驼峰命名，比如 CommPriority::High 会被序列化为 "high"
#[serde(rename_all = "snake_case")]
pub enum CommPriority {
    High,
    Normal,
}

impl Default for CommPriority {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommEvent {
    Connected {
        transport: String,
        timestamp_ms: u64,
    },
    Disconnected {
        transport: String,
        timestamp_ms: u64,
    },
    Reconnecting {
        transport: String,
        attempt: u32,
        delay_ms: u64,
        timestamp_ms: u64,
    },
    Rx {
        transport: String,
        data_base64: String,
        text: Option<String>,
        size: usize,
        timestamp_ms: u64,
    },
    Tx {
        transport: String,
        size: usize,
        timestamp_ms: u64,
    },
    Error {
        transport: String,
        message: String,
        timestamp_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HmipEvent {
    DecodeError {
        transport: String,
        message: String,
        dropped_bytes: usize,
        timestamp_ms: u64,
    },
    Message {
        transport: String,
        channel: u8,
        seq: u32,
        flags: u8,
        msg_type: u8,
        payload_len: u32,
        payload_crc32: Option<u32>,
        timestamp_ms: u64,
        summary: HmipMessageSummary,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HmipMessageSummary {
    Hello {
        role: String,
        capabilities: u32,
        name: String,
    },
    HelloAck {
        capabilities: u32,
        name: String,
    },
    Heartbeat {
        timestamp_ms: u64,
    },
    Request {
        request_id: u32,
        method: u16,
        body_len: usize,
        body_base64: Option<String>,
        body_truncated: bool,
    },
    Response {
        request_id: u32,
        status: u16,
        body_len: usize,
        body_base64: Option<String>,
        body_truncated: bool,
    },
    Event {
        event_id: u16,
        timestamp_ms: u64,
        body_len: usize,
        body_base64: Option<String>,
        body_truncated: bool,
    },
    Error {
        code: u16,
        message: String,
    },
    Raw {
        msg_type: u8,
        payload_len: usize,
        payload_base64: Option<String>,
        payload_truncated: bool,
    },
}

pub struct CommActorHandle {
    pub tx_high: mpsc::Sender<Vec<u8>>,
    pub tx_normal: mpsc::Sender<Vec<u8>>,
    shutdown_tx: oneshot::Sender<()>,
    join: tauri::async_runtime::JoinHandle<()>,
}

impl CommActorHandle {
    pub async fn shutdown(self) {
        let _ = self.shutdown_tx.send(());
        if let Err(err) = self.join.await {
            log::warn!("Comm actor task ended with error: {}", err);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn compute_backoff_ms(attempt: u32) -> u64 {
    let exp = attempt.min(6);
    let base = RECONNECT_MIN_DELAY_MS.saturating_mul(1u64 << exp);
    base.min(RECONNECT_MAX_DELAY_MS)
}

fn maybe_utf8_preview(bytes: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(bytes).ok()?;
    let trimmed = s.trim_matches('\0').trim();
    if trimmed.is_empty() {
        return None;
    }

    // 控制字符过多的内容通常不是可读文本，避免把二进制硬转字符串污染 UI
    let mut control = 0usize;
    let mut total = 0usize;
    for ch in trimmed.chars().take(512) {
        total += 1;
        if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
            control += 1;
        }
    }
    if total > 0 && control * 4 > total {
        return None;
    }

    const MAX_CHARS: usize = 2048;
    let preview: String = trimmed.chars().take(MAX_CHARS).collect();
    Some(preview)
}

fn emit_event(app: &AppHandle, event: &CommEvent) -> bool {
    match app.emit(COMM_EVENT_NAME, event) {
        Ok(_) => true,
        Err(err) => {
            log::warn!("Failed to emit comm event (window may be closed): {}", err);
            false
        }
    }
}

fn emit_hmip_event(app: &AppHandle, event: &HmipEvent) -> bool {
    match app.emit(HMIP_EVENT_NAME, event) {
        Ok(_) => true,
        Err(err) => {
            log::warn!("Failed to emit hmip event (window may be closed): {}", err);
            false
        }
    }
}

fn base64_preview(bytes: &[u8]) -> (Option<String>, bool) {
    if bytes.is_empty() {
        return (None, false);
    }
    if bytes.len() <= HMIP_PAYLOAD_EMIT_MAX {
        return (Some(general_purpose::STANDARD.encode(bytes)), false);
    }
    (
        Some(general_purpose::STANDARD.encode(&bytes[..HMIP_PAYLOAD_EMIT_MAX])),
        true,
    )
}

enum ConnectionExit {
    Shutdown,
    IoError(String),
}

/// 串口连续 0 字节读取的容忍上限。
///
/// 单次空读在 PTY/部分驱动下属正常现象，不应立即断线重连；
/// 但持续空读（每次间隔 10ms）通常意味着设备被拔出或对端已关闭而驱动以 EOF 表达，
/// 此时必须升级为 IoError 进入既有重连流程，否则链路会静默空转、永不恢复。
const SERIAL_ZERO_READ_LIMIT: u32 = 200; // 约 2s

/// 丢弃断线期间积压的待发帧。
///
/// 断线期间 try_send 入队的控制帧在重连成功后若原样补发，
/// 对工业设备等价于重放过期动作指令，风险高于丢帧；因此重连前统一清空。
fn drain_pending_frames(
    high_rx: &mut mpsc::Receiver<Vec<u8>>,
    normal_rx: &mut mpsc::Receiver<Vec<u8>>,
) -> usize {
    let mut dropped = 0usize;
    while high_rx.try_recv().is_ok() {
        dropped += 1;
    }
    while normal_rx.try_recv().is_ok() {
        dropped += 1;
    }
    dropped
}

async fn run_io_loop<S: AsyncRead + AsyncWrite + Unpin>(
    app: &AppHandle,
    transport: &str,
    stream: S,
    high_rx: &mut mpsc::Receiver<Vec<u8>>,
    normal_rx: &mut mpsc::Receiver<Vec<u8>>,
    shutdown_rx: &mut oneshot::Receiver<()>,
) -> ConnectionExit {
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut buf = vec![0u8; READ_BUFFER_SIZE];
    let mut hmip_decoder = proto::FrameDecoder::new(proto::DecoderConfig::default());
    let mut serial_zero_reads: u32 = 0;

    loop {
        tokio::select! {
            // 当多个分支同时准备就绪时，Tokio 会优先选择前面声明的分支执行
            biased;

            _ = &mut *shutdown_rx => {
                return ConnectionExit::Shutdown;
            }

            Some(data) = high_rx.recv() => {
                let size = data.len();
                match tokio::time::timeout(Duration::from_millis(WRITE_TIMEOUT_MS), writer.write_all(&data)).await {
                    Ok(Ok(())) => {
                        let event = CommEvent::Tx {
                            transport: transport.to_string(),
                            size,
                            timestamp_ms: now_ms(),
                        };
                        // emit 失败（如窗口暂不可用）只记录告警，不终止设备连接
                        emit_event(app, &event);
                    }
                    Ok(Err(err)) => {
                        return ConnectionExit::IoError(format!("Write failed: {}", err));
                    }
                    Err(_) => {
                        return ConnectionExit::IoError(format!("Write timeout ({}ms)", WRITE_TIMEOUT_MS));
                    }
                }
            }

            Some(data) = normal_rx.recv() => {
                let size = data.len();
                match tokio::time::timeout(Duration::from_millis(WRITE_TIMEOUT_MS), writer.write_all(&data)).await {
                    Ok(Ok(())) => {
                        let event = CommEvent::Tx {
                            transport: transport.to_string(),
                            size,
                            timestamp_ms: now_ms(),
                        };
                        // emit 失败（如窗口暂不可用）只记录告警，不终止设备连接
                        emit_event(app, &event);
                    }
                    Ok(Err(err)) => {
                        return ConnectionExit::IoError(format!("Write failed: {}", err));
                    }
                    Err(_) => {
                        return ConnectionExit::IoError(format!("Write timeout ({}ms)", WRITE_TIMEOUT_MS));
                    }
                }
            }

            read_res = reader.read(&mut buf) => {
                match read_res {
                    Ok(0) => {
                        if transport == "serial" {
                            // 串口链路上 0 字节读取并不等价于对端关闭，
                            // 在 PTY/部分驱动下可能只是一次空读，不能直接触发断线重连。
                            // 但连续空读超过阈值说明链路已死（拔出/对端关闭），需升级重连。
                            serial_zero_reads = serial_zero_reads.saturating_add(1);
                            if serial_zero_reads >= SERIAL_ZERO_READ_LIMIT {
                                return ConnectionExit::IoError(format!(
                                    "Serial read returned EOF {} times in a row",
                                    serial_zero_reads
                                ));
                            }
                            tokio::time::sleep(Duration::from_millis(10)).await;
                            continue;
                        }
                        return ConnectionExit::IoError("Remote closed".to_string());
                    }
                    Ok(n) => {
                        serial_zero_reads = 0;
                        let bytes = &buf[..n];
                        let event = CommEvent::Rx {
                            transport: transport.to_string(),
                            data_base64: general_purpose::STANDARD.encode(bytes),
                            text: maybe_utf8_preview(bytes),
                            size: n,
                            timestamp_ms: now_ms(),
                        };
                        // emit 失败（如窗口暂不可用）只记录告警，不终止设备连接
                        emit_event(app, &event);

                        // HMIP：bytes → frames → messages
                        if let Err(err) = hmip_decoder.push(bytes) {
                            let ev = HmipEvent::DecodeError {
                                transport: transport.to_string(),
                                message: err.message,
                                dropped_bytes: err.dropped_bytes,
                                timestamp_ms: now_ms(),
                            };
                            emit_hmip_event(app, &ev);
                        } else {
                            loop {
                                match hmip_decoder.next_frame() {
                                    Ok(Some(frame)) => {
                                        let header = frame.header;
                                        let decoded = proto::decode_message(&frame);

                                        let summary = match decoded {
                                            Ok(proto::Message::Hello(v)) => HmipMessageSummary::Hello {
                                                role: match v.role {
                                                    proto::Role::Client => "client".to_string(),
                                                    proto::Role::Server => "server".to_string(),
                                                },
                                                capabilities: v.capabilities,
                                                name: v.name,
                                            },
                                            Ok(proto::Message::HelloAck(v)) => HmipMessageSummary::HelloAck {
                                                capabilities: v.capabilities,
                                                name: v.name,
                                            },
                                            Ok(proto::Message::Heartbeat(v)) => HmipMessageSummary::Heartbeat {
                                                timestamp_ms: v.timestamp_ms,
                                            },
                                            Ok(proto::Message::Request(v)) => {
                                                let (b64, truncated) = base64_preview(&v.body);
                                                HmipMessageSummary::Request {
                                                    request_id: v.request_id,
                                                    method: v.method,
                                                    body_len: v.body.len(),
                                                    body_base64: b64,
                                                    body_truncated: truncated,
                                                }
                                            }
                                            Ok(proto::Message::Response(v)) => {
                                                let (b64, truncated) = base64_preview(&v.body);
                                                HmipMessageSummary::Response {
                                                    request_id: v.request_id,
                                                    status: v.status,
                                                    body_len: v.body.len(),
                                                    body_base64: b64,
                                                    body_truncated: truncated,
                                                }
                                            }
                                            Ok(proto::Message::Event(v)) => {
                                                let (b64, truncated) = base64_preview(&v.body);
                                                HmipMessageSummary::Event {
                                                    event_id: v.event_id,
                                                    timestamp_ms: v.timestamp_ms,
                                                    body_len: v.body.len(),
                                                    body_base64: b64,
                                                    body_truncated: truncated,
                                                }
                                            }
                                            Ok(proto::Message::Error(v)) => HmipMessageSummary::Error {
                                                code: v.code,
                                                message: v.message,
                                            },
                                            Ok(proto::Message::Raw { msg_type, payload }) => {
                                                let (b64, truncated) = base64_preview(&payload);
                                                HmipMessageSummary::Raw {
                                                    msg_type,
                                                    payload_len: payload.len(),
                                                    payload_base64: b64,
                                                    payload_truncated: truncated,
                                                }
                                            }
                                            Err(_err) => {
                                                let (b64, truncated) = base64_preview(&frame.payload);
                                                HmipMessageSummary::Raw {
                                                    msg_type: header.msg_type,
                                                    payload_len: frame.payload.len(),
                                                    payload_base64: b64,
                                                    payload_truncated: truncated,
                                                }
                                            }
                                        };

                                        let ev = HmipEvent::Message {
                                            transport: transport.to_string(),
                                            channel: header.channel,
                                            seq: header.seq,
                                            flags: header.flags,
                                            msg_type: header.msg_type,
                                            payload_len: header.payload_len,
                                            payload_crc32: header.payload_crc32,
                                            timestamp_ms: now_ms(),
                                            summary,
                                        };
                                        emit_hmip_event(app, &ev);
                                    }
                                    Ok(None) => break,
                                    Err(err) => {
                                        let ev = HmipEvent::DecodeError {
                                            transport: transport.to_string(),
                                            message: err.message,
                                            dropped_bytes: err.dropped_bytes,
                                            timestamp_ms: now_ms(),
                                        };
                                        emit_hmip_event(app, &ev);
                                        // 继续尝试解析后续帧（decoder 内部已重同步）
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                    Err(err) => {
                        return ConnectionExit::IoError(format!("Read failed: {}", err));
                    }
                }
            }
        }
    }
}

pub fn spawn_serial_actor(
    app: AppHandle,
    config: serial::SerialConfig,
    initial_stream: tokio_serial::SerialStream,
) -> CommActorHandle {
    let (tx_high, mut rx_high) = mpsc::channel::<Vec<u8>>(64);
    let (tx_normal, mut rx_normal) = mpsc::channel::<Vec<u8>>(256);
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let join = tauri::async_runtime::spawn(async move {
        let transport = "serial".to_string();
        let mut attempt: u32 = 0;
        let mut stream_opt = Some(initial_stream);

        loop {
            let stream = if let Some(stream) = stream_opt.take() {
                stream
            } else {
                match serial::open_stream(&config) {
                    Ok(stream) => {
                        let dropped = drain_pending_frames(&mut rx_high, &mut rx_normal);
                        if dropped > 0 {
                            log::warn!(
                                "Dropped {} stale queued frame(s) before serial reconnect",
                                dropped
                            );
                        }
                        stream
                    }
                    Err(err) => {
                        attempt = attempt.saturating_add(1);
                        let delay_ms = compute_backoff_ms(attempt);
                        let _ = emit_event(
                            &app,
                            &CommEvent::Error {
                                transport: transport.clone(),
                                message: err,
                                timestamp_ms: now_ms(),
                            },
                        );
                        let _ = emit_event(
                            &app,
                            &CommEvent::Reconnecting {
                                transport: transport.clone(),
                                attempt,
                                delay_ms,
                                timestamp_ms: now_ms(),
                            },
                        );

                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                            _ = &mut shutdown_rx => break,
                        }
                        continue;
                    }
                }
            };

            attempt = 0;
            emit_event(
                &app,
                &CommEvent::Connected {
                    transport: transport.clone(),
                    timestamp_ms: now_ms(),
                },
            );

            match run_io_loop(
                &app,
                &transport,
                stream,
                &mut rx_high,
                &mut rx_normal,
                &mut shutdown_rx,
            )
            .await
            {
                ConnectionExit::Shutdown => break,
                ConnectionExit::IoError(message) => {
                    let _ = emit_event(
                        &app,
                        &CommEvent::Error {
                            transport: transport.clone(),
                            message,
                            timestamp_ms: now_ms(),
                        },
                    );

                    // 进入重连
                    attempt = attempt.saturating_add(1);
                    let delay_ms = compute_backoff_ms(attempt);
                    let _ = emit_event(
                        &app,
                        &CommEvent::Reconnecting {
                            transport: transport.clone(),
                            attempt,
                            delay_ms,
                            timestamp_ms: now_ms(),
                        },
                    );

                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                        _ = &mut shutdown_rx => break,
                    }
                    continue;
                }
            }
        }

        let _ = emit_event(
            &app,
            &CommEvent::Disconnected {
                transport,
                timestamp_ms: now_ms(),
            },
        );
    });

    CommActorHandle {
        tx_high,
        tx_normal,
        shutdown_tx,
        join,
    }
}

pub fn spawn_tcp_actor(
    app: AppHandle,
    config: tcp::TcpConfig,
    initial_stream: tokio::net::TcpStream,
) -> CommActorHandle {
    let (tx_high, mut rx_high) = mpsc::channel::<Vec<u8>>(64);
    let (tx_normal, mut rx_normal) = mpsc::channel::<Vec<u8>>(256);
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let join = tauri::async_runtime::spawn(async move {
        let transport = "tcp".to_string();
        let mut attempt: u32 = 0;
        let mut stream_opt = Some(initial_stream);

        loop {
            // 先使用现有连接，连接断开后再进入重连流程（如果 initial_stream 无效则直接进入重连）
            let stream = if let Some(stream) = stream_opt.take() {
                stream
            } else {
                match tcp::open_stream(&config).await {
                    Ok(stream) => {
                        let dropped = drain_pending_frames(&mut rx_high, &mut rx_normal);
                        if dropped > 0 {
                            log::warn!(
                                "Dropped {} stale queued frame(s) before tcp reconnect",
                                dropped
                            );
                        }
                        stream
                    }
                    Err(err) => {
                        // 连接失败，进入重连，并有退避机制避免过于频繁的重试
                        attempt = attempt.saturating_add(1);
                        let delay_ms = compute_backoff_ms(attempt);
                        let _ = emit_event(
                            &app,
                            &CommEvent::Error {
                                transport: transport.clone(),
                                message: err,
                                timestamp_ms: now_ms(),
                            },
                        );
                        let _ = emit_event(
                            &app,
                            &CommEvent::Reconnecting {
                                transport: transport.clone(),
                                attempt,
                                delay_ms,
                                timestamp_ms: now_ms(),
                            },
                        );

                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                            _ = &mut shutdown_rx => break,
                        }
                        continue;
                    }
                }
            };

            attempt = 0;
            emit_event(
                &app,
                &CommEvent::Connected {
                    transport: transport.clone(),
                    timestamp_ms: now_ms(),
                },
            );

            match run_io_loop(
                &app,
                &transport,
                stream,
                &mut rx_high,
                &mut rx_normal,
                &mut shutdown_rx,
            )
            .await
            {
                ConnectionExit::Shutdown => break,
                ConnectionExit::IoError(message) => {
                    let _ = emit_event(
                        &app,
                        &CommEvent::Error {
                            transport: transport.clone(),
                            message,
                            timestamp_ms: now_ms(),
                        },
                    );

                    attempt = attempt.saturating_add(1);
                    let delay_ms = compute_backoff_ms(attempt);
                    let _ = emit_event(
                        &app,
                        &CommEvent::Reconnecting {
                            transport: transport.clone(),
                            attempt,
                            delay_ms,
                            timestamp_ms: now_ms(),
                        },
                    );

                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                        _ = &mut shutdown_rx => break,
                    }
                    continue;
                }
            }
        }

        let _ = emit_event(
            &app,
            &CommEvent::Disconnected {
                transport,
                timestamp_ms: now_ms(),
            },
        );
    });

    CommActorHandle {
        tx_high,
        tx_normal,
        shutdown_tx,
        join,
    }
}
