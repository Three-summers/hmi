//! ref-serial — 使用 HMI 后端真实串口栈（src-tauri/src/comm/serial.rs，不改写一行）
//! 通过 socat PTY 与 C SDK 设备端模拟器（pty_device）做真实串口链路联调。
//!
//! 验证内容：
//!   1. 真实 tokio-serial 打开 PTY（波特率/数据位/停止位/校验配置路径）
//!   2. 真实 proto.rs 编解码走真实字节流
//!   3. 设备上电 HELLO/HEARTBEAT、动作应答（回显语义）、PING、
//!      线路噪声重同步、40 轮随机动作 fuzz

#[path = "../../../../src-tauri/src/comm/serial.rs"]
mod serial;
#[path = "../../../../src-tauri/src/comm/proto.rs"]
mod proto;

use proto::{decode_message, DecoderConfig, EncodeFrameParams, Frame, FrameDecoder, Message};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{timeout, Duration};

const READ_TIMEOUT: Duration = Duration::from_secs(3);

enum Item {
    Frame(Frame),
    DecodeError { dropped: usize, message: String },
    Eof,
}

fn print_body_hex(body: &[u8]) -> String {
    let mut s = String::new();
    for b in body {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

async fn send_frame(
    io: &mut tokio_serial::SerialStream,
    mt: u8,
    flags: u8,
    ch: u8,
    seq: u32,
    payload: &[u8],
) {
    let bytes = proto::encode_frame(EncodeFrameParams {
        msg_type: mt,
        flags,
        channel: ch,
        seq,
        payload,
    });
    io.write_all(&bytes).await.expect("serial write");
}

async fn next_item(dec: &mut FrameDecoder, io: &mut tokio_serial::SerialStream) -> Item {
    loop {
        match dec.next_frame() {
            Ok(Some(f)) => return Item::Frame(f),
            Ok(None) => {}
            Err(e) => {
                return Item::DecodeError {
                    dropped: e.dropped_bytes,
                    message: e.message,
                }
            }
        }
        let mut buf = [0u8; 512];
        let n = match timeout(READ_TIMEOUT, io.read(&mut buf)).await {
            Ok(Ok(n)) => n,
            Ok(Err(_)) => return Item::Eof, /* PTY 对端关闭（EIO） */
            Err(_) => return Item::Eof,     /* 读超时 */
        };
        if n == 0 {
            return Item::Eof;
        }
        let _ = dec.push(&buf[..n]);
    }
}

async fn expect_response(
    dec: &mut FrameDecoder,
    io: &mut tokio_serial::SerialStream,
) -> (u32, u16, Vec<u8>) {
    loop {
        match next_item(dec, io).await {
            Item::Frame(f) => {
                if let Ok(Message::Response(r)) = decode_message(&f) {
                    assert_eq!(f.header.channel, 1, "channel echo");
                    return (f.header.seq, r.status, r.body.to_vec());
                }
                // 非 RESPONSE 帧：跳过（如设备主动上报）
            }
            Item::DecodeError { .. } => continue,
            Item::Eof => panic!("eof while waiting response"),
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::args().nth(1).expect("usage: ref-serial <pty path>");
    let cfg = serial::SerialConfig {
        port: port.clone(),
        baud_rate: 115200,
        data_bits: 8,
        stop_bits: 1,
        parity: "none".to_string(),
    };
    /* 真实 HMI 串口打开路径 */
    let mut io = serial::open_stream(&cfg).expect("open serial pty");
    let mut dec = FrameDecoder::new(DecoderConfig::default());

    /* 1. 设备上电：HELLO + HEARTBEAT */
    let f = match next_item(&mut dec, &mut io).await {
        Item::Frame(f) => f,
        other => panic!("expect hello frame, got {:?}", item_name(&other)),
    };
    match decode_message(&f) {
        Ok(Message::Hello(h)) => println!("HELLO-OK name={} role={}", h.name, h.role as u8),
        other => panic!("expect hello, got {:?}", other.map(|_| ())),
    }
    let f = match next_item(&mut dec, &mut io).await {
        Item::Frame(f) => f,
        other => panic!("expect heartbeat frame, got {:?}", item_name(&other)),
    };
    match decode_message(&f) {
        Ok(Message::Heartbeat(h)) => println!("HB-OK ts={}", h.timestamp_ms),
        other => panic!("expect heartbeat, got {:?}", other.map(|_| ())),
    }

    /* 2. 称量动作：期望回显 seq/request_id + status=0 + float32 body */
    send_frame(&mut io, 0x40, 0, 1, 1, &[0x01, 0x01]).await;
    let (seq, status, body) = expect_response(&mut dec, &mut io).await;
    assert_eq!(seq, 1, "weigh seq echo");
    assert_eq!(status, 0, "weigh status");
    assert_eq!(body.len(), 4, "weigh body len");
    println!("WEIGH-OK seq={} status={} body={}", seq, status, print_body_hex(&body));

    /* 3. 未知动作：期望 status=1 */
    send_frame(&mut io, 0x50, 0, 1, 2, &[0xff, 0xff]).await;
    let (seq, status, body) = expect_response(&mut dec, &mut io).await;
    assert_eq!(seq, 2, "unknown seq echo");
    assert_eq!(status, 1, "unknown status");
    assert_eq!(body.len(), 0, "unknown body");
    println!("UNKNOWN-OK seq={} status={}", seq, status);

    /* 4. PING（REQUEST payload 由测试侧构造，与 HMI 前端/模板行为一致） */
    let mut p = Vec::new();
    p.extend_from_slice(&777u32.to_le_bytes());
    p.extend_from_slice(&1u16.to_le_bytes());
    p.extend_from_slice(&0u16.to_le_bytes());
    send_frame(&mut io, proto::msg_type::REQUEST, 0, 1, 3, &p).await;
    let (seq, status, body) = expect_response(&mut dec, &mut io).await;
    assert_eq!(seq, 3, "ping seq echo");
    assert_eq!(status, 0, "ping status");
    assert_eq!(body, b"PONG", "ping body");
    println!("PING-OK seq={} status={} body={}", seq, status, print_body_hex(&body));

    /* 5. 随机动作 fuzz：40 轮，验证 seq/channel 回显与状态语义 */
    let mut x: u32 = 12345;
    for i in 0..40u32 {
        x = x.wrapping_mul(1664525).wrapping_add(1013904223);
        let mt = 0x40 + (x % 0x10) as u8;
        let seq = 100 + i;
        send_frame(&mut io, mt, 0, 1, seq, &[i as u8, 0x5a]).await;
        let (rseq, rstatus, _) = expect_response(&mut dec, &mut io).await;
        assert_eq!(rseq, seq, "fuzz seq echo");
        /* 业务语义：0x40 称量 / 0x41 搅拌 / 0x42 测粘度 → status=0，其余未知动作 → 1 */
        let expect_status = if matches!(mt, 0x40 | 0x41 | 0x42) { 0 } else { 1 };
        assert_eq!(rstatus, expect_status, "fuzz status");
    }
    println!("FUZZ-OK n=40");

    /* 6. 噪声测试（收尾）：设备注入 4 字节噪声 + EVENT 后退出 */
    send_frame(&mut io, 0x60, 0, 1, 4, &[0x06]).await;
    let mut dropped_total = 0usize;
    let mut saw_resync = false;
    loop {
        match next_item(&mut dec, &mut io).await {
            Item::DecodeError { dropped, message } => {
                dropped_total += dropped;
                if message.contains("Resync") {
                    saw_resync = true;
                }
            }
            Item::Frame(f) => {
                if let Ok(Message::Event(e)) = decode_message(&f) {
                    assert!(saw_resync, "resync before event");
                    assert_eq!(e.event_id, 0x0009);
                    assert_eq!(e.body.as_ref(), b"noise-done");
                    println!(
                        "NOISE-OK dropped={} event={} body={}",
                        dropped_total,
                        e.event_id,
                        print_body_hex(&e.body)
                    );
                    break;
                }
            }
            Item::Eof => panic!("eof before event"),
        }
    }

    println!("SERIAL-MOCK-ALL-OK");
}

fn item_name(i: &Item) -> &'static str {
    match i {
        Item::Frame(_) => "frame",
        Item::DecodeError { .. } => "decode-error",
        Item::Eof => "eof",
    }
}
