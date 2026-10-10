# 现场 PRMS 稀释联调测试指南（soap_cli，按附表）

> 用途：进现场时照着本指南 + `scripts/field_test.sh` 逐步执行 dilution create 模拟联调。
> 联调对象：PRMS 稀释接口（SOAP 统一入口 `InvokeCommonRVMessageByXMLMsgBody`）。

## 1. 本次现场要验证什么

按附表数据模拟一遍 **dilution create** 完整链路：

| 项 | 附表值 |
|---|---|
| 稀释日期 | 2026/9/2 |
| 原液名称 | TMR-IK02 PM 5.4cP |
| 原液 Barcode ×3 | MLTOK015118352026052000051 / …062 / …063 |
| 稀释光阻名称 | TMR-IK02 PM 5.4cP-70% |
| 稀释比例 | 原液 : 稀释液 = 70 : 30 |

三个 SOAP 方法（接口名已更新）：

| 旧名 | 新名 | 作用 |
|---|---|---|
| resistInfo | **PRMSResistInfoInq** | 扫码查询原液定义 + 可稀释浓度列表 |
| check | **PRMSResistInfoCheckInq** | 条码 + 浓度预校验，返回 resistDefRrn |
| batchCreate | **PRMSBatchCreateReq** | 创建稀释瓶 / 生成条码 / 打印 |

## 2. 前置准备

- 二进制位置：
  - 树莓派：`~/Project/hmi/soap_cli`（已就绪）
  - 笔记本 x86：`src-tauri/target/release/soap_cli`
- 网络：测试机能访问 PRMS 的 IP:端口（如 `http://<IP>:12000/prms-serve/cxf/PrmsDilutionWebService`），确认厂商防火墙放行
- 条码：必须 26 位。25 位会打印「警告: 条码长度 25（期望 26 位）」但仍会发送
- 浓度：**必须与第 1 步 resistInfo 返回的 `concentration` 原文逐字符一致**（可能是 `70%` 或 `70:30`），脚本默认 `70%`，不一致时用环境变量覆盖

## 3. 测试模式与脚本用法

把 `scripts/field_test.sh` 拷到测试机（如树莓派 `~/Project/hmi/`）后：

```bash
chmod +x field_test.sh

# 模式一：先本地自检（不连 PRMS，内置 mock 模拟附表场景，含 MLTOK/70%）
# 终端 A
./field_test.sh mock
# 终端 B
./field_test.sh local

# 模式二：现场连真实 PRMS
PRMS_ENDPOINT=http://<PRMS IP>:12000/prms-serve/cxf/PrmsDilutionWebService ./field_test.sh prms
```

常用环境变量（都有默认值）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `CONCENTRATION` | `70%` | 按第 1 步返回原文改 |
| `BOTTLES` | `3` | 稀释瓶数 |
| `VISCOSITY` | `5.4` | 粘度 cP |
| `SOURCE_WEIGHT` | `15000` | 原液光阻质量 g（按实际） |
| `EQPT_ID` / `OPERATOR` / `CHECKER` | EQPT-001 / 张工 / 李工 | 机台/人员 |
| `BARCODE_1..3` | 附表 3 条码 | 原液条码 |
| `RESULTS_DIR` | `./field-test-results` | 各步原始输出存档 |
| `VERBOSE=1` | 关 | 终端打印完整 SOAP 报文，便于现场对照 |

例：`CONCENTRATION=70:30 BOTTLES=5 VISCOSITY=5.2 ./field_test.sh prms`

## 4. 现场流程与验收点

脚本按顺序执行 6 个环节，每步打印 `[PASS/FAIL] exit=…`。

### 第 0 步 工具自检（--help）
预期 exit=0，打印命令用法。

### 第 1 步 resist-info（PRMSResistInfoInq）
发送：`vendorBarcode = B1`。
**验收点**：`InvokeCommonRVMessageByXMLMsgBodyResult=0`；`resistName` 应为 `TMR-IK02 PM 5.4cP`；`dilutionRelationship` 列表中应有 70% 那条（记录其 `concentration` 原文和 `sysRrn`）。

### 第 2 步 check（PRMSResistInfoCheckInq）
发送：3 个 `vendorBarcodeList` + `concentration`。
**验收点**：result=0；`barcodeCount=3`；`resistDefRrn` 与第 1 步 `sysRrn` 一致。

### 第 3 步 batch-create（PRMSBatchCreateReq）
先自动 check，再按附表填充 17 个报表字段发送。
**验收点**：result=0；返回 `resistBarcode[]` 和 `resistSysRrn[]` 数量 = `--bottles`；`printSuccess=true`。

### 第 4 步 flow 一条龙
resistInfo → check →（虚拟工艺读数）→ batchCreate，自动带出真实原液名与稀释名。
**验收点**：三步全部 result=0，最终条码数量 = 瓶数。

### 第 5 步 错误路径自检
`UNKNOWN` 条码 → exit=1（`vendorBarcode not found`）；`REJECT` 条码 → exit=1（`barcode not matched with concentration`）；`--bottles 0` → exit=2（参数错误）。

退出码约定：**0** 成功；**1** SOAP/HTTP/解析失败；**2** 参数错误。

## 5. 附表回填对照

| 附表列 | 来源 |
|---|---|
| 稀释日期 | 报表时间字段（脚本 `MIX_START` 等，默认按 2026-09-02 示例） |
| 原液名称 | 第 1/4 步输出 `resistName`（batch-create 单独跑需加 `--source-resist-name`） |
| 原液 Barcode ×3 | 输入：`BARCODE_1..3` |
| 原液光阻质量 | `--source-resist-weight`（`SOURCE_WEIGHT`） |
| 原液瓶数 | `--source-bottle-count`（脚本固定 3） |
| 机台 / 作业员 / 核对员 | `EQPT_ID` / `OPERATOR` / `CHECKER` |
| 搅拌开始/结束、粘度测试时间 | `MIX_START` / `MIX_END` / `VISC_TIME` |
| 粘度 | `--viscosity`（`VISCOSITY`） |
| 稀释光阻名称 | 第 1/4 步 resistInfo 返回（脚本显式传 `TMR-IK02 PM 5.4cP-70%`） |
| 稀释光阻瓶数 | `--bottles`（`BOTTLES`） |
| **稀释光阻 Barcode** | **第 3/4 步 batchCreate 输出 `resistBarcode[]`，回填附表** |
| 稀释光阻质量 | `--dilution-weight`（默认按 70:30 自动算：原液质量 × (1+30/70)） |
| Comment | 脚本固定 `稀释比例：原液：稀释液=70:30` |

## 6. 常见问题排查

| 现象 | 处理 |
|---|---|
| check 报 `barcode not matched with concentration` | 浓度字符串与第 1 步返回不一致，用 `CONCENTRATION=<原文>` 重跑 |
| `resistDefRrn mismatch` | resistInfo 的 `sysRrn` 与 check 返回值不一致，找厂商核对浓度/RRN 数据 |
| 返回条码数 ≠ 瓶数 | 检查 `BOTTLES`；PRMS 若只允许单条码 batchCreate，把 `BARCODE_2/3` 留空分 3 次跑 |
| HTTP 超时 / 连不上 | 防火墙、端口、endpoint 路径（`/prms-serve/cxf/PrmsDilutionWebService`） |
| 条码 25 位警告 | 确认条码 26 位（附表尾部为 `…52000051`，4 个 0） |
| 想看原始报文 | 各步 `.out` 文件里的 `rawSoapXml` / `requestMsgBody` / `responseMsgBody`；或 `VERBOSE=1` 终端直出 |
| 结果留档 | `RESULTS_DIR` 下保存了每步 JSON（含 ok/endpoint/steps），建议测试后归档 |

## 7. 与 hmi（GUI）的对应关系

现场如果用 hmi 主程序走同一流程：

| soap_cli 步骤 | hmi Dilution 视图 |
|---|---|
| resist-info | 「扫描原液」步骤（扫码即调） |
| check | 「选择浓度」步骤（单浓度自动 check 并锁定） |
| batch-create | 「执行批次」末端（本地工艺完成后自动调） |

hmi 的 PRMS 地址只在启动时读环境变量：

```bash
PRMS_SOAP_ENDPOINT=http://<PRMS IP>:12000/prms-serve/cxf/PrmsDilutionWebService ./hmi
```

不设置则走内置 mock。hmi 的原始报文不打印终端，落盘在日志目录 `dilution/batches/<批次ID>/batch.snapshot.json`（`rawSoapXml` 等字段）。

## 8. 参考文档

- 厂商侧联调说明：`docs/soap-cli-vendor-integration-guide.md`
- PRMS 接口文档：`docs/PRMS_DilutionTool接口对接文档_v1.1.md`
- 本地 mock 服务：`scripts/soap_mock_server.py`（Python 版）、`soap_cli mock`（内置版）
