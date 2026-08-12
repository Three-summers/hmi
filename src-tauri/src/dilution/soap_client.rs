//! PRMS SOAP 客户端：统一 InvokeCommonRVMessageByXMLMsgBody 调用

use crate::dilution::{
    build_soap_request, parse_soap_response, xml_escape, AdapterResult, CheckBatchRequest,
    CheckResult, CreateDilutionBatchRequest, CreateDilutionBatchResult, DilutionRelationship,
    PrmsClient, QueryResistInfoRequest, ResistInfo,
};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::BTreeMap;

pub struct SoapPrmsClient {
    pub endpoint: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SoapInvokeResult {
    pub http_status: u16,
    pub raw_response_xml: String,
    pub msg_body_xml: String,
    pub error_desc: Option<String>,
}

impl SoapPrmsClient {
    pub fn new(endpoint: String) -> Self {
        Self {
            endpoint,
            timeout_ms: 15_000,
        }
    }

    pub fn invoke(&self, method_name: &str, msg_body: &str) -> Result<SoapInvokeResult, String> {
        let body = build_soap_request(method_name, msg_body);
        let response = ureq::post(&self.endpoint)
            .config()
            .timeout_global(Some(std::time::Duration::from_millis(self.timeout_ms)))
            .http_status_as_error(false)
            .build()
            .header("Content-Type", "text/xml; charset=utf-8")
            .header(
                "SOAPAction",
                "http://tempuri.org/InvokeCommonRVMessageByXMLMsgBody",
            )
            .send(body)
            .map_err(|error| format!("PRMS SOAP request failed: {error}"))?;
        let status = response.status().as_u16();
        let text = response
            .into_body()
            .read_to_string()
            .map_err(|error| format!("failed to read PRMS SOAP response body: {error}"))?;
        let envelope = parse_soap_response(&text).map_err(|error| {
            if (200..300).contains(&status) {
                error
            } else {
                format!("PRMS SOAP HTTP {status}: {error}; response: {text}")
            }
        })?;
        if let Some(fault) = envelope.fault_string.as_deref() {
            return Err(format!(
                "PRMS SOAP {method_name} fault (HTTP {status}): {fault}; response: {text}"
            ));
        }
        if !(200..300).contains(&status) {
            let detail = envelope
                .fault_string
                .as_deref()
                .or(envelope.error_desc.as_deref())
                .unwrap_or(text.trim());
            return Err(format!(
                "PRMS SOAP HTTP {status}: {detail}; response: {text}"
            ));
        }

        let result = envelope.result.ok_or_else(|| {
            format!(
                "PRMS SOAP {method_name} response missing InvokeCommonRVMessageByXMLMsgBodyResult"
            )
        })?;
        let error_desc = envelope.error_desc.filter(|value| !value.trim().is_empty());

        if result != 0 {
            return Err(if error_desc.is_none() {
                format!("PRMS SOAP {method_name} failed (result={result}); response: {text}")
            } else {
                format!(
                    "PRMS SOAP {method_name} failed (result={result}): {}; response: {text}",
                    error_desc.as_deref().unwrap_or_default()
                )
            });
        }
        let body_xml = envelope
            .return_msg_body_xml_string
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                format!("PRMS SOAP {method_name} succeeded but returnMsgBodyXmlString is empty")
            })?
            .trim()
            .to_string();
        Ok(SoapInvokeResult {
            http_status: status,
            raw_response_xml: text,
            msg_body_xml: body_xml,
            error_desc,
        })
    }
}

// ===== 三个方法的 XML 报文构造 =====

pub fn resist_info_msg_body(request: &QueryResistInfoRequest) -> String {
    format!(
        "<msgBody><vendorBarcode>{}</vendorBarcode></msgBody>",
        xml_escape(&request.vendor_barcode)
    )
}

pub fn check_msg_body(request: &CheckBatchRequest) -> String {
    let barcodes = request
        .vendor_barcode_list
        .iter()
        .map(|barcode| {
            format!(
                "<vendorBarcodeList>{}</vendorBarcodeList>",
                xml_escape(barcode)
            )
        })
        .collect::<String>();
    format!(
        "<msgBody>{barcodes}<concentration>{}</concentration></msgBody>",
        xml_escape(&request.concentration)
    )
}

pub fn batch_create_msg_body(request: &CreateDilutionBatchRequest) -> String {
    let mut body = String::from("<msgBody>");
    for barcode in &request.vendor_barcode_list {
        body.push_str(&format!(
            "<vendorBarcodeList>{}</vendorBarcodeList>",
            xml_escape(barcode)
        ));
    }
    body.push_str(&format!(
        "<resistDefRrn>{}</resistDefRrn>",
        xml_escape(&request.resist_def_rrn)
    ));
    if let Some(eqpt_id) = &request.eqpt_id {
        body.push_str(&format!("<eqptId>{}</eqptId>", xml_escape(eqpt_id)));
    }
    body.push_str(&format!(
        "<bottleCount>{}</bottleCount>",
        request.bottle_count
    ));
    if let Some(viscosity) = request.viscosity {
        body.push_str(&format!("<viscosity>{viscosity}</viscosity>"));
    }
    if let Some(batch_no) = &request.batch_no {
        body.push_str(&format!("<batchNO>{}</batchNO>", xml_escape(batch_no)));
    }
    if let Some(exp_date) = &request.exp_date {
        body.push_str(&format!("<expDate>{}</expDate>", xml_escape(exp_date)));
    }
    if let Some(url) = &request.label_print_url {
        body.push_str(&format!(
            "<labelPrintUrl>{}</labelPrintUrl>",
            xml_escape(url)
        ));
    }
    for (element, value) in [
        ("sourceResistName", &request.source_resist_name),
        ("sourceResistBarcode", &request.source_resist_barcode),
        ("operator", &request.operator),
        ("checker", &request.checker),
        ("mixStartTime", &request.mix_start_time),
        ("mixEndTime", &request.mix_end_time),
        ("viscosityTestTime", &request.viscosity_test_time),
        ("dilutionResistName", &request.dilution_resist_name),
        ("comment", &request.comment),
    ] {
        if let Some(value) = value {
            body.push_str(&format!("<{element}>{}</{element}>", xml_escape(value)));
        }
    }
    for (element, value) in [
        ("sourceResistWeight", request.source_resist_weight),
        ("dilutionWeight", request.dilution_weight),
    ] {
        if let Some(value) = value {
            body.push_str(&format!("<{element}>{value}</{element}>"));
        }
    }
    for (element, value) in [
        ("sourceBottleCount", request.source_bottle_count),
        ("dilutionBottleCount", request.dilution_bottle_count),
    ] {
        if let Some(value) = value {
            body.push_str(&format!("<{element}>{value}</{element}>"));
        }
    }
    body.push_str("</msgBody>");
    body
}

// ===== 响应解析 =====

#[derive(Default)]
struct MsgBodyDocument {
    values: BTreeMap<String, Vec<String>>,
    relationships: Vec<BTreeMap<String, String>>,
}

impl MsgBodyDocument {
    fn first(&self, element: &str) -> Option<&str> {
        self.values
            .get(element)
            .and_then(|values| values.first())
            .map(String::as_str)
    }

    fn all(&self, element: &str) -> Vec<String> {
        self.values.get(element).cloned().unwrap_or_default()
    }

    fn required(&self, element: &str, context: &str) -> Result<String, String> {
        self.first(element)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .ok_or_else(|| format!("invalid PRMS {context} response: missing {element}"))
    }

    fn optional_number<T: std::str::FromStr>(
        &self,
        element: &str,
        context: &str,
    ) -> Result<Option<T>, String> {
        self.first(element)
            .map(|value| {
                value.parse::<T>().map_err(|_| {
                    format!(
                        "invalid PRMS {context} response: {element} is not a valid number: {value}"
                    )
                })
            })
            .transpose()
    }
}

fn parse_msg_body(xml: &str) -> Result<MsgBodyDocument, String> {
    let mut reader = Reader::from_str(xml);
    let mut document = MsgBodyDocument::default();
    let mut stack = Vec::<String>::new();
    let mut text_stack = Vec::<String>::new();
    let mut relationship: Option<BTreeMap<String, String>> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                let name = std::str::from_utf8(element.local_name().as_ref())
                    .map_err(|error| format!("invalid PRMS msgBody element name: {error}"))?
                    .to_string();
                if name == "dilutionRelationship" {
                    relationship = Some(BTreeMap::new());
                }
                stack.push(name);
                text_stack.push(String::new());
            }
            Ok(Event::Text(text)) => {
                if let Some(buffer) = text_stack.last_mut() {
                    let decoded = text
                        .decode()
                        .map_err(|error| format!("failed to decode PRMS msgBody text: {error}"))?;
                    let unescaped = quick_xml::escape::unescape(&decoded).map_err(|error| {
                        format!("failed to unescape PRMS msgBody text: {error}")
                    })?;
                    buffer.push_str(&unescaped);
                }
            }
            Ok(Event::CData(text)) => {
                if let Some(buffer) = text_stack.last_mut() {
                    buffer.push_str(&text.decode().map_err(|error| {
                        format!("failed to decode PRMS msgBody CDATA: {error}")
                    })?);
                }
            }
            Ok(Event::End(_)) => {
                let name = stack.pop().unwrap_or_default();
                let value = text_stack.pop().unwrap_or_default().trim().to_string();
                if name == "dilutionRelationship" {
                    if let Some(fields) = relationship.take() {
                        document.relationships.push(fields);
                    }
                } else if !value.is_empty() {
                    if let Some(fields) = relationship.as_mut() {
                        fields.insert(name.clone(), value.clone());
                    } else {
                        document.values.entry(name).or_default().push(value);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("failed to parse PRMS msgBody XML: {error}")),
            _ => {}
        }
    }
    Ok(document)
}

pub fn parse_resist_info(msg_body_xml: &str) -> Result<ResistInfo, String> {
    let document = parse_msg_body(msg_body_xml)?;
    let resist_no = document.required("resistNO", "resistInfo")?;
    let vendor_barcode = document.required("vendorBarcode", "resistInfo")?;
    let relationships = document
        .relationships
        .iter()
        .map(|fields| {
            let required = |element: &str| {
                fields
                    .get(element)
                    .filter(|value| !value.trim().is_empty())
                    .cloned()
                    .ok_or_else(|| {
                        format!("invalid PRMS resistInfo response: dilutionRelationship missing {element}")
                    })
            };
            Ok(DilutionRelationship {
                resist_no: required("resistNO")?,
                resist_name: fields.get("resistName").cloned().unwrap_or_default(),
                concentration: required("concentration")?,
                sys_rrn: required("sysRrn")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    if relationships.is_empty() {
        return Err("invalid PRMS resistInfo response: dilutionRelationship is empty".to_string());
    }
    Ok(ResistInfo {
        resist_no,
        resist_name: document.first("resistName").unwrap_or_default().to_string(),
        concentration: document
            .first("concentration")
            .unwrap_or_default()
            .to_string(),
        mtr_no: document.first("mtrNO").unwrap_or_default().to_string(),
        defrost_time: document
            .first("defrostTime")
            .unwrap_or_default()
            .to_string(),
        defrost_buffer_days: document
            .optional_number("defrostBufferDays", "resistInfo")?
            .unwrap_or(0),
        warning_day: document
            .optional_number("warningDay", "resistInfo")?
            .unwrap_or(0),
        extend_days: document
            .optional_number("extendDays", "resistInfo")?
            .unwrap_or(0),
        viscosity_upper_limit: document.optional_number("viscosityUpperLimit", "resistInfo")?,
        viscosity_lower_limit: document.optional_number("viscosityLowerLimit", "resistInfo")?,
        vendor_barcode,
        def_batch_no: document.first("defBatchNO").unwrap_or_default().to_string(),
        to_resist_no: document.first("toResistNo").unwrap_or_default().to_string(),
        expire_time: document.first("expireTime").unwrap_or_default().to_string(),
        dilution_relationships: relationships,
    })
}

pub fn parse_check_result(msg_body_xml: &str) -> Result<CheckResult, String> {
    let document = parse_msg_body(msg_body_xml)?;
    let resist_def_rrn = document.required("resistDefRrn", "check")?;
    resist_def_rrn.parse::<i64>().map_err(|_| {
        format!("invalid PRMS check response: resistDefRrn is not a Long: {resist_def_rrn}")
    })?;
    Ok(CheckResult {
        resist_no: document.required("resistNO", "check")?,
        def_resist_no: document.required("defResistNO", "check")?,
        resist_def_rrn,
        batch_no: document.required("batchNO", "check")?,
        expire_date: document.required("expireDate", "check")?,
        concentration: document.required("concentration", "check")?,
        barcode_count: document
            .optional_number("barcodeCount", "check")?
            .ok_or_else(|| "invalid PRMS check response: missing barcodeCount".to_string())?,
    })
}

pub fn parse_batch_create_result(msg_body_xml: &str) -> Result<CreateDilutionBatchResult, String> {
    let document = parse_msg_body(msg_body_xml)?;
    let resist_sys_rrns = document.all("resistSysRrn");
    let resist_barcodes = document.all("resistBarcode");
    if resist_barcodes.is_empty() {
        return Err("invalid PRMS batchCreate response: resistBarcode is empty".to_string());
    }
    if resist_sys_rrns.is_empty() {
        return Err("invalid PRMS batchCreate response: resistSysRrn is empty".to_string());
    }
    let print_success = document
        .first("printSuccess")
        .map(|value| {
            value.parse::<bool>().map_err(|_| {
                format!("invalid PRMS batchCreate response: printSuccess is not Boolean: {value}")
            })
        })
        .transpose()?;
    Ok(CreateDilutionBatchResult {
        resist_sys_rrns,
        resist_barcodes,
        print_success,
    })
}

impl PrmsClient for SoapPrmsClient {
    fn query_resist_info(
        &self,
        request: QueryResistInfoRequest,
    ) -> Result<AdapterResult<ResistInfo>, String> {
        if request.vendor_barcode.trim().is_empty() {
            return Err("vendorBarcode must not be empty".to_string());
        }
        let msg_body = resist_info_msg_body(&request);
        let response = self.invoke("resistInfo", &msg_body)?;
        let value = parse_resist_info(&response.msg_body_xml)?;
        Ok(AdapterResult {
            request_payload: serde_json::json!({
                "method": "resistInfo",
                "parameters": request,
                "msgBodyXml": msg_body,
            }),
            response_payload: serde_json::json!({
                "httpStatus": response.http_status,
                "rawSoapXml": response.raw_response_xml,
                "msgBodyXml": response.msg_body_xml,
                "value": value,
            }),
            value,
        })
    }

    fn check_batch(
        &self,
        request: CheckBatchRequest,
    ) -> Result<AdapterResult<CheckResult>, String> {
        if request.vendor_barcode_list.is_empty()
            || request
                .vendor_barcode_list
                .iter()
                .any(|barcode| barcode.trim().is_empty())
        {
            return Err(
                "vendorBarcodeList must contain at least one non-empty barcode".to_string(),
            );
        }
        if request.concentration.trim().is_empty() {
            return Err("concentration must not be empty".to_string());
        }
        let msg_body = check_msg_body(&request);
        let response = self.invoke("check", &msg_body)?;
        let value = parse_check_result(&response.msg_body_xml)?;
        if value.barcode_count != request.vendor_barcode_list.len() as u32 {
            return Err(format!(
                "PRMS check returned barcodeCount={} for {} requested barcodes",
                value.barcode_count,
                request.vendor_barcode_list.len()
            ));
        }
        Ok(AdapterResult {
            request_payload: serde_json::json!({
                "method": "check",
                "parameters": request,
                "msgBodyXml": msg_body,
            }),
            response_payload: serde_json::json!({
                "httpStatus": response.http_status,
                "rawSoapXml": response.raw_response_xml,
                "msgBodyXml": response.msg_body_xml,
                "value": value,
            }),
            value,
        })
    }

    fn create_dilution_batch(
        &self,
        request: CreateDilutionBatchRequest,
    ) -> Result<AdapterResult<CreateDilutionBatchResult>, String> {
        if request.vendor_barcode_list.is_empty()
            || request
                .vendor_barcode_list
                .iter()
                .any(|barcode| barcode.trim().is_empty())
        {
            return Err(
                "vendorBarcodeList must contain at least one non-empty barcode".to_string(),
            );
        }
        if request.resist_def_rrn.trim().is_empty() {
            return Err("resistDefRrn must not be empty".to_string());
        }
        request
            .resist_def_rrn
            .parse::<i64>()
            .map_err(|_| format!("resistDefRrn must be a Long: {}", request.resist_def_rrn))?;
        if request.bottle_count == 0 {
            return Err("bottleCount must be greater than 0".to_string());
        }
        if !request.viscosity.is_some_and(|value| value.is_finite()) {
            return Err("viscosity is required and must be finite".to_string());
        }
        let msg_body = batch_create_msg_body(&request);
        let response = self.invoke("batchCreate", &msg_body)?;
        let value = parse_batch_create_result(&response.msg_body_xml)?;
        if value.resist_barcodes.len() != request.bottle_count as usize
            || value.resist_sys_rrns.len() != request.bottle_count as usize
        {
            return Err(format!(
                "PRMS batchCreate returned {} barcodes and {} RRNs for {} requested bottles",
                value.resist_barcodes.len(),
                value.resist_sys_rrns.len(),
                request.bottle_count
            ));
        }
        Ok(AdapterResult {
            request_payload: serde_json::json!({
                "method": "batchCreate",
                "parameters": request,
                "msgBodyXml": msg_body,
            }),
            response_payload: serde_json::json!({
                "httpStatus": response.http_status,
                "rawSoapXml": response.raw_response_xml,
                "msgBodyXml": response.msg_body_xml,
                "value": value,
            }),
            value,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dilution::soap_mock::{self, MockSoapServer};
    use std::net::TcpListener;

    fn soap_client(server: &MockSoapServer) -> SoapPrmsClient {
        SoapPrmsClient {
            endpoint: server.endpoint(),
            timeout_ms: 5_000,
        }
    }

    #[test]
    fn resist_info_msg_body_should_wrap_barcode() {
        let body = resist_info_msg_body(&QueryResistInfoRequest {
            vendor_barcode: "MZJTST11234567826050700003".to_string(),
        });
        assert_eq!(
            body,
            "<msgBody><vendorBarcode>MZJTST11234567826050700003</vendorBarcode></msgBody>"
        );
    }

    #[test]
    fn check_msg_body_should_repeat_barcode_list() {
        let body = check_msg_body(&CheckBatchRequest {
            vendor_barcode_list: vec!["A".to_string(), "B".to_string()],
            concentration: "0.5".to_string(),
        });
        assert!(body.contains("<vendorBarcodeList>A</vendorBarcodeList>"));
        assert!(body.contains("<vendorBarcodeList>B</vendorBarcodeList>"));
        assert!(body.contains("<concentration>0.5</concentration>"));
    }

    #[test]
    fn check_batch_should_reject_empty_barcode_list_before_http() {
        let client = SoapPrmsClient::new("http://127.0.0.1:1".to_string());
        let error = client
            .check_batch(CheckBatchRequest {
                vendor_barcode_list: Vec::new(),
                concentration: "0.5".to_string(),
            })
            .unwrap_err();
        assert!(error.contains("vendorBarcodeList"), "{error}");
    }

    #[test]
    fn batch_create_msg_body_should_include_report_fields() {
        let request = CreateDilutionBatchRequest {
            vendor_barcode_list: vec!["MZJTST11234567826050700003".to_string()],
            resist_def_rrn: "2030625845182312449".to_string(),
            eqpt_id: Some("EQPT-001".to_string()),
            bottle_count: 2,
            viscosity: Some(5.0),
            operator: Some("张工".to_string()),
            source_resist_weight: Some(5000.0),
            ..Default::default()
        };
        let body = batch_create_msg_body(&request);
        assert!(body.contains("<resistDefRrn>2030625845182312449</resistDefRrn>"));
        assert!(body.contains("<eqptId>EQPT-001</eqptId>"));
        assert!(body.contains("<bottleCount>2</bottleCount>"));
        assert!(body.contains("<viscosity>5</viscosity>"));
        assert!(body.contains("<operator>张工</operator>"));
        assert!(body.contains("<sourceResistWeight>5000</sourceResistWeight>"));
        assert!(!body.contains("<labelPrintUrl>"));
    }

    #[test]
    fn create_batch_should_reject_missing_required_fields_before_http() {
        let client = SoapPrmsClient::new("http://127.0.0.1:1".to_string());
        let error = client
            .create_dilution_batch(CreateDilutionBatchRequest {
                vendor_barcode_list: vec!["A".to_string()],
                resist_def_rrn: String::new(),
                bottle_count: 0,
                viscosity: None,
                ..Default::default()
            })
            .unwrap_err();
        assert!(error.contains("resistDefRrn"), "{error}");
    }

    #[test]
    fn parse_resist_info_should_extract_relationships() {
        let xml = r#"<msgBody>
<resistNO>MZJTST1</resistNO><resistName>光刻胶A</resistName>
<vendorBarcode>MZJTST11234567826050700003</vendorBarcode>
<defBatchNO>12345678</defBatchNO><expireTime>260507</expireTime>
<dilutionRelationship><resistNO>MZJTST1-D</resistNO><resistName>稀释光刻胶A</resistName><concentration>0.5</concentration><sysRrn>2030625845182312449</sysRrn></dilutionRelationship>
<dilutionRelationship><resistNO>MZJTST1-D2</resistNO><resistName>稀释光刻胶A2</resistName><concentration>0.3</concentration><sysRrn>2030625845182312450</sysRrn></dilutionRelationship>
</msgBody>"#;
        let info = parse_resist_info(xml).unwrap();
        assert_eq!(info.resist_no, "MZJTST1");
        assert_eq!(info.vendor_barcode, "MZJTST11234567826050700003");
        assert_eq!(info.dilution_relationships.len(), 2);
        assert_eq!(info.dilution_relationships[0].concentration, "0.5");
        assert_eq!(
            info.dilution_relationships[0].sys_rrn,
            "2030625845182312449"
        );
    }

    #[test]
    fn parse_resist_info_should_extract_numeric_definition_fields() {
        let xml = r#"<msgBody>
<resistNO>MZJTST1</resistNO><resistName>光刻胶A</resistName>
<vendorBarcode>MZJTST11234567826050700003</vendorBarcode>
<defBatchNO>12345678</defBatchNO><expireTime>260507</expireTime>
<defrostBufferDays>2</defrostBufferDays><warningDay>7</warningDay><extendDays>30</extendDays>
<viscosityUpperLimit>10.5</viscosityUpperLimit><viscosityLowerLimit>1.25</viscosityLowerLimit>
<dilutionRelationship><resistNO>MZJTST1-D</resistNO><resistName>稀释光刻胶A</resistName><concentration>0.5</concentration><sysRrn>2030625845182312449</sysRrn></dilutionRelationship>
</msgBody>"#;
        let info = parse_resist_info(xml).unwrap();
        assert_eq!(info.defrost_buffer_days, 2);
        assert_eq!(info.warning_day, 7);
        assert_eq!(info.extend_days, 30);
        assert_eq!(info.viscosity_upper_limit, Some(10.5));
        assert_eq!(info.viscosity_lower_limit, Some(1.25));
    }

    #[test]
    fn parse_resist_info_should_reject_empty_success_body() {
        let error = parse_resist_info("<msgBody/>").unwrap_err();
        assert!(error.contains("resistNO"), "{error}");
    }

    #[test]
    fn parse_check_result_should_extract_fields() {
        let xml = r#"<msgBody><resistNO>MZJTST1</resistNO><defResistNO>MZJTST1-D</defResistNO><resistDefRrn>2030625845182312449</resistDefRrn><batchNO>12345678</batchNO><expireDate>260507</expireDate><concentration>0.5</concentration><barcodeCount>2</barcodeCount></msgBody>"#;
        let result = parse_check_result(xml).unwrap();
        assert_eq!(result.resist_def_rrn, "2030625845182312449");
        assert_eq!(result.barcode_count, 2);
    }

    #[test]
    fn parse_check_result_should_reject_invalid_barcode_count() {
        let xml = r#"<msgBody><resistNO>MZJTST1</resistNO><defResistNO>MZJTST1-D</defResistNO><resistDefRrn>2030625845182312449</resistDefRrn><batchNO>12345678</batchNO><expireDate>260507</expireDate><concentration>0.5</concentration><barcodeCount>two</barcodeCount></msgBody>"#;
        let error = parse_check_result(xml).unwrap_err();
        assert!(error.contains("barcodeCount"), "{error}");
    }

    #[test]
    fn parse_batch_create_result_should_extract_lists() {
        let xml = r#"<msgBody><resistSysRrn>1</resistSysRrn><resistSysRrn>2</resistSysRrn><printSuccess>true</printSuccess><resistBarcode>B1</resistBarcode><resistBarcode>B2</resistBarcode></msgBody>"#;
        let result = parse_batch_create_result(xml).unwrap();
        assert_eq!(result.resist_sys_rrns, vec!["1", "2"]);
        assert_eq!(result.resist_barcodes, vec!["B1", "B2"]);
        assert_eq!(result.print_success, Some(true));
    }

    #[test]
    fn parse_batch_create_result_should_reject_empty_success_body() {
        let error = parse_batch_create_result("<msgBody/>").unwrap_err();
        assert!(error.contains("resistBarcode"), "{error}");
    }

    // ===== invoke 层：走真实 HTTP 请求到本地 mock 服务 =====

    #[test]
    fn invoke_should_send_soap_envelope_and_parse_resist_info() {
        let server = MockSoapServer::start(soap_mock::respond_like_prms);
        let client = soap_client(&server);
        let result = client
            .query_resist_info(QueryResistInfoRequest {
                vendor_barcode: "MZJTST11234567826050700003".to_string(),
            })
            .expect("resistInfo over SOAP should succeed");
        assert_eq!(result.value.resist_no, "MZJTST1");
        assert_eq!(result.value.vendor_barcode, "MZJTST11234567826050700003");
        assert_eq!(result.value.dilution_relationships.len(), 2);
        assert_eq!(
            result.value.dilution_relationships[0].concentration,
            "0.01:2.222"
        );

        // 服务端收到的请求应是完整 SOAP 封包，msgBody 以 XML 转义形式内嵌
        let request = server
            .received_bodies
            .try_recv()
            .expect("server should receive one request");
        assert!(request.contains("soap:Envelope"), "{request}");
        assert!(
            request.contains("<temp:methodName>resistInfo</temp:methodName>"),
            "{request}"
        );
        assert!(
            request.contains("&lt;msgBody&gt;&lt;vendorBarcode&gt;MZJTST11234567826050700003&lt;/vendorBarcode&gt;&lt;/msgBody&gt;"),
            "{request}"
        );
    }

    #[test]
    fn invoke_should_map_result_nonzero_to_error_with_error_desc() {
        let server = MockSoapServer::start(soap_mock::respond_like_prms);
        let client = soap_client(&server);
        let error = client
            .query_resist_info(QueryResistInfoRequest {
                vendor_barcode: "UNKNOWN-123456".to_string(),
            })
            .expect_err("result=1 should fail");
        assert!(error.contains("PRMS SOAP resistInfo failed"), "{error}");
        assert!(error.contains("vendorBarcode not found"), "{error}");
    }

    #[test]
    fn invoke_should_fail_on_http_error_status() {
        // 非 2xx 也读取响应正文，便于报告 SOAP Fault / 服务端错误内容。
        let server = MockSoapServer::start(|_request| (500, "Internal Server Error".to_string()));
        let client = soap_client(&server);
        let error = client
            .query_resist_info(QueryResistInfoRequest {
                vendor_barcode: "any".to_string(),
            })
            .expect_err("HTTP 500 should fail");
        assert!(error.contains("PRMS SOAP HTTP 500"), "{error}");
        assert!(error.contains("500"), "{error}");
    }

    #[test]
    fn invoke_should_report_soap_fault_from_http_500_body() {
        let fault = r#"<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><soap:Fault><faultcode>soap:Server</faultcode>
  <faultstring>ResistDef database unavailable</faultstring></soap:Fault></soap:Body>
</soap:Envelope>"#;
        let server = MockSoapServer::start(move |_request| (500, fault.to_string()));
        let client = soap_client(&server);
        let error = client
            .query_resist_info(QueryResistInfoRequest {
                vendor_barcode: "any".to_string(),
            })
            .unwrap_err();
        assert!(error.contains("ResistDef database unavailable"), "{error}");
    }

    #[test]
    fn invoke_should_fail_when_endpoint_unreachable() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind probe listener");
        let port = listener.local_addr().expect("probe address").port();
        drop(listener);
        let client = SoapPrmsClient {
            endpoint: format!("http://127.0.0.1:{port}/"),
            timeout_ms: 5_000,
        };
        let error = client
            .query_resist_info(QueryResistInfoRequest {
                vendor_barcode: "any".to_string(),
            })
            .expect_err("unreachable endpoint should fail");
        assert!(error.contains("PRMS SOAP request failed"), "{error}");
    }

    #[test]
    fn check_batch_should_parse_result_over_http() {
        let server = MockSoapServer::start(soap_mock::respond_like_prms);
        let client = soap_client(&server);
        let result = client
            .check_batch(CheckBatchRequest {
                vendor_barcode_list: vec!["MZJTST11234567826050700003".to_string()],
                concentration: "0.01:2.222".to_string(),
            })
            .expect("check over SOAP should succeed");
        assert_eq!(result.value.resist_def_rrn, "2030625845182312449");
        assert_eq!(result.value.concentration, "0.01:2.222");
        assert_eq!(result.value.barcode_count, 1);
    }

    #[test]
    fn check_batch_should_accept_multiple_barcodes_from_contract_mock() {
        let server = MockSoapServer::start(soap_mock::respond_like_prms);
        let client = soap_client(&server);
        let result = client
            .check_batch(CheckBatchRequest {
                vendor_barcode_list: vec![
                    "MZJTST11234567826050700003".to_string(),
                    "MZJTST11234567826050700002".to_string(),
                ],
                concentration: "0.01:2.222".to_string(),
            })
            .expect("multi-barcode check should succeed");
        assert_eq!(result.value.barcode_count, 2);
    }

    #[test]
    fn check_batch_should_fail_when_prms_rejects_concentration() {
        let server = MockSoapServer::start(soap_mock::respond_like_prms);
        let client = soap_client(&server);
        let error = client
            .check_batch(CheckBatchRequest {
                vendor_barcode_list: vec!["REJECT-0001".to_string()],
                concentration: "0.01:2.222".to_string(),
            })
            .expect_err("rejected check should fail");
        assert!(
            error.contains("barcode not matched with concentration"),
            "{error}"
        );
    }

    #[test]
    fn create_dilution_batch_should_parse_barcodes_over_http() {
        let server = MockSoapServer::start(soap_mock::respond_like_prms);
        let client = soap_client(&server);
        let result = client
            .create_dilution_batch(CreateDilutionBatchRequest {
                vendor_barcode_list: vec!["MZJTST11234567826050700003".to_string()],
                resist_def_rrn: "2030625845182312450".to_string(),
                bottle_count: 3,
                viscosity: Some(5.0),
                ..Default::default()
            })
            .expect("batchCreate over SOAP should succeed");
        assert_eq!(result.value.resist_barcodes.len(), 3);
        assert_eq!(result.value.resist_sys_rrns.len(), 3);
        assert_eq!(result.value.print_success, Some(true));
    }
}
