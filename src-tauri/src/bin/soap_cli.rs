//! 独立 SOAP 联调 CLI：与厂商 PRMS 系统做 SOAP 接口联调，
//! 不接真实物理设备（本地工艺段用虚拟读数模拟），数据全部虚拟。
//!
//! 复用 `hmi_lib` 的 dilution SOAP 客户端（`SoapPrmsClient`）与内置 mock 服务（`soap_mock`）。
//!
//! 端点解析优先级：`--endpoint` 参数 > `PRMS_SOAP_ENDPOINT` 环境变量 > `http://127.0.0.1:8899`。
//!
//! 退出码：0 成功；1 SOAP/HTTP/解析失败；2 参数错误。

use hmi_lib::dilution::soap_client::{
    batch_create_msg_body, check_msg_body, parse_batch_create_result, parse_check_result,
    parse_resist_info, resist_info_msg_body,
};
use hmi_lib::dilution::soap_mock::{self, MockSoapServer};
use hmi_lib::dilution::{
    build_soap_request, default_workspace_root, load_dilution_config, parse_concentration_ratio,
    CheckBatchRequest, CheckResult, CreateDilutionBatchRequest, DilutionConfig,
    DilutionRelationship, QueryResistInfoRequest, ResistInfo, SoapPrmsClient,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::process::ExitCode;

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8899";
const DEFAULT_BARCODE: &str = "MZJTST11234567826050700003";
const DEFAULT_RRN: &str = "2030625845182312449";
const DEFAULT_BOTTLES: u32 = 1;
const DEFAULT_VISCOSITY: f64 = 5.0;
const DEFAULT_CONCENTRATION: &str = "0.01:2.222";
const DEFAULT_SOURCE_WEIGHT: f64 = 5000.0;
const DEFAULT_MOCK_PORT: u16 = 8899;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match cli::parse(&args) {
        Ok(command) => {
            let json_mode = command.json_mode();
            let code = match run_command(command) {
                Ok(()) => 0,
                Err(error) => {
                    if json_mode {
                        println!(
                            "{}",
                            serde_json::to_string_pretty(&json!({ "ok": false, "error": error }))
                                .unwrap()
                        );
                    } else {
                        eprintln!("error: {error}");
                    }
                    1
                }
            };
            ExitCode::from(code)
        }
        Err(message) => {
            eprintln!("error: {message}\n");
            cli::print_usage_to_stderr();
            ExitCode::from(2)
        }
    }
}

fn run_command(command: cli::Command) -> Result<(), String> {
    match command {
        cli::Command::Help => {
            cli::print_usage();
            Ok(())
        }
        cli::Command::ResistInfo { barcode, opts } => run_resist_info(&opts, &barcode),
        cli::Command::Check {
            barcodes,
            concentration,
            opts,
        } => run_check(&opts, &barcodes, &concentration),
        cli::Command::BatchCreate(args) => run_batch_create(*args),
        cli::Command::Flow(args) => run_flow(*args),
        cli::Command::Mock { port } => run_mock(port),
    }
}

// ===== 参数解析（手写，纯 std；不引入 clap） =====

mod cli {
    use super::*;

    /// 带值选项白名单
    const VALUE_OPTIONS: &[&str] = &[
        "endpoint", "timeout-ms", "concentration", "barcode", "bottles", "rrn", "viscosity",
        "eqpt-id", "operator", "checker", "source-resist-name", "source-resist-barcode",
        "source-resist-weight", "source-bottle-count", "mix-start-time", "mix-end-time",
        "viscosity-test-time", "dilution-resist-name", "dilution-bottle-count", "dilution-weight",
        "comment", "label-print-url", "sleep-ms", "port",
    ];
    /// 布尔开关白名单
    const BOOL_OPTIONS: &[&str] = &["json", "skip-check", "no-fill", "help", "h"];

    #[derive(Debug, Clone)]
    pub struct CommonOpts {
        pub endpoint: String,
        pub json: bool,
        pub timeout_ms: u64,
    }

    #[derive(Debug)]
    pub struct BatchCreateArgs {
        pub opts: CommonOpts,
        pub barcodes: Vec<String>,
        pub rrn: String,
        pub bottles: u32,
        pub concentration: String,
        pub viscosity: f64,
        pub no_fill: bool,
        /// 显式传入的报表字段覆盖（key 为 CLI 选项名，如 "operator"）
        pub overrides: HashMap<String, String>,
    }

    #[derive(Debug)]
    pub struct FlowArgs {
        pub opts: CommonOpts,
        pub barcodes: Vec<String>,
        pub concentration: Option<String>,
        pub bottles: u32,
        pub skip_check: bool,
        pub sleep_ms: u64,
    }

    #[derive(Debug)]
    pub enum Command {
        ResistInfo { barcode: String, opts: CommonOpts },
        Check { barcodes: Vec<String>, concentration: String, opts: CommonOpts },
        BatchCreate(Box<BatchCreateArgs>),
        Flow(Box<FlowArgs>),
        Mock { port: u16 },
        Help,
    }

    impl Command {
        pub fn json_mode(&self) -> bool {
            match self {
                Command::ResistInfo { opts, .. } | Command::Check { opts, .. } => opts.json,
                Command::BatchCreate(args) => args.opts.json,
                Command::Flow(args) => args.opts.json,
                Command::Mock { .. } | Command::Help => false,
            }
        }
    }

    pub fn parse(args: &[String]) -> Result<Command, String> {
        // 无子命令视为用法错误（退出码 2）；显式 -h / --help 出现在任意位置短路为帮助（退出码 0）
        if args.is_empty() {
            return Err("缺少子命令（见 usage）".to_string());
        }
        if args.iter().any(|arg| arg == "-h" || arg == "--help") {
            return Ok(Command::Help);
        }
        let (sub, rest) = args
            .split_first()
            .expect("non-empty args checked above");
        let (positional, flags, bools) = parse_flags(rest)?;
        let opts = common_opts(&flags, &bools)?;
        match sub.as_str() {
            "resist-info" => {
                let barcode = single_positional(&positional, "resist-info 需要 1 个条码参数")?;
                Ok(Command::ResistInfo { barcode, opts })
            }
            "check" => {
                if positional.is_empty() {
                    return Err("check 需要至少 1 个条码参数".to_string());
                }
                let concentration = flag(&flags, "concentration")
                    .cloned()
                    .ok_or_else(|| "check 需要 --concentration <浓度>（如 0.01:2.222，raw:solvent 比例）".to_string())?;
                Ok(Command::Check {
                    barcodes: positional,
                    concentration,
                    opts,
                })
            }
            "batch-create" => {
                if !positional.is_empty() {
                    return Err(format!("batch-create 不接受位置参数: {}", positional.join(" ")));
                }
                let barcodes = flag_all(&flags, "barcode");
                let barcodes = if barcodes.is_empty() {
                    vec![DEFAULT_BARCODE.to_string()]
                } else {
                    barcodes
                };
                let overrides = [
                    "eqpt-id", "operator", "checker", "source-resist-name",
                    "source-resist-barcode", "source-resist-weight", "source-bottle-count",
                    "mix-start-time", "mix-end-time", "viscosity-test-time",
                    "dilution-resist-name", "dilution-bottle-count", "dilution-weight", "comment",
                    "label-print-url", "viscosity",
                ]
                .iter()
                .filter_map(|name| flag(&flags, name).map(|v| (name.to_string(), v.clone())))
                .collect();
                Ok(Command::BatchCreate(Box::new(BatchCreateArgs {
                    opts,
                    barcodes,
                    rrn: flag(&flags, "rrn")
                        .cloned()
                        .unwrap_or_else(|| DEFAULT_RRN.to_string()),
                    bottles: flag_num(&flags, "bottles", DEFAULT_BOTTLES)?,
                    concentration: flag(&flags, "concentration")
                        .cloned()
                        .unwrap_or_else(|| DEFAULT_CONCENTRATION.to_string()),
                    viscosity: flag_num(&flags, "viscosity", DEFAULT_VISCOSITY)?,
                    no_fill: bools.contains("no-fill"),
                    overrides,
                })))
            }
            "flow" => {
                if !positional.is_empty() {
                    return Err(format!("flow 不接受位置参数: {}", positional.join(" ")));
                }
                let barcodes = flag_all(&flags, "barcode");
                let barcodes = if barcodes.is_empty() {
                    vec![DEFAULT_BARCODE.to_string()]
                } else {
                    barcodes
                };
                Ok(Command::Flow(Box::new(FlowArgs {
                    opts,
                    barcodes,
                    concentration: flag(&flags, "concentration").cloned(),
                    bottles: flag_num(&flags, "bottles", DEFAULT_BOTTLES)?,
                    skip_check: bools.contains("skip-check"),
                    sleep_ms: flag_num(&flags, "sleep-ms", 0)?,
                })))
            }
            "mock" => {
                if !positional.is_empty() {
                    return Err(format!("mock 不接受位置参数: {}", positional.join(" ")));
                }
                Ok(Command::Mock {
                    port: flag_num(&flags, "port", DEFAULT_MOCK_PORT)?,
                })
            }
            _ => Err(format!("unknown command: {sub}")),
        }
    }

    /// 通用解析：位置参数 / --key value / --key=value / -- 终止
    fn parse_flags(
        args: &[String],
    ) -> Result<(Vec<String>, HashMap<String, Vec<String>>, HashSet<String>), String> {
        let mut positional = Vec::new();
        let mut flags = HashMap::<String, Vec<String>>::new();
        let mut bools = HashSet::new();
        let mut rest = args;
        while !rest.is_empty() {
            let arg = &rest[0];
            rest = &rest[1..];
            if arg == "--" {
                positional.extend(rest.iter().cloned());
                break;
            }
            if let Some(name) = arg.strip_prefix("--") {
                if let Some((name, value)) = name.split_once('=') {
                    if !VALUE_OPTIONS.contains(&name) {
                        return Err(format!("unknown option: --{name}"));
                    }
                    flags.entry(name.to_string()).or_default().push(value.to_string());
                } else if BOOL_OPTIONS.contains(&name) {
                    bools.insert(name.to_string());
                } else if VALUE_OPTIONS.contains(&name) {
                    let value = rest
                        .first()
                        .ok_or_else(|| format!("option --{name} 需要一个值"))?
                        .clone();
                    flags.entry(name.to_string()).or_default().push(value);
                    rest = &rest[1..];
                } else {
                    return Err(format!("unknown option: --{name}"));
                }
            } else {
                positional.push(arg.clone());
            }
        }
        Ok((positional, flags, bools))
    }

    fn common_opts(
        flags: &HashMap<String, Vec<String>>,
        bools: &HashSet<String>,
    ) -> Result<CommonOpts, String> {
        Ok(CommonOpts {
            endpoint: resolve_endpoint(flag(flags, "endpoint")),
            json: bools.contains("json"),
            timeout_ms: flag_num(flags, "timeout-ms", 15_000)?,
        })
    }

    /// 端点解析：--endpoint 参数 > PRMS_SOAP_ENDPOINT 环境变量 > 默认本地 mock
    pub fn resolve_endpoint(flag_value: Option<&String>) -> String {
        flag_value
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .or_else(|| {
                std::env::var("PRMS_SOAP_ENDPOINT")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
            })
            .unwrap_or_else(|| DEFAULT_ENDPOINT.to_string())
    }

    fn flag<'a>(flags: &'a HashMap<String, Vec<String>>, name: &str) -> Option<&'a String> {
        flags.get(name).and_then(|values| values.last())
    }

    fn flag_all(flags: &HashMap<String, Vec<String>>, name: &str) -> Vec<String> {
        flags.get(name).cloned().unwrap_or_default()
    }

    fn flag_num<T: std::str::FromStr>(
        flags: &HashMap<String, Vec<String>>,
        name: &str,
        default: T,
    ) -> Result<T, String> {
        match flag(flags, name) {
            Some(value) => value
                .parse()
                .map_err(|_| format!("invalid value for --{name}: {value}")),
            None => Ok(default),
        }
    }

    fn single_positional(positional: &[String], error: &str) -> Result<String, String> {
        match positional {
            [] => Err(error.to_string()),
            [one] => Ok(one.clone()),
            many => Err(format!("{error}，实际收到 {} 个", many.len())),
        }
    }

    fn usage_text() -> String {
        format!(
            r#"SOAP 联调 CLI（复用 hmi_lib dilution SOAP 客户端；虚拟数据，不接真实设备）

用法:
  soap_cli <command> [args] [--options]

命令:
  resist-info <条码>
      PRMS resistInfo：查询原液信息与可稀释浓度列表
  check <条码> [条码...] --concentration <浓度>
      PRMS check：预校验，返回 resistDefRrn
  batch-create [选项]
      PRMS batchCreate：创建稀释瓶 / 生成条码 / 打印，17 个报表字段虚拟填充
  flow [选项]
      完整流程: resistInfo → check → 虚拟工艺段（虚拟读数）→ batchCreate
  mock [--port <端口>]
      本地内置 mock SOAP 服务端（默认端口 {DEFAULT_MOCK_PORT}，与 scripts/soap_mock_server.py 一致）

通用选项:
  --endpoint <url>     PRMS SOAP 端点（默认: 参数 > PRMS_SOAP_ENDPOINT 环境变量 > http://127.0.0.1:8899）
  --json               机器可读输出（stdout 仅输出单个 JSON 对象）
  --timeout-ms <n>     请求超时（毫秒，默认 15000）
  -h, --help           显示帮助

batch-create 选项:
  --barcode <条码>         原液条码（可重复；默认 {DEFAULT_BARCODE}）
  --rrn <rrn>              resistDefRrn（默认 {DEFAULT_RRN}，mock 的 0.01:2.222 关系）
  --bottles <n>            稀释瓶数（默认 1）
  --concentration <浓度>   稀释浓度（默认 0.01:2.222，raw:solvent 比例形式，不支持百分比）
  --viscosity <v>          粘度（默认 5.0 cP）
  --no-fill                仅发送显式传入的报表字段（验证 PRMS 空字段路径）
  报表字段覆盖: --eqpt-id --operator --checker --source-resist-name --source-resist-barcode
      --source-resist-weight --source-bottle-count --mix-start-time --mix-end-time
      --viscosity-test-time --dilution-resist-name --dilution-bottle-count
      --dilution-weight --comment --label-print-url

flow 选项:
  --barcode <条码>         原液条码（可重复；默认 {DEFAULT_BARCODE}）
  --concentration <浓度>   指定浓度（默认取 resistInfo 返回的第一个）
  --bottles <n>            稀释瓶数（默认 1）
  --skip-check             跳过 check 预校验（resistDefRrn 取 resistInfo 的 sysRrn）
  --sleep-ms <n>           虚拟工艺段模拟耗时（默认 0 不等待）

mock 选项:
  --port <端口>            监听端口（默认 {DEFAULT_MOCK_PORT}）

退出码: 0 成功；1 SOAP/HTTP/解析失败；2 参数错误

示例:
  soap_cli mock --port 8899
  soap_cli resist-info MZJTST11234567826050700003
  soap_cli check MZJTST11234567826050700003 --concentration 0.01:2.222
  soap_cli batch-create --bottles 3
  soap_cli flow --json
  soap_cli flow --endpoint http://<PRMS地址>:12000/prms-serve/cxf/PrmsDilutionWebService --barcode <真实26位条码>"#
        )
    }

    pub fn print_usage() {
        println!("{}", usage_text());
    }

    /// 用法错误时输出到 stderr（配合退出码 2）
    pub fn print_usage_to_stderr() {
        eprintln!("{}", usage_text());
    }
}

// ===== 虚拟数据 =====

struct ReportDefaults {
    eqpt_id: String,
    operator: String,
    checker: String,
    mix_start_time: String,
    mix_end_time: String,
    viscosity_test_time: String,
}

struct VirtualReadings {
    raw_mass: f64,
    solvent_mass: f64,
    viscosity: f64,
    mix_time_ms: u64,
    settle_time_ms: u64,
    raw_ratio: f64,
    solvent_ratio: f64,
}

/// 读取 workspace/system/dilution.json；缺失 / 解析失败时用默认值（与 app 行为一致）
fn load_config() -> DilutionConfig {
    load_dilution_config(&default_workspace_root()).unwrap_or_else(|error| {
        eprintln!("警告: 读取 dilution 配置失败，使用默认值: {error}");
        DilutionConfig::default()
    })
}

fn report_defaults(cfg: &DilutionConfig) -> ReportDefaults {
    let (mix_start, mix_end, viscosity_test) = virtual_times();
    ReportDefaults {
        eqpt_id: cfg.eqpt_id().unwrap_or("EQPT-001").to_string(),
        operator: cfg.operator().unwrap_or("张工").to_string(),
        checker: cfg.checker().unwrap_or("李工").to_string(),
        mix_start_time: mix_start,
        mix_end_time: mix_end,
        viscosity_test_time: viscosity_test,
    }
}

/// 虚拟时间戳：mixStart=now-30min、mixEnd=now-5min、viscosityTest=now-1min（%Y-%m-%d %H:%M:%S）
fn virtual_times() -> (String, String, String) {
    let now = chrono::Local::now();
    let format = |time: chrono::DateTime<chrono::Local>| time.format("%Y-%m-%d %H:%M:%S").to_string();
    (
        now.checked_sub_signed(chrono::Duration::minutes(30))
            .map(format)
            .unwrap_or_else(|| format(now)),
        now.checked_sub_signed(chrono::Duration::minutes(5))
            .map(format)
            .unwrap_or_else(|| format(now)),
        now.checked_sub_signed(chrono::Duration::minutes(1))
            .map(format)
            .unwrap_or_else(|| format(now)),
    )
}

/// 虚拟工艺段读数：称量 / 溶剂比例 / 粘度 / 搅拌静置时长（来自配置 processDefaults）
fn virtual_readings(cfg: &DilutionConfig, concentration: &str) -> VirtualReadings {
    let (raw_ratio, solvent_ratio) = parse_concentration_ratio(concentration).unwrap_or((0.01, 2.222));
    VirtualReadings {
        raw_mass: DEFAULT_SOURCE_WEIGHT,
        solvent_mass: DEFAULT_SOURCE_WEIGHT * solvent_ratio / raw_ratio,
        viscosity: DEFAULT_VISCOSITY,
        mix_time_ms: cfg.process_defaults.mix_time_ms,
        settle_time_ms: cfg.process_defaults.settle_time_ms,
        raw_ratio,
        solvent_ratio,
    }
}

/// 构造 batchCreate 请求：虚拟默认值填充 17 报表字段，`--xxx` 显式覆盖；
/// `--no-fill` 时仅发送显式传入字段（验证 PRMS 空字段路径）
fn fill_batch_create(
    args: &cli::BatchCreateArgs,
    cfg: &DilutionConfig,
    defaults: &ReportDefaults,
    resist_info_context: Option<(&ResistInfo, &DilutionRelationship)>,
) -> CreateDilutionBatchRequest {
    let overrides = &args.overrides;
    let no_fill = args.no_fill;
    // 报表字段取值：显式覆盖优先；no_fill 时不取虚拟默认值
    let pick = |name: &str, value: Option<String>| -> Option<String> {
        if let Some(override_value) = overrides.get(name) {
            return Some(override_value.clone());
        }
        if no_fill {
            return None;
        }
        value
    };
    let pick_f64 = |name: &str, value: f64| -> Option<f64> {
        if let Some(override_value) = overrides.get(name) {
            return override_value.parse().ok();
        }
        if no_fill {
            return None;
        }
        Some(value)
    };
    let pick_u32 = |name: &str, value: u32| -> Option<u32> {
        if let Some(override_value) = overrides.get(name) {
            return override_value.parse().ok();
        }
        if no_fill {
            return None;
        }
        Some(value)
    };

    let raw_mass = overrides
        .get("source-resist-weight")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(DEFAULT_SOURCE_WEIGHT);
    let (raw_ratio, solvent_ratio) =
        parse_concentration_ratio(&args.concentration).unwrap_or((0.01, 2.222));
    let dilution_weight = raw_mass + raw_mass * solvent_ratio / raw_ratio;

    let source_resist_name = resist_info_context
        .map(|(info, _)| info.resist_name.clone())
        .unwrap_or_else(|| "光刻胶A".to_string());
    let dilution_resist_name = resist_info_context
        .map(|(_, relationship)| relationship.resist_name.clone())
        .unwrap_or_else(|| format!("稀释光刻胶A {}", args.concentration));
    let label_print_url = cfg
        .label_print_url
        .as_deref()
        .filter(|url| !url.trim().is_empty())
        .map(|url| url.to_string());

    CreateDilutionBatchRequest {
        vendor_barcode_list: args.barcodes.clone(),
        resist_def_rrn: args.rrn.clone(),
        eqpt_id: pick("eqpt-id", Some(defaults.eqpt_id.clone())),
        bottle_count: args.bottles,
        viscosity: pick_f64("viscosity", args.viscosity),
        batch_no: None,
        exp_date: None,
        label_print_url: pick("label-print-url", label_print_url),
        source_resist_name: pick("source-resist-name", Some(source_resist_name)),
        source_resist_barcode: pick(
            "source-resist-barcode",
            args.barcodes.first().cloned(),
        ),
        source_resist_weight: pick_f64("source-resist-weight", DEFAULT_SOURCE_WEIGHT),
        source_bottle_count: pick_u32("source-bottle-count", args.barcodes.len() as u32),
        operator: pick("operator", Some(defaults.operator.clone())),
        checker: pick("checker", Some(defaults.checker.clone())),
        mix_start_time: pick("mix-start-time", Some(defaults.mix_start_time.clone())),
        mix_end_time: pick("mix-end-time", Some(defaults.mix_end_time.clone())),
        viscosity_test_time: pick(
            "viscosity-test-time",
            Some(defaults.viscosity_test_time.clone()),
        ),
        dilution_resist_name: pick("dilution-resist-name", Some(dilution_resist_name)),
        dilution_bottle_count: pick_u32("dilution-bottle-count", args.bottles),
        dilution_weight: pick_f64("dilution-weight", dilution_weight),
        comment: pick("comment", Some("本地稀释批次".to_string())),
    }
}

// ===== 子命令实现 =====

fn make_client(opts: &cli::CommonOpts) -> SoapPrmsClient {
    SoapPrmsClient {
        endpoint: opts.endpoint.clone(),
        timeout_ms: opts.timeout_ms,
    }
}

/// 单次 SOAP 调用：打印请求封包 / 请求与响应 msgBody / 解析结果；
/// JSON 模式则收集到 steps 供最终输出
fn call_and_report(
    client: &SoapPrmsClient,
    method: &str,
    msg_body: &str,
    summarize: impl FnOnce(&str) -> Result<Value, String>,
    opts: &cli::CommonOpts,
    steps: &mut Vec<Value>,
) -> Result<Value, String> {
    if !opts.json {
        println!("==> SOAP {method}");
        println!("--- 请求（SOAP 封包） ---");
        println!("{}", build_soap_request(method, msg_body));
        println!("--- 请求 msgBody（未转义） ---");
        println!("{msg_body}");
    }
    let (body_xml, _error_desc) = client.invoke(method, msg_body)?;
    let summary = summarize(&body_xml)?;
    if opts.json {
        steps.push(json!({
            "method": method,
            "requestMsgBody": msg_body,
            "responseMsgBody": body_xml,
            "result": summary,
        }));
    } else {
        println!("--- 响应 msgBody ---");
        println!("{body_xml}");
        println!("--- 解析结果 ---");
        println!("{}", serde_json::to_string_pretty(&summary).unwrap());
    }
    Ok(summary)
}

fn summarize<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(&value).map_err(|error| format!("序列化解析结果失败: {error}"))
}

fn run_resist_info(opts: &cli::CommonOpts, barcode: &str) -> Result<(), String> {
    let length = barcode.chars().count();
    if length != 26 {
        eprintln!("警告: 条码长度 {length}（期望 26 位）；已继续发送，便于联调错误路径");
    }
    let client = make_client(opts);
    let mut steps = Vec::new();
    let msg_body = resist_info_msg_body(&QueryResistInfoRequest {
        vendor_barcode: barcode.to_string(),
    });
    let _info = call_and_report(
        &client,
        "resistInfo",
        &msg_body,
        |xml| parse_resist_info(xml).and_then(summarize),
        opts,
        &mut steps,
    )?;
    finish_json(opts, &steps);
    if !opts.json {
        println!(
            "\n提示: 下一步可执行 `soap_cli flow --barcode {barcode}` 或 `soap_cli check {barcode} --concentration <浓度>`"
        );
    }
    Ok(())
}

fn run_check(
    opts: &cli::CommonOpts,
    barcodes: &[String],
    concentration: &str,
) -> Result<(), String> {
    let client = make_client(opts);
    let mut steps = Vec::new();
    let msg_body = check_msg_body(&CheckBatchRequest {
        vendor_barcode_list: barcodes.to_vec(),
        concentration: concentration.to_string(),
    });
    let _result = call_and_report(
        &client,
        "check",
        &msg_body,
        |xml| parse_check_result(xml).and_then(summarize),
        opts,
        &mut steps,
    )?;
    finish_json(opts, &steps);
    if !opts.json {
        println!(
            "\n提示: 下一步可执行 `soap_cli batch-create --barcode {} --rrn <上面的 resistDefRrn>`",
            barcodes.join(" --barcode ")
        );
    }
    Ok(())
}

fn run_batch_create(args: cli::BatchCreateArgs) -> Result<(), String> {
    let opts = &args.opts;
    let client = make_client(opts);
    let cfg = load_config();
    let defaults = report_defaults(&cfg);
    let request = fill_batch_create(&args, &cfg, &defaults, None);
    let mut steps = Vec::new();
    let msg_body = batch_create_msg_body(&request);
    let _result = call_and_report(
        &client,
        "batchCreate",
        &msg_body,
        |xml| parse_batch_create_result(xml).and_then(summarize),
        opts,
        &mut steps,
    )?;
    finish_json(opts, &steps);
    Ok(())
}

fn run_flow(args: cli::FlowArgs) -> Result<(), String> {
    let opts = &args.opts;
    let client = make_client(opts);
    let cfg = load_config();
    let defaults = report_defaults(&cfg);
    let barcodes = args.barcodes.clone();
    let mut steps = Vec::new();

    // 1. resistInfo：原液信息 + 浓度列表
    let msg_body = resist_info_msg_body(&QueryResistInfoRequest {
        vendor_barcode: barcodes[0].clone(),
    });
    let info_value = call_and_report(
        &client,
        "resistInfo",
        &msg_body,
        |xml| parse_resist_info(xml).and_then(summarize),
        opts,
        &mut steps,
    )?;
    let info: ResistInfo = serde_json::from_value(info_value)
        .map_err(|error| format!("解析 resistInfo 结果失败: {error}"))?;

    // 2. 确定浓度与匹配的 dilutionRelationship
    let concentration = match &args.concentration {
        Some(value) => value.clone(),
        None => info
            .dilution_relationships
            .first()
            .map(|relationship| relationship.concentration.clone())
            .ok_or_else(|| "resistInfo 未返回任何浓度选项，请用 --concentration 指定".to_string())?,
    };
    let relationship = info
        .dilution_relationships
        .iter()
        .find(|relationship| relationship.concentration == concentration)
        .ok_or_else(|| {
            let available = info
                .dilution_relationships
                .iter()
                .map(|relationship| relationship.concentration.as_str())
                .collect::<Vec<_>>()
                .join(" / ");
            format!("浓度 {concentration} 不在 resistInfo 返回的浓度列表中（{available}）")
        })?;

    // 3. check 预校验（--skip-check 时用 resistInfo 的 sysRrn）
    let resist_def_rrn = if args.skip_check {
        relationship.sys_rrn.clone()
    } else {
        let msg_body = check_msg_body(&CheckBatchRequest {
            vendor_barcode_list: barcodes.clone(),
            concentration: concentration.clone(),
        });
        let check_value = call_and_report(
            &client,
            "check",
            &msg_body,
            |xml| parse_check_result(xml).and_then(summarize),
            opts,
            &mut steps,
        )?;
        let check: CheckResult = serde_json::from_value(check_value)
            .map_err(|error| format!("解析 check 结果失败: {error}"))?;
        if check.resist_def_rrn.is_empty() {
            return Err("check 未返回 resistDefRrn，无法继续".to_string());
        }
        check.resist_def_rrn
    };

    // 4. 虚拟工艺段（无真实设备，打印虚拟读数）
    let readings = virtual_readings(&cfg, &concentration);
    if !opts.json {
        println!("==> 本地工艺段（虚拟读数，无真实设备）");
        println!("  称量原液: {:.1} g", readings.raw_mass);
        println!(
            "  称量溶剂: {:.1} g（浓度 {concentration}，比例 {raw_ratio}:{solvent_ratio}）",
            readings.solvent_mass,
            raw_ratio = readings.raw_ratio,
            solvent_ratio = readings.solvent_ratio
        );
        println!("  搅拌: {} ms", readings.mix_time_ms);
        println!("  静置: {} ms", readings.settle_time_ms);
        println!("  测粘度: {:.1} cP", readings.viscosity);
        if args.sleep_ms > 0 {
            println!("  模拟耗时: {} ms", args.sleep_ms);
        }
    }
    if args.sleep_ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(args.sleep_ms));
    }

    // 5. batchCreate：自动填充全部报表字段（虚拟读数 + resistInfo 上下文）
    let batch_args = cli::BatchCreateArgs {
        opts: opts.clone(),
        barcodes: barcodes.clone(),
        rrn: resist_def_rrn,
        bottles: args.bottles,
        concentration: concentration.clone(),
        viscosity: readings.viscosity,
        no_fill: false,
        overrides: HashMap::new(),
    };
    let request = fill_batch_create(&batch_args, &cfg, &defaults, Some((&info, relationship)));
    let msg_body = batch_create_msg_body(&request);
    let _result = call_and_report(
        &client,
        "batchCreate",
        &msg_body,
        |xml| parse_batch_create_result(xml).and_then(summarize),
        opts,
        &mut steps,
    )?;

    if opts.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "ok": true,
                "endpoint": opts.endpoint,
                "steps": steps,
                "virtualReadings": {
                    "rawMass": readings.raw_mass,
                    "solventMass": readings.solvent_mass,
                    "viscosity": readings.viscosity,
                    "mixTimeMs": readings.mix_time_ms,
                    "settleTimeMs": readings.settle_time_ms,
                },
            }))
            .unwrap()
        );
    }
    Ok(())
}

fn finish_json(opts: &cli::CommonOpts, steps: &[Value]) {
    if opts.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "ok": true,
                "endpoint": opts.endpoint,
                "steps": steps,
            }))
            .unwrap()
        );
    }
}

fn run_mock(port: u16) -> Result<(), String> {
    let server = MockSoapServer::start_on_port(port, |body| {
        let method = extract_method_name(body).unwrap_or("unknown").to_string();
        let (status, response) = soap_mock::respond_like_prms(body);
        println!("[mock] POST method={method} -> HTTP {status}");
        (status, response)
    })
    .map_err(|error| format!("mock 服务启动失败（端口 {port}）: {error}"))?;
    println!("PRMS SOAP mock 已启动: {}", server.endpoint());
    println!("另开终端联调示例:");
    println!("  soap_cli resist-info MZJTST11234567826050700003");
    println!("  soap_cli flow");
    println!("  soap_cli flow --json");
    println!("按 Ctrl+C 退出");
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

/// 提取 `temp:methodName` 元素（同 soap_mock 内部实现，供 mock 日志展示）
fn extract_method_name(request: &str) -> Option<&str> {
    const OPEN: &str = "<temp:methodName>";
    const CLOSE: &str = "</temp:methodName>";
    let start = request.find(OPEN)? + OPEN.len();
    let end = request[start..].find(CLOSE)? + start;
    Some(&request[start..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_no_args_is_usage_error() {
        assert!(cli::parse(&[]).is_err());
    }

    #[test]
    fn parse_help_shortcut() {
        assert!(matches!(
            cli::parse(&["--help".to_string()]).unwrap(),
            cli::Command::Help
        ));
        assert!(matches!(
            cli::parse(&["resist-info".to_string(), "-h".to_string()]).unwrap(),
            cli::Command::Help
        ));
    }

    #[test]
    fn parse_resist_info() {
        let command = cli::parse(&[
            "resist-info".to_string(),
            "MZJTST11234567826050700003".to_string(),
        ])
        .unwrap();
        match command {
            cli::Command::ResistInfo { barcode, opts } => {
                assert_eq!(barcode, "MZJTST11234567826050700003");
                assert_eq!(opts.endpoint, DEFAULT_ENDPOINT);
                assert!(!opts.json);
            }
            _ => panic!("expected ResistInfo"),
        }
    }

    #[test]
    fn parse_resist_info_missing_barcode() {
        assert!(cli::parse(&["resist-info".to_string()]).is_err());
    }

    #[test]
    fn parse_resist_info_extra_positional() {
        assert!(cli::parse(&["resist-info".to_string(), "A".to_string(), "B".to_string()]).is_err());
    }

    #[test]
    fn parse_check_with_concentration() {
        let command = cli::parse(&[
            "check".to_string(),
            "A".to_string(),
            "B".to_string(),
            "--concentration".to_string(),
            "0.01:2.222".to_string(),
        ])
        .unwrap();
        match command {
            cli::Command::Check {
                barcodes,
                concentration,
                opts,
            } => {
                assert_eq!(barcodes, vec!["A".to_string(), "B".to_string()]);
                assert_eq!(concentration, "0.01:2.222");
                assert_eq!(opts.endpoint, DEFAULT_ENDPOINT);
            }
            _ => panic!("expected Check"),
        }
    }

    #[test]
    fn parse_check_missing_concentration() {
        let error = cli::parse(&["check".to_string(), "A".to_string()]).unwrap_err();
        assert!(error.contains("--concentration"), "{error}");
    }

    #[test]
    fn parse_batch_create_defaults() {
        let command =
            cli::parse(&["batch-create".to_string(), "--bottles".to_string(), "3".to_string()])
                .unwrap();
        match command {
            cli::Command::BatchCreate(args) => {
                assert_eq!(args.barcodes, vec![DEFAULT_BARCODE.to_string()]);
                assert_eq!(args.bottles, 3);
                assert_eq!(args.rrn, DEFAULT_RRN);
                assert!(!args.no_fill);
            }
            _ => panic!("expected BatchCreate"),
        }
    }

    #[test]
    fn parse_batch_create_multiple_barcodes_and_overrides() {
        let command = cli::parse(&[
            "batch-create".to_string(),
            "--barcode".to_string(),
            "A".to_string(),
            "--barcode".to_string(),
            "B".to_string(),
            "--rrn=123".to_string(),
            "--no-fill".to_string(),
            "--operator".to_string(),
            "王工".to_string(),
        ])
        .unwrap();
        match command {
            cli::Command::BatchCreate(args) => {
                assert_eq!(args.barcodes, vec!["A".to_string(), "B".to_string()]);
                assert_eq!(args.rrn, "123");
                assert!(args.no_fill);
                assert_eq!(args.overrides.get("operator").map(String::as_str), Some("王工"));
            }
            _ => panic!("expected BatchCreate"),
        }
    }

    #[test]
    fn parse_flow_options() {
        let command = cli::parse(&[
            "flow".to_string(),
            "--skip-check".to_string(),
            "--json".to_string(),
            "--bottles".to_string(),
            "2".to_string(),
            "--concentration".to_string(),
            "0.01:2.222".to_string(),
        ])
        .unwrap();
        match command {
            cli::Command::Flow(args) => {
                assert!(args.skip_check);
                assert!(args.opts.json);
                assert_eq!(args.bottles, 2);
                assert_eq!(args.concentration.as_deref(), Some("0.01:2.222"));
            }
            _ => panic!("expected Flow"),
        }
    }

    #[test]
    fn parse_mock_port() {
        match cli::parse(&["mock".to_string(), "--port".to_string(), "9000".to_string()]).unwrap() {
            cli::Command::Mock { port } => assert_eq!(port, 9000),
            _ => panic!("expected Mock"),
        }
    }

    #[test]
    fn parse_unknown_command() {
        assert!(cli::parse(&["nope".to_string()]).is_err());
    }

    #[test]
    fn parse_unknown_option() {
        assert!(cli::parse(&[
            "resist-info".to_string(),
            "X".to_string(),
            "--bogus".to_string(),
            "1".to_string()
        ])
        .is_err());
    }

    #[test]
    fn parse_double_dash_terminates_positional() {
        let command = cli::parse(&[
            "resist-info".to_string(),
            "--".to_string(),
            "--weird-barcode".to_string(),
        ])
        .unwrap();
        match command {
            cli::Command::ResistInfo { barcode, .. } => {
                assert_eq!(barcode, "--weird-barcode")
            }
            _ => panic!("expected ResistInfo"),
        }
    }

    #[test]
    fn resolve_endpoint_flag_wins() {
        let flag = Some("http://flag-host/".to_string());
        assert_eq!(cli::resolve_endpoint(flag.as_ref()), "http://flag-host/");
    }

    #[test]
    fn fill_batch_create_should_fill_virtual_defaults() {
        let opts = cli::CommonOpts {
            endpoint: DEFAULT_ENDPOINT.to_string(),
            json: false,
            timeout_ms: 15_000,
        };
        let args = cli::BatchCreateArgs {
            opts,
            barcodes: vec![DEFAULT_BARCODE.to_string()],
            rrn: DEFAULT_RRN.to_string(),
            bottles: 2,
            concentration: "0.01:2.222".to_string(),
            viscosity: 5.0,
            no_fill: false,
            overrides: HashMap::new(),
        };
        let cfg = DilutionConfig::default();
        let defaults = report_defaults(&cfg);
        let request = fill_batch_create(&args, &cfg, &defaults, None);
        assert_eq!(request.eqpt_id.as_deref(), Some("EQPT-001"));
        assert_eq!(request.operator.as_deref(), Some("张工"));
        assert_eq!(request.checker.as_deref(), Some("李工"));
        assert_eq!(request.source_resist_weight, Some(5000.0));
        assert_eq!(request.source_bottle_count, Some(1));
        assert_eq!(request.dilution_bottle_count, Some(2));
        assert_eq!(request.viscosity, Some(5.0));
        assert_eq!(
            request.dilution_resist_name.as_deref(),
            Some("稀释光刻胶A 0.01:2.222")
        );
        assert_eq!(request.comment.as_deref(), Some("本地稀释批次"));
        assert!(request.batch_no.is_none());
        assert!(request.label_print_url.is_none());
        // 0.01:2.222 → 溶剂 = 5000 × 2.222/0.01 = 1,111,000 → 稀释重量 = 1,116,000
        let weight = request.dilution_weight.unwrap();
        assert!((weight - 1_116_000.0).abs() < 0.01, "dilution_weight={weight}");
        // 三个时间戳非空且格式正确
        for time in [
            request.mix_start_time.as_deref(),
            request.mix_end_time.as_deref(),
            request.viscosity_test_time.as_deref(),
        ] {
            let time = time.unwrap();
            assert_eq!(time.len(), 19, "time={time}");
        }
    }

    #[test]
    fn fill_batch_create_should_respect_no_fill() {
        let opts = cli::CommonOpts {
            endpoint: DEFAULT_ENDPOINT.to_string(),
            json: false,
            timeout_ms: 15_000,
        };
        let args = cli::BatchCreateArgs {
            opts,
            barcodes: vec![DEFAULT_BARCODE.to_string()],
            rrn: DEFAULT_RRN.to_string(),
            bottles: 1,
            concentration: "0.01:2.222".to_string(),
            viscosity: 5.0,
            no_fill: true,
            overrides: HashMap::new(),
        };
        let cfg = DilutionConfig::default();
        let defaults = report_defaults(&cfg);
        let request = fill_batch_create(&args, &cfg, &defaults, None);
        // 必填字段保留，报表字段全部 None
        assert_eq!(request.vendor_barcode_list, vec![DEFAULT_BARCODE.to_string()]);
        assert_eq!(request.resist_def_rrn, DEFAULT_RRN);
        assert_eq!(request.bottle_count, 1);
        assert!(request.eqpt_id.is_none());
        assert!(request.operator.is_none());
        assert!(request.viscosity.is_none());
        assert!(request.dilution_weight.is_none());
        assert!(request.comment.is_none());
    }

    #[test]
    fn virtual_times_should_be_formatted() {
        let (mix_start, mix_end, viscosity_test) = virtual_times();
        assert_eq!(mix_start.len(), 19);
        assert_eq!(mix_end.len(), 19);
        assert_eq!(viscosity_test.len(), 19);
        assert!(mix_start < mix_end);
        assert!(mix_end < viscosity_test);
    }

    #[test]
    fn extract_method_name_should_find_method() {
        let request = r#"<soap:Envelope><temp:methodName>resistInfo</temp:methodName></soap:Envelope>"#;
        assert_eq!(extract_method_name(request), Some("resistInfo"));
        assert_eq!(extract_method_name("no method"), None);
    }
}
