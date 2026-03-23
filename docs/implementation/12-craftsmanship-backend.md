# 12 · 工艺流程后端（craftsmanship）：工作区模型、静态校验与单实例运行时

本章聚焦 `src-tauri/src/craftsmanship/` 这一整组 Rust 后端实现。它已经不是“纯设计稿”，而是一个可被 Tauri 命令直接调用的工艺内核：能扫描 workspace、装配项目 bundle、生成 diagnostics、加载 recipe、启动单实例运行时，并通过信号/设备反馈驱动步骤推进。

同时也要先说清楚当前边界：**它还不是完整闭环产品**。后端核心已经落地，但前端 `Recipes` 视图仍是静态 demo 数据，发布层未实现，运行时也还没有真正下发设备控制命令。

## 1. 它在项目里的位置

源码对应：

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/craftsmanship/mod.rs`
- `src-tauri/src/craftsmanship/loader.rs`
- `src-tauri/src/craftsmanship/validation.rs`
- `src-tauri/src/craftsmanship/runtime/*`
- `src/components/views/Recipes/index.tsx`

字符画：当前真实链路

```txt
Tauri invoke
  └─ src-tauri/src/commands.rs
       ├─ craftsmanship_scan_workspace
       ├─ craftsmanship_get_project_bundle
       ├─ craftsmanship_get_recipe_bundle
       ├─ craftsmanship_runtime_load_recipe
       ├─ craftsmanship_runtime_start / stop / get_status
       └─ craftsmanship_runtime_write_signal / write_device_feedback
                │
                ▼
       src-tauri/src/craftsmanship/
         ├─ types.rs         文件模型 / bundle / diagnostics
         ├─ loader.rs        workspace 读取与 bundle 装配
         ├─ validation.rs    静态语义校验
         └─ runtime/         单实例内存运行时

Frontend today
  └─ src/components/views/Recipes/index.tsx
       └─ 仍使用 demoRecipes 静态数据，尚未调用上述命令
```

`src-tauri/src/lib.rs` 在 Tauri `setup()` 阶段注入了 `RecipeRuntimeManager`，并注册全部 `craftsmanship_*` 命令。这说明工艺模块已经是后端正式能力，而不是孤立实验代码。

## 2. 工作区模型：从设计草案到当前落地

源码对应：

- 设计草案：`docs/craftsmanship_build.md`
- 当前类型定义：`src-tauri/src/craftsmanship/types.rs`
- 当前加载实现：`src-tauri/src/craftsmanship/loader.rs`

`docs/craftsmanship_build.md` 给出的理念是“按目录组织工艺能力”，把工艺系统拆成系统定义层、项目资源层、工艺层，以及未来的发布层。当前 Rust 后端已经实现了前三层的大部分读取能力，但**发布层还没有进入代码实现**。

字符画：当前后端实际识别的目录

```txt
workspace/
  system/
    actions/*.json
    device-types/*.json
    schemas/*.json

  projects/
    <project-id>/
      project.json
      devices/*.json
      signals/*.json
      safety/interlocks.json
      safety/safe-stop.json
      recipes/*.json
```

### 2.1 核心文件模型

`types.rs` 把每类 JSON 文件都映射成稳定 Rust 结构，关键点如下：

- `ActionDefinition`
  - 定义动作能力本身。
  - 重点字段：`target_mode`、`allowed_device_types`、`parameters`、`completion`、`summary_template`。
- `DeviceTypeDefinition`
  - 定义某类设备允许使用哪些 action。
  - 重点字段：`allowed_actions`。
- `DeviceInstance`
  - 定义项目内具体设备实例。
  - 重点字段：`type_id`、`tags`。
  - 这里的 `tags` 很关键，运行时会把它当作“逻辑反馈键 -> runtime key”的映射表。
- `SignalDefinition`
  - 定义项目内信号。
  - 重点字段：`data_type`、`source`。
  - `source` 允许把外部运行值映射成 signal。
- `InterlockFile` / `InterlockRule` / `InterlockCondition`
  - 用树形条件表达联锁。
  - 叶子节点是 `signalId + operator + value`，组合节点用 `logic + items`。
- `SafeStopDefinition`
  - 定义异常后的固定安全停机步骤。
- `RecipeDefinition` / `RecipeStep`
  - 定义工艺本体。
  - 重点字段：`action_id`、`device_id`、`parameters`、`timeout_ms`、`on_error`。

一个细节值得注意：几乎所有文件模型都带 `source_path`，但它不是从 JSON 中反序列化出来的，而是在 `loader.rs` 读文件后回填。这样 diagnostics 可以稳定地指向具体文件来源。

### 2.2 三种 bundle

后端对外不是直接返回“零散文件”，而是返回 3 类 bundle：

- `CraftsmanshipWorkspaceSummary`
  - 用于扫描整个 workspace。
  - 包含：`system`、`projects`、`diagnostics`。
- `CraftsmanshipProjectBundle`
  - 用于打开一个项目。
  - 包含：`project`、`devices`、`signals`、`interlocks`、`safe_stop`、`recipes`、`diagnostics`。
- `CraftsmanshipRecipeBundle`
  - 用于加载单个 recipe。
  - 在 `ProjectBundle` 基础上，额外给出 `recipe` 和 `related_actions`。

这个设计很明显偏向前端消费友好：前端拿到 bundle 后，不需要自己再做大量 join。

## 3. 加载层：workspace -> bundle

源码对应：

- `src-tauri/src/craftsmanship/loader.rs`

### 3.1 `scan_workspace()`

职责：

- 校验 `workspace_root` 是否存在且为目录。
- 读取 `system/actions` 与 `system/device-types`。
- 收集 `system/schemas` 下的 JSON 路径。
- 读取 `projects/*/project.json` 形成项目摘要。
- 对系统层先做一次 `validate_system_bundle()`。

字符画：扫描路径

```txt
workspace_root
  ├─ load_system_bundle()
  │    ├─ system/actions/*.json
  │    ├─ system/device-types/*.json
  │    └─ system/schemas/*.json   -> 目前只收集路径
  ├─ validate_system_bundle(system)
  └─ projects/*/project.json
```

### 3.2 `get_project_bundle()`

职责：

- 在 `projects/` 下定位项目目录。
- 读取项目的 devices、signals、interlocks、safe-stop、recipes。
- 对 `safe_stop.steps` 和 `recipe.steps` 按 `seq` 排序。
- 叠加系统层 diagnostics 和项目层 diagnostics。

这里有两个实现选择很重要：

- **必需目录/文件硬失败**
  - 如 `workspace_root`、`system/`、`system/actions/`、`system/device-types/` 缺失，会直接返回 `Err`。
- **项目可选资源软失败**
  - `devices/`、`signals/`、`recipes/`、`interlocks.json`、`safe-stop.json` 缺失时，不会终止加载。
  - 后端会返回空集合或 `None`，同时追加 `missing_directory` / `missing_file` warning diagnostics。

这说明当前后端更偏向“编辑器 / 工程配置工具”场景，而不是“任何资源缺失都拒绝打开”的严格发布态场景。

### 3.3 `get_recipe_bundle()`

职责：

- 基于 `get_project_bundle()` 先拿完整项目资源。
- 按 `recipe_id` 找出目标 recipe。
- 根据 recipe steps 中出现的 `action_id`，裁剪出 `related_actions`。

因此 `RecipeBundle` 不是“项目全量动作定义”，而是“这个 recipe 实际会用到的动作子集”。这减少了前端或运行时的无关数据量。

### 3.4 项目定位策略

`find_project_dir()` 并不只依赖目录名，它会：

1. 先尝试 `projects/<project_id>/`
2. 如果找不到，再扫描每个子目录里的 `project.json`
3. 用 `project.id` 做回退匹配

这让“目录名变更但项目 ID 不变”的情况仍然可用。

## 4. 静态校验层：先收 diagnostics，再决定能否启动

源码对应：

- `src-tauri/src/craftsmanship/validation.rs`
- `src-tauri/src/craftsmanship/tests.rs`
- `src-tauri/src/craftsmanship/runtime/manager.rs`

### 4.1 diagnostics 结构

所有校验问题统一落到 `CraftsmanshipDiagnostic`：

- `level`
- `code`
- `message`
- `source_path`
- `entity_id`

后端区分 `error` 与 `warning`，而不是“一出错就拒绝解析”。这让系统可以在工作区编辑阶段保留更多上下文。

### 4.2 系统层校验

`validate_system_bundle()` 主要检查动作和设备类型定义本身是否合法，包括：

- `targetMode` 是否只取 `none` / `required`
- `targetMode=required` 时是否配置了 `allowedDeviceTypes`
- `allowedDeviceTypes` 是否引用真实 `device_type`
- `device_type.allowed_actions` 是否引用真实 `action`
- 参数定义是否支持 `number/string/boolean/enum`
- `enum` 参数是否声明了 `options`
- `number` 参数的 `min/max` 是否是数字，且 `min <= max`
- `completion.type` 是否支持
  - `immediate`
  - `deviceFeedback`
  - `signalCompare`
- `completion` 所需字段是否齐全
  - 如 `key`、`signalId`、`operator`、`value`

### 4.3 项目层校验

`validate_project_resources()` 继续做“系统定义与项目资源是否匹配”的检查，包括：

- device 的 `type_id` 是否存在
- interlock 的 `actionIds` 是否存在
- interlock 条件里的 `signalId` / `operator` 是否合法
- safe-stop step 的 action/device 绑定是否合法
- recipe step 的 action 是否存在
- recipe step 是否缺少必需 `deviceId`
- recipe step 是否多绑了本不该绑定设备的 action
- recipe step 传入的参数是否都在 action schema 里
- 必填参数是否缺失
- 参数值类型、范围、enum 选项是否符合动作定义
- recipe 参数中的 `signalId` 是否指向项目内真实 signal
- `completion.type=signalCompare` 时引用的 signal 是否属于项目

### 4.4 diagnostics 和运行时的关系

加载 recipe 并不会因为 diagnostics 里有 `error` 而失败，`load_recipe()` 依然返回 snapshot。真正的硬门槛发生在 `start()`：

- 如果 loaded bundle 中存在 `level == "error"` 的 diagnostics，运行时会拒绝启动。

字符画：当前策略

```txt
load_recipe
  ├─ 允许加载
  ├─ snapshot.diagnostics 保留全部问题
  └─ 前端/调用方可先展示问题

start
  ├─ 若 diagnostics 只有 warning -> 允许启动
  └─ 若存在 error          -> 拒绝启动
```

这是一种很典型的“编辑态宽容、执行态严格”的设计。

## 5. 运行时：单实例、内存态、事件驱动等待

源码对应：

- `src-tauri/src/craftsmanship/runtime/manager.rs`
- `src-tauri/src/craftsmanship/runtime/engine.rs`
- `src-tauri/src/craftsmanship/runtime/types.rs`
- `src-tauri/src/craftsmanship/runtime/tests.rs`

### 5.1 管理器模型

`RecipeRuntimeManager` 是 Tauri 级共享状态，内部维护：

- `loaded`
  - 当前已加载的 `LoadedRecipeRuntime`
- `snapshot`
  - 当前对外状态快照
- `run_control`
  - 当前运行控制器，负责 stop 请求
- `next_run_id`
  - 自增运行号
- `value_changed`
  - `Notify`，用于唤醒等待中的步骤

`LoadedRecipeRuntime` 会把 bundle 预处理成几个 lookup map：

- `actions`
- `devices`
- `signals`
- `signal_sources`

其中 `signal_sources` 很关键。它把 `signal.source -> signal.id` 反向建立索引，用于把 runtime value 回写成 signal value。

### 5.2 snapshot 结构

运行态对外核心对象是 `RecipeRuntimeSnapshot`，它本质上就是“可直接给 UI 的读模型”。主要字段有：

- 全局状态
  - `status`
  - `phase`
  - `run_id`
  - `started_at_ms`
  - `finished_at_ms`
- 上下文信息
  - `workspace_root`
  - `project_id/project_name`
  - `recipe_id/recipe_name`
- 当前执行点
  - `active_step_id`
  - `active_step_phase`
- 步骤集合
  - `recipe_steps`
  - `safe_stop_steps`
- 运行值
  - `signal_values`
  - `runtime_values`
- 诊断与错误
  - `diagnostics`
  - `last_error`
  - `last_message`

这说明当前后端并不打算把前端逼成“自己拼状态机”的角色，而是主动把运行态包装成扁平快照。

### 5.3 状态与阶段

运行时状态：

- `idle`
- `loaded`
- `running`
- `stopping`
- `completed`
- `failed`
- `stopped`

运行阶段：

- `idle`
- `recipe`
- `safe_stop`

步骤状态：

- `pending`
- `running`
- `completed`
- `failed`
- `skipped`
- `stopped`

注意一点：虽然定义了 `skipped`，但当前引擎代码并没有真正使用这个状态。现阶段实际会落到 `pending/running/completed/failed/stopped`。

### 5.4 启动与执行主流程

字符画：运行主流程

```txt
load_recipe()
  └─ snapshot <- RecipeBundle

start()
  ├─ 拒绝未 load / 重复启动 / 含 error diagnostics 的 recipe
  ├─ run_id += 1
  ├─ snapshot.reset_for_run()
  └─ spawn(engine::run_recipe)

run_recipe()
  ├─ execute_recipe_steps()
  │    └─ 逐步执行 recipe.steps
  ├─ success      -> finish_run(completed)
  ├─ stop request -> finish_run(stopped)
  └─ failure
       ├─ onError=safe-stop 且存在 safe_stop -> transition_to_safe_stop() -> execute_safe_stop()
       └─ 其他情况 -> finish_run(failed)
```

### 5.5 当前真正支持的步骤语义

`engine.rs` 里当前有 3 类执行路径：

1. `common.delay`
   - 从参数里取 `durationMs`
   - 用本地时间等待完成

2. `common.wait-signal`
   - 从参数里取 `signalId/operator/value/stableTimeMs`
   - 等待 `signal_values` 满足条件

3. 其他所有 action
   - 不做“动作下发”
   - 只看该 action 是否声明了 `completion`
   - 若有 completion，就等待 completion 条件满足
   - 若没有 completion，则立刻视为完成

这也是当前实现最关键的事实之一：**运行时现在已经会“推进步骤”，但还不会“真正执行设备命令”**。它更像一个“工艺判定与调度内核”，不是完整设备控制器。

### 5.6 completion 语义

当前引擎支持两种 runtime completion：

- `deviceFeedback`
  - 必须有 `deviceId`
  - 会去设备 `tags` 里找 `completion.key` 对应的 runtime key
  - 再等待 `runtime_values[runtime_key]` 满足比较条件

- `signalCompare`
  - 直接等待 `signal_values[signal_id]` 满足比较条件

如果 `action.completion` 为空，运行时返回“completed immediately”。

### 5.7 等待模型：Notify + 20ms 轮询兜底

所有等待都归到 `wait_for_condition()`：

- 每轮先检查 stop 请求
- 如果有 `timeout_ms`，检查是否超时
- 读取当前 snapshot
- 执行 predicate 比较
- 如果配置了 `stableTimeMs`，要求条件连续满足一段时间
- 否则通过两种方式唤醒下一轮
  - `value_changed.notified()`
  - `tokio::time::sleep(20ms)`

字符画：等待回路

```txt
write_signal / write_device_feedback
  ├─ 更新 snapshot
  └─ notify_waiters()

wait_for_condition()
  loop
    ├─ stop?
    ├─ timeout?
    ├─ predicate(snapshot)?
    ├─ stableTime reached?
    └─ 等待 notify 或 20ms
```

这是一种非常务实的实现：既避免纯忙轮询，也不把系统完全绑定到“必须收到事件”。

### 5.8 联锁与错误策略

recipe 主步骤在执行前会调用 `validate_interlocks()`：

- 只筛选 `rule.action_ids` 覆盖当前 `step.action_id` 的规则
- 用当前 `signal_values` 计算条件树
- 不满足时直接阻断执行

`on_error` 当前支持的分支行为是：

- `stop`
  - 失败即终止整个 runtime
- `ignore`
  - 标记当前步骤失败，但继续执行后续步骤
- `safe-stop`
  - 先记录失败，再进入 `safe_stop` phase 顺序执行安全停机步骤

一个边界要特别说明：**联锁当前只在 recipe 主步骤执行前检查**。它不会在步骤执行过程中持续监视，也不会在 `safe_stop` 步骤执行前重复校验。

### 5.9 信号与设备反馈如何写入运行时

`RecipeRuntimeManager` 暴露了两个写入口：

- `write_signal(signal_id, value)`
- `write_device_feedback(device_id, key, value)`

它们的行为并不完全相同：

`write_signal()`：

- 验证 signal 是否属于当前已加载 recipe
- 写入 `snapshot.signal_values[signal_id]`
- 如果这个 signal 声明了 `source`，会同步写入 `runtime_values[source]`

`write_device_feedback()`：

- 验证 device 是否存在
- 通过 `device.tags[key]` 找到 runtime key
- 写入 `snapshot.runtime_values[runtime_key]`
- 如果某个 signal 的 `source == runtime_key`，还会反向写入 `signal_values[signal_id]`

这说明当前运行时内部实际维护了两套值视图：

- `signal_values`
  - 面向工艺条件表达
- `runtime_values`
  - 面向设备/底层反馈键

这套双视图设计让“设备反馈”和“工艺信号”既可解耦，又能相互映射。

## 6. IPC 与事件：后端已经准备好，前端尚未接上

源码对应：

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/craftsmanship/runtime/manager.rs`
- `src/platform/invoke.ts`
- `src/components/views/Recipes/index.tsx`

### 6.1 当前暴露的 Tauri 命令

工艺后端当前已经暴露以下命令：

- `craftsmanship_scan_workspace`
- `craftsmanship_get_project_bundle`
- `craftsmanship_get_recipe_bundle`
- `craftsmanship_runtime_load_recipe`
- `craftsmanship_runtime_start`
- `craftsmanship_runtime_stop`
- `craftsmanship_runtime_get_status`
- `craftsmanship_runtime_write_signal`
- `craftsmanship_runtime_write_device_feedback`

这意味着从平台能力上，前端已经可以完整驱动“扫描 -> 选项目 -> 加载 recipe -> 启动 -> 写值 -> 读状态”的链路。

### 6.2 当前事件流

运行时事件名固定为：

- `craftsmanship-runtime-event`

事件类型包括：

- `loaded`
- `started`
- `step_changed`
- `signal_written`
- `device_feedback_written`
- `finished`
- `failed`
- `stopped`

事件里带完整 `snapshot`，可选再附加：

- `updated_key`
- `updated_value`
- `message`

这同样非常偏向 UI 接入友好。

### 6.3 但当前前端还没接入

虽然 `src/platform/invoke.ts` 已经提供统一 `invoke()` 抽象，但 `src/components/views/Recipes/index.tsx` 目前仍然是：

- 本地 `demoRecipes` 静态数组
- 本地 `useState`
- 本地“加载/编辑/删除”提示

并没有：

- 调 `craftsmanship_*` 命令
- 订阅 `craftsmanship-runtime-event`
- 显示 diagnostics / runtime snapshot

所以当前状态可以概括为：**后端核心可运行，前端业务页未接入。**

## 7. 设计理念：从代码里能看出的 6 个方向

### 7.1 配置优先，而不是硬编码流程

动作、设备类型、设备实例、信号、联锁、safe-stop、recipe 都来自 JSON 文件，而不是写死在 Rust 里。Rust 后端更像“解释器 + 执行器”。

### 7.2 先做静态诊断，再决定是否允许执行

系统不会在加载阶段就丢掉问题，而是尽量把问题收集成 diagnostics。只有真正执行前，才用 `error diagnostics` 把 start 挡住。

这很适合编辑器和工程配置场景，因为用户需要“看见所有问题”，而不是每次只被第一个错误中断。

### 7.3 运行时和硬件通信故意解耦

当前 runtime 不直接依赖串口/TCP/SECS/GEM 等具体链路，而是通过 `write_signal()` / `write_device_feedback()` 接受外部世界写入值。

好处是：

- 运行时内核可单独测试
- 后续可以从多种通信层喂值
- UI、模拟器、测试夹具都能复用同一套执行引擎

### 7.4 快照优先，而不是把 UI 逼成解释器

后端主动维护 `RecipeRuntimeSnapshot` 和 `RecipeRuntimeEvent`，使前端只需消费“现成读模型”，而不必自己拼运行状态。

### 7.5 以单实例运行时换取简单可靠

当前 `RecipeRuntimeManager` 只允许单个 loaded recipe 和单个 active run。它拒绝“运行中重新 load”和“重复 start”。

这显然牺牲了多任务并发，但换来了：

- 状态边界清楚
- 错误恢复简单
- 前端模型稳定
- 测试更容易覆盖

### 7.6 把 safe-stop 当成正式 phase，而不是异常旁路

一旦进入 `safe_stop`，系统会：

- 切换 phase
- 更新 snapshot
- 单独维护 `safe_stop_steps`
- 保留原始 failure

这说明 safe-stop 在设计上不是“附带回调”，而是工艺状态机的一等公民。

## 8. 当前尚未完成的部分

这一节最重要，因为它决定了“当前系统是什么”以及“它还不是什么”。

### 8.1 前端 Recipes 页面尚未接入后端

证据：

- `src/components/views/Recipes/index.tsx` 使用 `demoRecipes`
- 前端代码中没有 `craftsmanship_*` 调用
- 也没有 `craftsmanship-runtime-event` 订阅方

结论：

- 现在的工艺流程实现仍然是后端能力先行，UI 只是占位展示。

### 8.2 发布层未实现

证据：

- `docs/craftsmanship_build.md` 仍保留“发布层”概念
- `src-tauri/src/craftsmanship/` 当前没有任何 release / publish 相关结构或加载逻辑

结论：

- 当前后端实现的是“系统层 + 项目层 + recipe 层”，不是“发布冻结版本管理”。

### 8.3 `schemas/` 目前只被发现，没有真的参与 JSON Schema 校验

证据：

- `loader.rs` 只把 `system/schemas/*.json` 收集成路径列表
- `validation.rs` 的校验全部是手写语义校验

结论：

- `schemas/` 现在更像“预留给未来编辑器/发布器使用的资源目录”，还不是实际生效的 schema 引擎。

### 8.4 runtime 目前不会真正下发设备动作

证据：

- `engine.rs` 对 `common.delay`、`common.wait-signal` 之外的 action，不会调用任何通信模块
- 默认路径只是等待 `action.completion`
- `pump.stop` 这类没有 completion 的动作会被立即视为完成

结论：

- 当前引擎是“流程推进与条件判定器”，不是“设备命令执行器”。

### 8.5 动作语义支持还很薄

当前内建动作语义只有：

- `common.delay`
- `common.wait-signal`

其余动作是否“有实际执行意义”，取决于：

- 是否配置了 completion
- 是否有外部系统及时写回 signal / feedback

这意味着复杂动作模板、脚本动作、批量动作、并行动作、子流程调用等，都还不在当前实现范围内。

### 8.6 联锁不是持续监控模型

当前联锁只在 recipe step 开始前检查一次。步骤执行中、safe-stop 阶段、以及“动作完成后到下一步开始前”的窗口，并没有持续联锁守护。

### 8.7 没有运行记录持久化

当前 snapshot、run_id、runtime_values 都在内存里：

- 没有落库
- 没有运行历史查询
- 没有恢复机制
- 没有工艺执行审计日志文件

## 9. 当前自动化验证

本次阅读文档前，我对现有 craftsmanship 相关测试做了定向执行：

- 命令：`cargo test craftsmanship --manifest-path src-tauri/Cargo.toml`
- 结果：通过
- 汇总：27 个测试全部通过

这些测试已经覆盖到当前实现最关键的行为：

- workspace 扫描与 bundle 组装
- diagnostics 生成
- 可选资源缺失时的 warning 策略
- recipe/safe-stop `seq` 排序
- 参数类型与范围校验
- 动作/设备/信号绑定冲突
- runtime 启停
- `common.delay`
- `common.wait-signal`
- `deviceFeedback`
- `signalCompare`
- `stableTimeMs`
- `ignore`
- `safe-stop`
- 高频 signal 写入

## 10. 一句话总结

当前的 craftsmanship 后端已经具备了“配置化工艺模型 + 静态诊断 + 单实例运行时 + Tauri IPC 接口”的完整后端骨架，但它仍处在 **backend-first** 阶段：前端未接入、发布层未落地、真实设备动作未打通，因此它更准确的定位是“工艺流程后端内核”，而不是“已经完成的工艺流程产品”。
