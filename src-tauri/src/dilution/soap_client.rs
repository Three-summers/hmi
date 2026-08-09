//! PRMS SOAP 客户端：统一 InvokeCommonRVMessageByXMLMsgBody 调用

use crate::dilution::{
    build_soap_request, parse_soap_response, xml_escape, AdapterResult, CheckBatchRequest,
    CheckResult, CreateDilutionBatchRequest, CreateDilutionBatchResult, DilutionRelationship,
    PrmsClient, QueryResistInfoRequest, ResistInfo,
};

pub struct SoapPrmsClient {
    pub endpoint: String,
    pub timeout_ms: u64,
}

impl SoapPrmsClient {
    pub fn new(endpoint: String) -> Self {
        Self {
            endpoint,
            timeout_ms: 15_000,
        }
    }

    pub fn invoke(&self, method_name: &str, msg_body: &str) -> Result<(String, String), String> {
        let body = build_soap_request(method_name, msg_body);
        let response = ureq::post(&self.endpoint)
            .config()
            .timeout_global(Some(std::time::Duration::from_millis(self.timeout_ms)))
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
        if !(200..300).contains(&status) {
            return Err(format!("PRMS SOAP HTTP {status}: {text}"));
        }

        let envelope = parse_soap_response(&text)?;
        let result = envelope.result.unwrap_or(1);
        let error_desc = envelope.error_desc.unwrap_or_default();
        let body_xml = envelope
            .return_msg_body_xml_string
            .unwrap_or_default()
            .trim()
            .to_string();

        if result != 0 {
            return Err(if error_desc.is_empty() {
                format!("PRMS SOAP {method_name} failed (result={result})")
            } else {
                format!("PRMS SOAP {method_name} failed: {error_desc}")
            });
        }
        Ok((body_xml, error_desc))
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
        .map(|barcode| format!("<vendorBarcodeList>{}</vendorBarcodeList>", xml_escape(barcode)))
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
    body.push_str(&format!("<bottleCount>{}</bottleCount>", request.bottle_count));
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
        body.push_str(&format!("<labelPrintUrl>{}</labelPrintUrl>", xml_escape(url)));
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

/// 从 msgBody XML 提取单元素文本值
fn extract_element(xml: &str, element: &str) -> Option<String> {
    let open = format!("<{element}>");
    let close = format!("</{element}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].to_string())
}

/// 提取重复元素列表
fn extract_elements(xml: &str, element: &str) -> Vec<String> {
    let open = format!("<{element}>");
    let close = format!("</{element}>");
    let mut values = Vec::new();
    let mut cursor = 0;
    while let Some(start) = xml[cursor..].find(&open) {
        let content_start = cursor + start + open.len();
        let Some(relative_end) = xml[content_start..].find(&close) else {
            break;
        };
        let content_end = content_start + relative_end;
        values.push(xml[content_start..content_end].to_string());
        cursor = content_end + close.len();
    }
    values
}

fn parse_relationships(xml: &str) -> Vec<DilutionRelationship> {
    let mut relationships = Vec::new();
    let open = "<dilutionRelationship>";
    let close = "</dilutionRelationship>";
    let mut cursor = 0;
    while let Some(start) = xml[cursor..].find(open) {
        let block_start = cursor + start + open.len();
        let Some(relative_end) = xml[block_start..].find(close) else {
            break;
        };
        let block_end = block_start + relative_end;
        let block = &xml[block_start..block_end];
        relationships.push(DilutionRelationship {
            resist_no: extract_element(block, "resistNO").unwrap_or_default(),
            resist_name: extract_element(block, "resistName").unwrap_or_default(),
            concentration: extract_element(block, "concentration").unwrap_or_default(),
            sys_rrn: extract_element(block, "sysRrn").unwrap_or_default(),
        });
        cursor = block_end + close.len();
    }
    relationships
}

pub fn parse_resist_info(msg_body_xml: &str) -> Result<ResistInfo, String> {
    let mut info = ResistInfo::default();
    info.resist_no = extract_element(msg_body_xml, "resistNO").unwrap_or_default();
    info.resist_name = extract_element(msg_body_xml, "resistName").unwrap_or_default();
    info.concentration = extract_element(msg_body_xml, "concentration").unwrap_or_default();
    info.mtr_no = extract_element(msg_body_xml, "mtrNO").unwrap_or_default();
    info.defrost_time = extract_element(msg_body_xml, "defrostTime").unwrap_or_default();
    info.vendor_barcode = extract_element(msg_body_xml, "vendorBarcode").unwrap_or_default();
    info.def_batch_no = extract_element(msg_body_xml, "defBatchNO").unwrap_or_default();
    info.to_resist_no = extract_element(msg_body_xml, "toResistNo").unwrap_or_default();
    info.expire_time = extract_element(msg_body_xml, "expireTime").unwrap_or_default();
    info.dilution_relationships = parse_relationships(msg_body_xml);
    Ok(info)
}

pub fn parse_check_result(msg_body_xml: &str) -> Result<CheckResult, String> {
    let mut result = CheckResult::default();
    result.resist_no = extract_element(msg_body_xml, "resistNO").unwrap_or_default();
    result.def_resist_no = extract_element(msg_body_xml, "defResistNO").unwrap_or_default();
    result.resist_def_rrn = extract_element(msg_body_xml, "resistDefRrn").unwrap_or_default();
    result.batch_no = extract_element(msg_body_xml, "batchNO").unwrap_or_default();
    result.expire_date = extract_element(msg_body_xml, "expireDate").unwrap_or_default();
    result.concentration = extract_element(msg_body_xml, "concentration").unwrap_or_default();
    result.barcode_count = extract_element(msg_body_xml, "barcodeCount")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    Ok(result)
}

pub fn parse_batch_create_result(msg_body_xml: &str) -> Result<CreateDilutionBatchResult, String> {
    let mut result = CreateDilutionBatchResult::default();
    result.resist_sys_rrns = extract_elements(msg_body_xml, "resistSysRrn");
    result.resist_barcodes = extract_elements(msg_body_xml, "resistBarcode");
    result.print_success = extract_element(msg_body_xml, "printSuccess")
        .and_then(|value| value.parse::<bool>().ok());
    Ok(result)
}

impl PrmsClient for SoapPrmsClient {
    fn query_resist_info(
        &self,
        request: QueryResistInfoRequest,
    ) -> Result<AdapterResult<ResistInfo>, String> {
        let msg_body = resist_info_msg_body(&request);
        let (body_xml, _) = self.invoke("resistInfo", &msg_body)?;
        let value = parse_resist_info(&body_xml)?;
        Ok(AdapterResult {
            request_payload: serde_json::json!({ "method": "resistInfo", "vendorBarcode": request.vendor_barcode }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }

    fn check_batch(&self, request: CheckBatchRequest) -> Result<AdapterResult<CheckResult>, String> {
        let msg_body = check_msg_body(&request);
        let (body_xml, _) = self.invoke("check", &msg_body)?;
        let value = parse_check_result(&body_xml)?;
        Ok(AdapterResult {
            request_payload: serde_json::json!({ "method": "check", "concentration": request.concentration }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }

    fn create_dilution_batch(
        &self,
        request: CreateDilutionBatchRequest,
    ) -> Result<AdapterResult<CreateDilutionBatchResult>, String> {
        let msg_body = batch_create_msg_body(&request);
        let (body_xml, _) = self.invoke("batchCreate", &msg_body)?;
        let value = parse_batch_create_result(&body_xml)?;
        Ok(AdapterResult {
            request_payload: serde_json::json!({ "method": "batchCreate", "bottleCount": request.bottle_count }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn parse_check_result_should_extract_fields() {
        let xml = r#"<msgBody><resistNO>MZJTST1</resistNO><defResistNO>MZJTST1-D</defResistNO><resistDefRrn>2030625845182312449</resistDefRrn><batchNO>12345678</batchNO><expireDate>260507</expireDate><concentration>0.5</concentration><barcodeCount>2</barcodeCount></msgBody>"#;
        let result = parse_check_result(xml).unwrap();
        assert_eq!(result.resist_def_rrn, "2030625845182312449");
        assert_eq!(result.barcode_count, 2);
    }

    #[test]
    fn parse_batch_create_result_should_extract_lists() {
        let xml = r#"<msgBody><resistSysRrn>1</resistSysRrn><resistSysRrn>2</resistSysRrn><printSuccess>true</printSuccess><resistBarcode>B1</resistBarcode><resistBarcode>B2</resistBarcode></msgBody>"#;
        let result = parse_batch_create_result(xml).unwrap();
        assert_eq!(result.resist_sys_rrns, vec!["1", "2"]);
        assert_eq!(result.resist_barcodes, vec!["B1", "B2"]);
        assert_eq!(result.print_success, Some(true));
    }
}
