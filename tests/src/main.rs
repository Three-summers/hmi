use std::io::{self, BufRead, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

fn main() {
    println!("=== TCP 测试工具 ===");
    println!("用法:");
    println!("  client <host:port>  - 连接到 TCP 服务器");
    println!("  server <port>       - 启动 TCP 服务器");
    println!();

    let args: Vec<String> = std::env::args().collect();

    if args.len() < 3 {
        println!("示例:");
        println!("  {} client 127.0.0.1:9000", args[0]);
        println!("  {} server 9000", args[0]);
        return;
    }

    match args[1].as_str() {
        "client" => run_client(&args[2]),
        "server" => run_server(&args[2]),
        _ => {
            eprintln!("未知命令: {}", args[1]);
            eprintln!("请使用 'client' 或 'server'");
        }
    }
}

/// TCP 客户端模式
fn run_client(addr: &str) {
    println!("正在连接到 {}...", addr);

    match TcpStream::connect(addr) {
        Ok(stream) => {
            println!("已连接到 {}", addr);
            println!();
            println!("命令:");
            println!("  输入文本直接发送");
            println!("  hex:XX XX XX  - 发送十六进制数据");
            println!("  quit          - 退出");
            println!();

            handle_connection(stream);
        }
        Err(e) => {
            eprintln!("连接失败: {}", e);
        }
    }
}

/// TCP 服务器模式
fn run_server(port: &str) {
    let addr = format!("0.0.0.0:{}", port);
    println!("正在监听 {}...", addr);

    match TcpListener::bind(&addr) {
        Ok(listener) => {
            println!("服务器已启动，等待连接...");

            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let peer = stream.peer_addr().unwrap();
                        println!("新连接: {}", peer);
                        println!();
                        println!("命令:");
                        println!("  输入文本直接发送");
                        println!("  hex:XX XX XX  - 发送十六进制数据");
                        println!("  quit          - 断开当前连接");
                        println!();

                        handle_connection(stream);
                        println!("连接已断开，等待新连接...");
                    }
                    Err(e) => {
                        eprintln!("接受连接失败: {}", e);
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("绑定端口失败: {}", e);
        }
    }
}

/// 处理连接（读写数据）
fn handle_connection(stream: TcpStream) {
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    // 设置读取超时
    stream.set_read_timeout(Some(Duration::from_millis(100))).ok();

    // 克隆 stream 用于读取线程
    let mut read_stream = stream.try_clone().expect("无法克隆 stream");
    let mut write_stream = stream;

    // 启动读取线程
    let read_thread = thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        while running_clone.load(Ordering::SeqCst) {
            match read_stream.read(&mut buffer) {
                Ok(0) => {
                    println!("\n[连接已关闭]");
                    running_clone.store(false, Ordering::SeqCst);
                    break;
                }
                Ok(n) => {
                    let data = &buffer[..n];
                    print!("\n[收到 {} 字节]: ", n);

                    // 尝试显示为文本
                    if let Ok(text) = std::str::from_utf8(data) {
                        if text.chars().all(|c| !c.is_control() || c == '\n' || c == '\r') {
                            println!("{}", text.trim());
                        } else {
                            print_hex(data);
                        }
                    } else {
                        print_hex(data);
                    }
                    print!("> ");
                    io::stdout().flush().ok();
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                    // 超时，继续循环
                    continue;
                }
                Err(ref e) if e.kind() == io::ErrorKind::TimedOut => {
                    // 超时，继续循环
                    continue;
                }
                Err(e) => {
                    if running_clone.load(Ordering::SeqCst) {
                        eprintln!("\n[读取错误]: {}", e);
                        running_clone.store(false, Ordering::SeqCst);
                    }
                    break;
                }
            }
        }
    });

    // 主线程处理用户输入
    let stdin = io::stdin();
    print!("> ");
    io::stdout().flush().ok();

    for line in stdin.lock().lines() {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        match line {
            Ok(input) => {
                let input = input.trim();

                if input.eq_ignore_ascii_case("quit") {
                    println!("正在断开连接...");
                    running.store(false, Ordering::SeqCst);
                    break;
                }

                if input.is_empty() {
                    print!("> ");
                    io::stdout().flush().ok();
                    continue;
                }

                // 解析并发送数据
                let data = if input.to_lowercase().starts_with("hex:") {
                    parse_hex(&input[4..])
                } else {
                    Some(input.as_bytes().to_vec())
                };

                if let Some(data) = data {
                    match write_stream.write_all(&data) {
                        Ok(_) => {
                            println!("[已发送 {} 字节]", data.len());
                        }
                        Err(e) => {
                            eprintln!("[发送失败]: {}", e);
                            running.store(false, Ordering::SeqCst);
                            break;
                        }
                    }
                } else {
                    eprintln!("[错误]: 无效的十六进制格式");
                }

                if running.load(Ordering::SeqCst) {
                    print!("> ");
                    io::stdout().flush().ok();
                }
            }
            Err(e) => {
                eprintln!("读取输入错误: {}", e);
                break;
            }
        }
    }

    running.store(false, Ordering::SeqCst);
    read_thread.join().ok();
}

/// 解析十六进制字符串
fn parse_hex(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    let parts: Vec<&str> = s.split_whitespace().collect();
    let mut result = Vec::new();

    for part in parts {
        match u8::from_str_radix(part, 16) {
            Ok(byte) => result.push(byte),
            Err(_) => {
                eprintln!("无效的十六进制值: {}", part);
                return None;
            }
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// 打印十六进制数据
fn print_hex(data: &[u8]) {
    print!("HEX: ");
    for byte in data {
        print!("{:02X} ", byte);
    }
    println!();
}
