# 08 · 错误处理、重试体系与日志桥接

本章解释项目如何在“前端/后端/跨边界”三个层面处理错误，并把日志打通到终端，便于定位问题。

## 1. 跨边界错误：InvokeError（统一错误形态）

源码对应：`src/platform/invoke.ts`

`invoke()` 会把不同环境的错误收敛为 `InvokeError`：

- `code`：`MOCK_NOT_REGISTERED` / `TAURI_API_UNAVAILABLE` / `INVOKE_FAILED`
- `command/args`：帮助定位调用点
- `cause`：原始错误

字符画：错误收敛点

```
Tauri invoke 抛错 / mock handler 抛错
  └─ normalizeToError -> throw InvokeError{ code=INVOKE_FAILED, ... }
```

为什么重要？

- UI/Store/Hook 层可以用同一种格式处理错误
- 日志里能直接看到 command/args，降低“猜测成本”

## 2. IO 重试：useRetry + withTimeout

源码对应：

- `src/hooks/useRetry.ts`
- `src/utils/async.ts`（`withTimeout/isTimeoutError/sleep`）
- 使用处示例：`src/hooks/useFileTree.ts`、`src/hooks/useFilePreview.ts`、`src/stores/commStore.ts`

设计原则（偏保守）：

- 默认只对 TimeoutError 自动重试（避免把“有副作用的操作”误重放）
- 提供 backoff/jitter，避免同步风暴

字符画：重试循环（概念）

```
for attempt=1..maxAttempts:
  try task()
  catch err:
    if shouldRetry(err) and attempt<maxAttempts:
       sleep(delay(attempt))
       continue
    else:
       throw err
```

## 3. 渲染错误：ErrorBoundary（避免白屏）

源码对应：

- `src/components/common/ErrorBoundary.tsx`
- 使用处：`src/components/layout/MainLayout.tsx`、各视图内部也可局部使用

能力：

- 捕获 render/lifecycle 错误
- 支持 `resetKeys`：关键输入变化自动 reset（例如切换视图）
- fallback UI：降级 + 重试 + 展示错误详情

字符画：局部降级

```
InfoPanel 内某视图渲染抛错
  └─ ErrorBoundary 捕获
       ├─ 显示 fallback（重试按钮）
       └─ 主布局其它区域仍可用（Nav/Command/Title）
```

## 4. 异步错误：useErrorBoundary（把异步错误“转成 render throw”）

源码对应：`src/hooks/useErrorBoundary.ts`

背景：

React ErrorBoundary 捕获不到：

- Promise/async 回调
- 事件回调（click/ResizeObserver）
- setTimeout/rAF

`useErrorBoundary` 的做法：

- 把错误存入 state
- 在下一次 render 时 `throw error`
- 由最近的 ErrorBoundary 捕获

字符画：异步错误上抛

```
async callback catch(err)
  └─ showBoundary(err)
       └─ setError(err)

next render:
  if error -> throw error
  ErrorBoundary catches -> fallback
```

## 5. 图表初始化错误：useChartInit

源码对应：`src/hooks/useChartInit.ts`

目的：

- 把 uPlot/Canvas 初始化可能失败的逻辑从组件中抽离
- 统一 status/error/retry 约定
- 避免图表初始化失败导致整个视图不可用

典型使用：`src/components/views/Monitor/SpectrumChart.tsx`

## 6. 前端日志桥接：console/error -> backend log（可选）

源码对应：

- 前端：`src/hooks/useFrontendLogBridge.ts`
- 后端：`src-tauri/src/commands.rs`（`frontend_log_batch`）
- 后端日志插件：`src-tauri/src/lib.rs`（`tauri-plugin-log` 输出到 stdout）

### 6.1 为什么要桥接？

WebView 内的 console/error 常常看不见或不易汇总（尤其在嵌入式/无 devtools 场景）。

桥接的目标：

- 把前端日志与后端日志统一输出到终端，便于 grep/收集

### 6.2 批量发送与性能策略

前端收集日志到队列，按两种条件 flush：

- 队列达到 `MAX_BATCH_SIZE`
- 超过 `FLUSH_INTERVAL_MS`

字符画：批量 flush

```
console.* / window.error / unhandledrejection
  └─ enqueue(entry)
       ├─ if queue >= MAX_BATCH_SIZE -> flush()
       └─ else setTimeout(FLUSH_INTERVAL_MS) -> flush()

flush()
  └─ invoke("frontend_log_batch", { entries: batch })
```

失败策略：

- 转发失败时静默丢弃（避免影响业务流程）

### 6.3 后端如何输出？

后端遍历 entries，并以 `target="frontend"` 写入 log：

```
log::info!(target: "frontend", "[FE info ts=... src=...] ...")
```

这样终端可以按 target 过滤。

