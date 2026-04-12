# 工艺流程后端使用文档

本文面向要接入或维护 `src-tauri/src/craftsmanship/` 后端的人，目标不是解释“理想中的工艺平台”，而是说明**当前已经落地的后端实现到底如何组织 workspace、如何校验文件、如何启动运行时，以及每类 JSON 文件至少要写哪些字段**。

配套演示目录位于：`docs/craftsmanship-usage/demo-workspace/`

这套演示目录不是伪结构图，而是一套按当前后端实现可以被扫描、装配和校验的真实目录样板。你可以把它拷贝出去作为项目起始模板。

## 1. 当前后端能力边界

当前工艺后端已经具备这些正式能力：

- 扫描整个 workspace：`craftsmanship_scan_workspace`
- 读取项目 bundle：`craftsmanship_get_project_bundle`
- 读取 recipe bundle：`craftsmanship_get_recipe_bundle`
- 加载单个 recipe 到单实例运行时：`craftsmanship_runtime_load_recipe`
- 启动、停止、轮询当前运行时：`craftsmanship_runtime_start`、`craftsmanship_runtime_stop`、`craftsmanship_runtime_get_status`
- 在运行中写逻辑信号或设备反馈：`craftsmanship_runtime_write_signal`、`craftsmanship_runtime_write_device_feedback`

这意味着它已经不是纯设计稿，而是一个真实的 Tauri 后端内核。

同时要明确当前边界：

- 前端 `Recipes` 视图还不是完整的生产级操作台，真正稳定的入口仍然是这些 Tauri 命令
- runtime 是**单实例**的，同一时刻只运行一个已加载 recipe
- workspace 的很多资源目录是“可选缺省 + warning”，不是“一缺就拒绝打开”
- 真正阻止启动的是 `load_recipe` 之后 bundle 中的 `error diagnostics`，而不是扫描阶段本身

## 2. 架构设计

后端可分成 4 层：

```txt
Tauri command
  └─ commands.rs
       ├─ scan_workspace / get_project_bundle / get_recipe_bundle
       └─ runtime_load_recipe / start / stop / get_status / write_signal / write_device_feedback
                |
                v
craftsmanship/
  ├─ loader.rs      读取 workspace、装配 bundle
  ├─ validation.rs  静态语义校验，产出 diagnostics
  ├─ types.rs       JSON 文件模型、bundle、diagnostics 类型
  └─ runtime/
       ├─ manager.rs   单实例运行时状态机与快照
       ├─ engine.rs    步骤推进、安全停机、完成判定
       ├─ dispatch.rs  GPIO / HMIP/TCP/Serial 动作下发
       └─ types.rs     运行时快照、步骤状态、事件类型
```

### 2.1 Loader 层

`loader.rs` 做三件事：

- 解析 `workspace/system/**` 和 `workspace/projects/**`
- 把零散文件装成 `WorkspaceSummary`、`ProjectBundle`、`RecipeBundle`
- 给每个模型回填 `source_path`，方便 diagnostics 直接指向文件

### 2.2 Validation 层

`validation.rs` 不直接阻止扫描，而是统一产出 `CraftsmanshipDiagnostic`：

- `level`: `error` 或 `warning`
- `code`: 稳定机器码，例如 `duplicate_project_id`
- `message`: 面向人类阅读的错误消息
- `source_path`: 对应 JSON 文件路径
- `entity_id`: 出错对象的 id

策略是：

- 扫描和读取尽量保留上下文
- 启动 runtime 时，如果 bundle 中存在任何 `error`，则 `start()` 会拒绝执行

### 2.3 Runtime 层

`runtime/manager.rs + runtime/engine.rs` 共同维护一个单实例 recipe runtime：

- `load_recipe()` 只加载，不运行
- `start()` 进入步骤执行
- `write_signal()` 用于 `common.wait-signal`、联锁判断
- `write_device_feedback()` 用于 `deviceFeedback` 完成判定
- HMIP/TCP/Serial 反馈也可以通过 comm actor 自动写回 runtime

### 2.4 当前推荐的数据流

```txt
1. scan_workspace(workspace_root)
2. get_project_bundle(workspace_root, project_id)
3. get_recipe_bundle(workspace_root, project_id, recipe_id)
4. runtime_load_recipe(workspace_root, project_id, recipe_id)
5. runtime_start()
6. 轮询 runtime_get_status() 或监听 runtime event
7. 通过真实设备反馈 / write_signal / write_device_feedback 推进步骤
```

## 3. 目录结构安排

### 3.1 当前后端实际识别的目录

按当前 `loader.rs`，workspace 真实支持的结构如下：

```txt
workspace/
  system/
    actions/*.json
    device-types/*.json
    schemas/*.json                # 当前只收集路径，不参与强校验

  projects/
    <project-dir>/
      project.json
      connections/*.json          # 可选
      devices/*.json              # 可选
      feedback-mappings/*.json    # 可选
      signals/*.json              # 可选
      safety/
        interlocks.json           # 可选
        safe-stop.json            # 可选
      recipes/*.json              # 可选
```

### 3.2 必需目录与可选目录

硬要求：

- `workspace/`
- `workspace/system/`
- `workspace/system/actions/`
- `workspace/system/device-types/`
- `workspace/projects/`
- `workspace/projects/<project-dir>/project.json`

软要求：

- `system/schemas/`
- `connections/`
- `devices/`
- `feedback-mappings/`
- `signals/`
- `safety/interlocks.json`
- `safety/safe-stop.json`
- `recipes/`

缺少软要求资源时，后端会返回 warning diagnostics，而不是直接 `Err`。

### 3.3 project id 与目录名

当前后端优先按目录名找项目，但也支持回退到 `project.json.id`：

1. 先尝试 `projects/<project_id>/`
2. 如果目录名不匹配，再扫描每个子目录里的 `project.json.id`
3. 如果多个目录声明了同一个 `project.id`，会报 `ambiguous`

因此：

- 最稳妥的做法仍然是**目录名和 `project.json.id` 保持一致**
- 不要在同一个 workspace 下放两个相同 `project.id`

## 4. 字段要求

下面只列**当前后端真正读取和校验的字段**，而不是“可能存在于 extra 里的任意字段”。

### 4.1 `system/actions/*.json`

核心字段：

- `id`: 必填，动作唯一标识
- `name`: 必填
- `targetMode`: 可选，但如果写了只能是：`none`、`required`
- `allowedDeviceTypes`: 当 `targetMode = required` 时必须非空
- `parameters`: 可选，参数定义数组
- `completion`: 可选
- `dispatch`: 可选
- `summaryTemplate`: 可选

#### `parameters[]`

每项支持：

- `key`: 必填
- `name`: 必填
- `type`: 必填，可选值：`number`、`string`、`boolean`、`enum`
- `required`: 可选，默认 `false`
- `min` / `max`: 仅对 `number` 有意义，且必须是数值，`min <= max`
- `options`: 当 `type = enum` 时必须非空

#### `completion`

当前支持 3 种：

- `immediate`
- `deviceFeedback`
- `signalCompare`

字段要求：

- `type = immediate`: 不要求额外字段
- `type = deviceFeedback`: 需要 `key`、`operator`、`value`
- `type = signalCompare`: 需要 `signalId`、`operator`、`value`
- `stableTimeMs`: 可选，仅在等待稳定值时使用

`operator` 支持：

- `eq`
- `ne`
- `gt`
- `ge`
- `lt`
- `le`

#### `dispatch`

当前支持 2 种：

- `hmipFrame`
- `gpioWrite`

`hmipFrame` 要求：

- `targetMode` 必须是 `required`
- 当前只支持**固定十六进制 payload**
- `msgType` 必填
- `payloadMode` 省略时默认按 `fixedHex` 处理
- `payloadHex` 必填，且必须是合法十六进制串
- `priority` 可选，若填写只能是 `high` 或 `normal`
- 当前不支持带 action 参数的真实下发；有真实 dispatch 的 action，`parameters` 应保持为空或仅用于逻辑步骤以外的扩展场景

`gpioWrite` 要求：

- `targetMode` 必须是 `required`
- `value` 必填，布尔值
- 当前也不支持带参数的 GPIO 动作

### 4.2 `system/device-types/*.json`

核心字段：

- `id`: 必填
- `name`: 必填
- `allowedActions`: 可选数组，但其中每个 action id 都必须在 system/actions 中存在

### 4.3 `projects/<id>/project.json`

核心字段：

- `id`: 必填，项目唯一 id
- `name`: 必填
- `enabled`: 可选，默认 `true`
- `description`: 可选
- `version`: 可选

### 4.4 `connections/*.json`

核心字段：

- `id`: 必填
- `name`: 必填
- `enabled`: 可选，默认 `true`
- `kind`: 必填，可选值：`tcp`、`serial`

#### `kind = tcp`

- `tcp.host`: 必填
- `tcp.port`: 必填
- `tcp.timeoutMs`: 可选

#### `kind = serial`

- `serial.port`: 必填
- `serial.baudRate`: 可选，但如果写了必须大于 0
- `serial.dataBits`: 可选，若写了只能是 `5`、`6`、`7`、`8`
- `serial.stopBits`: 可选，若写了只能是 `1`、`2`
- `serial.parity`: 可选，若写了只能是 `none`、`even`、`odd`，大小写不敏感

### 4.5 `devices/*.json`

核心字段：

- `id`: 必填
- `name`: 必填
- `typeId`: 必填，且必须引用真实 `device-type`
- `enabled`: 可选，默认 `true`
- `transport`: 可选，但凡是会真实下发到设备的 action，实际都需要 transport
- `tags`: 可选，键值对；runtime 会把它作为“设备反馈键 -> runtime value key”的映射

#### `transport.kind`

支持：

- `tcp`
- `serial`
- `gpio`

`tcp` / `serial` 设备要求：

- `connectionId`: 必填
- 设备 transport.kind 必须和 connection.kind 一致
- `channel`: 可选但强烈建议填写；HMIP/串口多路复用场景靠它区分设备

`gpio` 设备要求：

- `pin`: 必填
- `chipPath`: 建议填写；当前实现通过这个路径定位 gpiochip
- `activeLow`: 可选

### 4.6 `signals/*.json`

核心字段：

- `id`: 必填
- `name`: 必填
- `dataType`: 必填
- `enabled`: 可选，默认 `true`
- `source`: 可选；用于说明这个逻辑信号从哪个外部 runtime key 映射而来

当前后端允许的 `dataType` 实际上依赖使用场景，但在现有实现中常见和值得优先使用的是：

- `number`
- `boolean`
- `string`

### 4.7 `feedback-mappings/*.json`

这是当前 backend 里最容易写错的一类文件。

核心结构：

- `id`: 必填
- `name`: 必填
- `enabled`: 可选，默认 `true`
- `match`: 必填
- `target`: 必填

#### `match`

- `connectionId`: 必填，必须引用已存在且启用的 tcp/serial connection
- `channel`: 可选
- `msgType`: 可选
- `summaryKind`: 可选，若写了支持：
  - `hello`
  - `helloAck`
  - `heartbeat`
  - `request`
  - `response`
  - `event`
  - `error`
  - `raw`
- `requestId`: 仅适用于 `request` / `response`
- `status`: 仅适用于 `response`
- `eventId`: 仅适用于 `event`
- `errorCode`: 仅适用于 `error`

#### `target`

只能二选一：

- 写 `signalId`
- 或写 `deviceId + feedbackKey`

不能同时写，也不能两个都不写。

此外，下面二选一：

- `value`: 常量值
- `valueFrom`: 从反馈包提取值

不能同时写，也不能两个都不写。

当前 `valueFrom` 支持：

- `channel`
- `seq`
- `msgType`
- `flags`
- `summary.requestId`
- `summary.status`
- `summary.eventId`
- `summary.errorCode`
- `summary.bodyBase64`
- `summary.bodyHex`
- `summary.payloadBase64`
- `summary.payloadHex`

### 4.8 `safety/interlocks.json`

文件结构：

- `rules`: 数组

每条 rule：

- `id`: 必填
- `name`: 必填
- `actionIds`: 需要被联锁保护的 action 列表
- `condition`: 必填
- `onViolation`: 可选，若写了只能是 `block` 或 `alarm`

`condition` 支持两种写法：

- 叶子条件：`signalId + operator + value`
- 组合条件：`logic + items`

`logic` 当前支持常见逻辑组，具体以现有校验与运行时解释为准；实际工程里建议优先使用简单叶子条件和清晰的小组合树。

### 4.9 `safety/safe-stop.json`

文件结构：

- `id`: 必填
- `name`: 必填
- `steps`: 数组

每个 step：

- `seq`: 必填
- `actionId`: 必填
- `deviceId`: 当 action 需要设备时必填
- `timeoutMs`: 可选

当前运行时语义：

- safe-stop step 自己写了 `timeoutMs` 就用它
- 没写时，runtime 会落到默认 `5000ms`
- safe-stop 不再无限等待

### 4.10 `recipes/*.json`

文件结构：

- `id`: 必填
- `name`: 必填
- `description`: 可选
- `steps`: 必填数组

每个 step：

- `id`: 必填，且在同一 recipe 内唯一
- `seq`: 必填，runtime 会按 `seq` 排序
- `name`: 必填
- `actionId`: 必填
- `deviceId`: 当 action `targetMode = required` 时必填
- `parameters`: 可选对象
- `timeoutMs`: 可选，但建议为所有非瞬时步骤显式填写
- `onError`: 可选，若写了只能是：
  - `stop`
  - `ignore`
  - `safe-stop`

## 5. 演示目录如何使用

演示目录：`docs/craftsmanship-usage/demo-workspace/`

它对应的是一个 3 步工艺：

1. `S010`：GPIO 打开工艺阀
2. `S020`：通过 HMIP/TCP 启动前级泵，并等待设备反馈 `running = true`
3. `S030`：等待逻辑信号 `process_ready = 1`

### 5.1 演示目录树

```txt
docs/craftsmanship-usage/demo-workspace/
  system/
    actions/
      common.delay.json
      common.wait-signal.json
      pump.start.json
      pump.stop.json
      valve.open.json
    device-types/
      pump.json
      valve.json

  projects/
    project-a/
      project.json
      connections/
        main-tcp-process.json
      devices/
        pump_01.json
        valve_01.json
      feedback-mappings/
        process_ready_process.json
        pump_running_process.json
      signals/
        process_ready.json
      safety/
        interlocks.json
        safe-stop.json
      recipes/
        mixed-transport-process.json
```

### 5.2 最小使用顺序

如果你只是验证目录能否被后端识别：

1. 调 `craftsmanship_scan_workspace(workspace_root)`
2. 看 `diagnostics` 是否有 `error`
3. 调 `craftsmanship_get_project_bundle(workspace_root, "project-a")`
4. 调 `craftsmanship_get_recipe_bundle(workspace_root, "project-a", "mixed-transport-process")`

如果你要真实启动 runtime：

1. `craftsmanship_runtime_load_recipe(workspace_root, "project-a", "mixed-transport-process")`
2. `craftsmanship_runtime_start()`
3. runtime 会先执行 GPIO 写入
4. 然后尝试通过 `main-tcp-process` 向 `127.0.0.1:15090` 发 HMIP 帧，`channel = 9`，payload = `aa55`
5. 当外部 HMIP peer 返回一个满足 mapping 的 `response(status=0, channel=9)` 时，`pump_01.running` 会被置为 `true`
6. 当外部 HMIP peer 再发一个满足 mapping 的 `event(eventId=91, channel=9)` 时，`process_ready` 会被置为 `1`
7. `S030` 完成，recipe 进入 `Completed`

### 5.3 这套演示目录的真实运行前提

这套演示不是“离线纯 JSON demo”，而是**面向当前 backend 真实行为**的模板，所以启动 `S020` 时确实需要一个 TCP HMIP 对端。

如果你没有真实对端，但只是想先验证文件组织：

- 可以只做到 `scan_workspace` / `get_project_bundle` / `get_recipe_bundle`
- 或者把 recipe 暂时改成只包含 `common.delay` 和 `common.wait-signal`

如果你要让它完整跑通：

- 需要在 `127.0.0.1:15090` 提供一个能回 HMIP `response` / `event` 的对端
- 或在测试 / 开发环境里使用 fake transport 覆盖，这也是当前后端测试里使用的方式

## 6. 目录设计建议

基于当前实现，建议你按下面的原则组织实际项目：

- system 只放“跨项目复用”的动作与设备类型，不要在项目目录里重复定义动作语义
- project 目录只放实例资源：连接、设备、信号、反馈映射、联锁、safe-stop、recipe
- 目录名最好和 `project.json.id` 保持一致
- 一个 connection 只服务同一种物理链路，不要混写 tcp/serial 概念
- device `tags` 先规划成稳定 runtime key，避免后面 feedback mapping 全部重写
- feedback mapping 先从“常量 value”开始，只有确实要提取响应内容时再上 `valueFrom`
- 对所有会等待外部条件的 recipe step，都显式写 `timeoutMs`
- 对所有会做真实下发的 recipe step，都显式写 `onError`，不要依赖隐式默认值

## 7. 排错建议

如果 runtime 启动失败或流程不推进，优先按下面顺序看：

1. `load_recipe()` 返回的 `diagnostics` 里是否有 `level = error`
2. action / device-type / device / connection 的引用关系是否闭合
3. `device.transport.kind` 和 `connection.kind` 是否一致
4. `feedback-mappings` 的 `connectionId + channel + summaryKind` 是否真的和外部反馈一致
5. `recipe step` 的 `deviceId` 是否在 action `targetMode = required` 时正确填写
6. `onError` / `onViolation` 是否用了当前后端真正支持的枚举值

如果只是做新项目起步，最稳的方式是：

- 先拷贝 `docs/craftsmanship-usage/demo-workspace/`
- 先让 `scan_workspace` 和 `get_recipe_bundle` 通过
- 再替换成你的真实连接、设备和反馈映射

## 8. 相关源码入口

- 命令入口：`src-tauri/src/commands.rs`
- 类型定义：`src-tauri/src/craftsmanship/types.rs`
- 目录加载：`src-tauri/src/craftsmanship/loader.rs`
- 静态校验：`src-tauri/src/craftsmanship/validation.rs`
- 运行时：`src-tauri/src/craftsmanship/runtime/`
- 当前实现说明：`docs/implementation/12-craftsmanship-backend.md`
