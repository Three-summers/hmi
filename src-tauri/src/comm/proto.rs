use bytes::{Buf, Bytes, BytesMut};
use crc32fast::Hasher as Crc32;

/// 协议：HMI Binary Protocol v1（HMIP）
///
/// 设计目标：
/// - 面向 TCP/Serial 等字节流：天然支持拆包/粘包
/// - 头部固定 + 可选 CRC：解析快、内存布局简单
/// - 可重同步：当流中出现噪声/错位时能尽快找回帧边界
/// - 可扩展：version + msg_type/channel/flags/seq 作为长期演进主干
///
/// 帧格式（小端）：
/// [0..4)   MAGIC = "HMIP"
/// [4]      VERSION = 1
/// [5]      MSG_TYPE (u8)
/// [6]      FLAGS (u8)  bit0=CRC32(payload) present
/// [7]      CHANNEL (u8)
/// [8..12)  SEQ (u32 LE)
/// [12..16) PAYLOAD_LEN (u32 LE)
/// [16..20) PAYLOAD_CRC32 (u32 LE) 仅当 FLAGS.CRC32=1 存在
/// [..]     PAYLOAD bytes
pub const MAGIC: [u8; 4] = *b"HMIP";
pub const VERSION: u8 = 1;

pub const FLAG_CRC32: u8 = 0x01;

pub const HEADER_LEN_BASE: usize = 16;
pub const HEADER_LEN_WITH_CRC: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    pub msg_type: u8,
    pub flags: u8,
    pub channel: u8,
    pub seq: u32,
    pub payload_len: u32,
    pub payload_crc32: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub header: FrameHeader,
    pub payload: Bytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError {
    pub message: String,
    /// 为了重同步而丢弃的字节数（用于观测）
    pub dropped_bytes: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct DecoderConfig {
    pub max_payload_len: usize,
    pub max_buffer_len: usize,
}

impl Default for DecoderConfig {
    fn default() -> Self {
        Self {
            // 工业 HMI 一般消息不大；大数据（如波形/频谱）建议走专用通道或分片。
            max_payload_len: 8 * 1024 * 1024,
            // 防止长时间无法同步导致 buffer 无限增长
            max_buffer_len: 16 * 1024 * 1024,
        }
    }
}

pub struct FrameDecoder {
    cfg: DecoderConfig,
    buf: BytesMut,
}

impl FrameDecoder {
    pub fn new(cfg: DecoderConfig) -> Self {
        Self {
            cfg,
            buf: BytesMut::with_capacity(8 * 1024),
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<(), DecodeError> {
        if bytes.is_empty() {
            return Ok(());
        }

        if self.buf.len().saturating_add(bytes.len()) > self.cfg.max_buffer_len {
            // 避免 OOM：直接清空并报错（让上层决定是否重连/告警）
            let dropped = self.buf.len();
            self.buf.clear();
            return Err(DecodeError {
                message: format!(
                    "Decoder buffer overflow (max_buffer_len={} bytes)",
                    self.cfg.max_buffer_len
                ),
                dropped_bytes: dropped,
            });
        }

        self.buf.extend_from_slice(bytes);
        Ok(())
    }

    /// 尝试解析一帧。
    ///
    /// - Ok(None)：数据不足
    /// - Ok(Some(frame))：成功解析
    /// - Err(e)：遇到错误并做了重同步（可继续调用 next_frame）
    pub fn next_frame(&mut self) -> Result<Option<Frame>, DecodeError> {
        let mut dropped = 0usize;

        loop {
            // 至少需要 magic
            if self.buf.len() < MAGIC.len() {
                return Ok(None);
            }

            // 若不在帧边界，尝试重同步：寻找 MAGIC
            if &self.buf[..MAGIC.len()] != MAGIC {
                let pos = find_magic(&self.buf);
                match pos {
                    Some(0) => {
                        // 不应出现：前面已比较过；继续往下走
                    }
                    Some(n) => {
                        self.buf.advance(n);
                        dropped += n;
                    }
                    None => {
                        // 未找到 magic：丢弃除最后 3 字节外的内容（保留可能的半个 magic）
                        let keep = MAGIC.len().saturating_sub(1);
                        if self.buf.len() > keep {
                            let n = self.buf.len() - keep;
                            self.buf.advance(n);
                            dropped += n;
                        }
                        return Err(DecodeError {
                            message: "Resync: magic not found".to_string(),
                            dropped_bytes: dropped,
                        });
                    }
                }

                if dropped > 0 {
                    return Err(DecodeError {
                        message: "Resync: dropped bytes before magic".to_string(),
                        dropped_bytes: dropped,
                    });
                }

                // 继续进入头部解析
            }

            // 头部最小长度不足：等待更多数据
            if self.buf.len() < HEADER_LEN_BASE {
                return Ok(None);
            }

            // 解析头部（小端）
            let version = self.buf[4];
            if version != VERSION {
                // 版本不匹配：丢弃当前 magic 的首字节，继续找下一处 magic
                self.buf.advance(1);
                dropped += 1;
                continue;
            }

            let msg_type = self.buf[5];
            let flags = self.buf[6];
            let channel = self.buf[7];
            let seq = u32::from_le_bytes(self.buf[8..12].try_into().unwrap());
            let payload_len =
                u32::from_le_bytes(self.buf[12..16].try_into().unwrap());

            let has_crc = (flags & FLAG_CRC32) != 0;
            let header_len = if has_crc {
                HEADER_LEN_WITH_CRC
            } else {
                HEADER_LEN_BASE
            };

            if self.buf.len() < header_len {
                return Ok(None);
            }

            if payload_len as usize > self.cfg.max_payload_len {
                // 长度异常：丢弃 magic 的首字节并重试（避免死锁在同一位置）
                self.buf.advance(1);
                dropped += 1;
                return Err(DecodeError {
                    message: format!(
                        "Payload too large (len={}, max={})",
                        payload_len, self.cfg.max_payload_len
                    ),
                    dropped_bytes: dropped,
                });
            }

            let frame_len = header_len + payload_len as usize;
            if self.buf.len() < frame_len {
                return Ok(None);
            }

            let frame_bytes = self.buf.split_to(frame_len).freeze();
            let payload = frame_bytes.slice(header_len..frame_len);

            let payload_crc32 = if has_crc {
                Some(u32::from_le_bytes(
                    frame_bytes[16..20].try_into().unwrap(),
                ))
            } else {
                None
            };

            if let Some(expected) = payload_crc32 {
                let actual = crc32_bytes(&payload);
                if actual != expected {
                    return Err(DecodeError {
                        message: format!(
                            "CRC32 mismatch (expected={:#010x}, actual={:#010x})",
                            expected, actual
                        ),
                        dropped_bytes: dropped,
                    });
                }
            }

            return Ok(Some(Frame {
                header: FrameHeader {
                    msg_type,
                    flags,
                    channel,
                    seq,
                    payload_len,
                    payload_crc32,
                },
                payload,
            }));
        }
    }
}

fn crc32_bytes(bytes: &[u8]) -> u32 {
    let mut hasher = Crc32::new();
    hasher.update(bytes);
    hasher.finalize()
}

fn find_magic(buf: &BytesMut) -> Option<usize> {
    // 朴素扫描：先找 'H'，再比对后续 3 字节；避免 windows(4) 的额外开销
    let first = MAGIC[0];
    if buf.len() < MAGIC.len() {
        return None;
    }
    let max = buf.len() - MAGIC.len();
    for i in 0..=max {
        if buf[i] != first {
            continue;
        }
        if &buf[i..i + MAGIC.len()] == MAGIC {
            return Some(i);
        }
    }
    None
}

pub struct EncodeFrameParams<'a> {
    pub msg_type: u8,
    pub flags: u8,
    pub channel: u8,
    pub seq: u32,
    pub payload: &'a [u8],
}

pub fn encode_frame(params: EncodeFrameParams<'_>) -> Vec<u8> {
    let has_crc = (params.flags & FLAG_CRC32) != 0;
    let header_len = if has_crc {
        HEADER_LEN_WITH_CRC
    } else {
        HEADER_LEN_BASE
    };

    let mut out = Vec::with_capacity(header_len + params.payload.len());
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(params.msg_type);
    out.push(params.flags);
    out.push(params.channel);
    out.extend_from_slice(&params.seq.to_le_bytes());
    out.extend_from_slice(&(params.payload.len() as u32).to_le_bytes());

    if has_crc {
        let crc = crc32_bytes(params.payload);
        out.extend_from_slice(&crc.to_le_bytes());
    }

    out.extend_from_slice(params.payload);
    out
}

/// 协议消息类型（推荐值；也允许自定义 msg_type）
pub mod msg_type {
    pub const HELLO: u8 = 0x01;
    pub const HELLO_ACK: u8 = 0x02;
    pub const HEARTBEAT: u8 = 0x03;

    pub const REQUEST: u8 = 0x10;
    pub const RESPONSE: u8 = 0x11;
    pub const EVENT: u8 = 0x20;
    pub const ERROR: u8 = 0x7F;
}

/// Hello 角色
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Client = 0,
    Server = 1,
}

impl Role {
    pub fn as_u8(self) -> u8 {
        self as u8
    }

    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Client),
            1 => Some(Self::Server),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hello {
    pub role: Role,
    pub capabilities: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelloAck {
    pub capabilities: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heartbeat {
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub request_id: u32,
    pub method: u16,
    pub body: Bytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub request_id: u32,
    pub status: u16,
    pub body: Bytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub event_id: u16,
    pub timestamp_ms: u64,
    pub body: Bytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtoError {
    pub code: u16,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Hello(Hello),
    HelloAck(HelloAck),
    Heartbeat(Heartbeat),
    Request(Request),
    Response(Response),
    Event(Event),
    Error(ProtoError),
    Raw { msg_type: u8, payload: Bytes },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageDecodeError(pub String);

pub fn decode_message(frame: &Frame) -> Result<Message, MessageDecodeError> {
    let payload = frame.payload.clone();
    match frame.header.msg_type {
        msg_type::HELLO => decode_hello(&payload).map(Message::Hello),
        msg_type::HELLO_ACK => decode_hello_ack(&payload).map(Message::HelloAck),
        msg_type::HEARTBEAT => decode_heartbeat(&payload).map(Message::Heartbeat),
        msg_type::REQUEST => decode_request(payload).map(Message::Request),
        msg_type::RESPONSE => decode_response(payload).map(Message::Response),
        msg_type::EVENT => decode_event(payload).map(Message::Event),
        msg_type::ERROR => decode_error(&payload).map(Message::Error),
        other => Ok(Message::Raw {
            msg_type: other,
            payload,
        }),
    }
}

fn decode_hello(payload: &[u8]) -> Result<Hello, MessageDecodeError> {
    if payload.len() < 1 + 4 + 1 {
        return Err(MessageDecodeError("HELLO payload too short".to_string()));
    }
    let role = Role::from_u8(payload[0])
        .ok_or_else(|| MessageDecodeError("HELLO invalid role".to_string()))?;
    let capabilities = u32::from_le_bytes(payload[1..5].try_into().unwrap());
    let name_len = payload[5] as usize;
    if payload.len() < 6 + name_len {
        return Err(MessageDecodeError("HELLO name truncated".to_string()));
    }
    let name_bytes = &payload[6..6 + name_len];
    let name = std::str::from_utf8(name_bytes)
        .map_err(|_| MessageDecodeError("HELLO name not utf8".to_string()))?
        .to_string();
    Ok(Hello {
        role,
        capabilities,
        name,
    })
}

fn decode_hello_ack(payload: &[u8]) -> Result<HelloAck, MessageDecodeError> {
    if payload.len() < 4 + 1 {
        return Err(MessageDecodeError(
            "HELLO_ACK payload too short".to_string(),
        ));
    }
    let capabilities = u32::from_le_bytes(payload[0..4].try_into().unwrap());
    let name_len = payload[4] as usize;
    if payload.len() < 5 + name_len {
        return Err(MessageDecodeError("HELLO_ACK name truncated".to_string()));
    }
    let name_bytes = &payload[5..5 + name_len];
    let name = std::str::from_utf8(name_bytes)
        .map_err(|_| MessageDecodeError("HELLO_ACK name not utf8".to_string()))?
        .to_string();
    Ok(HelloAck { capabilities, name })
}

fn decode_heartbeat(payload: &[u8]) -> Result<Heartbeat, MessageDecodeError> {
    if payload.len() != 8 {
        return Err(MessageDecodeError(
            "HEARTBEAT payload must be 8 bytes".to_string(),
        ));
    }
    let ts = u64::from_le_bytes(payload[0..8].try_into().unwrap());
    Ok(Heartbeat { timestamp_ms: ts })
}

fn decode_request(payload: Bytes) -> Result<Request, MessageDecodeError> {
    if payload.len() < 8 {
        return Err(MessageDecodeError("REQUEST payload too short".to_string()));
    }
    let request_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
    let method = u16::from_le_bytes(payload[4..6].try_into().unwrap());
    // [6..8) reserved
    let body = payload.slice(8..);
    Ok(Request {
        request_id,
        method,
        body,
    })
}

fn decode_response(payload: Bytes) -> Result<Response, MessageDecodeError> {
    if payload.len() < 8 {
        return Err(MessageDecodeError(
            "RESPONSE payload too short".to_string(),
        ));
    }
    let request_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
    let status = u16::from_le_bytes(payload[4..6].try_into().unwrap());
    // [6..8) reserved
    let body = payload.slice(8..);
    Ok(Response {
        request_id,
        status,
        body,
    })
}

fn decode_event(payload: Bytes) -> Result<Event, MessageDecodeError> {
    if payload.len() < 12 {
        return Err(MessageDecodeError("EVENT payload too short".to_string()));
    }
    let event_id = u16::from_le_bytes(payload[0..2].try_into().unwrap());
    // [2..4) reserved
    let timestamp_ms = u64::from_le_bytes(payload[4..12].try_into().unwrap());
    let body = payload.slice(12..);
    Ok(Event {
        event_id,
        timestamp_ms,
        body,
    })
}

fn decode_error(payload: &[u8]) -> Result<ProtoError, MessageDecodeError> {
    if payload.len() < 2 + 2 + 2 {
        return Err(MessageDecodeError("ERROR payload too short".to_string()));
    }
    let code = u16::from_le_bytes(payload[0..2].try_into().unwrap());
    // [2..4) reserved
    let msg_len = u16::from_le_bytes(payload[4..6].try_into().unwrap()) as usize;
    if payload.len() < 6 + msg_len {
        return Err(MessageDecodeError("ERROR message truncated".to_string()));
    }
    let msg_bytes = &payload[6..6 + msg_len];
    let message = std::str::from_utf8(msg_bytes)
        .map_err(|_| MessageDecodeError("ERROR message not utf8".to_string()))?
        .to_string();
    Ok(ProtoError { code, message })
}

pub fn encode_hello(hello: &Hello) -> Vec<u8> {
    // role(1) + capabilities(4) + name_len(1) + name
    let name_bytes = hello.name.as_bytes();
    let name_len = name_bytes.len().min(255);
    let mut out = Vec::with_capacity(1 + 4 + 1 + name_len);
    out.push(hello.role.as_u8());
    out.extend_from_slice(&hello.capabilities.to_le_bytes());
    out.push(name_len as u8);
    out.extend_from_slice(&name_bytes[..name_len]);
    out
}

pub fn encode_hello_ack(ack: &HelloAck) -> Vec<u8> {
    let name_bytes = ack.name.as_bytes();
    let name_len = name_bytes.len().min(255);
    let mut out = Vec::with_capacity(4 + 1 + name_len);
    out.extend_from_slice(&ack.capabilities.to_le_bytes());
    out.push(name_len as u8);
    out.extend_from_slice(&name_bytes[..name_len]);
    out
}

pub fn encode_heartbeat(hb: &Heartbeat) -> Vec<u8> {
    hb.timestamp_ms.to_le_bytes().to_vec()
}

pub fn encode_request(req: &Request) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + req.body.len());
    out.extend_from_slice(&req.request_id.to_le_bytes());
    out.extend_from_slice(&req.method.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&req.body);
    out
}

pub fn encode_response(resp: &Response) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + resp.body.len());
    out.extend_from_slice(&resp.request_id.to_le_bytes());
    out.extend_from_slice(&resp.status.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&resp.body);
    out
}

pub fn encode_event(ev: &Event) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + ev.body.len());
    out.extend_from_slice(&ev.event_id.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&ev.timestamp_ms.to_le_bytes());
    out.extend_from_slice(&ev.body);
    out
}

pub fn encode_error(err: &ProtoError) -> Vec<u8> {
    let msg_bytes = err.message.as_bytes();
    let msg_len = msg_bytes.len().min(u16::MAX as usize);
    let mut out = Vec::with_capacity(2 + 2 + 2 + msg_len);
    out.extend_from_slice(&err.code.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&(msg_len as u16).to_le_bytes());
    out.extend_from_slice(&msg_bytes[..msg_len]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip_with_crc() {
        let payload = b"hello";
        let bytes = encode_frame(EncodeFrameParams {
            msg_type: msg_type::EVENT,
            flags: FLAG_CRC32,
            channel: 2,
            seq: 42,
            payload,
        });

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes).unwrap();

        let frame = dec.next_frame().unwrap().unwrap();
        assert_eq!(frame.header.msg_type, msg_type::EVENT);
        assert_eq!(frame.header.channel, 2);
        assert_eq!(frame.header.seq, 42);
        assert_eq!(frame.payload.as_ref(), payload);
    }

    #[test]
    fn decoder_handles_split_frames() {
        let payload = vec![1u8, 2, 3, 4, 5, 6, 7, 8];
        let bytes = encode_frame(EncodeFrameParams {
            msg_type: msg_type::REQUEST,
            flags: 0,
            channel: 1,
            seq: 1,
            payload: &payload,
        });

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes[..5]).unwrap();
        assert_eq!(dec.next_frame().unwrap(), None);

        dec.push(&bytes[5..]).unwrap();
        let frame = dec.next_frame().unwrap().unwrap();
        assert_eq!(frame.payload.as_ref(), payload.as_slice());
    }

    #[test]
    fn decode_message_hello() {
        let hello = Hello {
            role: Role::Client,
            capabilities: 0xAABBCCDD,
            name: "hmi-ui".to_string(),
        };
        let payload = encode_hello(&hello);
        let bytes = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HELLO,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &payload,
        });

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes).unwrap();
        let frame = dec.next_frame().unwrap().unwrap();

        let msg = decode_message(&frame).unwrap();
        match msg {
            Message::Hello(v) => {
                assert_eq!(v.role, Role::Client);
                assert_eq!(v.capabilities, 0xAABBCCDD);
                assert_eq!(v.name, "hmi-ui");
            }
            _ => panic!("unexpected msg"),
        }
    }

    #[test]
    fn decoder_handles_sticky_frames() {
        let a = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HEARTBEAT,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &encode_heartbeat(&Heartbeat { timestamp_ms: 1 }),
        });
        let b = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HEARTBEAT,
            flags: 0,
            channel: 0,
            seq: 2,
            payload: &encode_heartbeat(&Heartbeat { timestamp_ms: 2 }),
        });

        let mut bytes = Vec::with_capacity(a.len() + b.len());
        bytes.extend_from_slice(&a);
        bytes.extend_from_slice(&b);

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes).unwrap();

        let f1 = dec.next_frame().unwrap().unwrap();
        let f2 = dec.next_frame().unwrap().unwrap();
        assert_eq!(f1.header.seq, 1);
        assert_eq!(f2.header.seq, 2);
        assert_eq!(dec.next_frame().unwrap(), None);
    }

    #[test]
    fn decoder_resync_drops_garbage_then_recovers() {
        let frame = encode_frame(EncodeFrameParams {
            msg_type: msg_type::REQUEST,
            flags: 0,
            channel: 0,
            seq: 9,
            payload: &[1, 2, 3],
        });

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(b"\x00\x01garbage").unwrap();
        dec.push(&frame).unwrap();

        let err = dec.next_frame().unwrap_err();
        assert!(err.message.contains("Resync"));
        assert!(err.dropped_bytes > 0);

        let parsed = dec.next_frame().unwrap().unwrap();
        assert_eq!(parsed.header.seq, 9);
        assert_eq!(parsed.payload.as_ref(), &[1, 2, 3]);
    }

    #[test]
    fn decoder_crc_mismatch_is_error() {
        let payload = b"hello";
        let mut bytes = encode_frame(EncodeFrameParams {
            msg_type: msg_type::EVENT,
            flags: FLAG_CRC32,
            channel: 0,
            seq: 1,
            payload,
        });

        // 篡改 payload 最后一个字节，触发 CRC 错误
        *bytes.last_mut().unwrap() ^= 0xFF;

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes).unwrap();

        let err = dec.next_frame().unwrap_err();
        assert!(err.message.contains("CRC32 mismatch"));
    }

    #[test]
    fn decoder_rejects_too_large_payload_len() {
        let mut cfg = DecoderConfig::default();
        cfg.max_payload_len = 4;

        let bytes = encode_frame(EncodeFrameParams {
            msg_type: msg_type::REQUEST,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &[1, 2, 3, 4, 5],
        });

        let mut dec = FrameDecoder::new(cfg);
        dec.push(&bytes).unwrap();

        let err = dec.next_frame().unwrap_err();
        assert!(err.message.contains("Payload too large"));
    }

    #[test]
    fn decoder_buffer_overflow_clears_buffer() {
        let cfg = DecoderConfig {
            max_payload_len: 1024,
            max_buffer_len: 32,
        };
        let mut dec = FrameDecoder::new(cfg);

        dec.push(&[0u8; 20]).unwrap();
        let err = dec.push(&[0u8; 20]).unwrap_err();
        assert!(err.message.contains("buffer overflow"));
        assert_eq!(err.dropped_bytes, 20);

        // buffer 被清空后应可继续使用
        let frame = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HEARTBEAT,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &encode_heartbeat(&Heartbeat { timestamp_ms: 1 }),
        });
        dec.push(&frame).unwrap();
        assert!(dec.next_frame().unwrap().is_some());
    }

    #[test]
    fn decode_message_error() {
        let err = ProtoError {
            code: 0x0102,
            message: "boom".to_string(),
        };
        let payload = encode_error(&err);
        let bytes = encode_frame(EncodeFrameParams {
            msg_type: msg_type::ERROR,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &payload,
        });

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes).unwrap();
        let frame = dec.next_frame().unwrap().unwrap();

        let msg = decode_message(&frame).unwrap();
        match msg {
            Message::Error(v) => {
                assert_eq!(v.code, 0x0102);
                assert_eq!(v.message, "boom");
            }
            _ => panic!("unexpected msg"),
        }
    }

    #[test]
    fn decoder_resync_magic_not_found_then_recovers() {
        let frame = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HEARTBEAT,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &encode_heartbeat(&Heartbeat { timestamp_ms: 1 }),
        });

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(b"no magic here...").unwrap();

        let err = dec.next_frame().unwrap_err();
        assert!(err.message.contains("magic not found"));

        dec.push(&frame).unwrap();

        // 可能先触发一次“丢弃前缀字节”的重同步错误，再解析出帧
        let _ = dec.next_frame();
        let parsed = dec.next_frame().unwrap().unwrap();
        assert_eq!(parsed.header.seq, 1);
    }

    #[test]
    fn decoder_skips_unknown_version_then_recovers() {
        let mut bad = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HEARTBEAT,
            flags: 0,
            channel: 0,
            seq: 1,
            payload: &encode_heartbeat(&Heartbeat { timestamp_ms: 1 }),
        });
        // version byte at offset 4
        bad[4] = 2;

        let good = encode_frame(EncodeFrameParams {
            msg_type: msg_type::HEARTBEAT,
            flags: 0,
            channel: 0,
            seq: 2,
            payload: &encode_heartbeat(&Heartbeat { timestamp_ms: 2 }),
        });

        let mut bytes = Vec::with_capacity(bad.len() + good.len());
        bytes.extend_from_slice(&bad);
        bytes.extend_from_slice(&good);

        let mut dec = FrameDecoder::new(DecoderConfig::default());
        dec.push(&bytes).unwrap();

        // 先发生一次重同步（版本不匹配导致丢弃/扫描）
        let _ = dec.next_frame();

        // 最终应能解析到正确版本的帧
        let frame = dec.next_frame().unwrap().unwrap();
        assert_eq!(frame.header.seq, 2);
    }
}
