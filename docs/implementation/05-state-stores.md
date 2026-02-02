# 05 · 状态管理（Zustand）：Store 划分与交互

本章解释 `src/stores/` 的划分原则，以及各 Store 在运行时如何互相配合。

## 1. 总览：有哪些 Store？

源码对应：`src/stores/`

- `appStore.ts`：全局设置（语言/主题/布局/缩放）、会话、系统消息
- `navigationStore.ts`：主视图切换、历史栈、对话框状态、未完成任务标记
- `alarmStore.ts`：告警列表 + 未确认计数（持久化）
- `notificationStore.ts`：Toast 通知列表（内存态）
- `commStore.ts`：通信操作 + `comm-event` 读模型（invoke + timeout + 错误收敛 + 事件聚合）
- `hmipStore.ts`：`hmip-event` 读模型（协议解码事件统计 + 有限长度事件日志）
- `spectrumAnalyzerStore.ts`：频谱分析参数（持久化）+ 运行时缓存（MaxHold/Average/瀑布图缓冲）

字符画：Store 与 UI 的关系（概念）

```
MainLayout
  ├─ appStore        (theme/scale/调试开关)
  ├─ navigationStore (currentView)
  ├─ alarmStore      (徽标/高亮/列表)
  └─ notificationStore (toast)

Views
  ├─ Setup -> appStore + commStore + navigationStore(dialogState)
  ├─ Monitor -> spectrumAnalyzerStore + alarmStore
  └─ Files -> appStore(theme) + hooks 内部状态
```

## 2. appStore：全局设置 + 部分持久化

源码对应：`src/stores/appStore.ts`

关键点：

- 使用 `zustand/middleware` 的 `persist`
- 只持久化 UI 设置（language/theme/commandPanelPosition/scaleOverride）
- 不持久化 `user` 与 `debugLogBridgeEnabled`（避免“自动登录/调试开关残留”）
- `setLanguage` 会同步调用 i18n：`i18n.changeLanguage(lang)`

字符画：持久化策略

```
persist(name="hmi-app-storage")
  partialize:
    - language
    - theme
    - commandPanelPosition
    - scaleOverride
```

## 3. navigationStore：视图切换与对话框状态隔离

源码对应：`src/stores/navigationStore.ts`

关键字段：

- `currentView`：当前主视图
- `viewHistory`：历史栈（最多 10 条）用于 goBack
- `viewDialogStates`：按视图隔离的“对话框/子状态”
  - 例如 Setup 的 activeTab：`viewDialogStates.setup?.activeTab`
- `unfinishedTasks`：用于导航按钮高亮提示

字符画：历史栈与切换

```
setCurrentView(next)
  viewHistory.push(prevCurrent)
  viewHistory = last 10
  currentView = next

goBack()
  currentView = viewHistory.pop() || "jobs"
```

字符画：对话框状态隔离

```
viewDialogStates: {
  setup: { activeTab: "communication" }
  files: undefined
  ...
}
```

## 4. alarmStore：告警历史持久化 + 未确认计数

源码对应：`src/stores/alarmStore.ts`

关键点：

- `persist` + `createJSONStorage` 持久化到 localStorage
- `reviver` 把 `timestamp` 字符串还原为 `Date`
- 维护 `unacknowledgedAlarmCount` / `unacknowledgedWarningCount`
- 内部 `alarmIdCounter` 会在 hydration 后同步（避免 ID 重复）

字符画：持久化与恢复

```
persist(name="hmi-alarm-storage")
  storage reviver:
    if key=="timestamp" -> new Date(value)
  onRehydrateStorage:
    state.setAlarms(state.alarms)  (同步计数器与未确认计数)
```

## 5. notificationStore：内存态 Toast 队列

源码对应：`src/stores/notificationStore.ts`

特点：

- 不持久化（通知是瞬时状态）
- `addNotification` 会设置 `setTimeout` 到期自动移除

字符画：生命周期

```
addNotification(...)
  ├─ push notifications[]
  └─ setTimeout(duration) -> removeNotification(id)
```

## 6. commStore：通信操作 = 状态 + RPC 封装

源码对应：`src/stores/commStore.ts`

核心价值：

- 把“UI 按钮点击”变成类型化的异步动作：connect/disconnect/send/listPorts
- 所有后端交互统一走 `src/platform/invoke.ts`
- 统一做 `withTimeout` + `toErrorMessage`，并写入 `lastError`
- 同时维护后端 `comm-event` 的读模型（status/计数/文本预览/事件日志），便于 UI selector 使用
- 提供 HMIP 发送 API：前端 payload → Rust 封帧 → Transport 写入

字符画：前端 config 到后端 config 的字段映射

```
SerialConfig (TS, camelCase)
  baudRate  -> baud_rate
  dataBits  -> data_bits
  stopBits  -> stop_bits

invoke("connect_serial", { config: { ...snake_case... } })
```

## 7. hmipStore：协议事件读模型（hmip-event）

源码对应：`src/stores/hmipStore.ts`

定位：

- 收敛后端 `hmip-event`（Rust 已完成 HMIP 解码）到前端 selector-friendly 的读模型
- 维护有限长度的事件日志（默认上限 200），便于调试与回放

与 UI 的职责边界约定：

- bridge（`useHmipEventBridge`）负责：订阅事件、错误/解码失败告警映射与去重
- store（`hmipStore`）负责：统计字段聚合 + 事件日志存储（避免把 UI 语义写进数据层）

## 8. spectrumAnalyzerStore：配置持久化 + 实时缓存

源码对应：`src/stores/spectrumAnalyzerStore.ts`

该 store 同时承载两类数据：

1) **配置项（持久化）**
- `threshold/historyDepth/refreshRate/colorScheme`

2) **运行时状态（不持久化）**
- `isPaused`
- `maxHoldData/averageData/averageCount`
- `waterfallBuffer/bufferHead`（环形缓冲区）

字符画：只持久化配置，不写入实时数据

```
persist(name="spectrum-analyzer-config")
  partialize:
    threshold/historyDepth/refreshRate/colorScheme
```

字符画：瀑布图环形缓冲区（概念）

```
capacity = historyDepth
bufferHead = 下次写入位置

pushWaterfallRow(row)
  if len < capacity:
     push(row)
     head = len % capacity
  else:
     buffer[head] = row
     head = (head + 1) % capacity
```

> 对“频谱链路”的详细解释见 `06-monitor-spectrum.md`。
