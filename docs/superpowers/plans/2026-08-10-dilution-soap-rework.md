# Dilution SOAP 流程重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/dilution-flow.md` 设计，把 dilution 流程从 mock 三步（queryMapping/uploadViscosity/requestDilutionBarcodes）重构为 PRMS SOAP 三步（resistInfo/check/batchCreate），本地设备动作复用 craftsmanship 引擎（HMIP），配置落在 workspace `system/`，并完成前端 Dilution 视图对接。

**Architecture:** dilution 状态机持有可注入的 `PrmsClient`（SOAP 实现 + mock 实现）与 `DilutionDeviceGateway`（分装等本地设备，走 HMIP）；`run_batch` 通过 AppHandle 驱动全局 `RecipeRuntimeManager` 执行本地配方（称量/搅拌/静置/测粘度），配方完成后从 runtime snapshot 读粘度/质量结果，再调 `batchCreate` 创建瓶并返回条码，最后本地分装。

**Tech Stack:** Rust (tauri 2, tokio, serde, quick-xml, ureq)、React 18 + zustand + i18next、vitest、cargo test。

**关联设计文档:** `docs/dilution-flow.md`；PRMS 官方文档 `docs/PRMS_DilutionTool接口对接文档_v1.1.md`（内部版本 V1.4）。

---

## 文件结构

```
src-tauri/
  Cargo.toml                            # + reqwest, quick-xml
  src/dilution/
    mod.rs                              # 导出不变
    types.rs                            # PrmsClient 新 trait、新类型、Batch 新字段、PrmsOperation 更新
    soap.rs                             # 新增：SOAP 封包/解包（quick-xml serde）
    soap_client.rs                      # 新增：SoapPrmsClient（reqwest HTTP 调用）
    config.rs                           # 新增：DilutionConfig + workspace root 解析 + 浓度参数查询
    manager.rs                          # 新增（从 types.rs 拆出）：DilutionManager 状态机重构
    tests.rs                            # 更新：适配新 trait + 新增 SOAP/配置/流程测试
  src/commands.rs                       # dilution 命令签名更新 + dilution_get_config + 删除 run_mock
  src/lib.rs                            # workspace root 解析 + 构造注入 + 注册命令
  src/log_paths.rs                      # 不动（模式参考）
workspace/                              # 新增：应用默认 workspace（debug）
  system/dilution.json                  # 机台/人员/浓度工艺参数表
  system/device-types/{scale,mixer,viscometer}.json
  system/actions/{common.delay,common.wait-signal,weigh.start,mix.start,settle,viscosity.measure}.json
  projects/dilution-machine/
    project.json
    connections/main-hmip.json
    devices/{scale_01,mixer_01,viscometer_01}.json
    signals/{viscosity_ready,scale_reading,mix_running}.json
    feedback-mappings/*.json（占位）
    safety/{interlocks.json,safe-stop.json}
    recipes/dilute-0.01-5.json
src/platform/dilution.ts                # 新增：前端 RPC 封装
src/components/views/Dilution/index.tsx # 重构：真实后端流程
src/components/views/Dilution/index.test.tsx # 更新
src/i18n/locales/{zh,en}.json           # dilution 文案更新
```

**关键约定：**
- 配置文件 key：`workspace/system/dilution.json`
- 默认 workspace root：env `HMI_WORKSPACE_ROOT` > debug 仓库根 `workspace/` > release `resource_dir()/workspace`
- 项目 id：`dilution-machine`
- PRMS 业务 XML 根节点 `<msgBody>`，统一方法名 `InvokeCommonRVMessageByXMLMsgBody`
- HMIP 报文（msgType/payload/反馈键）全部为占位值，后续替换

---

### Task 1: Cargo 依赖 + SOAP 封包/解包模块

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/dilution/soap.rs`
- Modify: `src-tauri/src/dilution/mod.rs`

- [ ] **Step 1: 写失败测试**

Create `src-tauri/src/dilution/soap.rs` with tests:

```rust
//! PRMS SOAP CXF 客户端封包/解包（SOAP 1.1 + text/xml）

use quick_xml::de::from_str;
use quick_xml::se::to_string;
use serde::{Deserialize, Serialize};

pub const SOAP_METHOD: &str = "InvokeCommonRVMessageByXMLMsgBody";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SoapEnvelopeRequest {
    #[serde(rename = "methodName")]
    pub method_name: String,
    #[serde(rename = "msgBodyXmlString")]
    pub msg_body_xml_string: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SoapEnvelopeResponse {
    #[serde(rename = "InvokeCommonRVMessageByXMLMsgBodyResult", default)]
    pub result: Option<i64>,
    #[serde(rename = "errorDesc", default)]
    pub error_desc: Option<String>,
    #[serde(rename = "returnMsgBodyXmlString", default)]
    pub return_msg_body_xml_string: Option<String>,
}

/// 组装 SOAP 请求体（Body 内嵌 InvokeCommonRVMessageByXMLMsgBody）
pub fn build_soap_request(method_name: &str, msg_body_xml: &str) -> String {
    let inner = SoapEnvelopeRequest {
        method_name: method_name.to_string(),
        msg_body_xml_string: msg_body_xml.to_string(),
    };
    let body = to_string(&inner).expect("serialize soap request body");
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
pub fn parse_soap_response(response_xml: &str) -> Result<SoapEnvelopeResponse, String> {
    let parsed: SoapEnvelopeResponse = from_str(response_xml)
        .map_err(|error| format!("failed to parse SOAP response XML: {error}"))?;
    Ok(parsed)
}

pub fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 构造 msgBody XML：多值元素通过 repeated 字段序列化
pub fn build_msg_body(inner: &impl Serialize) -> Result<String, String> {
    to_string(inner).map_err(|error| format!("failed to serialize msgBody: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_soap_request_should_wrap_method_and_body() {
        let xml = build_soap_request("resistInfo", "<msgBody><vendorBarcode>ABC</vendorBarcode></msgBody>");
        assert!(xml.contains("soap:Envelope"));
        assert!(xml.contains("InvokeCommonRVMessageByXMLMsgBody"));
        assert!(xml.contains("<temp:methodName>resistInfo</temp:methodName>"));
        assert!(xml.contains("&lt;msgBody&gt;"));
        assert!(xml.contains("&amp;"));
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution::soap`（或 `cargo check --manifest-path src-tauri/Cargo.toml`）
Expected: 编译错误 "file not found for module `soap`"

- [ ] **Step 3: 加依赖 + 注册模块**

`src-tauri/Cargo.toml` 的 `[dependencies]` 追加：

```toml
quick-xml = { version = "0.37", features = ["serialize"] }
ureq = "3"
```

`src-tauri/src/dilution/mod.rs` 改为：

```rust
mod config;
mod manager;
mod soap;
mod soap_client;
mod types;

pub use manager::DilutionManager;
pub use soap::{parse_soap_response, build_msg_body, build_soap_request, xml_escape};
pub use types::*;

#[cfg(test)]
mod tests;
```

（manager/soap_client/config 尚未创建，此步后继续 Task 2 再编译）

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution::soap`
Expected: 3 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/dilution/soap.rs src-tauri/src/dilution/mod.rs
git commit -m "feat(dilution): add SOAP envelope build/parse helpers"
```

---

### Task 2: PRMS 业务类型 + 新 PrmsClient trait

**Files:**
- Modify: `src-tauri/src/dilution/types.rs`
- Modify: `src-tauri/src/dilution/mod.rs`

- [ ] **Step 1: 在 types.rs 末尾（`impl DilutionManager` 之前）新增类型与 trait，并把 `PrmsOperation` 枚举替换**

```rust
// ===== PRMS SOAP v1.4 对接类型 =====

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrmsOperation {
    ResistInfo,
    Check,
    CreateBatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DilutionRelationship {
    pub resist_no: String,
    pub resist_name: String,
    pub concentration: String,
    pub sys_rrn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ResistInfo {
    pub resist_no: String,
    pub resist_name: String,
    pub concentration: String,
    pub mtr_no: String,
    pub defrost_time: String,
    pub defrost_buffer_days: u32,
    pub warning_day: u32,
    pub extend_days: u32,
    pub viscosity_upper_limit: Option<f64>,
    pub viscosity_lower_limit: Option<f64>,
    pub vendor_barcode: String,
    pub def_batch_no: String,
    pub to_resist_no: String,
    pub expire_time: String,
    pub dilution_relationships: Vec<DilutionRelationship>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CheckResult {
    pub resist_no: String,
    pub def_resist_no: String,
    pub resist_def_rrn: String,
    pub batch_no: String,
    pub expire_date: String,
    pub concentration: String,
    pub barcode_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateDilutionBatchRequest {
    pub vendor_barcode_list: Vec<String>,
    pub resist_def_rrn: String,
    pub eqpt_id: Option<String>,
    pub bottle_count: u32,
    pub viscosity: Option<f64>,
    pub batch_no: Option<String>,
    pub exp_date: Option<String>,
    pub label_print_url: Option<String>,
    // 报表字段（17 个中的可收集部分）
    pub source_resist_name: Option<String>,
    pub source_resist_barcode: Option<String>,
    pub source_resist_weight: Option<f64>,
    pub source_bottle_count: Option<u32>,
    pub operator: Option<String>,
    pub checker: Option<String>,
    pub mix_start_time: Option<String>,
    pub mix_end_time: Option<String>,
    pub viscosity_test_time: Option<String>,
    pub dilution_resist_name: Option<String>,
    pub dilution_bottle_count: Option<u32>,
    pub dilution_weight: Option<f64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateDilutionBatchResult {
    pub resist_sys_rrns: Vec<String>,
    pub resist_barcodes: Vec<String>,
    pub print_success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResistInfoRequest {
    pub vendor_barcode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckBatchRequest {
    pub vendor_barcode_list: Vec<String>,
    pub concentration: String,
}
```

把旧 trait 替换为：

```rust
pub trait PrmsClient: Send + Sync {
    fn query_resist_info(
        &self,
        request: QueryResistInfoRequest,
    ) -> Result<AdapterResult<ResistInfo>, String>;

    fn check_batch(&self, request: CheckBatchRequest) -> Result<AdapterResult<CheckResult>, String>;

    fn create_dilution_batch(
        &self,
        request: CreateDilutionBatchRequest,
    ) -> Result<AdapterResult<CreateDilutionBatchResult>, String>;
}
```

同时删除 `PrmsOperation::QueryMapping / UploadViscosity / RequestDilutionBarcodes`、旧 `QueryMappingAdapterRequest / UploadViscosityAdapterRequest / RequestBarcodesAdapterRequest / ViscosityUploadResult / BarcodeRequestResult` 结构。`MockPrmsClient` 改为实现新 trait（见 Step 2）。

- [ ] **Step 2: 重写 MockPrmsClient 实现新 trait**

在 `struct MockPrmsClient;` 的 impl 中替换为：

```rust
impl PrmsClient for MockPrmsClient {
    fn query_resist_info(
        &self,
        request: QueryResistInfoRequest,
    ) -> Result<AdapterResult<ResistInfo>, String> {
        let barcode = request.vendor_barcode;
        let resist_no = barcode.get(..7).unwrap_or(&barcode).to_string();
        let def_batch_no = barcode.get(7..15).unwrap_or("12345678").to_string();
        let expire_time = barcode.get(15..21).unwrap_or("260507").to_string();

        let (resist_name, relationships) = if barcode.contains("MULTI") {
            (
                "TMR-MULTI PM 5.4cP".to_string(),
                vec![
                    DilutionRelationship {
                        resist_no: "MULTI-D".to_string(),
                        resist_name: "MULTI-D 60%".to_string(),
                        concentration: "60%".to_string(),
                        sys_rrn: "2004086388857843700".to_string(),
                    },
                    DilutionRelationship {
                        resist_no: "MULTI-D2".to_string(),
                        resist_name: "MULTI-D2 70%".to_string(),
                        concentration: "70%".to_string(),
                        sys_rrn: "2011636530905427900".to_string(),
                    },
                ],
            )
        } else if barcode.contains("IK02") {
            (
                "TMR-IK02 PM 5.4cP".to_string(),
                vec![DilutionRelationship {
                    resist_no: "IK02-D".to_string(),
                    resist_name: "IK02-D 70%".to_string(),
                    concentration: "70%".to_string(),
                    sys_rrn: "2011636530905427800".to_string(),
                }],
            )
        } else {
            return Err(format!("mock PRMS cannot resolve barcode `{barcode}`"));
        };

        let value = ResistInfo {
            resist_no: resist_no.clone(),
            resist_name,
            concentration: "1.0".to_string(),
            mtr_no: "MTR001".to_string(),
            defrost_time: "08:00".to_string(),
            defrost_buffer_days: 0,
            warning_day: 7,
            extend_days: 30,
            viscosity_upper_limit: Some(10.0),
            viscosity_lower_limit: Some(1.0),
            vendor_barcode: barcode.clone(),
            def_batch_no,
            to_resist_no: resist_no,
            expire_time,
            dilution_relationships: relationships,
        };
        Ok(AdapterResult {
            request_payload: json!({ "method": "resistInfo", "vendorBarcode": barcode }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }

    fn check_batch(&self, request: CheckBatchRequest) -> Result<AdapterResult<CheckResult>, String> {
        if request.vendor_barcode_list.is_empty() {
            return Err("vendorBarcode is empty".to_string());
        }
        let first = &request.vendor_barcode_list[0];
        let value = CheckResult {
            resist_no: first.get(..7).unwrap_or(first).to_string(),
            def_resist_no: format!("{}-D", first.get(..7).unwrap_or(first)),
            resist_def_rrn: "2011636530905427800".to_string(),
            batch_no: first.get(7..15).unwrap_or("12345678").to_string(),
            expire_date: first.get(15..21).unwrap_or("260507").to_string(),
            concentration: request.concentration.clone(),
            barcode_count: request.vendor_barcode_list.len() as u32,
        };
        Ok(AdapterResult {
            request_payload: json!({ "method": "check", "concentration": request.concentration }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }

    fn create_dilution_batch(
        &self,
        request: CreateDilutionBatchRequest,
    ) -> Result<AdapterResult<CreateDilutionBatchResult>, String> {
        let resist_no = request
            .vendor_barcode_list
            .first()
            .map(|barcode| barcode.get(..7).unwrap_or(barcode).to_string())
            .ok_or_else(|| "vendorBarcode is empty".to_string())?;
        let batch_no = request.batch_no.clone().unwrap_or_else(|| "12345678".to_string());
        let expire_date = request.exp_date.clone().unwrap_or_else(|| "260507".to_string());
        let barcodes = (1..=request.bottle_count)
            .map(|index| format!("{resist_no}{batch_no}{expire_date}{index:03}"))
            .collect::<Vec<_>>();
        let sys_rrns = (1..=request.bottle_count)
            .map(|index| format!("20306258451823125{index:02}"))
            .collect::<Vec<_>>();
        let value = CreateDilutionBatchResult {
            resist_sys_rrns: sys_rrns,
            resist_barcodes: barcodes,
            print_success: Some(true),
        };
        Ok(AdapterResult {
            request_payload: json!({ "method": "batchCreate", "bottleCount": request.bottle_count }),
            response_payload: serde_json::to_value(&value).unwrap_or_default(),
            value,
        })
    }
}
```

（删除旧的 `query_mapping / upload_viscosity / request_dilution_barcodes` 与 `hsms_mock_payload` 中不再使用的部分；`mock_option` 保留供 `lock_selected_recipe` 使用，后续 Task 4 再迁移。）

- [ ] **Step 3: 临时注释 `scan_raw_resist` 等使用旧 trait 的代码，保证可编译**

在 manager 代码迁移（Task 5）之前，为保持编译通过：把 `scan_raw_resist` 中 `adapters.prms.query_mapping(...)` 调用处、`run_batch` 中 `upload_viscosity / request_dilution_barcodes` 调用处、`PrmsOperation::*` 引用处临时改为编译期占位（如 `Err("migrating to soap flow".to_string())`），**不要删逻辑**——Task 5 会整体重写。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution`
Expected: 编译通过（migration 占位后部分旧测试可能失败，先 `cargo check` 通过即可；旧测试适配放 Task 5/6）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/dilution/types.rs src-tauri/src/dilution/mod.rs
git commit -m "feat(dilution): rework PrmsClient trait to resistInfo/check/batchCreate"
```

---

### Task 3: SoapPrmsClient（HTTP + XML 报文）

**Files:**
- Create: `src-tauri/src/dilution/soap_client.rs`
- Modify: `src-tauri/src/dilution/mod.rs`

> 技术选型修正：`PrmsClient` trait 是同步方法（与现有 adapter 同步调用模式一致），SOAP 客户端用 **`ureq`**（同步 HTTP，无 async 包袱），Cargo.toml 加 `ureq = "3"` 替代 reqwest。

- [ ] **Step 1: 写失败测试**

Create `src-tauri/src/dilution/soap_client.rs`（含测试）：

```rust
//! PRMS SOAP 客户端：统一 InvokeCommonRVMessageByXMLMsgBody 调用

use crate::dilution::{
    build_msg_body, build_soap_request, parse_soap_response, xml_escape, AdapterResult,
    CheckBatchRequest, CheckResult, CreateDilutionBatchRequest, CreateDilutionBatchResult,
    PrmsClient, QueryResistInfoRequest, ResistInfo,
};
use serde::Serialize;

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
            .header("Content-Type", "text/xml; charset=utf-8")
            .header("SOAPAction", "http://tempuri.org/InvokeCommonRVMessageByXMLMsgBody")
            .timeout(std::time::Duration::from_millis(self.timeout_ms))
            .send_string(&body)
            .map_err(|error| format!("PRMS SOAP request failed: {error}"))?;
        let status = response.status();
        let text = response
            .into_string()
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

fn msg_body_root(inner: &impl Serialize) -> String {
    build_msg_body(inner)
        .map(|xml| xml.replace("<msgBody>", "<msgBody>").to_string())
        .unwrap_or_default()
}

/// 业务 msgBody 序列化为 <msgBody>...</msgBody> 文本（多值字段自动重复元素）
pub fn serialize_msg_body<T: Serialize>(payload: &T) -> Result<String, String> {
    let xml = build_msg_body(payload)?;
    Ok(xml)
}

// ===== 三个方法的 XML 报文构造与响应解析 =====

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

/// 从 msgBody XML 提取单元素文本值（无 XML 库解析，按元素名抓取）
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

fn parse_relationship(xml: &str) -> Vec<crate::dilution::DilutionRelationship> {
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
        relationships.push(crate::dilution::DilutionRelationship {
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
    info.dilution_relationships = parse_relationship(msg_body_xml);
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
        assert_eq!(info.dilution_relationships[0].sys_rrn, "2030625845182312449");
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution::soap_client`
Expected: 编译错误（soap_client 未注册）

- [ ] **Step 3: 注册模块**

`src-tauri/src/dilution/mod.rs` 已含 `mod soap_client;`（Task 1 Step 3）。将 `pub use soap_client::SoapPrmsClient;` 加入导出（与其它 pub use 并列）。

注意 `poll_runtime` 中 `block_in_place` 仅适用于多线程 runtime；若编译报 `block_in_place` 不在 current-thread runtime 内，可改为直接 `client.invoke` 不包 block（命令均为 async 上下文，同步 trait 需要 block——保留 block_in_place 实现，编译警告可接受；测试中 `#[tokio::test]` 默认 multi_thread）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution::soap_client`
Expected: 6 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/dilution/soap_client.rs src-tauri/src/dilution/mod.rs
git commit -m "feat(dilution): add SOAP PRMS client with msgBody build/parse"
```

---

### Task 4: 配置文件模块（system/dilution.json）

**Files:**
- Create: `src-tauri/src/dilution/config.rs`
- Modify: `src-tauri/src/dilution/mod.rs`

- [ ] **Step 1: 写失败测试**

Create `src-tauri/src/dilution/config.rs`（含测试）：

```rust
//! 稀释流程配置：workspace/system/dilution.json

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

pub const DILUTION_CONFIG_ENV: &str = "HMI_WORKSPACE_ROOT";
pub const DEFAULT_PROJECT_ID: &str = "dilution-machine";
pub const DILUTION_CONFIG_RELATIVE_PATH: &str = "system/dilution.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineConfig {
    pub eqpt_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PersonnelConfig {
    pub operator: Option<String>,
    pub checker: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RatioConfig {
    pub raw: f64,
    pub solvent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DilutionOptionConfig {
    pub concentration: String,
    pub recipe_id: String,
    pub ratio: RatioConfig,
    pub mix_time_ms: u64,
    pub settle_time_ms: u64,
    pub raw_density_g_per_ml: Option<f64>,
    pub solvent_density_g_per_ml: Option<f64>,
    pub viscosity_min_cp: Option<f64>,
    pub viscosity_max_cp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DilutionConfig {
    pub machine: Option<MachineConfig>,
    pub personnel: Option<PersonnelConfig>,
    pub label_print_url: Option<String>,
    pub dilution_options: Vec<DilutionOptionConfig>,
}

impl DilutionConfig {
    pub fn eqpt_id(&self) -> Option<&str> {
        self.machine.as_ref().and_then(|machine| machine.eqpt_id.as_deref())
    }

    pub fn operator(&self) -> Option<&str> {
        self.personnel.as_ref().and_then(|personnel| personnel.operator.as_deref())
    }

    pub fn checker(&self) -> Option<&str> {
        self.personnel.as_ref().and_then(|personnel| personnel.checker.as_deref())
    }

    pub fn option_for_concentration(&self, concentration: &str) -> Option<&DilutionOptionConfig> {
        self.dilution_options
            .iter()
            .find(|option| option.concentration == concentration)
    }
}

/// 解析默认 workspace root：
/// 1) env HMI_WORKSPACE_ROOT
/// 2) debug：仓库根 workspace/（CARGO_MANIFEST_DIR 父目录）
/// 3) release：可执行文件同目录 workspace/
pub fn default_workspace_root() -> PathBuf {
    if let Some(value) = std::env::var_os(DILUTION_CONFIG_ENV) {
        let value = value.to_string_lossy().trim().to_string();
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .map(|path| path.join("workspace"))
            .unwrap_or_else(|| manifest_dir.join("workspace"));
    }
    std::env::current_exe()
        .map(|exe| {
            exe.parent()
                .map(|path| path.join("workspace"))
                .unwrap_or_else(|| PathBuf::from("workspace"))
        })
        .unwrap_or_else(|_| PathBuf::from("workspace"))
}

pub fn workspace_project_dir(workspace_root: &PathBuf, project_id: &str) -> PathBuf {
    workspace_root.join("projects").join(project_id)
}

/// 读取 system/dilution.json；文件缺失时返回默认空配置
pub fn load_dilution_config(workspace_root: &PathBuf) -> Result<DilutionConfig, String> {
    let path = workspace_root.join(DILUTION_CONFIG_RELATIVE_PATH);
    if !path.exists() {
        return Ok(DilutionConfig::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read dilution config `{}`: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse dilution config `{}`: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hmi-dilution-config-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("system")).unwrap();
        dir
    }

    #[test]
    fn load_config_should_parse_full_file() {
        let workspace = temp_workspace();
        fs::write(
            workspace.join("system/dilution.json"),
            r#"{
              "machine": { "eqptId": "EQPT-001" },
              "personnel": { "operator": "张工", "checker": "李工" },
              "labelPrintUrl": "http://print-server/bartender/api",
              "dilutionOptions": [
                {
                  "concentration": "0.01:5",
                  "recipeId": "dilute-0.01-5",
                  "ratio": { "raw": 7, "solvent": 3 },
                  "mixTimeMs": 300000,
                  "settleTimeMs": 120000,
                  "viscosityMinCp": 1,
                  "viscosityMaxCp": 10
                }
              ]
            }"#,
        )
        .unwrap();
        let config = load_dilution_config(&workspace).unwrap();
        assert_eq!(config.eqpt_id(), Some("EQPT-001"));
        assert_eq!(config.operator(), Some("张工"));
        assert_eq!(config.checker(), Some("李工"));
        assert_eq!(config.label_print_url.as_deref(), Some("http://print-server/bartender/api"));
        let option = config.option_for_concentration("0.01:5").unwrap();
        assert_eq!(option.recipe_id, "dilute-0.01-5");
        assert_eq!(option.ratio, RatioConfig { raw: 7.0, solvent: 3.0 });
        assert_eq!(option.mix_time_ms, 300_000);
    }

    #[test]
    fn load_config_should_return_defaults_when_file_missing() {
        let workspace = temp_workspace();
        let config = load_dilution_config(&workspace).unwrap();
        assert_eq!(config, DilutionConfig::default());
        assert_eq!(config.eqpt_id(), None);
        assert!(config.option_for_concentration("0.01:5").is_none());
    }

    #[test]
    fn option_lookup_should_return_none_for_unknown_concentration() {
        let workspace = temp_workspace();
        fs::write(
            workspace.join("system/dilution.json"),
            r#"{"dilutionOptions":[{"concentration":"70%","recipeId":"r1","ratio":{"raw":7,"solvent":3}}]}"#,
        )
        .unwrap();
        let config = load_dilution_config(&workspace).unwrap();
        assert!(config.option_for_concentration("60%").is_none());
        assert_eq!(config.option_for_concentration("70%").unwrap().recipe_id, "r1");
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution::config`
Expected: 编译错误（config 未注册）

- [ ] **Step 3: 注册模块并导出**

`src-tauri/src/dilution/mod.rs` 加入（已在 Task 1 声明）：

```rust
pub use config::{default_workspace_root, load_dilution_config, DilutionConfig};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution::config`
Expected: 3 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/dilution/config.rs src-tauri/src/dilution/mod.rs
git commit -m "feat(dilution): add workspace dilution config module"
```

---

### Task 5: 应用默认 workspace 内容（system 配置 + 设备/动作 + 配方）

**Files:**
- Create: `workspace/` 下全部文件（见下）

- [ ] **Step 1: 创建 system 配置与设备类型**

`workspace/system/dilution.json`：

```json
{
  "machine": { "eqptId": "EQPT-001" },
  "personnel": { "operator": "张工", "checker": "李工" },
  "labelPrintUrl": "",
  "dilutionOptions": [
    {
      "concentration": "70%",
      "recipeId": "dilute-70",
      "ratio": { "raw": 7, "solvent": 3 },
      "mixTimeMs": 300000,
      "settleTimeMs": 120000,
      "rawDensityGPerMl": 1.0,
      "solventDensityGPerMl": 0.9,
      "viscosityMinCp": 1,
      "viscosityMaxCp": 10
    }
  ]
}
```

`workspace/system/device-types/scale.json`：

```json
{
  "id": "scale",
  "name": "电子秤",
  "group": "device",
  "allowedActions": ["weigh.start"]
}
```

`workspace/system/device-types/mixer.json`：

```json
{
  "id": "mixer",
  "name": "搅拌器",
  "group": "device",
  "allowedActions": ["mix.start"]
}
```

`workspace/system/device-types/viscometer.json`：

```json
{
  "id": "viscometer",
  "name": "粘度计",
  "group": "device",
  "allowedActions": ["viscosity.measure"]
}
```

- [ ] **Step 2: 创建动作定义（HMIP 报文占位）**

`workspace/system/actions/common.delay.json`：

```json
{
  "id": "common.delay",
  "name": "延时",
  "category": "common",
  "targetMode": "none",
  "parameters": [
    { "key": "durationMs", "name": "时长", "type": "number", "required": true, "unit": "ms", "min": 0, "max": 600000, "default": 1000 }
  ],
  "summaryTemplate": "延时 {durationMs} ms"
}
```

`workspace/system/actions/common.wait-signal.json`：

```json
{
  "id": "common.wait-signal",
  "name": "等待信号",
  "category": "common",
  "targetMode": "none",
  "parameters": [
    { "key": "signalId", "name": "信号", "type": "string", "required": true },
    { "key": "operator", "name": "比较符", "type": "enum", "required": false, "options": ["eq", "ne", "gt", "ge", "lt", "le"], "default": "eq" },
    { "key": "value", "name": "目标值", "type": "string", "required": true }
  ],
  "summaryTemplate": "等待信号 {signalId}"
}
```

`workspace/system/actions/weigh.start.json`（HMIP 报文占位）：

```json
{
  "id": "weigh.start",
  "name": "称量",
  "category": "device",
  "targetMode": "required",
  "allowedDeviceTypes": ["scale"],
  "parameters": [
    { "key": "targetMassG", "name": "目标质量", "type": "number", "required": true, "unit": "g" }
  ],
  "dispatch": {
    "kind": "hmipFrame",
    "msgType": 64,
    "payloadMode": "fixedHex",
    "payloadHex": "0101",
    "priority": "normal"
  },
  "completion": {
    "type": "deviceFeedback",
    "key": "weight",
    "operator": "eq",
    "value": true,
    "stableTimeMs": 200
  },
  "summaryTemplate": "{device.name} 称量 {targetMassG} g"
}
```

`workspace/system/actions/mix.start.json`（占位）：

```json
{
  "id": "mix.start",
  "name": "搅拌",
  "category": "device",
  "targetMode": "required",
  "allowedDeviceTypes": ["mixer"],
  "parameters": [
    { "key": "durationMs", "name": "时长", "type": "number", "required": true, "unit": "ms", "min": 0, "max": 3600000, "default": 300000 }
  ],
  "dispatch": {
    "kind": "hmipFrame",
    "msgType": 65,
    "payloadMode": "fixedHex",
    "payloadHex": "0202",
    "priority": "normal"
  },
  "completion": {
    "type": "deviceFeedback",
    "key": "running",
    "operator": "eq",
    "value": false,
    "stableTimeMs": 200
  },
  "summaryTemplate": "{device.name} 搅拌 {durationMs} ms"
}
```

`workspace/system/actions/settle.json`（静置 = 延时，不占设备）：

```json
{
  "id": "settle",
  "name": "静置",
  "category": "common",
  "targetMode": "none",
  "parameters": [
    { "key": "durationMs", "name": "时长", "type": "number", "required": true, "unit": "ms", "min": 0, "max": 3600000, "default": 120000 }
  ],
  "summaryTemplate": "静置 {durationMs} ms"
}
```

`workspace/system/actions/viscosity.measure.json`（占位）：

```json
{
  "id": "viscosity.measure",
  "name": "测粘度",
  "category": "device",
  "targetMode": "required",
  "allowedDeviceTypes": ["viscometer"],
  "parameters": [],
  "dispatch": {
    "kind": "hmipFrame",
    "msgType": 66,
    "payloadMode": "fixedHex",
    "payloadHex": "0303",
    "priority": "normal"
  },
  "completion": {
    "type": "deviceFeedback",
    "key": "viscosityAvgCp",
    "operator": "ge",
    "value": 0,
    "stableTimeMs": 0
  },
  "summaryTemplate": "{device.name} 测量粘度"
}
```

- [ ] **Step 3: 创建项目文件**

`workspace/projects/dilution-machine/project.json`：

```json
{
  "id": "dilution-machine",
  "name": "光刻胶稀释机",
  "description": "光刻胶稀释机本地工艺项目",
  "version": "0.1.0",
  "enabled": true
}
```

`workspace/projects/dilution-machine/connections/main-hmip.json`：

```json
{
  "id": "main-hmip",
  "name": "设备 HMIP 主连接",
  "enabled": true,
  "kind": "tcp",
  "tcp": { "host": "127.0.0.1", "port": 9001, "timeoutMs": 3000 }
}
```

`workspace/projects/dilution-machine/devices/scale_01.json`：

```json
{
  "id": "scale_01",
  "name": "原液秤",
  "typeId": "scale",
  "enabled": true,
  "transport": { "kind": "hmip", "connectionId": "main-hmip", "channel": 1 },
  "tags": { "weight": "scaleWeight" }
}
```

`workspace/projects/dilution-machine/devices/mixer_01.json`：

```json
{
  "id": "mixer_01",
  "name": "搅拌器",
  "typeId": "mixer",
  "enabled": true,
  "transport": { "kind": "hmip", "connectionId": "main-hmip", "channel": 2 },
  "tags": { "running": "mixerRunning" }
}
```

`workspace/projects/dilution-machine/devices/viscometer_01.json`：

```json
{
  "id": "viscometer_01",
  "name": "粘度计",
  "typeId": "viscometer",
  "enabled": true,
  "transport": { "kind": "hmip", "connectionId": "main-hmip", "channel": 3 },
  "tags": { "viscosityAvgCp": "viscosityAvgCp" }
}
```

`workspace/projects/dilution-machine/signals/viscosity_ready.json`：

```json
{
  "id": "viscosity_ready",
  "name": "粘度就绪",
  "dataType": "int",
  "source": "viscosityAvgCp",
  "enabled": true
}
```

`workspace/projects/dilution-machine/signals/scale_weight.json`：

```json
{
  "id": "scale_weight",
  "name": "称量值",
  "dataType": "double",
  "source": "scaleWeight",
  "enabled": true
}
```

`workspace/projects/dilution-machine/safety/interlocks.json`：

```json
{
  "rules": []
}
```

`workspace/projects/dilution-machine/safety/safe-stop.json`：

```json
{
  "id": "safe-stop",
  "name": "安全停机",
  "steps": []
}
```

`workspace/projects/dilution-machine/feedback-mappings/scale_weight_process.json`（占位）：

```json
{
  "id": "scale_weight_feedback",
  "name": "秤反馈",
  "enabled": true,
  "match": { "connectionId": "main-hmip", "summaryKind": "response" },
  "target": { "deviceId": "scale_01", "feedbackKey": "weight" }
}
```

`workspace/projects/dilution-machine/feedback-mappings/viscosity_process.json`（占位）：

```json
{
  "id": "viscosity_feedback",
  "name": "粘度反馈",
  "enabled": true,
  "match": { "connectionId": "main-hmip", "summaryKind": "response" },
  "target": { "deviceId": "viscometer_01", "feedbackKey": "viscosityAvgCp" }
}
```

`workspace/projects/dilution-machine/feedback-mappings/mixer_process.json`（占位）：

```json
{
  "id": "mixer_feedback",
  "name": "搅拌反馈",
  "enabled": true,
  "match": { "connectionId": "main-hmip", "summaryKind": "response" },
  "target": { "deviceId": "mixer_01", "feedbackKey": "running" }
}
```

- [ ] **Step 4: 创建配方文件**

`workspace/projects/dilution-machine/recipes/dilute-70.json`：

```json
{
  "id": "dilute-70",
  "name": "70% 浓度稀释工艺",
  "description": "称量原液 → 称量溶剂 → 搅拌 → 静置 → 测粘度",
  "steps": [
    {
      "id": "S010",
      "seq": 10,
      "name": "称量原液",
      "actionId": "weigh.start",
      "deviceId": "scale_01",
      "parameters": { "targetMassG": 1000 },
      "timeoutMs": 60000,
      "onError": "stop"
    },
    {
      "id": "S020",
      "seq": 20,
      "name": "称量溶剂",
      "actionId": "weigh.start",
      "deviceId": "scale_01",
      "parameters": { "targetMassG": 428.6 },
      "timeoutMs": 60000,
      "onError": "stop"
    },
    {
      "id": "S030",
      "seq": 30,
      "name": "搅拌",
      "actionId": "mix.start",
      "deviceId": "mixer_01",
      "parameters": { "durationMs": 300000 },
      "timeoutMs": 330000,
      "onError": "stop"
    },
    {
      "id": "S040",
      "seq": 40,
      "name": "静置",
      "actionId": "settle",
      "parameters": { "durationMs": 120000 },
      "timeoutMs": 150000,
      "onError": "stop"
    },
    {
      "id": "S050",
      "seq": 50,
      "name": "测粘度",
      "actionId": "viscosity.measure",
      "deviceId": "viscometer_01",
      "timeoutMs": 60000,
      "onError": "stop"
    }
  ]
}
```

- [ ] **Step 5: 验证 workspace 可被 craftsmanship 扫描且无 error**

运行现有扫描测试方式验证：在 `src-tauri/src/craftsmanship/tests.rs` 追加一个测试（或临时用 cargo test 里已有的 demo workspace 测试路径不可行，则直接写一个一次性测试）：

在 `src-tauri/src/craftsmanship/tests.rs` 文件末尾追加：

```rust
#[test]
fn app_workspace_should_scan_without_errors() {
    let workspace_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("workspace");
    if !workspace_root.exists() {
        return;
    }
    let summary = scan_workspace(&workspace_root.to_string_lossy()).unwrap();
    let errors = summary
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.level == "error")
        .collect::<Vec<_>>();
    assert!(
        errors.is_empty(),
        "workspace contains error diagnostics: {errors:#?}"
    );
    let project = summary
        .projects
        .iter()
        .find(|project| project.id == "dilution-machine")
        .expect("dilution-machine project missing from workspace");
    assert_eq!(project.name, "光刻胶稀释机");
    let recipe = get_recipe_bundle(
        &workspace_root.to_string_lossy(),
        "dilution-machine",
        "dilute-70",
    )
    .expect("dilute-70 recipe bundle should load");
    assert_eq!(recipe.recipe.steps.len(), 5);
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib craftsmanship::tests::app_workspace_should_scan_without_errors`
Expected: PASS（若有 error diagnostic，修正对应文件直到通过）

- [ ] **Step 6: 提交**

```bash
git add workspace/ src-tauri/src/craftsmanship/tests.rs
git commit -m "feat(workspace): add default dilution workspace with placeholder HMIP actions"
```

---

### Task 6: dilution 状态机重构（manager.rs）

**Files:**
- Create: `src-tauri/src/dilution/manager.rs`
- Modify: `src-tauri/src/dilution/types.rs`（移除 manager 部分，只留类型）
- Modify: `src-tauri/src/dilution/mod.rs`

**说明：** 把 `DilutionManager`、`DilutionState`、`DilutionAdapters`、`DilutionRepository`、`MockDilutionDeviceGateway`、`Batch` 相关方法从 `types.rs` 移到 `manager.rs`，并重构：

- [ ] **Step 1: 类型调整（types.rs）**

在 `Batch` 中新增字段：

```rust
    #[serde(default)]
    pub resist_info: Option<ResistInfo>,
    #[serde(default)]
    pub selected_concentration: Option<String>,
    #[serde(default)]
    pub resist_def_rrn: Option<String>,
    #[serde(default)]
    pub check_result: Option<CheckResult>,
    #[serde(default)]
    pub resist_barcodes: Vec<String>,
    #[serde(default)]
    pub resist_sys_rrns: Vec<String>,
    #[serde(default)]
    pub print_success: Option<bool>,
```

`CreateBatchRequest` 改为：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBatchRequest {
    #[serde(default)]
    pub machine_id: Option<String>,
    #[serde(default)]
    pub operator_id: Option<String>,
    #[serde(default)]
    pub reviewer_ids: Vec<String>,
    pub planned_bottle_count: u32,
    pub target_bottle_mass_g: f64,
}
```

`DilutionRecipeSnapshot` 增加字段：

```rust
    #[serde(default)]
    pub recipe_id: String,
```

`BatchStatus` 枚举替换为：

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    #[default]
    Draft,
    ScanningRawResist,
    ResistInfoResolved,
    RecipeLocked,
    LocalProcessRunning,
    LocalProcessCompleted,
    BatchCreating,
    Dispensing,
    Completed,
    Suspended,
    Failed,
}
```

`DilutionReport` 重构为（报表字段集合 + 输出瓶）：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DilutionReport {
    pub report_id: String,
    pub batch_id: String,
    pub eqpt_id: Option<String>,
    pub operator: Option<String>,
    pub checker: Option<String>,
    pub source_resist_name: Option<String>,
    pub source_resist_barcode: Option<String>,
    pub source_resist_weight: Option<f64>,
    pub source_bottle_count: Option<u32>,
    pub mix_start_time: Option<String>,
    pub mix_end_time: Option<String>,
    pub viscosity_test_time: Option<String>,
    pub viscosity: Option<f64>,
    pub dilution_resist_name: Option<String>,
    pub dilution_bottle_count: Option<u32>,
    pub dilution_weight: Option<f64>,
    pub comment: Option<String>,
    pub output_bottles: Vec<ReportBottleLine>,
    pub resist_sys_rrns: Vec<String>,
    pub print_success: Option<bool>,
}
```

- [ ] **Step 2: 写失败测试（manager.rs 内）**

`src-tauri/src/dilution/manager.rs` 开头（测试在文件内 `#[cfg(test)] mod tests`）：

```rust
fn create_request() -> CreateBatchRequest {
    CreateBatchRequest {
        machine_id: Some("MCP-03".to_string()),
        operator_id: Some("op-001".to_string()),
        reviewer_ids: vec!["qa-001".to_string()],
        planned_bottle_count: 3,
        target_bottle_mass_g: 500.0,
    }
}
```

核心流程测试（写于 manager.rs tests 模块）：

```rust
#[test]
fn scan_should_resolve_resist_info_and_auto_lock_single_option() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    assert_eq!(batch.status, BatchStatus::RecipeLocked);
    assert!(batch.resist_info.is_some());
    assert!(batch.resist_def_rrn.is_some());
    assert_eq!(batch.selected_concentration.as_deref(), Some("70%"));
}

#[test]
fn scan_should_reject_inconsistent_resist_no_across_scans() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "RAW-IK02-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    let result = manager.scan_raw_resist(ScanRawResistRequest {
        batch_id: batch.id.clone(),
        barcode: "MULTI-LOT02-B01".to_string(),
        operator_id: "op-001".to_string(),
    });
    assert!(result.is_err());
}

#[test]
fn select_concentration_should_set_resist_def_rrn_from_relationship() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "MULTI-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    assert_eq!(batch.status, BatchStatus::ResistInfoResolved);
    let batch = manager
        .select_concentration(SelectConcentrationRequest {
            batch_id: batch.id.clone(),
            concentration: "70%".to_string(),
        })
        .unwrap();
    assert_eq!(batch.status, BatchStatus::RecipeLocked);
    assert_eq!(batch.resist_def_rrn.as_deref(), Some("2011636530905427900"));
}

#[test]
fn select_concentration_should_reject_missing_config_option() {
    let manager = DilutionManager::new_mock();
    let batch = manager.create_batch(create_request()).unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "MULTI-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    // MULTI 有 60%/70% 两个浓度，但 repo workspace 配置（mock 默认）只有 70% → 60% 查不到配置应报错
    let result = manager.select_concentration(SelectConcentrationRequest {
        batch_id: batch.id.clone(),
        concentration: "60%".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not configured"));
}
```

**注意：** `new_mock()` 加载 repo `workspace/system/dilution.json`（Task 5 提交），配置只含 `70%` 浓度；MockPrmsClient 的 MULTI 返回 `60%/70%`、IK02 返回 `70%`。测试断言以此为准：单浓度 IK02 自动锁定 70%；MULTI 手动选 70% 成功、选 60% 因无配置报错。

- [ ] **Step 3: 写失败测试（run_batch 走 craftsmanship 驱动，MockRuntime）**

```rust
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::noop_assets())
        .expect("failed to build mock app")
}

#[tokio::test]
async fn run_batch_should_drive_craftsmanship_recipe_and_complete() {
    let workspace = build_test_workspace(); // 见 Step 4 helper：delay + wait-signal(viscosity_ready) 配方
    let app = mock_app();
    let rt = craftsmanship::RecipeRuntimeManager::default();
    assert!(app.manage(rt.clone()));
    assert!(app.manage(crate::comm::CommState::default()));

    let manager = DilutionManager::new_with(
        default_log_root(),
        workspace,
        "dilution-machine".to_string(),
        Arc::new(MockPrmsClient),
        Arc::new(MockDilutionDeviceGateway),
    );
    let batch = manager.create_batch(create_request()).unwrap();
    let batch = manager
        .scan_raw_resist(ScanRawResistRequest {
            batch_id: batch.id.clone(),
            barcode: "MULTI-LOT01-B01".to_string(),
            operator_id: "op-001".to_string(),
        })
        .unwrap();
    let batch = manager
        .select_concentration(SelectConcentrationRequest {
            batch_id: batch.id.clone(),
            concentration: "60%".to_string(),
        })
        .unwrap();

    let manager_run = manager.clone();
    let app_handle = app.handle().clone();
    let run_task = tokio::spawn(async move {
        manager_run
            .run_batch_with_app(
                Some(&app_handle),
                RunBatchRequest {
                    batch_id: batch.id.clone(),
                    raw_load: RawLoadRequest::ByMass { target_mass_g: 1000.0 },
                },
            )
            .await
    });
    // 等 recipe 的 wait-signal 步骤开始后写入粘度信号（source=viscosityAvgCp → runtime_values）
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    rt.write_signal_with_app(Some(app.handle()), "viscosity_ready", serde_json::json!(5.4))
        .await
        .unwrap();

    let finished = run_task.await.unwrap().unwrap();
    assert_eq!(finished.status, BatchStatus::Completed);
    assert_eq!(finished.resist_barcodes.len(), 3);
    assert!(finished.print_success == Some(true));
    let report = finished.report.unwrap();
    assert_eq!(report.viscosity, Some(5.4));
}
```

（`build_test_workspace` 与 `default_log_root` 见 Step 4。若 wait-signal 时序不稳定，配方改为 `common.delay` 100ms + 由测试通过 `rt.write_signal` 提前写入——write_signal 在 start 前写入会因 load 未完成失败，因此保留 sleep 时序，或让配方先 delay 100ms 再 wait-signal，测试 sleep 200ms 足够。）

- [ ] **Step 4: 实现 manager.rs**

```rust
//! 稀释批次状态机：PRMS SOAP 三步 + craftsmanship 本地工艺

use super::config::{default_workspace_root, load_dilution_config, workspace_project_dir, DilutionConfig};
use super::types::*;
use super::soap_client::SoapPrmsClient;
use crate::craftsmanship::{RecipeRuntimeManager, RecipeRuntimeRunInput, RecipeRuntimeStatus, RECIPE_RUNTIME_EVENT_NAME};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

pub struct DilutionManager {
    inner: Arc<Mutex<DilutionState>>,
    adapters: Arc<DilutionAdapters>,
    repository: Arc<DilutionRepository>,
    workspace_root: PathBuf,
    project_id: String,
    config: DilutionConfig,
}

#[derive(Default)]
pub(super) struct DilutionState {
    pub batches: HashMap<String, Batch>,
    pub next_event_id: u64,
}

struct DilutionAdapters {
    prms: Arc<dyn PrmsClient>,
    devices: Arc<dyn DilutionDeviceGateway>,
}

struct DilutionRepository {
    log_root: PathBuf,
}

impl Default for DilutionManager {
    fn default() -> Self {
        Self::new_mock()
    }
}

impl DilutionManager {
    pub fn new_mock() -> Self {
        Self::new_mock_with_log_root(default_log_root())
    }

    pub fn new_mock_with_log_root(log_root: PathBuf) -> Self {
        Self::new_with(
            log_root,
            default_workspace_root(),
            super::config::DEFAULT_PROJECT_ID.to_string(),
            Arc::new(MockPrmsClient),
            Arc::new(MockDilutionDeviceGateway),
        )
    }

    pub fn new_with(
        log_root: PathBuf,
        workspace_root: PathBuf,
        project_id: String,
        prms: Arc<dyn PrmsClient>,
        devices: Arc<dyn DilutionDeviceGateway>,
    ) -> Self {
        let config = load_dilution_config(&workspace_root).unwrap_or_default();
        Self {
            inner: Arc::new(Mutex::new(DilutionState::default())),
            adapters: Arc::new(DilutionAdapters { prms, devices }),
            repository: Arc::new(DilutionRepository { log_root }),
            workspace_root,
            project_id,
            config,
        }
    }

    pub fn create_batch(&self, request: CreateBatchRequest) -> Result<Batch, String> {
        let eqpt_id = request
            .machine_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| self.config.eqpt_id().map(str::to_string))
            .ok_or_else(|| "machineId is required (and no default eqptId configured)".to_string())?;
        let operator = request
            .operator_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| self.config.operator().map(str::to_string))
            .ok_or_else(|| "operatorId is required (and no default operator configured)".to_string())?;
        if request.planned_bottle_count == 0 {
            return Err("plannedBottleCount must be greater than 0".to_string());
        }
        if request.target_bottle_mass_g <= 0.0 {
            return Err("targetBottleMassG must be greater than 0".to_string());
        }

        let mut state = self.lock_state()?;
        let now = now_ms();
        let batch = Batch {
            id: format!("DIL-{}-{:04}", now, state.next_event_id.saturating_add(1)),
            machine_id: eqpt_id.clone(),
            status: BatchStatus::Draft,
            operator_id: operator.clone(),
            reviewer_ids: request.reviewer_ids,
            planned_bottle_count: request.planned_bottle_count,
            target_bottle_mass_g: request.target_bottle_mass_g,
            created_at_ms: now,
            completed_at_ms: None,
            raw_scans: Vec::new(),
            prms_mapping: None,
            selected_recipe: None,
            metering_records: Vec::new(),
            viscosity: None,
            output_bottles: Vec::new(),
            prms_sync: Vec::new(),
            report: None,
            alarms: Vec::new(),
            resist_info: None,
            selected_concentration: None,
            resist_def_rrn: None,
            check_result: None,
            resist_barcodes: Vec::new(),
            resist_sys_rrns: Vec::new(),
            print_success: None,
        };
        state.next_event_id = state.next_event_id.saturating_add(1);
        state.batches.insert(batch.id.clone(), batch.clone());
        self.repository
            .persist_batch_change(&batch, "batch_created", json!({}))?;
        Ok(batch)
    }

    pub fn get_batch(&self, batch_id: &str) -> Result<Batch, String> {
        self.lock_state()?
            .batches
            .get(batch_id)
            .cloned()
            .ok_or_else(|| format!("batch `{batch_id}` not found"))
    }

    pub fn list_batches(&self) -> Result<Vec<Batch>, String> {
        let mut batches = self
            .lock_state()?
            .batches
            .values()
            .cloned()
            .collect::<Vec<_>>();
        batches.sort_by(|left, right| left.created_at_ms.cmp(&right.created_at_ms));
        Ok(batches)
    }

    pub fn get_report(&self, batch_id: &str) -> Result<DilutionReport, String> {
        self.get_batch(batch_id)?
            .report
            .ok_or_else(|| format!("report for batch `{batch_id}` is not ready"))
    }

    pub fn scan_raw_resist(&self, request: ScanRawResistRequest) -> Result<Batch, String> {
        let adapters = Arc::clone(&self.adapters);
        let mut state = self.lock_state()?;
        let batch = state.batch_mut(request.batch_id.as_str())?;
        if batch.status == BatchStatus::RecipeLocked || batch.status == BatchStatus::Draft {
            batch.status = BatchStatus::ScanningRawResist;
        }
        let mapping_result = adapters.prms.query_resist_info(QueryResistInfoRequest {
            vendor_barcode: request.barcode.clone(),
        })?;
        let info = mapping_result.value;

        if let Some(existing) = batch.resist_info.as_ref() {
            if existing.resist_no != info.resist_no {
                return Err(format!(
                    "raw resist mismatch: expected `{}`, got `{}`",
                    existing.resist_no, info.resist_no
                ));
            }
        }

        let scan = RawResistScan {
            scan_id: format!("scan-{}", state.next_event_id()),
            barcode: request.barcode,
            scanned_at_ms: now_ms(),
            operator_id: request.operator_id,
            material_name: Some(info.resist_name.clone()),
            lot_id: Some(info.def_batch_no.clone()),
            prms_query_id: Some(info.vendor_barcode.clone()),
            validation_status: ScanValidationStatus::Accepted,
            validation_message: Some("PRMS resistInfo accepted".to_string()),
        };
        batch.raw_scans.push(scan);
        batch.prms_sync.push(sync_record(
            state.next_event_id(),
            PrmsOperation::ResistInfo,
            mapping_result.request_payload,
            Some(mapping_result.response_payload),
        ));
        if batch.resist_info.is_none() {
            batch.resist_info = Some(info.clone());
            batch.status = BatchStatus::ResistInfoResolved;
        }

        if batch
            .resist_info
            .as_ref()
            .is_some_and(|info| info.dilution_relationships.len() == 1)
        {
            let concentration = info.dilution_relationships[0].concentration.clone();
            let option = self.config.option_for_concentration(&concentration).cloned();
            if let Some(option) = option {
                lock_selected_option(batch, &info.dilution_relationships[0], &option)?;
            }
        }

        self.repository.persist_batch_change(
            batch,
            "raw_resist_scanned",
            json!({ "barcode": info.vendor_barcode, "resistNo": info.resist_no }),
        )?;
        Ok(batch.clone())
    }

    pub fn select_concentration(
        &self,
        request: SelectConcentrationRequest,
    ) -> Result<Batch, String> {
        let mut state = self.lock_state()?;
        let batch = state.batch_mut(request.batch_id.as_str())?;
        let info = batch
            .resist_info
            .as_ref()
            .ok_or_else(|| "resist info has not been resolved; scan a raw resist barcode first".to_string())?;
        let relationship = info
            .dilution_relationships
            .iter()
            .find(|relationship| relationship.concentration == request.concentration)
            .ok_or_else(|| format!("concentration `{}` is not available", request.concentration))?;
        let option = self
            .config
            .option_for_concentration(&request.concentration)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "concentration `{}` is not configured in workspace system/dilution.json",
                    request.concentration
                )
            })?;
        lock_selected_option(batch, relationship, &option)?;
        batch.status = BatchStatus::RecipeLocked;
        self.repository.persist_batch_change(
            batch,
            "concentration_selected",
            json!({ "concentration": request.concentration, "resistDefRrn": batch.resist_def_rrn }),
        )?;
        Ok(batch.clone())
    }

    pub async fn run_batch(&self, request: RunBatchRequest) -> Result<Batch, String> {
        let app: Option<AppHandle> = None;
        self.run_batch_with_app(app, request).await
    }

    pub async fn run_batch_with_app<R: Runtime>(
        &self,
        app: Option<&AppHandle<R>>,
        request: RunBatchRequest,
    ) -> Result<Batch, String> {
        let (batch_id, recipe_id, bottle_count, target_mass, raw_load, operator, checker, config) = {
            let state = self.lock_state()?;
            let batch = state
                .batches
                .get(request.batch_id.as_str())
                .ok_or_else(|| format!("batch `{}` not found", request.batch_id))?;
            if batch.status != BatchStatus::RecipeLocked {
                return Err(format!(
                    "cannot run batch `{}` from status {:?}",
                    batch.id, batch.status
                ));
            }
            let option = self
                .config
                .option_for_concentration(batch.selected_concentration.as_deref().unwrap_or_default())
                .cloned()
                .ok_or_else(|| "selected concentration config is missing".to_string())?;
            (
                batch.id.clone(),
                option.recipe_id.clone(),
                batch.planned_bottle_count,
                batch.target_bottle_mass_g,
                request.raw_load.clone(),
                self.config.operator().map(str::to_string),
                self.config.checker().map(str::to_string),
                option,
            )
        };

        let rt = app
            .map(|app_handle| app_handle.state::<RecipeRuntimeManager>().inner().clone())
            .ok_or_else(|| "app handle is required to run the local recipe".to_string())?;

        // 1. 加载本地配方
        rt.load_recipe(
            None,
            self.workspace_root.to_string_lossy().to_string(),
            self.project_id.clone(),
            recipe_id,
        )
        .await?;

        // 2. 启动（runInputs.parameters 传本地执行参数）
        let raw_target_mass = resolve_raw_load_mass(&raw_load, target_mass)?;
        let mut parameters = std::collections::BTreeMap::new();
        parameters.insert("rawLoadTargetMassG".to_string(), json!(raw_target_mass));
        parameters.insert("bottleCount".to_string(), json!(bottle_count));
        parameters.insert("ratioRaw".to_string(), json!(config.ratio.raw));
        parameters.insert("ratioSolvent".to_string(), json!(config.ratio.solvent));
        parameters.insert("targetBottleMassG".to_string(), json!(target_mass));
        rt.start_with_input_with_app(
            app.cloned(),
            Some(RecipeRuntimeRunInput {
                correlation_id: Some(batch_id.clone()),
                operator_id: operator.clone(),
                reviewer_ids: Vec::new(),
                parameters,
                domain: None,
            }),
        )
        .await?;

        // 3. 轮询直到终态
        loop {
            let snapshot = rt.get_status().await;
            match snapshot.status {
                RecipeRuntimeStatus::Completed => break,
                RecipeRuntimeStatus::Failed | RecipeRuntimeStatus::Stopped => {
                    let message = snapshot
                        .last_error
                        .map(|failure| failure.message)
                        .or(snapshot.last_message)
                        .unwrap_or_else(|| "local recipe did not complete".to_string());
                    return Err(format!("local recipe failed: {message}"));
                }
                _ => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        }

        // 4. 读取结果
        let snapshot = rt.get_status().await;
        let runtime_values = &snapshot.runtime_values;
        let raw_mass = runtime_values
            .get("rawActualMassG")
            .and_then(Value::as_f64)
            .unwrap_or(raw_target_mass);
        let solvent_mass = runtime_values
            .get("solventActualMassG")
            .and_then(Value::as_f64)
            .unwrap_or_else(|| raw_mass * config.ratio.solvent / config.ratio.raw);
        let viscosity = runtime_values
            .get("viscosityAvgCp")
            .and_then(Value::as_f64)
            .ok_or_else(|| "local recipe did not produce a viscosity result".to_string())?;

        // 5. PRMS batchCreate
        let info = {
            let state = self.lock_state()?;
            state.batches.get(batch_id.as_str()).and_then(|batch| batch.resist_info.clone())
        }
        .ok_or_else(|| "resist info is missing".to_string())?;
        let barcodes = info
            .vendor_barcode
            .split(',')
            .map(str::to_string)
            .collect::<Vec<_>>();
        let vendor_barcode_list = {
            let state = self.lock_state()?;
            state.batches.get(batch_id.as_str()).map(|batch| batch.raw_scans.iter().map(|scan| scan.barcode.clone()).collect::<Vec<_>>())
        }
        .unwrap_or_default();
        let resist_def_rrn = {
            let state = self.lock_state()?;
            state.batches.get(batch_id.as_str()).and_then(|batch| batch.resist_def_rrn.clone())
        }
        .ok_or_else(|| "resistDefRrn is missing; select a concentration first".to_string())?;

        let mut state = self.lock_state()?;
        let batch = state.batch_mut(batch_id.as_str())?;
        batch.status = BatchStatus::BatchCreating;
        drop(state);

        let create_request = CreateDilutionBatchRequest {
            vendor_barcode_list,
            resist_def_rrn,
            eqpt_id: Some(batch_meta(&self, &batch_id)?.machine_id.clone()),
            bottle_count,
            viscosity: Some(round1(viscosity)),
            label_print_url: self.config.label_print_url.clone().filter(|url| !url.is_empty()),
            source_resist_name: Some(info.resist_name.clone()),
            source_resist_barcode: Some(info.vendor_barcode.clone()),
            source_resist_weight: Some(round1(raw_mass)),
            source_bottle_count: Some(batch.raw_scans.len() as u32),
            operator,
            checker,
            mix_start_time: Some(format_unix_ms(batch.created_at_ms)),
            mix_end_time: Some(format_unix_ms(now_ms())),
            viscosity_test_time: Some(format_unix_ms(now_ms())),
            dilution_resist_name: Some(
                info.dilution_relationships
                    .iter()
                    .find(|relationship| relationship.concentration == batch.selected_concentration.as_deref().unwrap_or_default())
                    .map(|relationship| relationship.resist_name.clone())
                    .unwrap_or_default(),
            ),
            dilution_bottle_count: Some(bottle_count),
            dilution_weight: Some(round1(raw_mass + solvent_mass)),
            comment: Some("本地稀释批次".to_string()),
            ..Default::default()
        };
        let create_result = self.adapters.prms.create_dilution_batch(create_request)?;

        // 6. 分装
        let mut state = self.lock_state()?;
        let batch = state.batch_mut(batch_id.as_str())?;
        batch.status = BatchStatus::Dispensing;
        batch.prms_sync.push(sync_record(
            state.next_event_id(),
            PrmsOperation::CreateBatch,
            create_result.request_payload,
            Some(create_result.response_payload),
        ));
        let barcodes = create_result.value.resist_barcodes.clone();
        let sys_rrns = create_result.value.resist_sys_rrns.clone();
        batch.resist_barcodes = barcodes.clone();
        batch.resist_sys_rrns = sys_rrns.clone();
        batch.print_success = create_result.value.print_success;

        let dispensed = self
            .adapters
            .devices
            .dispense_outputs(DispenseOutputRequest {
                total_mass_g: raw_mass + solvent_mass,
                bottle_count,
                target_bottle_mass_g: target_mass,
                timestamp_ms: now_ms(),
            })?;
        batch.output_bottles.clear();
        for dispensed_bottle in dispensed {
            if dispensed_bottle.index == 0 {
                return Err("dispense gateway returned bottle index 0 (expected 1-based)".to_string());
            }
            let barcode = barcodes
                .get((dispensed_bottle.index - 1) as usize)
                .cloned()
                .ok_or_else(|| format!("PRMS did not return barcode for bottle {}", dispensed_bottle.index))?;
            batch.metering_records.push(dispensed_bottle.metering_record);
            batch.output_bottles.push(OutputBottle {
                index: dispensed_bottle.index,
                target_mass_g: target_mass,
                actual_mass_g: Some(dispensed_bottle.actual_mass_g),
                dilution_barcode: Some(barcode),
                barcode_status: BarcodeStatus::Assigned,
                print_status: PrintStatus::Printed,
                dispensed_at_ms: Some(now_ms()),
                is_last_underfilled: dispensed_bottle.index == bottle_count
                    && dispensed_bottle.actual_mass_g < target_mass,
                metering_record_id: Some(dispensed_bottle.metering_record.id.clone()),
            });
        }

        batch.report = Some(build_report(
            batch,
            &self.config,
            viscosity,
            raw_mass,
            solvent_mass,
        ));
        batch.status = BatchStatus::Completed;
        batch.completed_at_ms = Some(now_ms());

        self.repository
            .persist_batch_change(batch, "batch_completed", json!({ "barcodeCount": barcodes.len() }))?;
        Ok(batch.clone())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, DilutionState>, String> {
        self.inner
            .lock()
            .map_err(|_| "dilution manager mutex poisoned".to_string())
    }
}
```

并保留（从 types.rs 迁移并适配）：`DilutionState::{batch_mut, next_event_id}`、`DilutionRepository::persist_batch_change`、`DilutionBatchEvent`、`sync_record`、`lock_selected_option`（替代旧 `lock_selected_recipe`）、`build_report`、`resolve_raw_load_mass`、`round1`、`now_ms`、`default_log_root`、`format_unix_ms`、`batch_meta` helper、`MockPrmsClient`、`MockDilutionDeviceGateway`、`mock_option`。

新增 helper：

```rust
fn lock_selected_option(
    batch: &mut Batch,
    relationship: &DilutionRelationship,
    option: &super::config::DilutionOptionConfig,
) -> Result<(), String> {
    batch.resist_def_rrn = Some(relationship.sys_rrn.clone());
    batch.selected_concentration = Some(relationship.concentration.clone());
    batch.selected_recipe = Some(DilutionRecipeSnapshot {
        id: option.recipe_id.clone(),
        version: "config-v1".to_string(),
        raw_resist_name: batch
            .resist_info
            .as_ref()
            .map(|info| info.resist_name.clone())
            .unwrap_or_default(),
        concentration: relationship.concentration.clone(),
        dilution_resist_name: relationship.resist_name.clone(),
        ratio: RatioDefinition {
            raw: option.ratio.raw,
            solvent: option.ratio.solvent,
        },
        raw_density_g_per_ml: option.raw_density_g_per_ml,
        solvent_density_g_per_ml: option.solvent_density_g_per_ml,
        mix_time_ms: option.mix_time_ms,
        settle_time_ms: option.settle_time_ms,
        viscosity_min_cp: option.viscosity_min_cp,
        viscosity_max_cp: option.viscosity_max_cp,
        standard_bottle_mass_g: batch.target_bottle_mass_g,
        recipe_id: option.recipe_id.clone(),
    });
    batch.status = BatchStatus::RecipeLocked;
    Ok(())
}

fn format_unix_ms(timestamp_ms: u64) -> String {
    let seconds = (timestamp_ms / 1000) as i64;
    let datetime = chrono_unix_to_string(seconds);
    datetime
}

// 不引入 chrono 依赖：直接格式化 epoch 秒为 yyyy-MM-dd HH:mm:ss（UTC 说明见设计文档）
fn chrono_unix_to_string(seconds: i64) -> String {
    // 简化实现：使用 libc-free 的手动算法过于繁琐，这里用固定占位格式，实施时若需真实时间再引入 chrono
    format!("1970-01-01 00:00:00+{seconds}")
}
```

**实施时注意**：`format_unix_ms` 的时间格式化若引入 chrono 则直接在 Cargo.toml 加 `chrono = "0.4"` 并用 `chrono::DateTime::from_timestamp(...)`，放弃上面的占位实现。选择：**加 chrono 依赖**（简单可靠）。

`build_report` 重构：

```rust
fn build_report(
    batch: &Batch,
    config: &DilutionConfig,
    viscosity: f64,
    raw_mass: f64,
    solvent_mass: f64,
) -> DilutionReport {
    DilutionReport {
        report_id: format!("report-{}", batch.id),
        batch_id: batch.id.clone(),
        eqpt_id: Some(batch.machine_id.clone()),
        operator: config.operator().map(str::to_string),
        checker: config.checker().map(str::to_string),
        source_resist_name: batch.resist_info.as_ref().map(|info| info.resist_name.clone()),
        source_resist_barcode: Some(
            batch.raw_scans.iter().map(|scan| scan.barcode.as_str()).collect::<Vec<_>>().join(","),
        ),
        source_resist_weight: Some(round1(raw_mass)),
        source_bottle_count: Some(batch.raw_scans.len() as u32),
        mix_start_time: Some(format_unix_ms(batch.created_at_ms)),
        mix_end_time: Some(format_unix_ms(now_ms())),
        viscosity_test_time: Some(format_unix_ms(now_ms())),
        viscosity: Some(round1(viscosity)),
        dilution_resist_name: batch.selected_recipe.as_ref().map(|recipe| recipe.dilution_resist_name.clone()),
        dilution_bottle_count: Some(batch.planned_bottle_count),
        dilution_weight: Some(round1(raw_mass + solvent_mass)),
        comment: batch
            .selected_recipe
            .as_ref()
            .map(|recipe| format!("稀释浓度 {}", recipe.concentration)),
        output_bottles: batch
            .output_bottles
            .iter()
            .filter_map(|bottle| {
                Some(ReportBottleLine {
                    index: bottle.index,
                    dilution_barcode: bottle.dilution_barcode.clone()?,
                    actual_mass_g: bottle.actual_mass_g?,
                })
            })
            .collect(),
        resist_sys_rrns: batch.resist_sys_rrns.clone(),
        print_success: batch.print_success,
    }
}
```

- [ ] **Step 5: 测试 workspace fixture helper（manager.rs 测试模块内）**

```rust
fn build_test_workspace() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hmi-dilution-ws-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("system/actions")).unwrap();
    std::fs::create_dir_all(dir.join("projects/dilution-machine/recipes")).unwrap();
    std::fs::create_dir_all(dir.join("projects/dilution-machine/signals")).unwrap();
    std::fs::write(
        dir.join("system/dilution.json"),
        r#"{"machine":{"eqptId":"MCP-03"},"personnel":{"operator":"op-001","checker":"qa-001"},"dilutionOptions":[
          {"concentration":"60%","recipeId":"test-recipe","ratio":{"raw":6,"solvent":4},"mixTimeMs":100,"settleTimeMs":100},
          {"concentration":"70%","recipeId":"test-recipe","ratio":{"raw":7,"solvent":3},"mixTimeMs":100,"settleTimeMs":100}
        ]}"#,
    )
    .unwrap();
    // 内建动作必须存在，否则 craftsmanship 校验会产出 error diagnostics，start() 拒绝执行
    std::fs::write(
        dir.join("system/actions/common.delay.json"),
        r#"{"id":"common.delay","name":"延时","targetMode":"none","parameters":[]}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("system/actions/common.wait-signal.json"),
        r#"{"id":"common.wait-signal","name":"等待信号","targetMode":"none","parameters":[]}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("projects/dilution-machine/project.json"),
        r#"{"id":"dilution-machine","name":"测试项目","enabled":true}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("projects/dilution-machine/signals/viscosity_ready.json"),
        r#"{"id":"viscosity_ready","name":"粘度就绪","dataType":"double","source":"viscosityAvgCp","enabled":true}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("projects/dilution-machine/recipes/test-recipe.json"),
        r#"{
          "id":"test-recipe",
          "name":"测试配方",
          "steps":[
            {"id":"S010","seq":10,"name":"延时","actionId":"common.delay","parameters":{"durationMs":100},"timeoutMs":5000,"onError":"stop"},
            {"id":"S020","seq":20,"name":"等待粘度","actionId":"common.wait-signal","parameters":{"signalId":"viscosity_ready","operator":"ge","value":0},"timeoutMs":5000,"onError":"stop"}
          ]
        }"#,
    )
    .unwrap();
    dir
}
```

> 等待粘度步骤用 `operator=ge, value=0`：测试写入任意粘度数值（如 5.4）即满足条件，同时 runtime_values["viscosityAvgCp"] 得到该值供 run_batch 读取。

fn default_log_root() -> PathBuf {
    std::env::temp_dir().join(format!("hmi-dilution-log-test-{}", std::process::id()))
}
```

- [ ] **Step 6: 迁移与编译**

把 `types.rs` 中 manager 相关代码（`DilutionManager` 等）删除，仅保留类型；`mod.rs` 导出 `manager::{DilutionManager}` 与 `soap_client::{SoapPrmsClient}`、`config::{...}`。旧测试 `src-tauri/src/dilution/tests.rs` 迁移到 `manager.rs` 内测试并适配新 API（`run_batch` 改为 `run_batch_with_app(None, ...)` 会报错——旧流程测试改为使用 `new_mock()` + 直接断言 mock 流程，或删除与上传/要条码相关的断言）。

Run: `cargo test --manifest-path src-tauri/Cargo.toml --package hmi --lib dilution`
Expected: 编译通过，新测试 PASS，旧测试适配后 PASS

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/dilution/ src-tauri/src/lib.rs
git commit -m "feat(dilution): rework state machine to soap flow with craftsmanship local process"
```

---

### Task 7: commands.rs + lib.rs 接线

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: commands.rs 更新**

`dilution_create_batch` 签名不变；`dilution_scan_raw_resist` 不变；`dilution_select_concentration` 不变；`dilution_run_batch` 改为：

```rust
#[tauri::command]
pub async fn dilution_run_batch(
    app: AppHandle,
    state: State<'_, dilution::DilutionManager>,
    request: dilution::RunBatchRequest,
) -> Result<dilution::Batch, String> {
    state.run_batch_with_app(Some(&app), request).await
}
```

删除 `dilution_run_mock_batch`。新增：

```rust
/// 返回稀释流程配置（机台/人员/浓度选项），供前端默认值与展示
#[tauri::command]
pub fn dilution_get_config(
    state: State<'_, dilution::DilutionManager>,
) -> Result<dilution::config::DilutionConfig, String> {
    state.config().cloned()
}
```

（`DilutionManager` 需要新增 `pub fn config(&self) -> &DilutionConfig`）

- [ ] **Step 2: lib.rs 更新**

setup 中改为：

```rust
app.manage(dilution::DilutionManager::new_mock_with_log_root(log_dir));
```

保持 mock 构造（PRMS/设备 adapter 仍为 mock，真实 SOAP 接入时替换为 `SoapPrmsClient::new(endpoint)`——接线点在 `new_with`）。注册命令列表删除 `dilution_run_mock_batch`，加入 `commands::dilution_get_config`。

- [ ] **Step 3: 编译与测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(dilution): wire commands and config endpoint"
```

---

### Task 8: 前端 RPC 封装

**Files:**
- Create: `src/platform/dilution.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: 类型定义（src/types/index.ts 追加或新建 src/types/dilution.ts）**

新建 `src/types/dilution.ts`：

```ts
export type BatchStatus =
    | "draft" | "scanning_raw_resist" | "resist_info_resolved" | "recipe_locked"
    | "local_process_running" | "local_process_completed" | "batch_creating"
    | "dispensing" | "completed" | "suspended" | "failed";

export interface DilutionRelationship {
    resistNo: string;
    resistName: string;
    concentration: string;
    sysRrn: string;
}

export interface ResistInfo {
    resistNo: string;
    resistName: string;
    concentration: string;
    mtrNO: string;
    defrostTime: string;
    viscosityUpperLimit?: number;
    viscosityLowerLimit?: number;
    vendorBarcode: string;
    defBatchNO: string;
    toResistNo: string;
    expireTime: string;
    dilutionRelationships: DilutionRelationship[];
}

export interface RatioConfig { raw: number; solvent: number; }

export interface DilutionOptionConfig {
    concentration: string;
    recipeId: string;
    ratio: RatioConfig;
    mixTimeMs: number;
    settleTimeMs: number;
    rawDensityGPerMl?: number;
    solventDensityGPerMl?: number;
    viscosityMinCp?: number;
    viscosityMaxCp?: number;
}

export interface DilutionConfig {
    machine?: { eqptId?: string };
    personnel?: { operator?: string; checker?: string };
    labelPrintUrl?: string;
    dilutionOptions: DilutionOptionConfig[];
}

export interface RawResistScan {
    scanId: string;
    barcode: string;
    scannedAtMs: number;
    operatorId: string;
    materialName?: string;
    lotId?: string;
    prmsQueryId?: string;
    validationStatus: "accepted" | "rejected";
    validationMessage?: string;
}

export interface CheckResult {
    resistNO: string;
    defResistNO: string;
    resistDefRrn: string;
    batchNO: string;
    expireDate: string;
    concentration: string;
    barcodeCount: number;
}

export interface ReportBottleLine { index: number; dilutionBarcode: string; actualMassG: number; }

export interface DilutionReport {
    reportId: string;
    batchId: string;
    eqptId?: string;
    operator?: string;
    checker?: string;
    sourceResistName?: string;
    sourceResistBarcode?: string;
    sourceResistWeight?: number;
    sourceBottleCount?: number;
    mixStartTime?: string;
    mixEndTime?: string;
    viscosityTestTime?: string;
    viscosity?: number;
    dilutionResistName?: string;
    dilutionBottleCount?: number;
    dilutionWeight?: number;
    comment?: string;
    outputBottles: ReportBottleLine[];
    resistSysRrns: string[];
    printSuccess?: boolean;
}

export interface OutputBottle {
    index: number;
    targetMassG: number;
    actualMassG?: number;
    dilutionBarcode?: string;
    barcodeStatus: "pending" | "assigned";
    printStatus: "pending" | "printed" | "failed";
    dispensedAtMs?: number;
    isLastUnderfilled: boolean;
}

export interface Batch {
    id: string;
    machineId: string;
    status: BatchStatus;
    operatorId: string;
    reviewerIds: string[];
    plannedBottleCount: number;
    targetBottleMassG: number;
    createdAtMs: number;
    completedAtMs?: number;
    rawScans: RawResistScan[];
    selectedConcentration?: string;
    resistDefRrn?: string;
    resistInfo?: ResistInfo;
    checkResult?: CheckResult;
    resistBarcodes: string[];
    resistSysRrns: string[];
    printSuccess?: boolean;
    outputBottles: OutputBottle[];
    report?: DilutionReport;
    alarms: string[];
}

export interface CreateBatchRequest {
    machineId?: string;
    operatorId?: string;
    reviewerIds?: string[];
    plannedBottleCount: number;
    targetBottleMassG: number;
}

export interface ScanRawResistRequest {
    batchId: string;
    barcode: string;
    operatorId: string;
}

export interface SelectConcentrationRequest {
    batchId: string;
    concentration: string;
}

export interface RunBatchRequest {
    batchId: string;
    rawLoad: { mode: "mass"; targetMassG: number } | { mode: "bottle_count"; bottleCount: number };
}
```

- [ ] **Step 2: 写失败测试**

Create `src/platform/dilution.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerInvokeMock } from "./invoke";
import {
    dilutionCreateBatch,
    dilutionGetBatch,
    dilutionListBatches,
    dilutionScanRawResist,
    dilutionSelectConcentration,
    dilutionRunBatch,
    dilutionGetConfig,
} from "./dilution";
import type { Batch, DilutionConfig } from "@/types/dilution";

const batch: Batch = {
    id: "DIL-1", machineId: "EQPT-001", status: "draft", operatorId: "op",
    reviewerIds: [], plannedBottleCount: 1, targetBottleMassG: 500,
    createdAtMs: 1, rawScans: [], resistBarcodes: [], resistSysRrns: [],
    outputBottles: [], alarms: [],
};

beforeEach(() => vi.restoreAllMocks());

describe("dilution rpc", () => {
    it("should invoke create batch", async () => {
        registerInvokeMock("dilution_create_batch", () => batch);
        const result = await dilutionCreateBatch({
            machineId: "EQPT-001", plannedBottleCount: 1, targetBottleMassG: 500,
        });
        expect(result.id).toBe("DIL-1");
    });

    it("should invoke scan and return batch", async () => {
        registerInvokeMock("dilution_scan_raw_resist", () => batch);
        const result = await dilutionScanRawResist({ batchId: "DIL-1", barcode: "X", operatorId: "op" });
        expect(result.id).toBe("DIL-1");
    });

    it("should invoke run batch with raw load", async () => {
        registerInvokeMock("dilution_run_batch", () => batch);
        const result = await dilutionRunBatch({ batchId: "DIL-1", rawLoad: { mode: "mass", targetMassG: 1000 } });
        expect(result.id).toBe("DIL-1");
    });

    it("should get config", async () => {
        const config: DilutionConfig = { dilutionOptions: [] };
        registerInvokeMock("dilution_get_config", () => config);
        const result = await dilutionGetConfig();
        expect(result.dilutionOptions).toEqual([]);
    });
});
```

- [ ] **Step 3: 实现 `src/platform/dilution.ts`**

```ts
import { invoke } from "./invoke";
import type {
    Batch, CreateBatchRequest, DilutionConfig, RunBatchRequest,
    ScanRawResistRequest, SelectConcentrationRequest,
} from "@/types/dilution";

export function dilutionCreateBatch(request: CreateBatchRequest): Promise<Batch> {
    return invoke<Batch>("dilution_create_batch", { request });
}

export function dilutionGetBatch(batchId: string): Promise<Batch> {
    return invoke<Batch>("dilution_get_batch", { batchId });
}

export function dilutionListBatches(): Promise<Batch[]> {
    return invoke<Batch[]>("dilution_list_batches");
}

export function dilutionScanRawResist(request: ScanRawResistRequest): Promise<Batch> {
    return invoke<Batch>("dilution_scan_raw_resist", { request });
}

export function dilutionSelectConcentration(request: SelectConcentrationRequest): Promise<Batch> {
    return invoke<Batch>("dilution_select_concentration", { request });
}

export function dilutionRunBatch(request: RunBatchRequest): Promise<Batch> {
    return invoke<Batch>("dilution_run_batch", { request });
}

export function dilutionGetConfig(): Promise<DilutionConfig> {
    return invoke<DilutionConfig>("dilution_get_config");
}

export const DILUTION_POLL_INTERVAL_MS = 500;
```

- [ ] **Step 4: 运行测试**

Run: `npm run test -- --run src/platform/dilution.test.ts`
Expected: 4 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src/types/dilution.ts src/platform/dilution.ts src/platform/dilution.test.ts
git commit -m "feat(frontend): add dilution rpc wrappers and types"
```

---

### Task 9: 前端 Dilution 视图重构

**Files:**
- Modify: `src/components/views/Dilution/index.tsx`
- Modify: `src/components/views/Dilution/index.test.tsx`
- Modify: `src/i18n/locales/zh.json`、`en.json`

**目标行为：**
- 挂载时 `dilutionGetConfig()` 预填机台/作业员/核对员（可编辑）
- 「创建批次」→ `dilutionCreateBatch`（machineId 空则后端取配置默认）
- 输入条码 →「扫码」→ `dilutionScanRawResist` → 展示 resistInfo（名称/批次/有效期/浓度单选列表）
- 「选择浓度」→ `dilutionSelectConcentration`
- 原液装载模式（质量/瓶数）+ 目标 →「开始执行」→ `dilutionRunBatch`
- 轮询 `dilutionGetBatch`（500ms）显示 `status` 文案 + 输出瓶条码
- 完成 → 显示条码列表、printSuccess、报表摘要
- 删除 mock 步进浏览器（browseId/browseCountdown）、mock 粘度输入、mock 仪表来源

- [ ] **Step 1: 更新 i18n**

`zh.json` 的 `dilution` 段替换（保留结构，字段按新状态机；删除 `mock*` key；新增 `status.*` 文案）：

```json
"dilution": {
  "title": "稀释流程",
  "panels": {
    "batch": "批次设置",
    "scan": "原液扫码",
    "concentration": "浓度选择",
    "execute": "本地工艺执行",
    "output": "稀释瓶输出"
  },
  "fields": {
    "machineId": "机台",
    "operator": "作业员",
    "checker": "核对员",
    "bottleCount": "瓶数",
    "targetMass": "目标瓶质量(g)",
    "barcode": "原液条码",
    "concentration": "浓度",
    "rawLoadMode": "原液装载方式",
    "rawLoadMass": "原液质量(g)",
    "rawLoadBottleCount": "原液瓶数"
  },
  "status": {
    "draft": "草稿",
    "scanning_raw_resist": "扫码中",
    "resist_info_resolved": "原液信息已获取",
    "recipe_locked": "配方已锁定",
    "local_process_running": "本地工艺执行中",
    "local_process_completed": "本地工艺完成",
    "batch_creating": "正在创建稀释瓶",
    "dispensing": "分装中",
    "completed": "已完成",
    "suspended": "挂起",
    "failed": "失败"
  },
  "buttons": {
    "createBatch": "创建批次",
    "scan": "扫码查询",
    "selectConcentration": "选择浓度",
    "run": "开始执行"
  },
  "notifications": {
    "batchCreated": "批次已创建",
    "resistInfoResolved": "原液信息已获取",
    "concentrationSelected": "浓度已选择",
    "batchCompleted": "稀释批次已完成",
    "batchFailed": "稀释批次失败"
  },
  "results": {
    "barcode": "稀释液条码",
    "sysRrn": "系统RRN",
    "printSuccess": "打印成功",
    "viscosity": "粘度(cP)",
    "rawMass": "原液质量(g)",
    "dilutionMass": "稀释质量(g)"
  }
}
```

`en.json` 同步英文。

- [ ] **Step 2: 重构 `src/components/views/Dilution/index.tsx`**

保持现有视觉布局（布局 CSS 不动），替换数据流：

```tsx
// 顶部状态
const [config, setConfig] = useState<DilutionConfig | null>(null);
const [batch, setBatch] = useState<Batch | null>(null);
const [barcodeInput, setBarcodeInput] = useState("");
const [machineId, setMachineId] = useState("");
const [operatorId, setOperatorId] = useState("");
const [checker, setChecker] = useState("");
const [bottleCount, setBottleCount] = useState(2);
const [targetMassG, setTargetMassG] = useState(500);
const [rawLoadMode, setRawLoadMode] = useState<"mass" | "bottle_count">("mass");
const [rawLoadMassG, setRawLoadMassG] = useState(1000);
const [rawBottleCount, setRawBottleCount] = useState(1);
const [busy, setBusy] = useState(false);
const [polling, setPolling] = useState(false);
```

核心逻辑：

```tsx
useEffect(() => {
    let cancelled = false;
    dilutionGetConfig()
        .then((config) => {
            if (cancelled) return;
            setConfig(config);
            setMachineId(config.machine?.eqptId ?? "");
            setOperatorId(config.personnel?.operator ?? "");
            setChecker(config.personnel?.checker ?? "");
        })
        .catch((error) => notify.error(toErrorMessage(error), t("dilution.title")));
    return () => { cancelled = true; };
}, [t]);

const createBatch = async () => {
    setBusy(true);
    try {
        const created = await dilutionCreateBatch({
            machineId: machineId || undefined,
            operatorId: operatorId || undefined,
            plannedBottleCount: bottleCount,
            targetBottleMassG: targetMassG,
        });
        setBatch(created);
        success(t("dilution.notifications.batchCreated"), created.id);
    } catch (error) {
        warning(toErrorMessage(error), t("dilution.title"));
    } finally {
        setBusy(false);
    }
};

const scanBarcode = async () => {
    if (!batch || !barcodeInput.trim()) return;
    setBusy(true);
    try {
        const updated = await dilutionScanRawResist({
            batchId: batch.id,
            barcode: barcodeInput.trim(),
            operatorId: batch.operatorId,
        });
        setBatch(updated);
        setBarcodeInput("");
        success(t("dilution.notifications.resistInfoResolved"), barcodeInput);
    } catch (error) {
        warning(toErrorMessage(error), t("dilution.title"));
    } finally {
        setBusy(false);
    }
};

const selectConcentration = async (concentration: string) => {
    if (!batch) return;
    setBusy(true);
    try {
        const updated = await dilutionSelectConcentration({ batchId: batch.id, concentration });
        setBatch(updated);
        success(t("dilution.notifications.concentrationSelected"), concentration);
    } catch (error) {
        warning(toErrorMessage(error), t("dilution.title"));
    } finally {
        setBusy(false);
    }
};

const runBatch = async () => {
    if (!batch) return;
    setBusy(true);
    setPolling(true);
    try {
        const updated = await dilutionRunBatch({
            batchId: batch.id,
            rawLoad:
                rawLoadMode === "mass"
                    ? { mode: "mass", targetMassG: rawLoadMassG }
                    : { mode: "bottle_count", bottleCount: rawBottleCount },
        });
        setBatch(updated);
        if (updated.status === "completed") {
            success(t("dilution.notifications.batchCompleted"), updated.id);
        } else if (updated.status === "failed") {
            warning(t("dilution.notifications.batchFailed"), updated.id);
        }
    } catch (error) {
        warning(toErrorMessage(error), t("dilution.title"));
    } finally {
        setBusy(false);
        setPolling(false);
    }
};
```

轮询（run 期间后台刷新状态；由于后端 `run_batch` 是阻塞命令，等待返回即为终态，轮询仅用于展示中间态——若后端命令阻塞则省略轮询，直接展示返回结果；保留 `useIntervalWhenActive` 风格的轮询仅当后端改为异步执行时启用。**实施时以实际后端返回为准：run_batch 阻塞直到完成，视图直接展示结果即可，轮询代码可删除。**）

渲染：批次信息卡（machineId/operator/checker/瓶数/目标质量 + 创建按钮）、扫码卡（输入 + 按钮 + resistInfo 展示）、浓度单选列表（来自 `batch.resistInfo?.dilutionRelationships`，未配置的浓度禁用并标注）、执行卡（rawLoadMode 切换 + 质量/瓶数 + 开始按钮）、输出卡（`batch.status` 文案、`resistBarcodes` 列表、`printSuccess`、报表摘要 viscosity/质量）。

- [ ] **Step 3: 更新前端测试 `index.test.tsx`**

按新行为重写测试：
- mock `dilutionGetConfig`（vi.mock `@/platform/dilution`）
- 输入机台/瓶数 → 点击创建 → 断言调用参数与展示批次 id
- 输入条码 → 扫码 → 断言浓度列表渲染
- 选择浓度 → 断言 selectedConcentration 展示
- 运行 → 断言调用 runBatch 参数与条码展示

- [ ] **Step 4: 运行前端测试**

Run: `npm run test -- --run`
Expected: 全部 PASS（含新增 dilution rpc 测试与视图测试）

- [ ] **Step 5: 类型检查与构建**

Run: `npm run lint`
Expected: tsc 与 cargo check 通过

- [ ] **Step 6: 提交**

```bash
git add src/components/views/Dilution/ src/i18n/locales/ src/platform/ src/types/
git commit -m "feat(frontend): wire dilution view to real backend flow"
```

---

### Task 10: 收尾检查

- [ ] **Step 1: 全量测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` 与 `npm run test -- --run` 与 `npm run lint`
Expected: 全部 PASS

- [ ] **Step 2: 自检设计文档一致性**

对照 `docs/dilution-flow.md` 逐条核对：
- [ ] resistInfo/check/batchCreate 三接口已落地（PrmsClient + SoapPrmsClient）
- [ ] upload_viscosity / request_dilution_barcodes 已删除
- [ ] 本地工艺段走 craftsmanship 引擎（run_batch_with_app 驱动 RecipeRuntimeManager）
- [ ] 配置在 workspace system/dilution.json（eqptId/operator/checker + dilutionOptions[].recipeId）
- [ ] 报表字段收集透传 batchCreate（build_report + CreateDilutionBatchRequest 报表字段）
- [ ] machineId 入参保留，未传取配置默认
- [ ] 配方预写 recipe 文件（workspace/projects/dilution-machine/recipes/）
- [ ] 删除清单项已全部执行（mock 扫码/仪表/条码逻辑移除）

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "chore: finalize dilution soap flow rework"
```

---

## 风险与说明

1. **SOAP 服务未就绪**：`SoapPrmsClient`（ureq 同步 HTTP）已实现但默认接线仍用 `MockPrmsClient`（`lib.rs` 构造点），真实 PRMS 地址接入时在 setup 处换 `new_with(... SoapPrmsClient::new(endpoint))`，endpoint 由 env `PRMS_SOAP_ENDPOINT` 配置（可加，不在本计划范围）。
2. **HMIP 报文占位**：`weigh.start` 等动作的 msgType/payload/反馈键为占位，后续提供报文后只改 workspace JSON，不动 Rust。
3. **run_batch 阻塞语义**：后端命令阻塞至本地工艺段 + batchCreate 完成，前端无需轮询（返回即终态）；若后续需要中途状态展示，再改为异步任务 + 事件。
4. **时间格式化**：引入 `chrono`（仅格式化报表时间字段）。
5. **recipe 参数占位**：recipe 步骤里的 targetMassG 等为静态占位值，真实设备接入后通过 runInputs.parameters（rawLoadTargetMassG 等）在 payloadTemplate 中引用。
