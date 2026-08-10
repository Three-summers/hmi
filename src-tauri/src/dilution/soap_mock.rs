//! 本地 SOAP mock 服务（仅测试构建）：用 std 手写 HTTP/1.1 服务器，
//! 模拟 PRMS `InvokeCommonRVMessageByXMLMsgBody` 统一入口，
//! 用于验证 `SoapPrmsClient::invoke` 的 HTTP 传输层（封包发送 / 状态码 / 响应解析）。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;

/// 请求处理函数：原始请求体 → (HTTP 状态码, 响应体)
pub type Responder = dyn Fn(&str) -> (u16, String) + Send + Sync;

pub struct MockSoapServer {
    pub addr: std::net::SocketAddr,
    /// 服务端实际收到的原始请求体（按到达顺序）
    pub received_bodies: mpsc::Receiver<String>,
}

impl MockSoapServer {
    /// 绑定 127.0.0.1 随机端口并启动服务线程
    pub fn start(responder: impl Fn(&str) -> (u16, String) + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock soap server");
        let addr = listener.local_addr().expect("mock soap server address");
        let (tx, received_bodies) = mpsc::channel();
        let _handle = thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let tx = tx.clone();
                let _ = serve(stream, &responder, &tx);
            }
        });
        Self {
            addr,
            received_bodies,
        }
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}/mock/soap", self.addr)
    }
}

/// 处理单个 HTTP 请求：读请求行/头/体，调 responder 后写响应
fn serve(
    mut stream: TcpStream,
    responder: &Responder,
    tx: &mpsc::Sender<String>,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line)?;
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;
    let body = String::from_utf8_lossy(&body).into_owned();
    let _ = tx.send(body.clone());

    let (status, response_body) = responder(&body);
    let reason = if status == 200 { "OK" } else { "Internal Server Error" };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/xml; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response_body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(response_body.as_bytes())?;
    stream.flush()
}

// ===== SOAP 响应构造（模拟 PRMS） =====

/// 构造 SOAP envelope 响应（result / errorDesc / returnMsgBodyXmlString 由调用方给定）
pub fn soap_envelope(result: i64, error_desc: Option<&str>, return_msg_body: Option<&str>) -> String {
    let mut response = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><InvokeCommonRVMessageByXMLMsgBodyResponse xmlns="http://tempuri.org/">"#,
    );
    response.push_str(&format!(
        "<InvokeCommonRVMessageByXMLMsgBodyResult>{result}</InvokeCommonRVMessageByXMLMsgBodyResult>"
    ));
    if let Some(error_desc) = error_desc {
        response.push_str(&format!("<errorDesc>{error_desc}</errorDesc>"));
    }
    if let Some(return_msg_body) = return_msg_body {
        response.push_str(&format!(
            "<returnMsgBodyXmlString><![CDATA[{return_msg_body}]]></returnMsgBodyXmlString>"
        ));
    }
    response.push_str("</InvokeCommonRVMessageByXMLMsgBodyResponse></soap:Body></soap:Envelope>");
    response
}

pub fn resist_info_msg_body(barcode: &str) -> String {
    format!(
        r#"<msgBody><resistNO>MZJTST1</resistNO><resistName>光刻胶A</resistName><concentration>1.0</concentration><mtrNO>MTR001</mtrNO><defrostTime>08:00</defrostTime><vendorBarcode>{barcode}</vendorBarcode><defBatchNO>12345678</defBatchNO><toResistNo>MZJTST1</toResistNo><expireTime>260507</expireTime><dilutionRelationship><resistNO>MZJTST1-D</resistNO><resistName>稀释光刻胶A 60%</resistName><concentration>60%</concentration><sysRrn>2030625845182312449</sysRrn></dilutionRelationship><dilutionRelationship><resistNO>MZJTST1-D2</resistNO><resistName>稀释光刻胶A2 70%</resistName><concentration>70%</concentration><sysRrn>2030625845182312450</sysRrn></dilutionRelationship></msgBody>"#
    )
}

pub fn check_msg_body(concentration: &str) -> String {
    format!(
        r#"<msgBody><resistNO>MZJTST1</resistNO><defResistNO>MZJTST1-D</defResistNO><resistDefRrn>2030625845182312450</resistDefRrn><batchNO>12345678</batchNO><expireDate>260507</expireDate><concentration>{concentration}</concentration><barcodeCount>1</barcodeCount></msgBody>"#
    )
}

pub fn batch_create_msg_body(bottle_count: u32) -> String {
    let mut sys_rrns = String::new();
    let mut barcodes = String::new();
    for index in 1..=bottle_count {
        sys_rrns.push_str(&format!("<resistSysRrn>20306258451823125{index:02}</resistSysRrn>"));
        barcodes.push_str(&format!("<resistBarcode>MZJTST1-D-{index:03}</resistBarcode>"));
    }
    format!("<msgBody>{sys_rrns}{barcodes}<printSuccess>true</printSuccess></msgBody>")
}

// ===== 请求体解析（客户端发来的封包） =====

/// 提取 `temp:methodName` 元素（未转义，直接出现在 SOAP body 中）
fn extract_method_name(request: &str) -> Option<&str> {
    const OPEN: &str = "<temp:methodName>";
    const CLOSE: &str = "</temp:methodName>";
    let start = request.find(OPEN)? + OPEN.len();
    let end = request[start..].find(CLOSE)? + start;
    Some(&request[start..end])
}

/// 提取 msgBody 内元素（客户端用 xml_escape 转义了标签，需匹配转义形态）
fn extract_escaped_element(request: &str, element: &str) -> Option<String> {
    let open = format!("&lt;{element}&gt;");
    let close = format!("&lt;/{element}&gt;");
    let start = request.find(&open)? + open.len();
    let end = request[start..].find(&close)? + start;
    Some(request[start..end].to_string())
}

/// 模拟 PRMS 行为：按 methodName 分发；特殊条码触发错误分支（供测试错误路径）
pub fn respond_like_prms(request_body: &str) -> (u16, String) {
    let method = extract_method_name(request_body).unwrap_or("unknown");
    match method {
        "resistInfo" => {
            let barcode = extract_escaped_element(request_body, "vendorBarcode")
                .unwrap_or_default();
            if barcode.contains("UNKNOWN") {
                (200, soap_envelope(1, Some("vendorBarcode not found"), None))
            } else {
                (
                    200,
                    soap_envelope(0, None, Some(&resist_info_msg_body(&barcode))),
                )
            }
        }
        "check" => {
            let concentration =
                extract_escaped_element(request_body, "concentration").unwrap_or_default();
            if request_body.contains("REJECT") {
                (
                    200,
                    soap_envelope(1, Some("barcode not matched with concentration"), None),
                )
            } else {
                (200, soap_envelope(0, None, Some(&check_msg_body(&concentration))))
            }
        }
        "batchCreate" => {
            let bottle_count = extract_escaped_element(request_body, "bottleCount")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(1);
            if request_body.contains("FAIL") {
                (200, soap_envelope(1, Some("batchCreate failed"), None))
            } else {
                (
                    200,
                    soap_envelope(0, None, Some(&batch_create_msg_body(bottle_count))),
                )
            }
        }
        _ => (500, "unknown SOAP method".to_string()),
    }
}
