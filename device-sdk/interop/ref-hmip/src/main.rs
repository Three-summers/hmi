//! ref-hmip — HMI 侧真实协议代码（src-tauri/src/comm/proto.rs）的互操作测试 CLI
//!
//! 直接 include HMI 后端生产代码，不做任何改写：
//!   decode 模式：stdin 读字节流 -> FrameDecoder + decode_message -> 打印 F/M 行
//!   encode 模式：stdin 读 "mt flags ch seq hex" 行 -> encode_frame -> stdout 写原始字节
//!   stdmsg  模式：stdin 读标准消息命令 -> 按协议布局组 payload + encode_frame -> stdout
//!     （注：HMI 生产侧的标准消息 payload 由前端 TS/action 模板构造，Rust 后端没有
//!       生产编码器；此处命令为测试专用、按 docs/device-serial-interface.md §4.4 布局实现，
//!       用于反向验证 C SDK 解码器。）

#[path = "../../../../src-tauri/src/comm/proto.rs"]
mod proto;

use std::io::{BufRead, Read, Write};
use proto::{decode_message, DecoderConfig, EncodeFrameParams, FrameDecoder, Message};

/// 行输出并强制 flush（管道下 Rust stdout 默认块缓冲，必须手动刷新）
fn out_line(s: &str) {
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    out.write_all(s.as_bytes()).expect("write");
    out.write_all(b"\n").expect("write");
    out.flush().expect("flush");
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn unhex(s: &str) -> Vec<u8> {
    if s == "-" {
        return Vec::new();
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("bad hex"))
        .collect()
}

fn print_frame(f: &proto::Frame) {
    let crc = match f.header.payload_crc32 {
        Some(c) => format!("{:08x}", c),
        None => "-".to_string(),
    };
    out_line(&format!(
        "F {} {} {} {} {} {} {}",
        f.header.msg_type,
        f.header.flags,
        f.header.channel,
        f.header.seq,
        f.header.payload_len,
        crc,
        hex(&f.payload)
    ));
    match decode_message(f) {
        Ok(Message::Hello(v)) => {
            out_line(&format!("M hello {} {} {}", v.role as u8, v.capabilities, v.name))
        }
        Ok(Message::HelloAck(v)) => {
            out_line(&format!("M helloAck {} {}", v.capabilities, v.name))
        }
        Ok(Message::Heartbeat(v)) => out_line(&format!("M heartbeat {}", v.timestamp_ms)),
        Ok(Message::Request(v)) => {
            out_line(&format!("M request {} {} {}", v.request_id, v.method, hex(&v.body)))
        }
        Ok(Message::Response(v)) => {
            out_line(&format!("M response {} {} {}", v.request_id, v.status, hex(&v.body)))
        }
        Ok(Message::Event(v)) => {
            out_line(&format!("M event {} {} {}", v.event_id, v.timestamp_ms, hex(&v.body)))
        }
        Ok(Message::Error(v)) => out_line(&format!("M error {} {}", v.code, v.message)),
        Ok(Message::Raw { msg_type, payload }) => {
            out_line(&format!("M raw {} {}", msg_type, hex(&payload)))
        }
        Err(_) => out_line(&format!("M raw {} {}", f.header.msg_type, hex(&f.payload))),
    }
}

fn mode_decode() {
    // 增量解码：边读边解析（stdin 为管道，不能等 EOF）
    let mut dec = FrameDecoder::new(DecoderConfig::default());
    let mut buf = vec![0u8; 4096];
    let stdin = std::io::stdin();
    let mut lock = stdin.lock();
    loop {
        let n = lock.read(&mut buf).expect("read stdin");
        if n == 0 {
            break;
        }
        if let Err(e) = dec.push(&buf[..n]) {
            out_line(&format!("E {} {}", e.dropped_bytes, e.message));
            continue;
        }
        loop {
            match dec.next_frame() {
                Ok(Some(f)) => print_frame(&f),
                Ok(None) => break,
                Err(e) => out_line(&format!("E {} {}", e.dropped_bytes, e.message)),
            }
        }
    }
}

fn mode_encode() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = line.expect("line");
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        // mt flags ch seq hex（数值字段为十进制，仅 payload 为十六进制）
        let mt: u8 = parts[0].parse().expect("mt");
        let flags: u8 = parts[1].parse().expect("flags");
        let ch: u8 = parts[2].parse().expect("ch");
        let seq: u32 = parts[3].parse().expect("seq");
        let payload = unhex(parts[4]);
        let bytes = proto::encode_frame(EncodeFrameParams {
            msg_type: mt,
            flags,
            channel: ch,
            seq,
            payload: &payload,
        });
        out.write_all(&bytes).expect("write");
        out.flush().expect("flush");
    }
}

fn wr_u16le(p: &mut Vec<u8>, v: u16) {
    p.push((v & 0xff) as u8);
    p.push(((v >> 8) & 0xff) as u8);
}
fn wr_u32le(p: &mut Vec<u8>, v: u32) {
    for i in 0..4 {
        p.push(((v >> (8 * i)) & 0xff) as u8);
    }
}
fn wr_u64le(p: &mut Vec<u8>, v: u64) {
    for i in 0..8 {
        p.push(((v >> (8 * i)) & 0xff) as u8);
    }
}

/// 测试专用：按接口文档 §4.4 布局构造标准消息（见文件头注释）
fn mode_stdmsg() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = line.expect("line");
        let parts: Vec<&str> = line.splitn(6, ' ').collect();
        if parts.is_empty() {
            continue;
        }
        let (mt, flags, ch, seq, payload) = match parts[0] {
            // H role cap name
            "H" => {
                let role: u8 = parts[1].parse().expect("role");
                let cap: u32 = parts[2].parse().expect("cap");
                let name = parts[3].trim();
                let mut p = Vec::new();
                p.push(role);
                wr_u32le(&mut p, cap);
                p.push((name.len() & 0xff) as u8);
                p.extend_from_slice(name.as_bytes());
                (proto::msg_type::HELLO, 0, 1, 1, p)
            }
            // B ts
            "B" => {
                let ts: u64 = parts[1].parse().expect("ts");
                let mut p = Vec::new();
                wr_u64le(&mut p, ts);
                (proto::msg_type::HEARTBEAT, 0, 1, 2, p)
            }
            // Q ch reqid method hex
            "Q" => {
                let ch: u8 = parts[1].parse().expect("ch");
                let reqid: u32 = parts[2].parse().expect("reqid");
                let method: u16 = parts[3].parse().expect("method");
                let mut p = Vec::new();
                wr_u32le(&mut p, reqid);
                wr_u16le(&mut p, method);
                wr_u16le(&mut p, 0);
                p.extend_from_slice(&unhex(parts[4]));
                (proto::msg_type::REQUEST, 0, ch, 3, p)
            }
            // P ch seq reqid status hex
            "P" => {
                let ch: u8 = parts[1].parse().expect("ch");
                let seq: u32 = parts[2].parse().expect("seq");
                let reqid: u32 = parts[3].parse().expect("reqid");
                let status: u16 = parts[4].parse().expect("status");
                let mut p = Vec::new();
                wr_u32le(&mut p, reqid);
                wr_u16le(&mut p, status);
                wr_u16le(&mut p, 0);
                p.extend_from_slice(&unhex(parts[5]));
                (proto::msg_type::RESPONSE, 0, ch, seq, p)
            }
            // V ch eventid ts hex
            "V" => {
                let ch: u8 = parts[1].parse().expect("ch");
                let eventid: u16 = parts[2].parse().expect("eventid");
                let ts: u64 = parts[3].parse().expect("ts");
                let mut p = Vec::new();
                wr_u16le(&mut p, eventid);
                wr_u16le(&mut p, 0);
                wr_u64le(&mut p, ts);
                p.extend_from_slice(&unhex(parts[4]));
                (proto::msg_type::EVENT, 0, ch, 4, p)
            }
            // X ch code message
            "X" => {
                let ch: u8 = parts[1].parse().expect("ch");
                let code: u16 = parts[2].parse().expect("code");
                let msg = parts[3].trim();
                let mut p = Vec::new();
                wr_u16le(&mut p, code);
                wr_u16le(&mut p, 0);
                wr_u16le(&mut p, msg.len() as u16);
                p.extend_from_slice(msg.as_bytes());
                (proto::msg_type::ERROR, 0, ch, 5, p)
            }
            _ => panic!("unknown command"),
        };
        let bytes = proto::encode_frame(EncodeFrameParams {
            msg_type: mt,
            flags,
            channel: ch,
            seq,
            payload: &payload,
        });
        out.write_all(&bytes).expect("write");
        out.flush().expect("flush");
    }
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "decode".into());
    match mode.as_str() {
        "decode" => mode_decode(),
        "encode" => mode_encode(),
        "stdmsg" => mode_stdmsg(),
        other => panic!("unknown mode {other}"),
    }
}
