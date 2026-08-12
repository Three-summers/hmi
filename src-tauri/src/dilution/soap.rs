//! PRMS SOAP CXF 客户端封包/解包（SOAP 1.1 + text/xml）

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SoapEnvelopeResponse {
    #[serde(rename = "InvokeCommonRVMessageByXMLMsgBodyResult", default)]
    pub result: Option<i64>,
    #[serde(rename = "errorDesc", default)]
    pub error_desc: Option<String>,
    #[serde(rename = "returnMsgBodyXmlString", default)]
    pub return_msg_body_xml_string: Option<String>,
    #[serde(rename = "faultcode", default)]
    pub fault_code: Option<String>,
    #[serde(rename = "faultstring", default)]
    pub fault_string: Option<String>,
}

/// 组装 SOAP 请求体（Body 内嵌 InvokeCommonRVMessageByXMLMsgBody）
pub fn build_soap_request(method_name: &str, msg_body_xml: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:temp="http://tempuri.org/">
  <soap:Body>
    <temp:InvokeCommonRVMessageByXMLMsgBody>
      <temp:methodName>{}</temp:methodName>
      <temp:msgBodyXmlString>{}</temp:msgBodyXmlString>
    </temp:InvokeCommonRVMessageByXMLMsgBody>
  </soap:Body>
</soap:Envelope>"#,
        xml_escape(method_name),
        xml_escape(msg_body_xml)
    )
}

/// 从 SOAP 响应 XML 中提取 InvokeCommonRVMessageByXMLMsgBodyResult / errorDesc / returnMsgBodyXmlString
///
/// 用事件流按元素 local name 匹配（忽略 SOAP/业务 namespace 前缀），避免 namespace 处理差异。
pub fn parse_soap_response(response_xml: &str) -> Result<SoapEnvelopeResponse, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(response_xml);
    let mut response = SoapEnvelopeResponse::default();
    let mut current_element: Option<String> = None;
    let mut text_buffer = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                current_element = Some(
                    std::str::from_utf8(element.local_name().as_ref())
                        .unwrap_or_default()
                        .to_string(),
                );
                text_buffer.clear();
            }
            Ok(Event::Text(text)) => {
                if let Ok(decoded) = text.decode() {
                    text_buffer.push_str(&decoded);
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                let name = reference
                    .decode()
                    .map_err(|error| format!("failed to decode SOAP XML entity: {error}"))?;
                match name.as_ref() {
                    "lt" => text_buffer.push('<'),
                    "gt" => text_buffer.push('>'),
                    "amp" => text_buffer.push('&'),
                    "quot" => text_buffer.push('"'),
                    "apos" => text_buffer.push('\''),
                    _ => match reference.resolve_char_ref() {
                        Ok(Some(character)) => text_buffer.push(character),
                        Ok(None) => {
                            return Err(format!("unrecognized SOAP XML entity: &{name};"));
                        }
                        Err(error) => {
                            return Err(format!("invalid SOAP XML character entity: {error}"));
                        }
                    },
                }
            }
            Ok(Event::CData(text)) => {
                text_buffer.push_str(&text.decode().unwrap_or_default());
            }
            Ok(Event::End(_)) => {
                if let Some(element) = current_element.take() {
                    let value = text_buffer.trim().to_string();
                    match element.as_str() {
                        "InvokeCommonRVMessageByXMLMsgBodyResult" => {
                            response.result = value.parse::<i64>().ok();
                        }
                        "errorDesc" => {
                            if !value.is_empty() {
                                response.error_desc = Some(value);
                            }
                        }
                        "returnMsgBodyXmlString" => {
                            if !value.is_empty() {
                                response.return_msg_body_xml_string = Some(value);
                            }
                        }
                        "faultcode" => {
                            if !value.is_empty() {
                                response.fault_code = Some(value);
                            }
                        }
                        "faultstring" => {
                            if !value.is_empty() {
                                response.fault_string = Some(value);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(format!("failed to parse SOAP response XML: {error}"));
            }
            _ => {}
        }
    }

    Ok(response)
}

pub fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_soap_request_should_wrap_method_and_body() {
        let xml = build_soap_request(
            "resistInfo",
            "<msgBody><vendorBarcode>ABC</vendorBarcode></msgBody>",
        );
        assert!(xml.contains("soap:Envelope"));
        assert!(xml.contains("InvokeCommonRVMessageByXMLMsgBody"));
        assert!(xml.contains("<temp:methodName>resistInfo</temp:methodName>"));
        assert!(xml.contains("&lt;msgBody&gt;"));
        assert!(!xml.contains("<msgBody>"));
    }

    #[test]
    fn parse_soap_response_should_extract_envelope_fields() {
        let xml = r#"<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <InvokeCommonRVMessageByXMLMsgBodyResponse xmlns="http://tempuri.org/">
      <InvokeCommonRVMessageByXMLMsgBodyResult>0</InvokeCommonRVMessageByXMLMsgBodyResult>
      <returnMsgBodyXmlString><![CDATA[<msgBody><resistNO>MZ</resistNO></msgBody>]]></returnMsgBodyXmlString>
    </InvokeCommonRVMessageByXMLMsgBodyResponse>
  </soap:Body>
</soap:Envelope>"#;
        let parsed = parse_soap_response(xml).unwrap();
        assert_eq!(parsed.result, Some(0));
        let body = parsed.return_msg_body_xml_string.unwrap();
        assert!(body.contains("<resistNO>MZ</resistNO>"));
    }

    #[test]
    fn parse_soap_response_should_preserve_xml_from_escaped_text_response() {
        let xml = r#"<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <InvokeCommonRVMessageByXMLMsgBodyResponse xmlns="http://tempuri.org/">
      <InvokeCommonRVMessageByXMLMsgBodyResult>0</InvokeCommonRVMessageByXMLMsgBodyResult>
      <returnMsgBodyXmlString>&lt;msgBody&gt;&lt;resistDefRrn&gt;2061321410000228354&lt;/resistDefRrn&gt;&lt;barcodeCount&gt;1&lt;/barcodeCount&gt;&lt;/msgBody&gt;</returnMsgBodyXmlString>
    </InvokeCommonRVMessageByXMLMsgBodyResponse>
  </soap:Body>
</soap:Envelope>"#;

        let parsed = parse_soap_response(xml).unwrap();
        assert_eq!(
            parsed.return_msg_body_xml_string.as_deref(),
            Some(
                "<msgBody><resistDefRrn>2061321410000228354</resistDefRrn><barcodeCount>1</barcodeCount></msgBody>"
            )
        );
    }

    #[test]
    fn parse_soap_response_should_extract_error_desc() {
        let xml = r#"<InvokeCommonRVMessageByXMLMsgBodyResponse xmlns="http://tempuri.org/">
      <InvokeCommonRVMessageByXMLMsgBodyResult>1</InvokeCommonRVMessageByXMLMsgBodyResult>
      <errorDesc>vendorBarcode is empty</errorDesc>
    </InvokeCommonRVMessageByXMLMsgBodyResponse>"#;
        let parsed = parse_soap_response(xml).unwrap();
        assert_eq!(parsed.result, Some(1));
        assert_eq!(parsed.error_desc.as_deref(), Some("vendorBarcode is empty"));
    }
}
