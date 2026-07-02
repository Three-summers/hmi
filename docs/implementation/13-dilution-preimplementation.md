# 13 · 光阻稀释预实现设计：通用工艺后端补强与 dilution 领域层落地

> 更新日期：2026-07-01
> 范围：基于 `docs/project_env.md` 的光阻稀释需求，对照当前 `src-tauri/src/` 后端实现，给出可落地的预实现方案。

本文回答一个实现决策问题：**现有通用 recipe 后端是否只要叠加一层领域层就能满足光阻稀释项目？**

结论是：不能只加领域层。当前 `craftsmanship` 后端已经适合作为设备工艺执行内核，但要进入现场闭环，还需要补齐少量通用后端能力，再新增 `dilution` 领域层承接批次业务、PRMS、条码、报表和追溯。合理边界是：

```txt
通用工艺后端：执行动作、管理连接、等待反馈、联锁、安全停机、运行事件
dilution 领域层：批次、扫码、mapping、配方锁定、计量计算、粘度、PRMS、打印、报表
```

这样做的原因是：设备动作执行与业务追溯的变化频率不同。阀门、泵、搅拌、粘度计触发属于可复用执行能力；PRMS mapping、同批次光阻一致性、非整瓶二次使用、Dilution Barcode、补账和报表属于格科光阻稀释业务规则，不应塞进通用 recipe runtime。

## 1. 源码现状：当前已经具备什么

### 1.1 Tauri 后端已经注册工艺运行能力

源码对应：

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/craftsmanship/mod.rs`

`lib.rs` 在 `tauri::Builder` 中注册了工艺命令，并在 `setup()` 中注入 `RecipeRuntimeManager`：

```txt
commands::craftsmanship_scan_workspace
commands::craftsmanship_get_project_bundle
commands::craftsmanship_get_recipe_bundle
commands::craftsmanship_runtime_load_recipe
commands::craftsmanship_runtime_start
commands::craftsmanship_runtime_stop
commands::craftsmanship_runtime_get_status
commands::craftsmanship_runtime_write_signal
commands::craftsmanship_runtime_write_device_feedback
```

这说明 `craftsmanship` 不是文档概念，已经是可被前端 invoke 的后端能力。领域层可以直接调用同一套 Rust API，也可以通过 Tauri command 暴露给前端。

### 1.2 workspace 模型已经能表达系统动作、项目设备、连接、反馈映射和 recipe

源码对应：

- `src-tauri/src/craftsmanship/types.rs`
- `src-tauri/src/craftsmanship/loader.rs`
- `src-tauri/src/craftsmanship/validation.rs`

当前识别的 workspace 结构：

```txt
workspace/
  system/
    actions/*.json
    device-types/*.json
    schemas/*.json

  projects/
    <project-id>/
      project.json
      connections/*.json
      devices/*.json
      feedback-mappings/*.json
      signals/*.json
      safety/interlocks.json
      safety/safe-stop.json
      recipes/*.json
```

关键类型：

- `ActionDefinition`：动作定义，包含参数 schema、completion、dispatch。
- `ConnectionDefinition`：连接定义，当前支持 TCP/serial 配置。
- `DeviceInstance`：设备实例，包含 `transport` 和 `tags`。
- `FeedbackMappingDefinition`：把 HMIP 消息映射成 signal 或 device feedback。
- `SignalDefinition`：运行时可等待、可联锁的逻辑信号。
- `RecipeDefinition` / `RecipeStep`：顺序工艺步骤。
- `SafeStopDefinition`：异常后固定安全停机步骤。

这部分可以直接承载光阻稀释机台的设备动作层，例如：

- 原液阀门打开/关闭。
- PGMEA 供液阀门打开/关闭。
- 泵启动/停止。
- 搅拌机启动/停止。
- 粘度计触发测量。
- 出料阀门打开/关闭。
- 气泡计、EMO、液位、流量累计等信号联锁。

### 1.3 静态校验已经能挡住很多工程配置错误

源码对应：`src-tauri/src/craftsmanship/validation.rs`

当前校验覆盖：

- action/device type 是否重复、引用是否存在。
- action 参数类型是否为 `number/string/boolean/enum`。
- recipe step 是否引用未知 action、未知 device、未知 signal。
- `targetMode=required` 时是否绑定 `deviceId`。
- dispatch action 是否缺少设备、transport 或 connection。
- completion 的 `deviceFeedback` / `signalCompare` 字段是否完整。
- interlock 条件是否合法。
- feedback mapping 是否引用真实 connection、device、signal。

这对后续现场调试很重要。光阻稀释设备会有多个阀、泵、计量、粘度计和厂务信号，如果配置错误能在启动前报 diagnostics，问题定位成本会低很多。

### 1.4 runtime 已能顺序执行 recipe、等待反馈、联锁和 safe-stop

源码对应：

- `src-tauri/src/craftsmanship/runtime/types.rs`
- `src-tauri/src/craftsmanship/runtime/manager.rs`
- `src-tauri/src/craftsmanship/runtime/engine.rs`
- `src-tauri/src/craftsmanship/runtime/dispatch.rs`

运行模型：

```txt
load_recipe()
  -> get_recipe_bundle()
  -> RecipeRuntimeSnapshot::from_bundle()
  -> status = Loaded

start()
  -> 拒绝包含 error diagnostics 的 bundle
  -> reset_for_run()
  -> spawn run_recipe()

run_recipe()
  -> execute_recipe_steps()
  -> 每步先 validate_interlocks()
  -> begin_step()
  -> dispatch / delay / wait-signal / completion
  -> complete_step() 或 fail_step()
  -> onError=safe-stop 时执行 safe_stop.steps
```

当前 runtime snapshot 已包含：

- `status`：`Idle/Loaded/Running/Stopping/Completed/Failed/Stopped`
- `phase`：`Recipe/SafeStop`
- recipe 与 project 标识。
- 每个 recipe step / safe-stop step 的状态和开始结束时间。
- `signal_values` 和 `runtime_values`。
- diagnostics、last error、last message。

这已经能支撑“设备执行层”的最小闭环。

### 1.5 通信层已经支持 TCP/串口连接复用、HMIP 封帧和反馈桥接

源码对应：

- `src-tauri/src/comm/mod.rs`
- `src-tauri/src/comm/actor.rs`
- `src-tauri/src/comm/proto.rs`
- `src-tauri/src/craftsmanship/runtime/manager.rs`

已有能力：

- 连接按 `connection_id` 管理。
- 相同连接配置复用，配置变化时替换旧 actor。
- TCP/serial 都有 high/normal 两级发送队列。
- HMIP 帧支持 magic、version、msg_type、flags、channel、seq、payload_len、可选 CRC32。
- actor 解码 HMIP 后会 emit `hmip-event`，并调用 `RecipeRuntimeManager::apply_hmip_feedback_with_app()`。
- `feedback-mappings` 可以把 HMIP 消息映射到 signal 或 device feedback，进而推动 runtime step 完成。

这意味着：如果现场设备控制器愿意使用 HMIP 或可通过网关转换成 HMIP，阀门/泵/粘度计等反馈能直接进入 recipe runtime。

### 1.6 STM32/HMIP 网关模式已经贴合当前实现，树莓派直连设备还缺驱动层

当前实现最贴合的现场拓扑是：

```txt
Rust / Tauri
  -> comm serial / TCP
  -> HMIP
  -> STM32
  -> 多个现场设备：阀、泵、流量计、搅拌机、粘度计、气泡计等
```

在这种模式下，Rust 端只需要理解 HMIP，具体设备协议、脉冲计数、实时 IO、强安全联动都可以放在 STM32 固件中完成。`craftsmanship` 的 `hmipFrame` dispatch 和 `feedback-mappings` 能自然表达“向 STM32 下发动作，等待 STM32 返回设备反馈”。

但如果某些设备不经过 STM32，而是直接接在树莓派上，并使用自己的协议，当前后端还不够完整：

```txt
树莓派 serial -> 流量计 ASCII/私有二进制协议
树莓派 RS485  -> Modbus RTU 设备
树莓派 TCP    -> 粘度计私有协议
树莓派 USB/串口/TCP -> 打印机 ZPL/TSPL 或厂商协议
树莓派 GPIO input -> 限位、EMO、气泡计开关量
```

当前 `comm` 能提供 TCP/serial 原始收发、连接复用和 HMIP 编解码；`dispatch.rs` 能做 `hmipFrame` 和 `gpioWrite`。它缺少的是“非 HMIP 设备驱动层”：

- 自定义协议 codec：帧头、长度、CRC、转义、ASCII 行协议等。
- 请求/响应匹配：request id、超时、重试、乱序或重复响应处理。
- 周期轮询：流量计、粘度计、状态寄存器等。
- 协议解析后的统一事件：把设备原始响应转换成 signal / device feedback。
- 直连设备的 command dispatch：让 recipe step 可以调用某个 driver 命令，而不是只能发 HMIP 固定帧。
- GPIO 输入：当前已有 GPIO 写输出，缺少输入读取、边沿监听和去抖后的 signal 更新。

因此后续架构应同时支持两种设备接入方式：

```txt
方式 A：STM32/HMIP 网关
  - 推荐用于强实时、多 IO、阀泵联动、脉冲计数、安全停机
  - Rust 端通过 HMIP action 控制，反馈经 feedback-mappings 进入 runtime

方式 B：树莓派直连驱动
  - 适合低实时、协议清晰、独立设备
  - Rust 端通过 device driver 编解码设备协议，再把结果映射到 runtime
```

### 1.7 SECS RPC 已经有基础封装，但不是 PRMS 业务接口

源码对应：

- `src-tauri/src/secs_rpc.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/proto/secs/rpc/v1/secs_rpc.proto`
- `src/platform/secsRpc.ts`

当前 SECS RPC 能创建/启动/停止 session，发送或请求 SECS message envelope。它适合对接需要 SECS/HSMS 的设备或系统，但 `project_env.md` 里的 PRMS 需求是业务级接口：

- 扫码后查询原液/机台/稀释液 mapping。
- 上传粘度值。
- 发送稀释瓶数。
- 接收 Dilution Barcode。

这些不是当前 `secs_rpc` 模块已经建好的业务方法。后续可以复用 SECS RPC 作为底层 transport，但仍然需要 `PrmsClient` 领域适配层。

### 1.8 前端 Recipes 页面仍是静态 demo

源码对应：`src/components/views/Recipes/index.tsx`

当前 `RecipesView` 使用 `demoRecipes` 本地数组；“新建/加载/编辑/删除”按钮只弹通知，没有调用 `craftsmanship_*` 后端命令。这意味着：

- 后端工艺运行能力已经存在。
- 生产级 recipe 管理/运行界面还没有接入。
- 光阻稀释 HMI 应新增领域页面，或者重构 Recipes 页面接入后端 bundle 和 runtime。

## 2. 项目需求拆解：哪些是通用能力，哪些是领域能力

需求来源：`docs/project_env.md`

核心流程：

```txt
扫码原液 barcode
  -> PRMS mapping
  -> 原液上机校验
  -> 浓度选择 / recipe 锁定
  -> 抽取原液
  -> 按实际原液质量计算并抽取 PGMEA
  -> 搅拌
  -> 静置
  -> 粘度测试 2 次
  -> 平均值上传 PRMS
  -> 计算瓶数
  -> PRMS 创建/返回 Dilution Barcode
  -> 打印标签
  -> 定量出料并逐瓶记录
  -> 生成 Log 和报表
```

能力归属建议：

| 需求 | 建议归属 | 说明 |
| --- | --- | --- |
| 阀门、泵、搅拌机、粘度计触发、出料动作 | 通用 `craftsmanship` | 通过 action + device + recipe step 表达。 |
| 气泡计、EMO、液位、供液状态联锁 | 通用 `craftsmanship` | 通过 signal + interlock 表达。 |
| 按设备反馈推进步骤 | 通用 `craftsmanship` | 现有 deviceFeedback / signalCompare 可复用。 |
| 原液 barcode 解析和重复使用规则 | `dilution` 领域层 | 与光阻批次、非整瓶二次使用相关。 |
| PRMS mapping 查询 | `dilution` 领域层 | 业务接口，不是通用设备动作。 |
| 浓度选择和 recipe 锁定 | `dilution` 领域层 | 取决于 PRMS 返回、物料配置和 HMI 人工选择。 |
| 质量/体积/密度换算 | `dilution` 领域层 | 工艺计算规则，且仍有待确认项。 |
| 两次粘度值平均和 PRMS hold 结果 | `dilution` 领域层 | 粘度计动作可通用执行，结果处理属于业务。 |
| Dilution Barcode 创建、打印、顺序绑定 | `dilution` 领域层 | PRMS、打印、逐瓶出料记录必须保持一致。 |
| Log 1 年留存、报表、补账 | 领域层 + 通用 journal | 通用层记录运行事件，领域层记录批次业务事实。 |

## 3. 推荐总体架构

```txt
Frontend
  dilution views
  recipe/runtime views
        |
        | invoke / event listen
        v
Tauri commands
  dilution_* commands
  craftsmanship_* commands
        |
        v
+-----------------------------+
| dilution domain             |
| - Batch state machine       |
| - PRMS client               |
| - Recipe binding            |
| - Metering calculation      |
| - Viscosity decision        |
| - Barcode / print / report  |
+--------------+--------------+
               |
               | physical segment execution
               v
+-----------------------------+
| craftsmanship runtime        |
| - load recipe bundle         |
| - execute actions            |
| - interlock / safe-stop      |
| - signal / device feedback   |
+--------------+--------------+
               |
               | dispatch / feedback
               v
+-----------------------------+
| comm / adapters              |
| - TCP / Serial / HMIP        |
| - GPIO                       |
| - SECS RPC                   |
| - Device drivers/codecs      |
| - future printer / PRMS      |
+--------------+--------------+
               |
               v
设备 / PRMS / 打印机 / 报表系统 / 厂务供液系统
```

### 图解

**这张图回答什么问题**

它回答“新增光阻稀释功能时，业务规则应该放在哪里”。`craftsmanship` 继续做通用执行内核；`dilution` 做批次编排和外部业务系统交互。

**节点/层级说明**

- Frontend：操作员/核对员页面、扫码列表、批次状态、运行进度。
- Tauri commands：前端可调用的后端 API。
- `dilution domain`：新增领域层，是批次事实的唯一写入者。
- `craftsmanship runtime`：已有工艺运行时，是设备动作执行器，不直接理解 PRMS 或 Dilution Barcode。
- `comm / adapters`：已有 TCP/serial/HMIP/GPIO/SECS RPC；后续补 direct device drivers/codecs，并新增 PRMS、打印、报表适配。

**关键路径**

扫码、mapping、recipe 锁定和计量计算先进入 `dilution`；需要真实设备动作时，由 `dilution` 调用 `craftsmanship` 执行物理段；反馈再回到 runtime，完成后由 `dilution` 推进批次状态。

**分支/异常/变体**

PRMS、打印机、报表系统的失败不应该直接让通用 runtime 变复杂。它们由 `dilution` 领域层按批次状态处理：暂停、重试、人工确认、补账或失败。

**修改关注点**

不要把 `Batch`、`PrmsMapping`、`OutputBottle` 这类业务实体放进 `craftsmanship`。通用层只补执行所需的能力：动态参数、运行输入、运行事件持久化、人工 gate、外部反馈入口。

## 4. 通用后端需要补充的能力

### 4.1 动态 dispatch payload

#### 当前缺口

`ActionDispatchDefinition` 当前支持：

- `kind=hmipFrame`
- `payloadMode=fixedHex`
- `payloadHex`
- `kind=gpioWrite`
- 固定 boolean `value`

`validation.rs` 里还明确限制：使用 HMIP/GPIO dispatch 的 action 不允许有 action parameters，因为当前只支持固定 payload。`dispatch.rs` 的 `build_hmip_payload()` 也只接受 `fixedHex`。

这会挡住光阻稀释项目，因为许多动作必须携带运行期参数：

- 原液目标质量。
- 稀释剂目标质量。
- 出料目标质量。
- 粘度计采样 request id。
- 当前瓶序号。
- 设备通道或 recipe 版本。

#### 预实现方案

保留 `fixedHex`，新增动态 payload 模式：

```rust
pub struct ActionDispatchDefinition {
    pub kind: Option<String>,
    pub msg_type: Option<u8>,
    pub flags: Option<u8>,
    pub priority: Option<String>,
    pub payload_mode: Option<String>,
    pub payload_hex: Option<String>,
    pub value: Option<bool>,

    // 新增
    pub payload_template: Option<PayloadTemplateDefinition>,
}
```

建议第一阶段只支持两种动态模板，避免过度设计：

```txt
payloadMode = "templateHex"
  用字段片段生成二进制 payload，适合 HMIP 固定协议。

payloadMode = "json"
  把参数渲染成 JSON bytes，适合未来 TCP JSON 设备或调试网关。
```

`templateHex` 示例：

```json
{
  "id": "metering.start-target-mass",
  "name": "按目标质量启动计量",
  "targetMode": "required",
  "allowedDeviceTypes": ["metering-controller"],
  "parameters": [
    { "key": "materialLine", "name": "物料管路", "type": "enum", "required": true, "options": ["raw", "pgmea", "output"] },
    { "key": "targetMassG", "name": "目标质量", "type": "number", "required": true, "min": 0 },
    { "key": "toleranceG", "name": "允许误差", "type": "number", "required": true, "min": 0 }
  ],
  "dispatch": {
    "kind": "hmipFrame",
    "msgType": 16,
    "flags": 1,
    "priority": "high",
    "payloadMode": "templateHex",
    "payloadTemplate": {
      "endian": "little",
      "fields": [
        { "type": "u16", "value": 101 },
        { "type": "enumU8", "from": "parameters.materialLine", "map": { "raw": 1, "pgmea": 2, "output": 3 } },
        { "type": "f32", "from": "parameters.targetMassG" },
        { "type": "f32", "from": "parameters.toleranceG" }
      ]
    }
  },
  "completion": {
    "type": "deviceFeedback",
    "key": "done",
    "operator": "eq",
    "value": true
  }
}
```

运行时解析上下文：

```rust
pub struct StepInvocationContext<'a> {
    pub run_id: u64,
    pub project_id: &'a str,
    pub recipe_id: &'a str,
    pub step_id: &'a str,
    pub action_id: &'a str,
    pub step_parameters: &'a BTreeMap<String, Value>,
    pub run_inputs: &'a BTreeMap<String, Value>,
    pub runtime_values: &'a BTreeMap<String, Value>,
    pub signal_values: &'a BTreeMap<String, Value>,
}
```

字段来源优先级建议：

```txt
parameters.<key>      当前 step 参数
runInputs.<key>       本次运行输入
runtimeValues.<key>   运行时反馈值
signalValues.<key>    信号值
literal value         模板固定值
```

实现点：

- `types.rs` 增加 payload template 结构。
- `validation.rs` 放开动态 dispatch 的 action parameters 限制；仍然禁止 `fixedHex` action 带无意义参数。
- `dispatch.rs` 新增 `build_hmip_payload(context, action, dispatch, step)`。
- `runtime/tests.rs` 增加动态 payload 编码测试。

### 4.2 运行输入与 recipe 实例化

#### 当前缺口

当前 `craftsmanship_runtime_start()` 不接收本次运行输入。`RecipeDefinition` 是静态 JSON，step parameters 也在 JSON 里固定。

光阻稀释批次不同，运行参数也不同：

- 批次 ID。
- 原液 barcode 列表。
- 目标原液质量或瓶数。
- 实际原液质量。
- 按配比计算出的 PGMEA 目标质量。
- 出料目标质量和瓶数。
- PRMS 返回的 mapping id / recipe version。

这些不适合写死在 recipe JSON 里。

#### 预实现方案

新增运行输入类型：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeRunInput {
    pub correlation_id: Option<String>,
    pub operator_id: Option<String>,
    pub reviewer_ids: Vec<String>,
    pub parameters: BTreeMap<String, Value>,
    pub domain: Option<RecipeRuntimeDomainContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeDomainContext {
    pub domain_name: String,
    pub entity_id: String,
    pub entity_kind: String
}
```

命令可新增：

```txt
craftsmanship_runtime_start_with_input(input)
craftsmanship_runtime_get_status()
```

或者兼容当前命令：

```txt
craftsmanship_runtime_start(input?: RecipeRuntimeRunInput)
```

snapshot 增加：

```rust
pub run_input: Option<RecipeRuntimeRunInput>,
pub correlation_id: Option<String>,
```

领域层调用方式：

```txt
dilution_start_physical_segment(batchId, segment)
  -> 组装 RecipeRuntimeRunInput
  -> load_recipe(workspace, project, recipe_id)
  -> start_with_input(input)
  -> 监听 craftsmanship-runtime-event
  -> Completed 后推进 Batch 状态
```

这样 recipe JSON 保持“工艺模板”，领域层在运行时注入批次参数。

### 4.3 运行事件 journal

#### 当前缺口

runtime snapshot 是内存态。`get_log_dir` 只返回/创建 Log 目录，`tauri-plugin-log` 当前配置为 stdout。`project_env.md` 要求：

- 机台 Log 全信息记录。
- 步骤时间。
- 粘度原始值和平均值。
- 每瓶 Dilution Barcode 与出料质量。
- Log 留存 1 年。

这些不能只靠内存 snapshot。

#### 预实现方案

在通用层新增 append-only journal，专门记录运行事件；领域层另建批次事件和批次快照。

通用事件结构：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRuntimeJournalEvent {
    pub event_id: String,
    pub run_id: u64,
    pub timestamp_ms: u64,
    pub kind: RecipeRuntimeEventKind,
    pub project_id: Option<String>,
    pub recipe_id: Option<String>,
    pub phase: RecipeRuntimePhase,
    pub step_id: Option<String>,
    pub action_id: Option<String>,
    pub status: RecipeRuntimeStatus,
    pub message: Option<String>,
    pub failure: Option<RecipeRuntimeFailure>,
    pub snapshot_ref: Option<String>
}
```

第一阶段推荐文件实现，不引入数据库依赖：

```txt
Log/
  runtime/
    runs/
      <run_id>.jsonl
      <run_id>.snapshot.json
```

写入点：

- `load_recipe()`
- `start_with_input()`
- `begin_step()`
- `complete_step()`
- `fail_step()`
- `stop_step()`
- `finish_run()`
- `write_signal()`
- `write_device_feedback()`

后续如果需要快速查询、筛选、统计，再升级 SQLite。不要一开始把通用 runtime 和数据库绑定死，先定义 `JournalSink` trait：

```rust
#[async_trait]
pub trait RecipeRuntimeJournalSink: Send + Sync {
    async fn append(&self, event: RecipeRuntimeJournalEvent) -> Result<(), String>;
}
```

### 4.4 人工 gate、暂停、恢复与确认

#### 当前缺口

当前 runtime 支持：

- `start`
- `stop`
- `wait-signal`
- `write_signal`
- `write_device_feedback`

这些可以勉强表达“等待人工确认”：写一个 `common.wait-signal`，前端确认时调用 `write_signal()`。但这会把人工确认伪装成设备信号，审计信息不足：

- 谁确认。
- 为什么确认。
- 是否核对员确认。
- 确认前后的偏差值。
- 是否属于异常放行。

#### 预实现方案

通用层新增人工 gate 概念，但不放业务字段：

```rust
pub enum RecipeRuntimeStepStatus {
    Pending,
    Running,
    WaitingInput,
    Completed,
    Failed,
    Skipped,
    Stopped
}

pub struct ManualGateRequest {
    pub gate_id: String,
    pub step_id: String,
    pub title: String,
    pub reason_code: String,
    pub payload: BTreeMap<String, Value>,
    pub required_roles: Vec<String>
}

pub struct ManualGateResolution {
    pub gate_id: String,
    pub decision: String, // approve / reject / retry / abort
    pub operator_id: String,
    pub reviewer_ids: Vec<String>,
    pub comment: Option<String>
}
```

新增 command：

```txt
craftsmanship_runtime_resolve_gate(resolution)
```

领域层使用方式：

- 计量超差：`dilution` 判断超差，触发领域 gate；必要时也可以让 runtime 等待通用 gate。
- 打印失败：领域层记录打印异常，要求核对员确认重打。
- PRMS 失败：领域层要求人工选择重试、暂停或补账。

建议：**人工 gate 的业务判定放 `dilution`，通用 runtime 只提供可审计的等待与确认机制。**

### 4.5 外部反馈统一入口

#### 当前缺口

HMIP 反馈已经能通过 `apply_hmip_feedback()` 自动桥接到 runtime。但现场设备未必都走 HMIP：

- 扫码枪常见为 USB HID、串口或键盘输入。
- 流量计可能是串口 ASCII、Modbus RTU/TCP、脉冲量。
- 打印机可能是 TCP、USB、Windows spooler、ZPL/TSPL。
- PRMS/报表系统可能是 HTTP、SECS、Socket 或数据库中间表。

当前通用 runtime 虽然有 `write_signal()`，但没有统一说明“外部 adapter 如何进入运行系统”。

#### 预实现方案

保持通用 runtime 接口简单，新增 adapter 到 runtime 的桥接规范：

```rust
pub enum RuntimeExternalInput {
    Signal {
        signal_id: String,
        value: Value,
        source: String,
        timestamp_ms: u64
    },
    DeviceFeedback {
        device_id: String,
        feedback_key: String,
        value: Value,
        source: String,
        timestamp_ms: u64
    }
}
```

新增 command 或内部 API：

```txt
craftsmanship_runtime_apply_input(input)
```

第一阶段可直接复用现有 `write_signal()` / `write_device_feedback()`，但文档和类型上要明确：扫码枪、粘度计、流量计 adapter 进入领域层或 runtime 时都必须带 `source` 和 timestamp，便于追溯。

### 4.6 直连设备驱动与协议适配层

#### 当前缺口

当前后端的通信层更像“管道”：

```txt
serial / TCP bytes
  -> HMIP decoder
  -> hmip-event
  -> feedback-mappings
```

这对 STM32/HMIP 网关模式足够清晰，但对树莓派直连设备不够。直连设备需要 Rust 端直接理解设备协议，例如：

- 串口 ASCII：以 `\r\n` 结尾，命令如 `READ\r\n`，响应如 `MASS=123.45g`。
- 私有二进制：固定帧头、长度、CRC16、命令字、payload。
- Modbus RTU/TCP：寄存器读写、功能码、从站地址、CRC。
- 打印机协议：ZPL/TSPL 生成和发送，打印状态回读。
- GPIO 输入：读取开关量、边沿检测、去抖。

如果没有 driver 层，领域层或 recipe action 只能直接拼字节、手写解析、自己处理超时和重试，后续会快速变成不可维护的协议散落。

#### 预实现方案

新增通用模块：

```txt
src-tauri/src/device_drivers/
  mod.rs
  traits.rs
  registry.rs
  codecs/
    line_ascii.rs
    framed_binary.rs
    modbus.rs
  drivers/
    flowmeter_xxx.rs
    viscosity_xxx.rs
    printer_zpl.rs
    gpio_input.rs
```

核心边界：

```rust
#[async_trait]
pub trait DeviceDriver: Send + Sync {
    fn protocol_id(&self) -> &'static str;

    async fn dispatch(
        &self,
        ctx: DeviceDriverContext,
        command: DeviceDriverCommand,
    ) -> Result<DeviceDriverDispatchResult, DeviceDriverError>;

    async fn handle_rx(
        &self,
        ctx: DeviceDriverContext,
        bytes: &[u8],
    ) -> Result<Vec<DeviceDriverEvent>, DeviceDriverError>;
}

pub struct DeviceDriverCommand {
    pub command_id: String,
    pub device_id: String,
    pub parameters: BTreeMap<String, Value>,
    pub timeout_ms: Option<u64>,
}

pub enum DeviceDriverEvent {
    Signal {
        signal_id: String,
        value: Value,
        source: String,
        timestamp_ms: u64,
    },
    DeviceFeedback {
        device_id: String,
        feedback_key: String,
        value: Value,
        source: String,
        timestamp_ms: u64,
    },
    Measurement {
        device_id: String,
        measurement_key: String,
        value: Value,
        unit: Option<String>,
        timestamp_ms: u64,
    },
}
```

`craftsmanship` dispatch 扩展：

```txt
当前：
  hmipFrame
  gpioWrite

建议新增：
  driverCommand
```

action 示例：

```json
{
  "id": "flowmeter.read-total-volume",
  "name": "读取流量计累计体积",
  "targetMode": "required",
  "allowedDeviceTypes": ["flowmeter"],
  "parameters": [
    { "key": "resetAfterRead", "name": "读取后清零", "type": "boolean", "required": true }
  ],
  "dispatch": {
    "kind": "driverCommand",
    "driverProtocol": "flowmeter.ascii.v1",
    "commandId": "read-total-volume"
  },
  "completion": {
    "type": "deviceFeedback",
    "key": "volumeUpdated",
    "operator": "eq",
    "value": true
  }
}
```

device 示例：

```json
{
  "id": "flowmeter_01",
  "name": "原液流量计",
  "typeId": "flowmeter",
  "transport": {
    "kind": "serial",
    "connectionId": "flowmeter-serial"
  },
  "driver": {
    "protocol": "flowmeter.ascii.v1",
    "pollIntervalMs": 200,
    "requestTimeoutMs": 1000
  },
  "tags": {
    "volumeUpdated": "flowmeter_01.volume_updated",
    "actualVolumeMl": "flowmeter_01.actual_volume_ml"
  }
}
```

需要同步扩展的类型：

- `DeviceInstance` 增加 `driver` 配置。
- `ActionDispatchDefinition` 增加 `driver_protocol`、`command_id` 或 `driver_command`。
- `validation.rs` 校验 `driverCommand` 的 device 是否配置 driver、driver protocol 是否注册、transport kind 是否匹配。
- `dispatch.rs` 遇到 `driverCommand` 时调用 driver registry。
- `comm/actor.rs` 的 rx bytes 除 HMIP decoder 外，还要能转交给绑定该 connection 的 driver。

#### 与 STM32/HMIP 的边界

直连 driver 不是要替代 STM32。推荐规则：

| 设备/能力 | 推荐接入 |
| --- | --- |
| 阀门、泵、脉冲计数、联锁、安全停机 | STM32/HMIP |
| 高实时计量闭环 | STM32/HMIP |
| 扫码枪 | Rust direct adapter 或前端键盘输入 |
| 打印机 | Rust direct driver |
| 低频粘度计读取 | Rust direct driver 或 STM32/HMIP 均可 |
| Modbus 状态设备 | Rust direct driver 可行 |
| EMO、气泡计等安全输入 | 优先 STM32，Rust 可做只读监控 |

安全原则：只要动作失败可能造成设备危险状态，优先放 STM32，并让 STM32 自己具备安全停机能力。Rust direct driver 适合低频、独立、失败可恢复的设备。

### 4.7 错误策略从三档扩展为可恢复事件

#### 当前缺口

当前 step 的 `onError` 支持：

```txt
stop
ignore
safe-stop
```

这适合设备执行错误，不足以表达业务异常：

- PRMS mapping 查询失败后重试。
- PRMS 返回多浓度，等待人工选择。
- 计量超差，暂停并要求核对。
- 粘度两次差异过大，需要重测。
- 打印失败，需要重打或人工贴标确认。
- 报表发送失败，允许完成批次但保留待补传。

#### 预实现方案

通用 runtime 不直接处理 PRMS/打印/报表，但应把设备错误做成可审计事件，并支持 retry policy：

```rust
pub struct RecipeStepRetryPolicy {
    pub max_attempts: u32,
    pub backoff_ms: u64,
    pub retry_on_codes: Vec<String>
}
```

recipe step 可新增：

```json
{
  "id": "S020",
  "seq": 20,
  "name": "启动 PGMEA 计量",
  "actionId": "metering.start-target-mass",
  "deviceId": "metering_01",
  "parameters": { "targetMassG": 1200.0 },
  "timeoutMs": 300000,
  "onError": "safe-stop",
  "retry": { "maxAttempts": 2, "backoffMs": 1000 }
}
```

领域异常仍放 `dilution` 状态机处理，不通过 recipe step 的 `onError` 硬编码。

### 4.8 通用配置存取

#### 当前缺口

目前 workspace 配置覆盖工艺项目资源，但 `project_env.md` 需要的这些配置不属于纯设备资源：

- PRMS endpoint、认证、超时、重试。
- 报表系统 endpoint。
- 打印机名称、打印协议、模板。
- 机台编号，例如 `MCP-03`。
- Log 留存策略。
- 电子签名/权限策略。

#### 预实现方案

新增后端配置模块，不要直接散落在领域代码里：

```txt
src-tauri/src/config/
  mod.rs
  types.rs
  loader.rs
```

初始配置文件：

```txt
config/
  machine.json
  external-systems.json
```

示例：

```json
{
  "machineId": "MCP-03",
  "logRetentionDays": 365,
  "prms": {
    "mode": "mock",
    "endpoint": "http://127.0.0.1:8080",
    "connectTimeoutMs": 3000,
    "requestTimeoutMs": 15000,
    "maxRetries": 3
  },
  "printer": {
    "mode": "mock",
    "protocol": "zpl",
    "endpoint": "tcp://127.0.0.1:9100"
  },
  "report": {
    "mode": "mock",
    "endpoint": "http://127.0.0.1:8090"
  }
}
```

`craftsmanship` 继续读取 workspace；`dilution` 和外部 client 读取系统配置。

## 5. dilution 领域层预实现

### 5.1 模块结构

建议新增：

```txt
src-tauri/src/dilution/
  mod.rs
  commands.rs
  types.rs
  state_machine.rs
  repository.rs
  recipe_binding.rs
  metering.rs
  prms.rs
  printer.rs
  report.rs
  adapters.rs
  events.rs
  tests.rs
```

职责：

- `types.rs`：领域实体、状态、命令 payload、事件 payload。
- `state_machine.rs`：批次状态转换和守卫条件。
- `repository.rs`：批次快照、事件日志、幂等记录。
- `recipe_binding.rs`：PRMS mapping 到本地 `DilutionRecipe` / `craftsmanship` recipe 的绑定。
- `metering.rs`：质量、体积、密度、误差、瓶数计算。
- `prms.rs`：PRMS trait、mock 实现、真实实现接口骨架。
- `printer.rs`：打印 trait、mock 实现、真实实现接口骨架。
- `report.rs`：报表聚合与发送。
- `adapters.rs`：扫码枪、粘度计、流量计等输入适配。
- `events.rs`：向前端 emit `dilution-event`。

### 5.2 领域状态机

推荐以 `Batch` 为唯一业务主线。不要让 recipe runtime 直接成为批次状态机；runtime 是物理动作执行器。

```txt
Draft
  -> ScanningRawResist
  -> MappingResolved
  -> RecipeLocked
  -> RawLoading
  -> SolventLoading
  -> Mixing
  -> Settling
  -> ViscosityTesting
  -> ViscositySynced
  -> BarcodeRequested
  -> Printing
  -> Dispensing
  -> ReportPending
  -> Completed

任意关键状态
  -> Suspended
  -> Failed
  -> ManualReconcilePending
```

状态说明：

| 状态 | 允许动作 | 退出条件 |
| --- | --- | --- |
| `Draft` | 创建批次、登记机台/人员/计划 | 开始扫码 |
| `ScanningRawResist` | 扫原液 barcode、查询 PRMS mapping | 至少一条有效 mapping |
| `MappingResolved` | 展示可选浓度、校验同批原液类别 | 单浓度自动锁定或人工选择 |
| `RecipeLocked` | 冻结 `DilutionRecipe` 与本批参数 | 开始上料 |
| `RawLoading` | 执行原液抽取、记录实际质量 | 原液计量完成且偏差处理完成 |
| `SolventLoading` | 按实际原液质量计算 PGMEA 并抽取 | 稀释剂计量完成 |
| `Mixing` | 启动/监控搅拌 | 搅拌完成 |
| `Settling` | 静置倒计时 | 静置完成 |
| `ViscosityTesting` | 触发 2 次粘度测量 | 两次原始值齐全并算出平均值 |
| `ViscositySynced` | 上传 PRMS，记录 hold 结果 | 上传完成或进入待补传 |
| `BarcodeRequested` | 发送瓶数给 PRMS，获取条码 | 条码数量与瓶数匹配 |
| `Printing` | 打印标签、记录打印状态 | 标签全部打印或人工处理 |
| `Dispensing` | 逐瓶出料、逐瓶质量与条码绑定 | 所有瓶次完成，最后一瓶不足允许 |
| `ReportPending` | 生成并发送报表 | 报表发送成功或进入待补传 |
| `Completed` | 只读、可导出/追溯 | 无 |

重要规则：

- 相同原液 barcode 不能简单按重复扫码拦截，因为非整瓶上料后可能二次使用。
- 同一批次多瓶原液必须属于同一类光阻，否则 alarm 并禁止继续。
- 无论粘度是否符合 PRMS limit setting，都不影响 Dilution Barcode 生成；但 hold 结果必须记录。
- 最后一瓶不满瓶允许完成，但要在 `OutputBottle` 和报表中明确记录实际质量。

### 5.3 领域数据模型

#### Batch

```rust
pub struct Batch {
    pub id: String,
    pub machine_id: String,
    pub status: BatchStatus,
    pub operator_id: String,
    pub reviewer_ids: Vec<String>,
    pub created_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
    pub raw_scans: Vec<RawResistScan>,
    pub prms_mapping: Option<PrmsMapping>,
    pub selected_recipe: Option<DilutionRecipeSnapshot>,
    pub metering_records: Vec<MeteringRecord>,
    pub viscosity: Option<ViscosityTest>,
    pub output_bottles: Vec<OutputBottle>,
    pub prms_sync: Vec<PrmsSyncRecord>,
    pub report: Option<DilutionReport>,
    pub alarms: Vec<DilutionAlarm>,
}
```

`Batch` 是 HMI 页面展示、报表生成和补账的根对象。它必须能在程序重启后恢复。

#### RawResistScan

```rust
pub struct RawResistScan {
    pub scan_id: String,
    pub barcode: String,
    pub scanned_at_ms: u64,
    pub operator_id: String,
    pub material_name: Option<String>,
    pub lot_id: Option<String>,
    pub prms_query_id: Option<String>,
    pub validation_status: ScanValidationStatus,
    pub validation_message: Option<String>
}
```

扫码后不要只保留 barcode 字符串。必须记录扫描时间、人员、PRMS 查询关联和校验结果。

#### PrmsMapping

```rust
pub struct PrmsMapping {
    pub mapping_id: String,
    pub raw_resist_name: String,
    pub raw_resist_code: String,
    pub allowed_machine_ids: Vec<String>,
    pub dilution_options: Vec<DilutionOption>,
    pub returned_at_ms: u64,
    pub raw_payload: serde_json::Value
}

pub struct DilutionOption {
    pub concentration: String,
    pub dilution_resist_name: String,
    pub ratio: RatioDefinition,
    pub recipe_key: String,
    pub viscosity_min_cp: Option<f64>,
    pub viscosity_max_cp: Option<f64>
}
```

`raw_payload` 建议保留，便于现场接口变更和异常追溯。

#### DilutionRecipe

领域 recipe 不等于 `craftsmanship::RecipeDefinition`。它是光阻稀释业务配置，应该显式表达项目要求中的字段：

```rust
pub struct DilutionRecipe {
    pub id: String,
    pub version: String,
    pub raw_resist_name: String,
    pub concentration: String,
    pub dilution_resist_name: String,
    pub ratio: RatioDefinition,
    pub raw_density_g_per_ml: Option<f64>,
    pub solvent_density_g_per_ml: Option<f64>,
    pub mix_time_ms: u64,
    pub settle_time_ms: u64,
    pub viscosity_min_cp: Option<f64>,
    pub viscosity_max_cp: Option<f64>,
    pub standard_bottle_mass_g: f64,
    pub raw_load_segment_recipe_id: String,
    pub solvent_load_segment_recipe_id: String,
    pub mix_segment_recipe_id: String,
    pub viscosity_segment_recipe_id: String,
    pub dispense_segment_recipe_id: String
}
```

设计取舍：

- `DilutionRecipe` 负责业务参数。
- `craftsmanship` recipe 负责具体设备动作段。
- 领域层把业务参数作为 runtime input 注入工艺段。

#### MeteringRecord

```rust
pub struct MeteringRecord {
    pub id: String,
    pub kind: MeteringKind, // raw / solvent / output
    pub target_mass_g: Option<f64>,
    pub actual_volume_ml: Option<f64>,
    pub density_g_per_ml: Option<f64>,
    pub actual_mass_g: f64,
    pub tolerance_g: Option<f64>,
    pub deviation_g: Option<f64>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub source_device_id: String,
    pub runtime_run_id: Option<u64>,
    pub status: MeteringStatus
}
```

质量计算规则：

```txt
如果设备直接返回质量：
  actual_mass_g = device_mass_g

如果设备只返回体积：
  actual_mass_g = actual_volume_ml * density_g_per_ml

如果 density_g_per_ml 缺失：
  不允许默认按 1:1，除非 recipe 或系统配置明确声明 densityAssumption=oneToOneConfirmed
```

这对应 `project_env.md` 中“不能默认体积等于质量”的要求。

#### ViscosityTest

```rust
pub struct ViscosityTest {
    pub test_id: String,
    pub readings_cp: Vec<ViscosityReading>,
    pub average_cp: Option<f64>,
    pub local_result: Option<QualityResult>,
    pub prms_result: Option<PrmsHoldResult>,
    pub uploaded_at_ms: Option<u64>,
    pub sync_record_id: Option<String>
}

pub struct ViscosityReading {
    pub index: u8,
    pub value_cp: f64,
    pub measured_at_ms: u64,
    pub source_device_id: String
}
```

业务规则：

- 必须记录两次原始值。
- 平均值作为最终粘度上传 PRMS。
- 两次差异过大是否重测仍待确认；实现上应预留 `requires_retest` 状态。

#### OutputBottle

```rust
pub struct OutputBottle {
    pub index: u32,
    pub target_mass_g: f64,
    pub actual_mass_g: Option<f64>,
    pub dilution_barcode: Option<String>,
    pub barcode_status: BarcodeStatus,
    pub print_status: PrintStatus,
    pub dispensed_at_ms: Option<u64>,
    pub is_last_underfilled: bool,
    pub metering_record_id: Option<String>
}
```

条码、打印、出料质量必须按瓶序绑定，不能只在批次尾部存一个条码数组。

#### PrmsSyncRecord

```rust
pub struct PrmsSyncRecord {
    pub id: String,
    pub operation: PrmsOperation,
    pub idempotency_key: String,
    pub request_payload: serde_json::Value,
    pub response_payload: Option<serde_json::Value>,
    pub status: SyncStatus,
    pub attempt_count: u32,
    pub last_error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64
}
```

PRMS 相关操作必须具备幂等键，尤其是：

- 上传粘度。
- 发送瓶数。
- 创建/获取 Dilution Barcode。
- 补账或重试。

### 5.4 领域层命令草案

Tauri command 命名建议：

```txt
dilution_create_batch
dilution_get_batch
dilution_list_batches
dilution_scan_raw_resist
dilution_select_concentration
dilution_lock_recipe
dilution_start_raw_loading
dilution_start_solvent_loading
dilution_start_mixing
dilution_start_viscosity_test
dilution_record_viscosity_reading
dilution_upload_viscosity_to_prms
dilution_request_barcodes
dilution_print_bottle_label
dilution_start_dispense_bottle
dilution_complete_dispense_bottle
dilution_generate_report
dilution_send_report
dilution_resolve_alarm
dilution_retry_sync
dilution_export_batch
```

不要把所有动作做成一个巨大 `dilution_next()`。现场异常多，显式 command 更容易审计、测试和权限控制。

前端事件：

```txt
dilution-event
```

事件 payload：

```rust
pub struct DilutionEvent {
    pub event_id: String,
    pub batch_id: String,
    pub timestamp_ms: u64,
    pub kind: DilutionEventKind,
    pub status: BatchStatus,
    pub message: Option<String>,
    pub payload: serde_json::Value
}
```

## 6. 领域层如何调用通用 runtime

### 6.1 推荐：领域状态机为主，runtime 执行物理段

不要让一个超长 recipe 包含 PRMS 查询、打印、报表等业务动作。更稳妥的方式是：

```txt
dilution Batch state machine
  -> 调用 craftsmanship 执行 raw-load segment
  -> 读取实际计量结果并做业务计算
  -> 调用 craftsmanship 执行 solvent-load segment
  -> 调用 craftsmanship 执行 mix segment
  -> 调用 craftsmanship 执行 viscosity segment
  -> 调用 PRMS / printer / report client
  -> 调用 craftsmanship 执行 each bottle dispense segment
```

物理段 recipe 示例：

```txt
dilution-raw-load
  S010 打开原液阀
  S020 启动计量泵 targetMassG
  S030 等待计量完成 feedback
  S040 关闭原液阀

dilution-solvent-load
  S010 请求 PGMEA 供液
  S020 打开稀释剂阀
  S030 启动计量 targetMassG
  S040 等待计量完成
  S050 停止 PGMEA 供液

dilution-mix
  S010 启动搅拌 mixTimeMs
  S020 等待搅拌完成

dilution-viscosity
  S010 触发粘度计测量
  S020 等待粘度结果 signal

dilution-dispense-bottle
  S010 打开出料阀
  S020 计量 output targetMassG
  S030 关闭出料阀
```

### 6.2 为什么不建议一开始做“单个端到端 recipe”

端到端 recipe 看起来简单，但会把下面这些业务塞进通用 runtime：

- PRMS mapping 多解后等待人工选择。
- 非整瓶二次使用规则。
- 粘度上传 PRMS。
- Barcode 申请与打印。
- 报表失败待补传。
- Manual create / 补账。

这些动作不属于通用设备执行，且每个客户现场都可能不同。让 `dilution` 状态机主导，runtime 只负责物理段，边界更清楚。

### 6.3 物理段调用时的数据流

```txt
dilution_start_raw_loading(batch_id)
  -> repository.load(batch)
  -> calculate targetRawMassG / toleranceG
  -> runtime.load_recipe(raw_load_segment_recipe_id)
  -> runtime.start_with_input({
       correlationId: batch_id,
       parameters: {
         targetMassG,
         toleranceG,
         materialLine: "raw"
       },
       domain: {
         domainName: "dilution",
         entityKind: "batch",
         entityId: batch_id
       }
     })
  -> wait runtime Completed / Failed / Stopped
  -> collect MeteringRecord
  -> repository.append_event(...)
  -> batch.status = SolventLoading 或 Suspended
```

领域层不应通过轮询内存变量偷偷拿数据。推荐从两条路径收集结果：

- runtime journal：步骤开始/结束、设备动作状态。
- 设备 adapter/feedback：实际体积、质量、粘度值等测量事实。

## 7. PRMS、打印、报表与厂务接口

### 7.1 PRMS client

接口 trait：

```rust
#[async_trait]
pub trait PrmsClient: Send + Sync {
    async fn query_mapping(&self, request: QueryMappingRequest) -> Result<QueryMappingResponse, PrmsError>;
    async fn upload_viscosity(&self, request: UploadViscosityRequest) -> Result<UploadViscosityResponse, PrmsError>;
    async fn request_dilution_barcodes(&self, request: RequestDilutionBarcodesRequest) -> Result<RequestDilutionBarcodesResponse, PrmsError>;
}
```

请求必须包含：

- `machine_id`
- `batch_id`
- raw barcode 列表
- 原液名称/类型
- dilution concentration
- bottle count
- viscosity average
- idempotency key

实现策略：

- `MockPrmsClient`：先用于 UI/流程联调。
- `HttpPrmsClient`：如果 PRMS 提供 HTTP。
- `SecsPrmsClient`：如果 PRMS 经 SECS/HSMS 对接，复用现有 `secs_rpc`。
- `SocketPrmsClient`：如果 PRMS 是私有 TCP 协议，复用 `comm` 或新增轻量 client。

### 7.2 Printer client

接口 trait：

```rust
#[async_trait]
pub trait LabelPrinterClient: Send + Sync {
    async fn print_label(&self, request: PrintLabelRequest) -> Result<PrintLabelResponse, PrinterError>;
}
```

`PrintLabelRequest` 至少包含：

- batch id
- bottle index
- Dilution Barcode
- 稀释光阻名称
- 实际或目标质量
- 打印模板版本

打印失败处理：

- 记录 `OutputBottle.print_status = Failed`。
- 不自动跳过该瓶。
- 前端要求人工选择重试、作废标签或核对员确认。

### 7.3 Report client

报表字段按 `project_env.md` 9.3 生成。建议领域层先生成一个稳定内部结构：

```rust
pub struct DilutionReport {
    pub report_id: String,
    pub batch_id: String,
    pub dilution_date: String,
    pub raw_resist_name: String,
    pub raw_barcodes: Vec<String>,
    pub raw_mass_g: f64,
    pub raw_bottle_count: Option<f64>,
    pub machine_id: String,
    pub operator_id: String,
    pub reviewer_ids: Vec<String>,
    pub mix_started_at_ms: Option<u64>,
    pub mix_finished_at_ms: Option<u64>,
    pub viscosity_test_time_ms: Option<u64>,
    pub viscosity_average_cp: Option<f64>,
    pub dilution_resist_name: String,
    pub output_bottles: Vec<ReportBottleLine>,
    pub comment: Option<String>
}
```

发送格式由 adapter 决定：HTTP JSON、CSV、Excel、数据库或 SECS 都可以，但领域层内部结构保持稳定。

### 7.4 厂务供液系统

PGMEA 供液/停止信号更接近设备控制，可用 `craftsmanship` action 表达：

```txt
facility.pgmea-supply-start
facility.pgmea-supply-stop
```

但协议和 EMO 联动仍待确认。实现上预留：

- GPIO 点位控制。
- HMIP/TCP 控制。
- 只读供液状态 signal。
- EMO signal interlock。

## 8. 持久化设计

### 8.1 初始实现：文件型 repository

不引入新数据库依赖时，建议：

```txt
Log/
  dilution/
    batches/
      <batch_id>/
        batch.snapshot.json
        batch.events.jsonl
        prms-sync.jsonl
        report.json
```

优点：

- 使用现有 `serde_json` 和文件系统即可实现。
- 易于现场导出和人工排查。
- 与当前 `get_log_dir` 约定兼容。

约束：

- 查询历史批次需要扫描目录。
- 并发写要做文件锁或单 actor 串行写。

推荐实现方式：

- `DilutionRepository` 内部使用 `tokio::sync::Mutex` 保护每个 batch 写入。
- 所有状态变化先 append event，再写 snapshot。
- snapshot 写入使用临时文件 + rename，避免半写入。

### 8.2 后续实现：SQLite repository

如果现场需要复杂查询、报表重发、按 barcode 搜索历史，建议升级 SQLite：

```txt
batches
raw_resist_scans
metering_records
viscosity_tests
output_bottles
prms_sync_records
batch_events
reports
```

但这不是第一阶段必须项。先把 repository trait 定好，文件实现和 SQLite 实现可以替换。

## 9. 错误处理与人工介入

| 场景 | 检出层 | 默认动作 | 是否写 Log | 是否可重试 |
| --- | --- | --- | --- | --- |
| barcode 无法识别 | `dilution` | 拒绝加入批次，提示重扫 | 是 | 是 |
| PRMS mapping 查询失败 | `dilution` / `PrmsClient` | 状态进入 Suspended | 是 | 是 |
| PRMS 返回多浓度 | `dilution` | 等待人工选择 | 是 | 不适用 |
| 非机台设定光阻 | `dilution` | Alarm，禁止继续 | 是 | 扫其他 barcode |
| 同批原液类别不一致 | `dilution` | Alarm，禁止继续 | 是 | 移除错误扫描 |
| 流量计数据缺失 | adapter / runtime | 停止物理段，safe-stop | 是 | 视设备状态 |
| 计量超差 | `dilution` | 暂停，人工确认或报废 | 是 | 可补计量或确认 |
| PGMEA 供液失败 | runtime interlock | safe-stop 或暂停 | 是 | 是 |
| 气泡计异常 | runtime interlock | 阻止动作或 safe-stop | 是 | 现场确认 |
| 粘度计失败 | runtime / `dilution` | 暂停，允许重测 | 是 | 是 |
| 两次粘度差异过大 | `dilution` | 等待重测/人工确认 | 是 | 是 |
| PRMS 粘度上传失败 | `PrmsClient` | 保留待补传，不丢数据 | 是 | 是 |
| Barcode 创建失败 | `PrmsClient` | 暂停出料/打印 | 是 | 是 |
| 打印失败 | `PrinterClient` | 暂停对应瓶次 | 是 | 是 |
| 报表发送失败 | `ReportClient` | 批次可完成但标记待补传 | 是 | 是 |

原则：

- 设备安全错误优先走 `craftsmanship` safe-stop。
- 业务同步错误优先进入 `dilution` 的 Suspended / PendingSync 状态。
- 所有人工确认必须记录人员、时间、原因、前后数据。

## 10. 与 HMI 页面的关系

`project_env.md` 建议的页面状态可以直接对应领域状态机：

```txt
批次初始化       -> Draft
扫码上料         -> ScanningRawResist / MappingResolved
recipe 锁定      -> RecipeLocked
上料计量         -> RawLoading / SolventLoading
PGMEA 供液       -> SolventLoading 中的设备状态卡片
搅拌静置         -> Mixing / Settling
粘度测试         -> ViscosityTesting / ViscositySynced
出料打印         -> BarcodeRequested / Printing / Dispensing
Log/报表         -> ReportPending / Completed / PendingSync
```

前端建议新增 `Dilution` 视图，不要直接把全部逻辑塞进现有 `Recipes` 视图。`Recipes` 更适合管理工艺模板；`Dilution` 是操作员按批次执行的业务工作台。

## 11. 分阶段实施路线

### 阶段 0：mock 闭环与文档冻结

目标：

- 定义 `dilution` 类型、状态机和 command。
- `MockPrmsClient`、`MockPrinterClient`、`MockReportClient`。
- 用文件 repository 保存 batch snapshot/events。
- 前端能走完整模拟流程。

不依赖真实设备，不改动 HMIP 协议。

### 阶段 1：通用后端补强

目标：

- `craftsmanship_runtime_start_with_input()`。
- 动态 HMIP payload。
- runtime journal。
- 更清晰的 external input bridge。
- 可选人工 gate。
- `driverCommand` dispatch 类型与 `device_drivers` registry 骨架。

这一阶段让领域层可以把批次参数干净注入物理段 recipe。

### 阶段 2：直连设备驱动基础能力

目标：

- 增加 `DeviceInstance.driver` 配置和静态校验。
- 建立 serial line ASCII、framed binary、Modbus 的 codec 基础接口。
- 实现至少一个 fake driver 和一个真实低风险 driver，例如扫码枪或打印机。
- 让 driver 事件能进入 `craftsmanship_runtime_apply_input()` 或现有 `write_signal()` / `write_device_feedback()`。
- 明确哪些设备必须走 STM32/HMIP，哪些允许树莓派直连。

这一阶段不要求所有设备协议一次完成，但要把“直连设备不是 HMIP，也能以统一方式进入 runtime”的骨架固定下来。

### 阶段 3：物理段 recipe 与设备联调

目标：

- 建立稀释设备 workspace。
- 配置阀、泵、流量计、搅拌机、粘度计、气泡计、EMO signal。
- 将 raw-load、solvent-load、mix、viscosity、dispense 做成 segment recipes。
- 通过 fake device、STM32/HMIP 控制器或 Rust direct driver 验证 interlock / safe-stop / feedback。

### 阶段 4：PRMS、打印、报表真实接口

目标：

- 替换 mock PRMS。
- 确认 barcode 格式和 mapping 字段。
- 确认 Dilution Barcode 申请时机。
- 接入打印机并处理重打。
- 接入报表系统并实现待补传。

### 阶段 5：生产硬化

目标：

- 权限/电子签名。
- 1 年留存清理策略。
- 批次恢复和断电续跑策略。
- 补账操作审计。
- 故障注入测试。
- 现场 SOP 和维护工具。

## 12. 测试策略

### 通用后端测试

应新增或扩展：

- 动态 payload 编码：数字、enum、缺失参数、范围错误。
- `start_with_input`：run input 出现在 snapshot 和 journal。
- journal：步骤开始/完成/失败都写入 JSONL。
- gate：等待、确认、拒绝、stop。
- external input bridge：signal/device feedback 都能推进 wait/completion。
- `driverCommand` dispatch：能调用 fake driver，并把 driver event 转成 signal/device feedback。
- driver codec：ASCII 行协议、二进制帧拆包粘包、CRC 错误、超时重试。
- GPIO input：开关量读取、去抖、边沿事件到 signal 的映射。

### dilution 单元测试

重点测试：

- 同批次多 barcode 类别一致性。
- 相同 barcode 二次使用不被硬拦截。
- 单浓度自动锁定，多浓度等待人工选择。
- 质量 = 体积 * 密度；密度缺失时拒绝默认 1:1。
- 整瓶/非整瓶稀释剂目标质量计算。
- 最后一瓶不足不报错。
- 粘度平均值和重测预留状态。
- PRMS 幂等键生成和重试状态。
- 打印失败后瓶次状态不丢失。
- 报表多行展开字段。

### 集成测试

建议 fake 三类外部系统：

- fake PRMS：返回单浓度、多浓度、mapping 失败、barcode 数量不匹配。
- fake STM32/HMIP device runtime：模拟计量完成、粘度值、气泡异常。
- fake direct driver：模拟直连流量计/粘度计/打印机协议响应。
- fake printer/report：模拟成功、失败、重试成功。

最小集成流程：

```txt
create batch
scan raw barcode
mock PRMS returns one option
lock recipe
raw loading fake completed actual mass
solvent loading fake completed
mix completed
two viscosity readings
upload PRMS
request barcodes
print labels
dispense bottles
send report
assert batch Completed
assert events and report fields complete
```

## 13. 当前待确认项对实现的影响

这些问题不会阻止 mock 版本，但会影响生产接口和业务规则：

| 待确认项 | 影响 |
| --- | --- |
| barcode 格式 | 影响 `RawResistScan` 解析和本地校验。 |
| PRMS 协议 | 影响 `PrmsClient` 真实实现。 |
| mapping 返回字段 | 影响 `PrmsMapping` 和 recipe 锁定。 |
| 稀释关系公式 | 影响 `metering.rs` 计算。 |
| 密度来源 | 影响质量换算和 recipe 字段。 |
| 非整瓶稀释剂计算依据 | 影响目标 PGMEA 质量。 |
| 计量误差和超差处理 | 影响人工 gate 和报警策略。 |
| PGMEA 供液协议和 EMO 联动 | 影响 workspace action/interlock。 |
| 气泡计联锁策略 | 影响 interlocks 配置。 |
| 粘度差异过大是否重测 | 影响 `ViscosityTest` 状态机。 |
| Dilution Barcode 申请时机 | 影响 BarcodeRequested 与 Dispensing 顺序。 |
| 打印失败/重打规则 | 影响 `OutputBottle.print_status` 和人工确认。 |
| Manual create / ter barcode | 影响补账模型。 |
| 权限/电子签名 | 影响 command 权限和人工确认审计。 |
| Log 留存位置 | 影响 repository 和清理策略。 |

## 14. 最小可实施切入点

如果现在开始编码，建议按下面的最小切入点推进：

1. 新增 `src-tauri/src/dilution/types.rs` 和 `state_machine.rs`，先不接设备。
2. 新增文件型 `DilutionRepository`，完成 batch snapshot/events。
3. 新增 mock PRMS/打印/报表 client。
4. 新增 `dilution_create_batch`、`dilution_scan_raw_resist`、`dilution_select_concentration`、`dilution_lock_recipe`。
5. 新增 `dilution_start_mock_run` 或分段 mock commands，跑通完整状态机。
6. 再补 `craftsmanship` 的 `start_with_input` 和动态 payload。
7. 最后把 mock physical segment 替换成真实 `craftsmanship` segment recipes。

这个顺序的好处是：业务对象和状态机先稳定，PRMS/设备协议未定时也能前端联调；等现场接口明确后替换 adapter，而不是重写批次逻辑。
