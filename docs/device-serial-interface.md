# 设备串口对接接口文档（HMIP v1 over Serial）

> 版本：V0.1（2026-08-20）
> 适用对象：**设备侧（下位机/固件/网关）开发人员**
> 范围：HMI 通过**串口**接入真实设备的完整接口契约，包括物理层参数、链路行为、帧协议（HMIP v1）、应用层交互模型、workspace 配置方法、调试手段。
>
> 配套参考：
> - **设备端 C SDK**：`device-sdk/`（面向 STM32 的 C99 实现，业务代码只需写回调 + 调用发送方法；含主机测试套件与回环演示）
> - HMIP 协议实现细节：`docs/implementation/11-hmip-binary-protocol.md`
> - 工艺后端（craftsmanship）使用文档：`docs/craftsmanship-usage/README.md`
> - 源码：`src-tauri/src/comm/serial.rs`（串口）、`src-tauri/src/comm/proto.rs`（帧协议）、`src-tauri/src/comm/actor.rs`（链路行为）、`src-tauri/src/craftsmanship/runtime/dispatch.rs`（动作下发）、`src-tauri/src/craftsmanship/runtime/manager.rs`（反馈写回）
> - 配置样例：`workspace/projects/dilution-machine/`（当前为 TCP 示例，串口仅需改 `connections/*.json` 的 `kind` 与 `serial` 字段）

---

## 目录

1. [对接全景](#1-对接全景)
2. [串口物理层约定](#2-串口物理层约定)
3. [链路行为规范](#3-链路行为规范)
4. [HMIP v1 帧协议](#4-hmip-v1-帧协议)
5. [应用层交互模型](#5-应用层交互模型)
6. [workspace 配置指南](#6-workspace-配置指南)
7. [调试与联调方法](#7-调试与联调方法)
8. [附录](#8-附录)

---

## 1. 对接全景

### 1.1 系统分层

```
┌─────────────────────────────────────────────────────────────┐
│ HMI（Tauri 桌面应用，运行于本机）                              │
│                                                              │
│  UI 层（React：状态展示 / 命令 / 告警）                        │
│   ▲  comm-event / hmip-event（Tauri 事件）                    │
│  ──┼─────────────────────────────────────────────────────── │
│  工艺运行时（craftsmanship runtime）                          │
│   ├─ dispatch：按 recipe 步骤下发动作帧                        │
│   └─ feedback mapping：把设备回帧映射为信号/设备反馈            │
│  ──┼─────────────────────────────────────────────────────── │
│  通信层（comm）：串口 actor + HMIP 编解码                      │
└──────┬──────────────────────────────────────────────────────┘
       │ 串口（RS-232 / USB 转串口 / RS-485 需转换器）
┌──────▼──────────────────────────────────────────────────────┐
│ 真实设备（下位机/固件）                                        │
│  - 接收 HMI 下发的 HMIP 动作帧，执行动作                       │
│  - 动作完成/异常时向 HMI 回 HMIP 响应帧/事件帧                  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 两层契约

设备开发人员需要遵守**两层契约**：

| 层 | 契约 | 变更方式 |
|---|---|---|
| 链路 + 帧协议 | 串口参数、HMIP v1 帧格式、消息语义（本文档 §2–§4） | 双方共同遵守，改帧格式要同步改 `src-tauri/src/comm/proto.rs` |
| 应用层 | 每个动作的 `msgType` / payload 内容、每个反馈的匹配规则与取值（本文档 §5–§6） | 只改 workspace 下的 JSON 配置文件，**不需要改 HMI 代码** |

### 1.3 关键结论（先读这一节）

- HMI 与设备之间是**主从模型**：HMI 下发动作帧，设备执行后回响应帧；设备也可主动上报事件帧。
- 一个串口连接上可以通过 `channel`（1 字节）区分多个设备；但**串口直连通常一设备一连接**，多设备共线需设备侧提供网关/总线路由（本文档 §5.1）。
- HMI **不会**主动发送 HELLO/HEARTBEAT，也不要求握手才能工作：帧到达即可被解析。设备侧可以发 HEARTBEAT/EVENT 做心跳与主动上报，HMI 能解析并记录。
- 所有多字节整数均为**小端（LE）**。
- 业务动作的 `msgType` 是**双方自定义的编号**（当前示例用 `0x40/0x41/0x42`），协议预留给推荐的请求/响应消息类型（`0x10/0x11/…`），两者不冲突。
- HMI 的动作下发帧是**裸帧**（不带 `request_id`），设备回帧时通过 **`channel` + 消息类型 + 状态**让 HMI 匹配到对应设备与完成判定；`request_id` 字段可回显 `0` 或忽略。

---

## 2. 串口物理层约定

### 2.1 连接拓扑

- HMI 运行在本机，通过本机串口（`/dev/ttyUSB0`、`/dev/ttyS0`、`COM3` 等）与设备直连。
- 支持 RS-232 与 USB 转串口；RS-485 需硬件转换器，HMI 侧不接管方向控制信号。
- **HMI 侧不配置流控**（不设 RTS/CTS、XON/XOFF），设备侧不得依赖硬件流控。

### 2.2 串口参数

| 参数 | workspace 配置字段 | 取值范围 | 默认值 | 说明 |
|---|---|---|---|---|
| 串口名 | `serial.port` | 本机存在的串口 | 无（必填） | Linux 如 `/dev/ttyUSB0`，Windows 如 `COM3` |
| 波特率 | `serial.baudRate` | > 0 | `9600` | 建议 115200；见 §8.2 时间预算 |
| 数据位 | `serial.dataBits` | `5` / `6` / `7` / `8` | `8` | |
| 停止位 | `serial.stopBits` | `1` / `2` | `1` | |
| 校验 | `serial.parity` | `none` / `even` / `odd`（大小写不敏感） | `none` | |

配置示例见 §6.1。校验规则：`baudRate=0`、非法 `dataBits/stopBits/parity` 都会产生 **error 级诊断并阻止 recipe 启动**。

### 2.3 设备侧要求

- 串口参数与 HMI 配置必须完全一致，否则会出现 `decode_error`（见 §7.2）。
- 设备侧建议**主动上报**（如周期 EVENT/HEARTBEAT），以便 HMI 端确认链路存活；HMI 端约 2 秒收不到任何字节并不会断链（读超时 100ms 兜底，见 §3.2）。
- 波特率越低，单帧传输时间越长，注意与 recipe 步骤 `timeoutMs` 的匹配（§8.2）。

---

## 3. 链路行为规范

### 3.1 连接建立时机

- recipe 执行到某个动作、且该动作的设备使用串口连接时，HMI **自动**按 workspace `connections/*.json` 打开串口（`ensure_serial_connection`）；连接在断开前**保持复用**，不会每个动作重开。
- HMI 也提供调试用的显式命令：`connect_serial` / `disconnect_serial` / `send_serial_data` / `send_serial_hmip_frame` / `get_serial_ports`（前端 `useCommStore`）。
- 连接成功/失败会通过 `comm-event` 推送到 UI（`connected` / `error`）。

### 3.2 断线重连

设备开发人员**必须**理解以下行为，避免设备侧误判：

| 行为 | 值 | 说明 |
|---|---|---|
| 写超时 | 2000 ms | 向串口写入超过 2s 未完成 → 判断链，进入重连 |
| 串口空读判死 | 连续 200 次 0 字节（约 2s） | 单次空读正常（PTY/部分驱动），持续空读视为拔出/对端关闭 |
| 重连退避 | 约 400ms → 800ms → 1600ms → 3200ms → 5000ms（封顶） | 指数退避，重连成功清零 |
| **重连丢帧** | 断链期间积压的待发帧在重连成功前**全部丢弃** | 工业设备上重放过期动作指令比丢帧更危险；设备侧不应期待断链期间的命令被补发 |

- 重连成功后 HMI 只发**后续新产生的**动作帧；若设备侧需要恢复现场，应在上报事件中携带自身状态（如“动作 X 已完成/失败”），由 HMI 侧反馈映射处理。
- 设备**上电/复位**时：建议先静默等待串口稳定，再开始上报；HMI 收到噪声字节会触发 `decode_error`（有重同步能力，见 §4.5），不会因此崩溃。

### 3.3 发送队列与优先级

- 每个连接有两条写队列：`high`（容量 64 帧）与 `normal`（容量 256 帧）。队列满时命令报错（不静默丢弃）。
- 动作帧默认走 `normal`；workspace action 中 `dispatch.priority: "high"` 可走 `high`。设备侧无需区分，但须知**可能收到乱序的高优帧**（高优队列先写）。

### 3.4 单帧大小与时限建议

- HMI 读缓冲 4KB/次，帧无最小间隔要求，可连续发送。
- 设备完成动作后**应立即回帧**（HMI 侧步骤有 `timeoutMs` 超时，见 §5.3）。

---

## 4. HMIP v1 帧协议

### 4.1 设计定位

HMIP（HMI Binary Protocol v1）是串口/TCP 字节流之上的**帧封装**，解决拆包/粘包、噪声重同步与扩展问题。业务语义（动作/反馈）由上层 `msgType` + payload 自定义。

```
串口字节流
  └─ HMIP Frame（MAGIC + 头部 [+ CRC32] + payload）
        └─ Message（HELLO / REQUEST / RESPONSE / EVENT / ERROR / Raw）
              └─ body 字节（业务自定义）
```

### 4.2 帧格式（全部小端）

```
偏移        长度   字段            说明
[0..4)      4      MAGIC          固定 "HMIP"（0x48 0x4D 0x49 0x50）
[4]         1      VERSION        固定 1
[5]         1      MSG_TYPE       消息类型（§4.4）
[6]         1      FLAGS          bit0=1 表示头部带 PAYLOAD_CRC32
[7]         1      CHANNEL        通道号（多设备/多业务流区分，§5.1）
[8..12)     4      SEQ            u32 LE，发送序号（HMI 自动分配，从 1 自增）
[12..16)    4      PAYLOAD_LEN    u32 LE，payload 字节数（不含头部与 CRC 字段）
[16..20)    4      PAYLOAD_CRC32  u32 LE，仅当 FLAGS.bit0=1 存在
[20..]      N      PAYLOAD        N 字节
```

- 无 CRC 时头部 16 字节；带 CRC 时 20 字节。
- `SEQ`：HMI 下发帧自动分配；设备回帧建议回显请求帧的 SEQ（HMI 不强制校验）。
- `CHANNEL`：设备帧必须与设备在 workspace 中配置的 `transport.channel` 一致（§6.2），否则 HMI 匹配不到。

### 4.3 CRC32 约定

- `FLAGS` 当前只定义 `bit0 = 0x01`（`FLAG_CRC32`）。
- CRC32 = IEEE 标准 CRC-32（多项式 0xEDB88320，与 zlib crc32 一致），**仅覆盖 payload 字节**，结果按 u32 LE 存放。
- HMI 收到带 CRC 的帧会校验，不匹配时报 `decode_error`（丢弃该帧并尝试重同步）。
- 建议：设备回帧开启 CRC32（更易发现线路噪声）；调试初期可先不开启。

### 4.4 推荐消息类型与 payload 结构

| msg_type | 名称 | 方向建议 | payload 结构（LE） |
|---|---|---|---|
| `0x01` | HELLO | 设备 → HMI（可选） | `role(u8: 0=client,1=server) + capabilities(u32) + name_len(u8) + name(UTF-8)` |
| `0x02` | HELLO_ACK | 预留 | `capabilities(u32) + name_len(u8) + name(UTF-8)` |
| `0x03` | HEARTBEAT | 设备 → HMI（可选） | `timestamp_ms(u64)` |
| `0x10` | REQUEST | 预留（HMI 不用于动作下发） | `request_id(u32) + method(u16) + reserved(u16=0) + body` |
| `0x11` | RESPONSE | **设备 → HMI（推荐回帧）** | `request_id(u32) + status(u16) + reserved(u16=0) + body` |
| `0x20` | EVENT | 设备 → HMI（主动上报） | `event_id(u16) + reserved(u16=0) + timestamp_ms(u64) + body` |
| `0x7F` | ERROR | 设备 → HMI（异常报告） | `code(u16) + reserved(u16=0) + msg_len(u16) + message(UTF-8)` |
| 其他（如 `0x40`+） | 自定义 | HMI → 设备（动作帧） | 双方自定义 payload（§5.1） |

说明：

- `reserved` 字段固定填 0，为未来扩展预留。
- `body` 为业务自定义字节序列。
- 未知 `msgType` 的帧会被解析为 Raw 并记录（不丢弃），HMI 不会因未知类型断链。
- HMI 的动作下发帧使用**自定义 `msgType`**（非 `0x10` REQUEST），因此不携带 `request_id`；设备若内部需要配对，可用 `channel + SEQ` 作为事务标识。

### 4.5 拆包/粘包与重同步（HMI 解码器行为）

设备侧**无需做任何拆包处理**，只需按字节流写出完整帧：

- HMI 解码器内部缓冲，支持拆包（一次收半帧）与粘包（一次收多帧）。
- 数据不足等待；发现非 `MAGIC` 前缀时扫描下一个 `"HMIP"` 重同步，并丢弃噪声字节（上报 `decode_error` 及 `dropped_bytes`）。
- 版本不为 1、payload 长度异常、CRC 不匹配时均丢弃并对齐下一帧。

### 4.6 边界限制

| 项 | 限制 |
|---|---|
| 单帧 payload | ≤ 8 MB（超出判为异常帧丢弃） |
| 解码缓冲 | ≤ 16 MB（超限清空并报错） |
| UI 事件转发 | payload 前 2048 字节（base64），**仅影响调试显示，不影响解析与业务** |

---

## 5. 应用层交互模型

### 5.1 HMI → 设备：动作下发帧

recipe 步骤执行到设备动作时，HMI 发送一帧：

| 帧字段 | 取值来源 |
|---|---|
| `MSG_TYPE` | action `dispatch.msgType`（双方约定编号） |
| `FLAGS` | action `dispatch.flags`（0 或 0x01=CRC） |
| `CHANNEL` | 设备 `transport.channel` |
| `SEQ` | HMI 自动分配（1 起自增） |
| `PAYLOAD` | `payloadMode: fixedHex`（固定字节）或 `templateHex`（模板参数化，§6.3） |

**当前示例约定（dilution-machine）：**

| 动作 | msgType | payload（hex） | channel（示例） |
|---|---|---|---|
| 称量 weigh.start | `0x40` | `01 01` | 秤 = 1 |
| 搅拌 mix.start | `0x41` | `02 02` | 搅拌器 = 2 |
| 测粘度 viscosity.measure | `0x42` | `03 03` | 粘度计 = 3 |

> 以上编号与 payload 只是示例占位，接入真实设备时由双方重新定义并写进 workspace 的 `system/actions/*.json`（不需要改代码）。若动作需要携带参数（目标质量、转速、时长等），用 `payloadTemplate` 模板（§6.3.2）。

**多设备共线**：串口直连一设备时 `channel` 固定即可；若一条总线挂多个设备，设备侧须提供网关把 `channel` 路由到具体设备，HMI 侧按设备配置不同 `channel`。

### 5.2 设备 → HMI：反馈帧（核心契约）

设备收到动作帧后：

1. 执行动作；
2. 动作结束（成功或失败）后回一帧 **`RESPONSE`（msgType=0x11）**，字段建议：
   - `channel`：与请求帧相同（必须）；
   - `request_id`：建议把请求帧头部的 SEQ 回显写入此字段；当前 HMI 匹配**不强制校验**该值，主要用于日志核对与未来的严格配对（机制见 §5.6）；
   - `status`：**业务完成状态**——建议 `0`=成功、非 0=错误码（HMI 的 feedback mapping 可按 `status` 匹配，§6.4）；
   - `body`：可携带数值（如称量重量、粘度读数），HMI 支持把 body 提取为反馈值（base64/hex 字符串）。
3. 运行过程中的中间状态/异常：用 **`EVENT`（0x20）** 主动上报（`event_id` + 时间戳 + body）；协议级错误用 **`ERROR`（0x7F）**。

**HMI 侧匹配逻辑（feedback mapping）**：对每个收到的帧，按以下字段全部匹配（只填写的字段参与匹配）：

`connectionId`（必填）+ `channel` / `msgType` / `summaryKind`（hello|helloAck|heartbeat|request|response|event|error|raw）/ `requestId` / `status` / `eventId` / `errorCode`（均可选）

命中后把值写入：

- `signal_id`：写入逻辑信号；或
- `device_id + feedbackKey`：写入设备反馈（键经 `device.tags` 映射到 runtime 值，§6.2）；或
- 固定值 `value` / 或从帧中提取 `valueFrom`（支持：`channel`、`seq`、`msgType`、`flags`、`summary.requestId`、`summary.status`、`summary.eventId`、`summary.errorCode`、`summary.bodyBase64`、`summary.bodyHex`、`summary.payloadBase64`、`summary.payloadHex`）。

### 5.3 完成判定（HMI 侧）

设备回帧写入反馈值后，HMI 按 action 的 `completion` 判定动作完成：

- `type: deviceFeedback`：等待 `runtime_values[设备反馈键]` 满足 `operator`（`eq/ne/gt/ge/lt/le`）对 `value` 的比较，并可要求持续稳定 `stableTimeMs`；
- 步骤级 `timeoutMs` 超时未满足 → 步骤失败（按 `onError` 处理：`stop` 失败停机 / `ignore` 忽略继续）。

**建议的设备侧约定**：动作完成后回 `status=0` 的 RESPONSE 帧；mapping 用固定 `"value": true` 写反馈键，`completion` 用 `eq true`。失败路径回 `status=非0`，用另一条 mapping（`status` 匹配）写 `false` 或告警信号。

### 5.4 端到端时序（称量示例）

```
HMI                                 设备（秤, channel=1）
 │                                       │
 │ HMIP: 40 00 01 [seq=42] payload=01 01 │  动作下发
 │──────────────────────────────────────>│  设备开始称量
 │                                       │
 │ HMIP: 11 00 01 [seq=43] request_id=0  │  完成回帧
 │       status=0 body=(空或重量字节)      │
 │<──────────────────────────────────────│
 │ mapping 命中(channel=1, response,     │
 │   status=0) → 写入 scale_01.weight    │
 │ completion eq true 稳定 200ms         │
 │ 步骤完成，进入下一步                    │
```

### 5.5 心跳与在线检测

- HMI 不主动发心跳。设备可周期发 `HEARTBEAT`（0x03，`timestamp_ms` u64）或带 `event_id` 的 EVENT 帧；HMI 解码并记入事件日志。
- 若设备长时间静默，HMI 不会主动断链（链路判死条件见 §3.2）；联调期建议设备上电即周期上报，便于确认链路。

### 5.6 请求-响应对应机制（0x11 响应如何对应到请求）

HMI 当前**不依赖 `request_id`/`seq` 做事务级配对**，而是靠三个前提的组合实现“精确对应”：

1. **单在途动作**：runtime 单实例、recipe 步骤串行执行（`engine.rs` 顺序推进），同一时刻只有一个设备动作在等待反馈；
2. **channel 路由**：响应帧的 `channel` 决定它属于哪个设备（mapping 的 `match.channel` 过滤）；
3. **反馈键绑定**：命中的 mapping 把值写入该设备的反馈键（`device.tags` 映射），而当前步骤的 `completion` 等待的正是这个键。

对应链路：响应帧 → `channel` 找到设备 → `summaryKind/status/msgType` 找到对应 mapping → 写入当前步骤正在等待的反馈键 → 完成判定。等待逻辑是“先查当前值、再等变化”（`wait_for_condition`），响应早于等待开始到达也不会丢失。

**局限与规避：**

- 匹配不看 `seq`：同一设备相邻两个步骤（channel/status 相同）时，**迟到的重复响应可能误触发下一步骤的完成**。设备侧不得重发完成帧；若同一设备不同动作需要区分，请使用不同的 `status` / `eventId` / `msgType` 组合。
- **反馈键残留值**：动作完成后反馈键不会被自动清零。若下一步骤复用同一反馈键且完成条件相同，等待会在下发后第一次检查就满足，**跳过对本次响应的等待**。规避：相邻步骤使用不同的 `status`（配合 `valueFrom: summary.status`）/反馈键/`eventId`，或由 HMI 侧增加“动作下发前重置反馈键”（当前未实现）。
- `request_id` 与 `seq` 目前只用于观测：mapping 的 `match.requestId` 是**静态配置值**（不是本次请求动态生成的 id），帧头 `seq` 不参与匹配。
- 建议设备把请求帧头 SEQ 回显到响应帧头，并把 SEQ 写入 RESPONSE payload 的 `request_id` 字段：联调时可在事件日志里人工核对配对，也为将来 HMI 升级按 `seq`/`request_id` 严格配对留好数据。
- 若需要事务级严格配对（并发动作、防串扰），需在 HMI 侧增加“在途请求表 + 动态 seq/request_id 匹配”，当前未实现，属扩展点。

---

## 6. workspace 配置指南

设备开发/集成人员只需要改 workspace 下的 JSON 文件。目录结构：

```
workspace/
  system/
    actions/*.json          设备动作定义（msgType/payload/completion）
    device-types/*.json     设备类型（可选，声明允许的动作）
  projects/<project-id>/
    project.json
    connections/*.json      串口参数（本节 6.1）
    devices/*.json          设备实例（channel/tags，本节 6.2）
    feedback-mappings/*.json 回帧 → 信号/反馈的映射（本节 6.4）
    signals/*.json          逻辑信号（本节 6.5）
    safety/ interlocks.json / safe-stop.json
    recipes/*.json          recipe 步骤（动作+设备+超时）
```

校验规则：启动 recipe 时若存在 **error 级**诊断会拒绝启动；字段写错会给出指向具体文件的诊断信息。

### 6.1 `connections/*.json`（串口参数）

```json
{
  "id": "device-serial-1",
  "name": "设备串口连接",
  "enabled": true,
  "kind": "serial",
  "serial": {
    "port": "/dev/ttyUSB0",
    "baudRate": 115200,
    "dataBits": 8,
    "stopBits": 1,
    "parity": "none"
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` / `name` | 是 | 连接标识 / 名称 |
| `enabled` | 否 | 默认 `true` |
| `kind` | 是 | `serial`（本接口文档范围；HMIP 同样支持 `tcp`） |
| `serial.port` | 是 | 串口名 |
| `serial.baudRate` | 否 | 默认 9600，必须 > 0 |
| `serial.dataBits` | 否 | 默认 8，取值 5/6/7/8 |
| `serial.stopBits` | 否 | 默认 1，取值 1/2 |
| `serial.parity` | 否 | 默认 `none`，取值 none/even/odd |

### 6.2 `devices/*.json`（设备实例）

```json
{
  "id": "scale_01",
  "name": "原液秤",
  "typeId": "scale",
  "enabled": true,
  "transport": { "kind": "serial", "connectionId": "device-serial-1", "channel": 1 },
  "tags": { "weight": "scaleWeight" }
}
```

| 字段 | 说明 |
|---|---|
| `transport.kind` | 必须与 connection 的 `kind` 一致（`serial`） |
| `transport.connectionId` | 指向 §6.1 的 connection id |
| `transport.channel` | **强烈建议填写**：HMI 下发与匹配回帧都用它区分设备（0–255） |
| `tags` | 键值对：`反馈键 → runtime 值键`。action 的 `completion.key` 通过它找到 runtime 里的比较值 |

### 6.3 `system/actions/*.json`（动作定义）

#### 6.3.1 固定 payload 动作（示例）

```json
{
  "id": "weigh.start",
  "name": "称量",
  "targetMode": "required",
  "allowedDeviceTypes": ["scale"],
  "dispatch": {
    "kind": "hmipFrame",
    "msgType": 64,
    "flags": 0,
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
  }
}
```

| 字段 | 说明 |
|---|---|
| `dispatch.kind` | `hmipFrame`（串口动作）或 `gpioWrite`（GPIO 电平，另一条路径） |
| `dispatch.msgType` | **双方约定的动作编号**（下发给设备的帧 `MSG_TYPE`） |
| `dispatch.flags` | 可选，`0x01` 表示对 payload 启用 CRC32 |
| `dispatch.payloadMode` | `fixedHex`（固定字节）或 `templateHex`（模板，见 6.3.2） |
| `dispatch.payloadHex` | 固定 payload 的十六进制串（可含空格） |
| `dispatch.priority` | 可选 `high` / `normal`（默认 normal） |
| `completion.type` | `immediate`（立即完成）/ `deviceFeedback`（等设备反馈）/ `signalCompare`（等信号） |
| `completion.key` | `deviceFeedback` 时必填，对应 `devices/*.json` 的 `tags` 键 |
| `completion.operator` | `eq/ne/gt/ge/lt/le` |
| `completion.value` | 比较目标值（写入 runtime 的反馈值与它比较；`valueFrom: summary.status` 写入的 status 数值也可参与比较） |
| `completion.stableTimeMs` | 可选，值需持续稳定的毫秒数 |

#### 6.3.2 带参数的模板 payload（`templateHex`）

```json
{
  "id": "mix.start",
  "name": "搅拌",
  "targetMode": "required",
  "allowedDeviceTypes": ["mixer"],
  "parameters": [
    { "key": "rpm", "name": "转速", "type": "number", "required": true }
  ],
  "dispatch": {
    "kind": "hmipFrame",
    "msgType": 65,
    "payloadMode": "templateHex",
    "payloadTemplate": {
      "endian": "big",
      "fields": [
        { "type": "u8",  "value": 2 },
        { "type": "u8",  "value": 2 },
        { "type": "u16", "from": "parameters.rpm" }
      ]
    }
  },
  "completion": { "type": "deviceFeedback", "key": "running", "operator": "eq", "value": false }
}
```

- 字段类型：`u8/u16/u32/i8/i16/i32/f32/f64/enumU8/hex`；
- `endian`：`big`（默认）或 `little`；
- 字段值来源：`value` 固定值，或 `from` 取 `parameters.<key>`（recipe 步骤参数）、`runInputs.<key>`（运行输入）、`runtimeValues.<key>`、`signalValues.<key>`；
- `enumU8` 需配 `map`（字符串 → 数值）。

#### 6.3.3 `device-types/*.json`

```json
{ "id": "scale", "name": "电子秤", "allowedActions": ["weigh.start"] }
```

### 6.4 `feedback-mappings/*.json`（回帧 → 反馈）

```json
{
  "id": "scale_weight_feedback",
  "name": "秤反馈",
  "enabled": true,
  "match": {
    "connectionId": "device-serial-1",
    "channel": 1,
    "summaryKind": "response",
    "status": 0
  },
  "target": {
    "deviceId": "scale_01",
    "feedbackKey": "weight",
    "value": true
  }
}
```

| 部分 | 字段 | 说明 |
|---|---|---|
| `match` | `connectionId` | 必填，匹配来源连接 |
| `match` | `channel` / `msgType` / `summaryKind` / `requestId` / `status` / `eventId` / `errorCode` | 可选，全部满足才命中（只比较填写的字段） |
| `match.summaryKind` | 可选值 | `hello` `helloAck` `heartbeat` `request` `response` `event` `error` `raw` |
| `target` | `signalId` | 写入逻辑信号（与 `deviceId/feedbackKey` 二选一） |
| `target` | `deviceId` + `feedbackKey` | 写入设备反馈；`feedbackKey` 经设备 `tags` 映射到 runtime 值 |
| `target` | `value` | 固定值写入 |
| `target` | `valueFrom` | 从帧提取：`channel/seq/msgType/flags/summary.requestId/summary.status/summary.eventId/summary.errorCode/summary.bodyBase64/summary.bodyHex/summary.payloadBase64/summary.payloadHex` |

**推荐写法**：成功回帧 mapping 用 `match.status = 0` + `target.value = true`（或 `valueFrom: summary.status`），失败回帧 mapping 用 `match.status = 非0` 写 `false` / 告警信号。不同设备用 `channel` 区分；同一设备不同业务（如完成 vs 读数）用 `msgType` / `eventId` / `requestId` 区分。

### 6.5 `signals/*.json`（逻辑信号）

```json
{
  "id": "scale_weight",
  "name": "称量值",
  "dataType": "double",
  "source": "scaleWeight",
  "enabled": true
}
```

`source` 是 runtime 值键；设备 `tags` 的值、`valueFrom` 写入的 `signalId` 均可与此关联。`common.wait-signal` 步骤与联锁（`safety/interlocks.json`）都读信号值。

### 6.6 `recipes/*.json`（步骤）

```json
{
  "id": "dilute-70",
  "name": "70% 浓度稀释工艺",
  "steps": [
    {
      "id": "S010", "seq": 10, "name": "称量原液",
      "actionId": "weigh.start", "deviceId": "scale_01",
      "timeoutMs": 60000, "onError": "stop",
      "parameters": { }
    }
  ]
}
```

`timeoutMs` 是步骤级超时（含下发 + 等待反馈），设备必须在时限内回帧；`onError`：`stop`（默认，失败停机）/ `ignore`（忽略继续）。

---

## 7. 调试与联调方法

### 7.1 HMI 侧观测事件

| 事件 | 内容 | 用途 |
|---|---|---|
| `comm-event` | `connected / disconnected / reconnecting / rx / tx / error`（含字节数、base64 原始数据、UTF-8 预览、时间戳） | 判断链路状态、看原始字节流 |
| `hmip-event` | `message`（帧头 + 消息摘要）与 `decode_error`（错误信息 + 丢弃字节数） | 判断协议层是否正确 |

前端聚合位置：`useCommStore.commEventLog`、`useHmipStore.hmipEventLog`（各保留最近 200 条）；解码错误会映射为告警（10s 去重）。

### 7.2 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `comm-event: error`（打开端口失败） | 串口名错 / 被占用 / 无权限（Linux 需 dialout 组） | 核对 `port`，`ls -l /dev/tty*`，加入 dialout 组 |
| 反复 `reconnecting` | 写超时 / 串口持续空读（约 2s） | 检查设备是否回数据、线缆、波特率 |
| 大量 `decode_error`（magic not found / dropped bytes） | 波特率/数据位/校验不匹配、线路噪声 | 核对参数；示波器/逻辑分析仪看波形 |
| `CRC32 mismatch` | 双方 CRC 约定不一致（flags 未开 vs 已算） | 确认 CRC 只覆盖 payload、LE 存放 |
| 动作下发后步骤超时 | 设备没回帧 / `channel` 不对 / mapping 没命中 | 用 hmip 事件日志确认下发帧与设备回帧的 channel/status |
| 回帧被解析但步骤不完成 | `completion.key` 与设备 `tags` 键不一致、比较值/`valueFrom` 不符 | 核对 §6.2/§6.3/§6.4 配置 |

### 7.3 联调建议流程（checklist）

1. **物理层**：串口助手确认收发正常，波特率/数据位/停止位/校验与 HMI 配置一致。
2. **帧层**：设备发一条 HEARTBEAT/EVENT 帧，HMI 事件日志应出现对应 `hmip-event: message`（无 `decode_error`）。
3. **动作层**：手动触发一个 recipe（或前端命令发帧），确认设备收到且 HMI 日志显示 `tx`；设备回 RESPONSE，确认日志显示 `rx` + `message(summary kind=response)`。
4. **业务层**：确认 mapping 命中（runtime 快照中出现反馈值）、步骤完成、UI 状态推进。
5. **健壮性**：拔插串口验证重连（400ms→5s 退避）、断链期间命令丢弃、恢复后新命令正常。

---

## 8. 附录

### 8.1 完整帧 HEX 示例

**示例 1：HMI 下发“称量”动作帧（无 CRC）**

```
msgType=0x40, channel=1, seq=42, payload=01 01
48 4D 49 50  01  40  00  01  2A 00 00 00  02 00 00 00  01 01
└─ MAGIC ─┘   V  MT  FL  CH  └ SEQ=42 ┘  └ LEN=2 ──┘  └ payload
```

**示例 2：设备回 RESPONSE（无 CRC，status=0，body 为空）**

```
msgType=0x11, channel=1, seq=43,
payload = request_id(4)=0 + status(2)=0 + reserved(2)=0
48 4D 49 50  01  11  00  01  2B 00 00 00  08 00 00 00  00 00 00 00 00 00 00 00
```

**示例 3：同上带 CRC32（FLAGS=0x01，头部 20 字节）**

```
payload=01 01 的 CRC32 = 0x2FC51328（LE: 28 13 C5 2F）
48 4D 49 50  01  40  01  01  2A 00 00 00  02 00 00 00  28 13 C5 2F  01 01
└─ MAGIC ─┘   V  MT  FL  CH  └ SEQ ─┘  └ LEN ─┘  └ CRC32 ─┘  └ payload
```

**示例 4：设备回 RESPONSE（带 CRC，payload = 8 个 0x00）**

```
CRC32(00×8) = 0x6522DF69（LE: 69 DF 22 65）
48 4D 49 50  01  11  01  01  2B 00 00 00  08 00 00 00  69 DF 22 65  00 00 00 00 00 00 00 00
```

### 8.2 波特率与时间预算

单帧传输时间 ≈ 位数 / 波特率。以 `8N1` 每字节 10 bit 计：

| 波特率 | 帧开销（含 16B 头 + 8B payload ≈ 24B） | 100B payload 帧 |
|---|---|---|
| 9600 | ~25 ms | ~104 ms |
| 115200 | ~2.1 ms | ~8.7 ms |

recipe 步骤 `timeoutMs` 需要覆盖：下发 + 设备执行 + 回帧 + HMI 判定。低速波特率下不要把 `timeoutMs` 设得太紧。

### 8.3 与 TCP 的关系

HMIP 帧协议与传输无关：同一套帧格式在串口与 TCP 上通用。当前 `workspace/projects/dilution-machine/` 的示例用 TCP（`kind: "tcp"`），切换到真实串口只需把 connection 改为 `kind: "serial"` 并填 `serial` 参数，其余（devices/actions/mappings/recipes）全部不变。设备侧固件若同时支持串口与网口，可用同一套 HMIP 编解码。

### 8.4 当前实现边界（设备侧须知）

- HMI 侧 runtime 为**单实例**：同一时刻只运行一个 recipe。
- HMI **不主动握手/心跳**：设备不能把“收到 HELLO_ACK”作为上电同步点；设备侧应自行上电即工作、周期上报状态。
- 动作下发帧为**自定义 msgType 裸帧**（无 request_id、默认无 CRC）；若双方决定启用 REQUEST/RESPONSE 标准配对或 CRC，请在 workspace 的 action `dispatch`（flags）与本文档基础上扩展约定，并同步修改 HMI 侧 `dispatch.rs`（如需要）。
- 重连后**不补发**断线期间积压的帧（§3.2）；需要事务性保证的场景，设备侧应具备状态上报/查询能力。

### 8.5 常见疑问（FAQ）

- **Q：设备可以一次发多帧吗？** 可以，HMI 支持粘包，按顺序解析。
- **Q：`channel` 必须填吗？** 建议必填。同一 connection 下多个设备靠它区分；即使只有一个设备也建议固定一个值并写进设备与 mapping 配置。
- **Q：设备帧的 `SEQ` 怎么填？** 回帧建议回显请求帧 SEQ，并建议同时写入 RESPONSE payload 的 `request_id`；当前 HMI 仅用于日志核对、不参与匹配（见 §5.6）。主动上报自增即可。
- **Q：HMI 多久算一次链路死？** 连续约 2s 空读或单次写超时 2s（§3.2）。
- **Q：大 payload（如波形）怎么传？** 单帧最大 8MB；建议分片走 EVENT 帧，或走 TCP 通道。
- **Q：串口权限不足？** Linux 下把用户加入 `dialout` 组（`sudo usermod -aG dialout $USER`）后重新登录。
