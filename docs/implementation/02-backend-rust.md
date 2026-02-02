# 02 · 后端（Rust/Tauri）：启动、命令、通信与事件

本章聚焦 `src-tauri/src/`：后端如何启动、如何暴露命令（RPC），以及如何推送实时事件给前端。

## 1. 启动：从 main.rs 到 lib.rs

源码对应：

- `src-tauri/src/main.rs`：仅调用 `hmi_lib::run()`
- `src-tauri/src/lib.rs`：真正的 Tauri 初始化入口

字符画：入口调用链

```
src-tauri/src/main.rs
  fn main() {
    hmi_lib::run()
  }

src-tauri/src/lib.rs
  pub fn run() {
    tauri::Builder::default()
      ├─ plugin(log)
      ├─ plugin(shell)
      ├─ plugin(fs)
      ├─ invoke_handler(generate_handler![...commands...])
      ├─ setup(|app| app.manage(...state...))
      └─ run(generate_context!())
  }
```

### 1.1 插件安装（plugin）

源码对应：`src-tauri/src/lib.rs`

已安装插件（以代码为准）：

- `tauri-plugin-log`：日志统一输出到 Stdout（开发 Debug / 发布 Info）
- `tauri-plugin-shell`：用于打开外部资源等（前端可用）
- `tauri-plugin-fs`：文件系统读写能力（前端 `@tauri-apps/plugin-fs` 对应）

## 2. 命令（RPC）：commands.rs

命令的基本模式：

```
前端 invoke("connect_tcp", { config: {...} })
  └─ 后端 commands::connect_tcp(State<CommState>, tcp::TcpConfig) -> Result<(), String>
```

源码对应：

- 命令注册：`src-tauri/src/lib.rs`（`tauri::generate_handler![ ... ]`）
- 命令实现：`src-tauri/src/commands.rs`（`#[tauri::command]`）

### 2.1 get_log_dir：日志目录定位与创建

源码对应：`src-tauri/src/commands.rs`（`get_log_dir`）

行为要点：

- 开发模式：`env!("CARGO_MANIFEST_DIR")/Log`
- 发布模式：`resource_dir().parent()/Log`（父目录不存在则退化到 `resource_dir()/Log`）
- 若目录不存在：`create_dir_all`

字符画：目录选择逻辑

```
debug?
  ├─ yes -> <repo>/src-tauri/Log
  └─ no  -> <resource_dir>/../Log  (fallback: <resource_dir>/Log)
```

### 2.2 串口 / TCP 命令：连接状态存放在哪里？

后端用 `CommState` 保存 **Actor 句柄**（而不是直接持有连接对象）：

源码对应：

- `src-tauri/src/comm/mod.rs`：`CommState`
- `src-tauri/src/commands.rs`：`connect_serial/connect_tcp/...`

数据结构（概念）：

```
CommState
  serial: Arc<Mutex<Option<CommActorHandle>>>
  tcp:    Arc<Mutex<Option<CommActorHandle>>>
```

字符画：命令与状态的关系

```
connect_serial(config)
  ├─ serial::open_stream(config)
  ├─ spawn_serial_actor(app, config, stream) -> CommActorHandle
  └─ state.serial.lock().await = Some(handle)   (如有旧 handle，先 shutdown)

send_serial_data(bytes, priority?)
  ├─ lock serial -> 拿到 handle.tx_high/tx_normal
  ├─ priority=high -> try_send(tx_high)
  ├─ priority=normal(default) -> try_send(tx_normal)
  └─ else -> Err("Serial port not connected" / "write queue is full" / "connection is closed")
```

Actor 的额外价值：

- 统一 IO 循环（读/写/超时）与异常处理
- 自动重连（带退避），并通过 `comm-event` 把状态推送到前端
- 在读路径上尝试解析 HMIP 帧，并通过 `hmip-event` 推送协议事件（便于对接与观测）

### 2.3 前端日志批量转发：frontend_log_batch

源码对应：

- 后端命令：`src-tauri/src/commands.rs`（`frontend_log_batch`）
- 前端 hook：`src/hooks/useFrontendLogBridge.ts`（详见 `08-error-retry-logging.md`）

目的：

- 把 WebView 内的 console/error 汇总到 Rust log（target = `frontend`），便于终端过滤与调试。

### 2.4 HMIP：send_*_hmip_frame（前端 payload → Rust 封帧 → Transport 写入）

源码对应：

- `src-tauri/src/commands.rs`：`send_tcp_hmip_frame` / `send_serial_hmip_frame`
- `src-tauri/src/comm/proto.rs`：`encode_frame`（HMIP 头部 + 可选 CRC32）

命令参数（概念）：

```
HmipSendFrame {
  msg_type: u8,
  payload: Vec<u8>,
  flags?: u8,
  channel?: u8,
  seq?: u32,
  priority?: high|normal
}
```

行为要点：

- 若未指定 `seq`：后端生成自增序号（便于对端关联与日志定位）
- `flags & 0x01` 时：后端在帧头写入 `payload_crc32` 并做校验

> HMIP 协议细节见：`docs/implementation/11-hmip-binary-protocol.md`。

## 3. 通信实现：comm/actor.rs + comm/proto.rs + comm/serial.rs + comm/tcp.rs

源码对应：

- `src-tauri/src/comm/actor.rs`
- `src-tauri/src/comm/proto.rs`
- `src-tauri/src/comm/serial.rs`
- `src-tauri/src/comm/tcp.rs`

### 3.1 serial.rs：串口配置 + open_stream

要点：

- 使用 `tokio-serial` 构建串口参数（dataBits/stopBits/parity）
- `open_stream(config)` 打开 `SerialStream`
- `list_ports()` 枚举可用串口名

### 3.2 tcp.rs：TCP 配置 + open_stream

要点：

- `open_stream(config)`：`timeout(timeout_ms, TcpStream::connect(addr))`
- `set_nodelay(true)`：减少小包交互延迟（现场常见需求）

### 3.3 actor.rs：IO 循环 + 重连 + 事件推送

Actor 的职责：

- 管理单条连接的读写循环（读/写并发 + 写超时）
- 维护两级写队列（high/normal），支持控制/报警类消息优先写入
- 断线/异常时自动重连（带退避），并向前端 emit `comm-event`
- 在读路径上对字节流尝试解析 HMIP 帧，对解码结果 emit `hmip-event`

事件名：

- `comm-event`：connected/disconnected/reconnecting/rx/tx/error
- `hmip-event`：message/decode_error（含 dropped_bytes 与 message summary）

### 3.4 proto.rs：HMIP 协议（封帧/解帧/CRC/重同步）

proto 模块提供：

- `encode_frame(...)`：构造 HMIP 帧头并拼接 payload（可选 CRC32）
- `FrameDecoder`：支持拆包/粘包与 magic 重同步的流式解码器
- `decode_message(frame)`：把推荐 msg_type 解码为可观测的 Message（未知类型保留为 Raw）

> 协议细节（帧格式/消息 payload）见：`docs/implementation/11-hmip-binary-protocol.md`。

## 4. 事件推送：SensorSimulator 与 spectrum-data

本项目的实时数据目前来自“传感器模拟器”，以事件形式推送给前端。

源码对应：

- `src-tauri/src/sensor.rs`：`SensorSimulator` / `SpectrumData` / `app.emit("spectrum-data", ...)`
- `src-tauri/src/commands.rs`：`start_sensor_simulation/stop_sensor_simulation`
- `src/hooks/useSpectrumData.ts`：前端订阅（详见 `06-monitor-spectrum.md`）

### 4.1 事件数据结构：SpectrumData

后端结构：`src-tauri/src/sensor.rs`（`SpectrumData`）

字段要点：

- `timestamp`：毫秒时间戳
- `frequencies/amplitudes`：频率与幅值数组（同长度）
- `peak_frequency/peak_amplitude/average_amplitude`：后端已计算好的统计量

### 4.2 start() 如何生成并 emit？

字符画：事件生产链

```
SensorSimulator::start(app)
  ├─ running=true
  └─ spawn async task
       └─ loop every 50ms
            ├─ generate frequencies[256] (0..10kHz)
            ├─ synthesize amplitudes (multi-peak + noise)
            ├─ smooth_spectrum(window=3)
            ├─ compute peak/average
            └─ app.emit("spectrum-data", SpectrumData{...})
```

关键实现点：

- `running: AtomicBool`：用于 stop 信号
- `Notify`：用于“已停止”的通知（当前主要用于一致性与未来扩展）
- 当 `emit` 失败（窗口关闭）时：退出 loop，避免后台空转

### 4.3 stop() 如何终止？

源码对应：`src-tauri/src/sensor.rs`（`stop()`）

行为：`running.store(false, SeqCst)`  
被 spawn 的 loop 每次迭代都会检查 `running`，因此会自然退出。

## 5. 扩展建议：从“模拟数据”切换到“真实设备”

如果未来要接入真实设备数据，推荐保持“事件名 + payload 结构”稳定：

```
后端采集（串口/TCP/设备 SDK）
  └─ 仍 emit("spectrum-data", SpectrumData-compatible payload)

前端 useSpectrumData / Monitor 组件
  └─ 无需改动（或只做字段兼容）
```

这样能把变更收敛在后端采集模块，最大程度复用前端渲染与交互逻辑。
