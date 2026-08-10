# soap_cli SOAP 联调测试指南（厂商 IT 用）

## 1. 这是什么

`soap_cli` 是我方独立开发的命令行工具，用于与 PRMS 稀释接口（SOAP）进行联调测试：

- **复用生产 SOAP 客户端代码**：报文封装、发送、解析与正式设备完全一致
- **数据全部虚拟**：不连接真实设备，只做接口层测试
- **内置 mock 服务端**：可先不连 PRMS 自行验证工具本身
- **全量打印报文**：每个请求的 SOAP 封包 XML 和响应 XML 都会完整打印，便于双方对报文

## 2. 运行环境

- Linux x86_64（或 Windows + WSL2）
- 单个可执行文件 `soap_cli`，无需安装任何依赖
- 在二进制所在目录执行 `./soap_cli`（Windows 下为 `.\soap_cli.exe`）

## 3. 第一步：本地自测（10 分钟，不需要连 PRMS）

开两个终端：

**终端 A** —— 启动内置 mock 服务端（模拟 PRMS）：

```bash
./soap_cli mock --port 8899
```

**终端 B** —— 依次执行：

```bash
./soap_cli resist-info MZJTST11234567826050700003
./soap_cli check MZJTST11234567826050700003 --concentration 0.01:2.222
./soap_cli batch-create --bottles 3
./soap_cli flow
```

**预期**：终端 A 逐条打印 `[mock] POST method=resistInfo -> HTTP 200`（check、batchCreate 同理）；终端 B 各命令打印请求/响应报文并以退出码 0 结束。

## 4. 第二步：连真实 PRMS 联调

```bash
./soap_cli flow \
  --endpoint http://<PRMS服务器IP>:<端口>/prms-serve/cxf/PrmsDilutionWebService \
  --barcode <PRMS 中登记的真实 26 位原液条码> \
  --concentration <PRMS 配置的稀释浓度>
```

说明：

- `--endpoint` 也可用环境变量 `PRMS_SOAP_ENDPOINT` 代替（优先级：命令行参数 > 环境变量 > 默认本地 mock 地址）
- 我方测试机需能访问 PRMS 地址，请确认防火墙放行对应 IP:端口
- **浓度必须用 raw:solvent 比例形式**（如 `0.01:2.222`），PRMS 不支持百分比
- 先跑单个方法逐步验证，全部通过后再跑 `flow` 完整流程：

```bash
# 分步验证（推荐顺序）
./soap_cli resist-info <条码> --endpoint <PRMS地址>
./soap_cli check <条码> --concentration <浓度> --endpoint <PRMS地址>
./soap_cli batch-create --barcode <条码> --concentration <浓度> --endpoint <PRMS地址>
```

## 5. 命令速查

| 命令 | 作用 | 示例 |
|---|---|---|
| `resist-info <条码>` | 查询原液信息 + 可稀释浓度列表 | `soap_cli resist-info MZJTST11234567826050700003` |
| `check <条码> --concentration <浓度>` | 浓度预校验，返回 `resistDefRrn` | `soap_cli check <条码> --concentration 0.01:2.222` |
| `batch-create [选项]` | 创建稀释瓶 / 生成条码 / 打印（17 个报表字段虚拟填充） | `soap_cli batch-create --bottles 3` |
| `flow [选项]` | 完整流程：resistInfo → check → 虚拟工艺段 → batchCreate | `soap_cli flow` |
| `mock [--port <端口>]` | 内置 mock PRMS 服务端（默认 8899） | `soap_cli mock --port 8899` |

通用选项：`--endpoint <url>`、`--json`（机器可读输出）、`--timeout-ms <n>`（默认 15000）、`-h/--help`。

batch-create / flow 可选参数：`--barcode`（可重复）、`--concentration`、`--bottles`、`--viscosity`、`--rrn`、`--skip-check`（flow 跳过 check）、`--sleep-ms`（虚拟工艺段耗时）等，详见 `./soap_cli --help`。

## 6. 三种方法的验收点

| 方法 | 成功标志（result=0） | 关注返回字段 |
|---|---|---|
| `resistInfo` | `InvokeCommonRVMessageByXMLMsgBodyResult` = 0 | `dilutionRelationship` 列表：稀释胶名称、`concentration`（比例）、`sysRrn` |
| `check` | 同上 | `resistDefRrn`（后续 batchCreate 的入参）、`batchNO`、`expireDate` |
| `batchCreate` | 同上 | `resistSysRrn[]`、`resistBarcode[]`、`printSuccess` |

失败时：`result` = 1，且 `errorDesc` 返回错误描述（如 `vendorBarcode not found`、`barcode not matched with concentration`）。

## 7. 错误路径自测（仅 mock 有效）

mock 服务端按条码内容触发错误分支，用于验证我方对失败响应的处理：

| 条码特征 | 触发的错误 |
|---|---|
| 含 `UNKNOWN` | resistInfo 失败：`vendorBarcode not found` |
| 含 `REJECT` | check 失败：`barcode not matched with concentration` |
| 含 `FAIL` | batchCreate 失败：`batchCreate failed` |

```bash
./soap_cli resist-info UNKNOWN-123            # 退出码 1
./soap_cli check REJECT-0001 --concentration 0.01:2.222   # 退出码 1
```

## 8. 常见问题

- **浓度格式**：必须为 `raw:solvent` 比例（如 `0.01:2.222`）；传百分比（如 `70%`）会被拒绝并提示"不在浓度列表中"
- **退出码**：`0` 成功；`1` SOAP/HTTP/解析失败；`2` 参数错误（输出用法说明）
- **报文核对**：每个命令都会打印请求封包（含 `temp:methodName` / `temp:msgBodyXmlString`）和响应解包 XML，可直接与 PRMS 服务端日志对照
- **`--json` 输出**：stdout 仅输出单个 JSON 对象，便于脚本断言
- **超时**：默认 15 秒，可用 `--timeout-ms` 调整
