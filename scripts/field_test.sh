#!/usr/bin/env bash
# ============================================================
# 现场 PRMS 稀释联调脚本（soap_cli）
#
# 场景：附表 3 瓶原液（MLTOK...051/062/063），稀释浓度 70%（70:30）
# 接口（新名）：PRMSResistInfoInq / PRMSResistInfoCheckInq / PRMSBatchCreateReq
#
# 用法：
#   终端 A（模拟 PRMS，联调前自检用）:
#     ./field_test.sh mock
#   终端 B（对本地 mock 跑全流程）:
#     ./field_test.sh local
#   现场（连真实 PRMS）:
#     PRMS_ENDPOINT=http://<PRMS IP>:<端口>/prms-serve/cxf/PrmsDilutionWebService ./field_test.sh prms
#
# 环境变量（均带默认值，现场按实际覆盖）:
#   SOAP_CLI       soap_cli 二进制路径          （默认 ./soap_cli）
#   PRMS_ENDPOINT  PRMS SOAP 端点               （prms 模式必填）
#   BARCODE_1/2/3  原液条码                      （默认附表 3 个 MLTOK 条码）
#   CONCENTRATION  稀释浓度                      （默认 70%，以第 1 步返回原文为准）
#   BOTTLES        稀释瓶数                      （默认 3）
#   VISCOSITY      粘度 cP                       （默认 5.4）
#   SOURCE_WEIGHT  原液光阻质量 g                （默认 15000，按实际填写）
#   EQPT_ID        机台                          （默认 EQPT-001）
#   OPERATOR       作业员                        （默认 张工）
#   CHECKER        核对员                        （默认 李工）
#   MIX_START/MIX_END/VISC_TIME  搅拌/粘度时间   （默认按附表 2026-09-02 示例）
#   RESULTS_DIR    结果输出目录                  （默认 ./field-test-results）
#   VERBOSE=1      不用 --json，终端打印完整 SOAP 报文，便于现场对照
# ============================================================
set -u

SOAP_CLI="${SOAP_CLI:-./soap_cli}"
MODE="${1:-local}"
PORT="${MOCK_PORT:-8899}"
B1="${BARCODE_1:-MLTOK015118352026052000051}"
B2="${BARCODE_2:-MLTOK015118352026052000062}"
B3="${BARCODE_3:-MLTOK015118352026052000063}"
CONCENTRATION="${CONCENTRATION:-70%}"
BOTTLES="${BOTTLES:-3}"
VISCOSITY="${VISCOSITY:-5.4}"
SOURCE_WEIGHT="${SOURCE_WEIGHT:-15000}"
EQPT_ID="${EQPT_ID:-EQPT-001}"
OPERATOR="${OPERATOR:-张工}"
CHECKER="${CHECKER:-李工}"
MIX_START="${MIX_START:-2026-09-02 08:00:00}"
MIX_END="${MIX_END:-2026-09-02 08:30:00}"
VISC_TIME="${VISC_TIME:-2026-09-02 08:31:00}"
RESULTS_DIR="${RESULTS_DIR:-./field-test-results}"
JSON_FLAG="--json"
[ "${VERBOSE:-0}" = "1" ] && JSON_FLAG=""

PASS_N=0
FAIL_N=0

say()  { echo "$*"; }
step() { echo ""; echo "============================================================"; echo "$*"; }

pass_fail() { # pass_fail PASS|FAIL
  if [ "$1" = "PASS" ]; then PASS_N=$((PASS_N+1)); else FAIL_N=$((FAIL_N+1)); fi
}

run_step() { # run_step <名称> <预期退出码> <命令...>
  local name="$1" expect="$2"; shift 2
  step "$name"
  "$@" $JSON_FLAG > "${RESULTS_DIR}/${name}.out" 2>&1
  local code=$?
  local mark="PASS"
  [ "$code" -eq "$expect" ] || mark="FAIL"
  echo "[$mark] exit=$code（预期 $expect）"
  pass_fail "$mark"
  [ "$mark" = "FAIL" ] && tail -5 "${RESULTS_DIR}/${name}.out"
}

summarize() { # summarize <步骤名> <输出文件>
  if ! command -v python3 >/dev/null 2>&1; then
    echo "  （无 python3，跳过摘要，详情见 $2）"; return 0
  fi
  CONCENTRATION="$CONCENTRATION" python3 - "$1" "$2" <<'PY'
import json, os, sys
s, path = sys.argv[1], sys.argv[2]
raw = open(path).read()
i = raw.find("{")
if i < 0:
    print("  无 JSON 输出（失败或 VERBOSE=1），详情见", path); sys.exit(0)
d, _ = json.JSONDecoder().raw_decode(raw[i:])
if not d.get("ok"):
    print("  ok=False | error:", d.get("error")); sys.exit(0)
steps = d.get("steps", [])
if s == "1-resist-info":
    r = steps[0]["result"]
    print("  method:", steps[0]["method"], "| resistName:", r.get("resistName"), "| resistNo:", r.get("resistNo"))
    print("  defBatchNo:", r.get("defBatchNo"), "| expireTime:", r.get("expireTime"))
    for rel in r.get("dilutionRelationships", []):
        print("  可稀释:", rel.get("resistName"), "| concentration:", rel.get("concentration"), "| sysRrn:", rel.get("sysRrn"))
    print("  注意: 后续步骤的浓度必须与上面 concentration 原文一致，当前 CONCENTRATION=" + os.environ["CONCENTRATION"])
elif s == "2-check":
    r = steps[0]["result"]
    print("  method:", steps[0]["method"], "| resistDefRrn:", r.get("resistDefRrn"),
          "| barcodeCount:", r.get("barcodeCount"), "| concentration:", r.get("concentration"))
elif s == "3-batch-create":
    r = steps[-1]["result"]
    print("  steps:", [x["method"] for x in steps])
    print("  稀释光阻Barcode:", r.get("resistBarcodes"))
    print("  resistSysRrns:", r.get("resistSysRrns"), "| printSuccess:", r.get("printSuccess"))
    msg = steps[-1].get("requestMsgBody", "")
    print("  请求含稀释比例 comment:", "稀释比例" in msg, "| vendorBarcodeList 数量:", msg.count("<vendorBarcodeList>"))
elif s == "4-flow":
    print("  endpoint:", d.get("endpoint"))
    for x in steps:
        r = x["result"]
        if x["method"] == "PRMSBatchCreateReq":
            print("   ", x["method"], "-> barcodes:", r.get("resistBarcodes"), "| printSuccess:", r.get("printSuccess"))
        elif x["method"] == "PRMSResistInfoCheckInq":
            print("   ", x["method"], "-> resistDefRrn:", r.get("resistDefRrn"), "| barcodeCount:", r.get("barcodeCount"))
        else:
            print("   ", x["method"], "-> resistName:", r.get("resistName"))
    print("  虚拟工艺读数:", d.get("virtualReadings"))
PY
}

# ---------------- 模式解析 ----------------
case "$MODE" in
  mock)
    echo "启动内置 mock PRMS（端口 $PORT），Ctrl+C 退出"
    echo "另开终端执行: $0 local"
    exec "$SOAP_CLI" mock --port "$PORT"
    ;;
  local)
    ENDPOINT="http://127.0.0.1:${PORT}"
    echo "本地 mock 模式，端点 ${ENDPOINT}（请确认终端 A 已运行: $0 mock）"
    ;;
  prms)
    ENDPOINT="${PRMS_ENDPOINT:-}"
    if [ -z "$ENDPOINT" ]; then
      echo "错误: prms 模式需要 PRMS_ENDPOINT 环境变量"
      echo "示例: PRMS_ENDPOINT=http://<PRMS IP>:<端口>/prms-serve/cxf/PrmsDilutionWebService $0 prms"
      exit 2
    fi
    echo "真实 PRMS 模式，端点 ${ENDPOINT}"
    ;;
  *)
    echo "用法: $0 {mock|local|prms}"
    exit 2
    ;;
esac

if [ ! -x "$SOAP_CLI" ] && ! command -v "$SOAP_CLI" >/dev/null 2>&1; then
  echo "错误: 找不到 soap_cli 二进制，请用 SOAP_CLI=/path/to/soap_cli 指定"
  exit 2
fi

mkdir -p "$RESULTS_DIR"
ENDPOINT_FLAG=(--endpoint "$ENDPOINT")
echo "条码: $B1 / $B2 / $B3"
echo "浓度: $CONCENTRATION | 瓶数: $BOTTLES | 粘度: $VISCOSITY | 原液质量: $SOURCE_WEIGHT g"
echo "结果目录: $RESULTS_DIR"

# ---------------- 第 0 步：工具自检 ----------------
run_step "0-help" 0 "$SOAP_CLI" --help

# ---------------- 第 1 步：resist-info（扫码查询原液） ----------------
run_step "1-resist-info" 0 "$SOAP_CLI" resist-info "$B1" "${ENDPOINT_FLAG[@]}"
summarize "1-resist-info" "${RESULTS_DIR}/1-resist-info.out"

# ---------------- 第 2 步：check（3 瓶 + 浓度预校验） ----------------
run_step "2-check" 0 "$SOAP_CLI" check "$B1" "$B2" "$B3"   --concentration "$CONCENTRATION" "${ENDPOINT_FLAG[@]}"
summarize "2-check" "${RESULTS_DIR}/2-check.out"

# ---------------- 第 3 步：batch-create（模拟 dilution create，按附表填报表字段） ----------------
run_step "3-batch-create" 0 "$SOAP_CLI" batch-create   --barcode "$B1" --barcode "$B2" --barcode "$B3"   --concentration "$CONCENTRATION"   --bottles "$BOTTLES"   --viscosity "$VISCOSITY"   --source-bottle-count 3   --source-resist-weight "$SOURCE_WEIGHT"   --eqpt-id "$EQPT_ID"   --operator "$OPERATOR"   --checker "$CHECKER"   --mix-start-time "$MIX_START"   --mix-end-time "$MIX_END"   --viscosity-test-time "$VISC_TIME"   --dilution-resist-name "TMR-IK02 PM 5.4cP-70%"   --comment "稀释比例：原液：稀释液=70:30"   "${ENDPOINT_FLAG[@]}"
summarize "3-batch-create" "${RESULTS_DIR}/3-batch-create.out"

# ---------------- 第 4 步：flow 一条龙（resistInfo → check → 虚拟工艺 → batchCreate） ----------------
run_step "4-flow" 0 "$SOAP_CLI" flow   --barcode "$B1" --barcode "$B2" --barcode "$B3"   --concentration "$CONCENTRATION"   --bottles "$BOTTLES"   --viscosity "$VISCOSITY"   "${ENDPOINT_FLAG[@]}"
summarize "4-flow" "${RESULTS_DIR}/4-flow.out"

# ---------------- 第 5 步：错误路径自检 ----------------
run_step "5-err-unknown" 1 "$SOAP_CLI" resist-info UNKNOWN-123 "${ENDPOINT_FLAG[@]}"
run_step "5-err-reject" 1 "$SOAP_CLI" check REJECT-0001 --concentration "$CONCENTRATION" "${ENDPOINT_FLAG[@]}"
run_step "5-err-usage" 2 "$SOAP_CLI" batch-create --bottles 0

# ---------------- 汇总 ----------------
step "结果汇总"
echo "通过 ${PASS_N} 项 / 失败 ${FAIL_N} 项"
echo "各步骤原始输出（含 SOAP 报文）见: ${RESULTS_DIR}/"
if [ "$FAIL_N" -gt 0 ]; then
  echo "存在失败项，请对照《现场联调测试指南》排查"
  exit 1
fi
echo "全部符合预期"
