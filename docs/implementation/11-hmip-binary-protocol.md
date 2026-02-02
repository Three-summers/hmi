# 11 · HMIP 二进制协议（HMI Binary Protocol v1）

本章用于说明项目新增的 **HMIP（HMI Binary Protocol v1）** 二进制协议：帧格式、推荐消息类型、CRC32 规则、以及前后端职责边界与事件流落点。

> 对照源码：
>
> - Rust：`src-tauri/src/comm/proto.rs`（封帧/解帧/CRC/重同步/消息 decode）
> - Rust：`src-tauri/src/comm/actor.rs`（字节流读取 → HMIP 解码 → emit `hmip-event`）
> - TS：`src/protocol/hmip.ts`（payload 编码工具）
> - TS：`src/types/hmip.ts`（前端事件类型）

---

## 1. 分层视角：TCP/Serial 字节流之上的“帧协议”

HMIP 的定位是“**字节流（TCP/Serial）上的帧封装**”，解决拆包/粘包、重同步与可扩展的问题：

```
TCP/Serial (bytes stream)
  └─ HMIP Frame (MAGIC + header + payload [+ CRC32])
        └─ Message (HELLO/REQUEST/EVENT/...)
              └─ body bytes (业务自定义)
```

在当前实现中：

- **Rust 侧**负责帧封装与解码（包含 CRC32 校验与重同步策略）
- **前端**主要负责“payload 编码”和“命令参数构造”，通过 Tauri command 把 payload 交给后端封帧并写入串口/TCP

---

## 2. 帧格式（小端）

帧格式在 Rust 侧定义为固定头部 + 可选 CRC：

```
[0..4)   MAGIC = "HMIP"
[4]      VERSION = 1
[5]      MSG_TYPE (u8)
[6]      FLAGS (u8)     bit0=CRC32(payload) present
[7]      CHANNEL (u8)
[8..12)  SEQ (u32 LE)
[12..16) PAYLOAD_LEN (u32 LE)
[16..20) PAYLOAD_CRC32 (u32 LE)  仅当 FLAGS.CRC32=1 存在
[..]     PAYLOAD bytes
```

关键约定：

- **小端（LE）**：`SEQ`、`PAYLOAD_LEN`、以及所有“推荐消息类型”的字段均按小端编码
- **payload_len** 是 payload 的长度（不含头部与 crc 字段）
- **CRC32**（若启用）仅覆盖 payload 字节

---

## 3. FLAGS 与 CRC32

当前仅定义一个 flags 位：

- `FLAG_CRC32 = 0x01`：表示头部包含 `PAYLOAD_CRC32` 字段，并对 payload 做 CRC32 校验

建议：

- “控制/状态类”消息：开启 CRC32（更易定位线路噪声/串口干扰）
- “调试/临时对接”消息：可先不开启，稳定后再打开

---

## 4. 推荐消息类型与 payload 结构

Rust 侧给出一组推荐 `MSG_TYPE`（也允许自定义）：

| msg_type | 名称 | 说明 | payload 结构（LE） |
| --- | --- | --- | --- |
| `0x01` | HELLO | 握手：声明角色与能力 | `role(u8) + capabilities(u32) + name_len(u8) + name(utf8)` |
| `0x02` | HELLO_ACK | 握手应答 | `capabilities(u32) + name_len(u8) + name(utf8)` |
| `0x03` | HEARTBEAT | 心跳 | `timestamp_ms(u64)` |
| `0x10` | REQUEST | 请求 | `request_id(u32) + method(u16) + reserved(u16=0) + body(bytes...)` |
| `0x11` | RESPONSE | 响应 | `request_id(u32) + status(u16) + reserved(u16=0) + body(bytes...)` |
| `0x20` | EVENT | 事件 | `event_id(u16) + reserved(u16=0) + timestamp_ms(u64) + body(bytes...)` |
| `0x7F` | ERROR | 协议错误 | `code(u16) + reserved(u16=0) + msg_len(u16) + message(utf8...)` |

说明：

- `reserved` 字段用于未来扩展，当前固定为 0
- `body` 为业务自定义字节序列（建议在业务层自定义“method / event_id”枚举与 body 编码规则）

---

## 5. 前端：payload 编码与发送方式

### 5.1 payload 编码工具（TS）

前端提供 `src/protocol/hmip.ts` 用于编码推荐消息类型的 payload：

- `encodeHelloPayload({ role, capabilities, name })`
- `encodeHelloAckPayload({ capabilities, name })`
- `encodeHeartbeatPayload({ timestampMs })`
- `encodeRequestPayload({ requestId, method, body })`
- `encodeResponsePayload({ requestId, status, body })`
- `encodeEventPayload({ eventId, timestampMs, body })`
- `encodeErrorPayload({ code, message })`

注意：

- 这些函数只负责编码 **payload**，不包含 HMIP 帧头（MAGIC/version/len/crc 等）
- 帧封装由 Rust 侧完成（见下一节）

### 5.2 发送命令（TS → Rust → TCP/Serial）

前端通过 `commStore` 暴露的 API 发送 HMIP 帧：

- `useCommStore.getState().sendTcpHmipFrame(frame)`
- `useCommStore.getState().sendSerialHmipFrame(frame)`

其中 `frame` 结构（见 `src/types/hmip.ts`）：

- `msgType`：对应 HMIP `MSG_TYPE`
- `payload`：`number[] | Uint8Array`（将被转换为 `number[]` 传给 Rust）
- 可选：`channel`、`flags`、`seq`、`priority`

---

## 6. 后端：封帧/解帧、重同步与事件推送

### 6.1 封帧（Rust command）

后端命令：

- `send_tcp_hmip_frame`
- `send_serial_hmip_frame`

行为要点：

- 若前端未指定 `seq`：后端用自增计数生成 `SEQ`
- 用 `proto::encode_frame(...)` 写入 HMIP 头部，并在需要时计算 CRC32
- 写入到 Actor 的写队列（支持 `high/normal` 优先级）

### 6.2 解帧（字节流 → Frame）

后端使用 `FrameDecoder` 解析字节流：

- 支持拆包/粘包：buffer 累积数据，不足则等待
- 支持重同步：当出现噪声/错位时，扫描 `MAGIC="HMIP"` 尝试重新对齐
- 支持上限：`max_payload_len` 与 `max_buffer_len` 防止 buffer 失控增长

### 6.3 解码（Frame → Message）

在成功解析 `Frame` 后，Rust 侧会按 `msg_type` 解码为推荐的 `Message`：

- `Hello/HelloAck/Heartbeat/Request/Response/Event/Error`
- 未识别的 `msg_type` 则保留为 `Raw`

### 6.4 事件推送：`hmip-event`

后端在 `src-tauri/src/comm/actor.rs` 中把 HMIP 解码结果通过 Tauri event 推送到前端：

- `hmip-event`：
  - `decode_error`：解码/重同步错误（包含 `dropped_bytes`）
  - `message`：成功解析的帧（包含 header 字段与 message summary）

为避免把大 payload 直接塞进事件导致 UI 卡顿，后端对 payload base64 做了大小截断（详见 `HMIP_PAYLOAD_EMIT_MAX`）。

---

## 7. 前端：hmip-event 的消费入口（桥接 Hook + Store）

推荐的数据流：

```
Rust actor
  ├─ emit("comm-event", ...)  (连接/收发/错误)
  └─ emit("hmip-event", ...)  (HMIP 解码结果)

MainLayout
  ├─ useCommEventBridge()  -> useCommStore.handleCommEvent + 告警映射
  └─ useHmipEventBridge()  -> useHmipStore.handleHmipEvent + 告警映射
```

这样可以确保：

- **业务视图无需自行 listen**（避免 Keep-Alive 下隐藏页面泄漏订阅）
- Store 只做“读模型聚合”，告警语义由 bridge 统一做映射与去重

---

## 8. 调试建议（对接期）

1) 首先确认连接事件是否到达：查看 `comm-event`（connected/reconnecting/error）

2) 再确认协议解码是否稳定：

- 出现连续 `decode_error`：优先检查线路噪声、波特率/串口参数、对端是否严格按 HMIP 帧格式发送
- 出现 `CRC32 mismatch`：检查 flags 是否开启 CRC、以及对端 CRC 计算是否仅覆盖 payload

3) 如果需要在 UI 上快速查看近期事件，可使用：

- `commStore.commEventLog`
- `hmipStore.hmipEventLog`

