# 03 · 跨边界（IPC）与平台抽象层

本章解释“前端如何安全地调用后端、如何订阅事件、如何支持浏览器模式”。

## 1. isTauri：运行环境探测

源码对应：`src/platform/tauri.ts`

核心原则：

- 浏览器模式下不能 import/调用 Tauri API（会运行时报错）
- 所以所有“强依赖 Tauri”的逻辑都必须先判断 `isTauri()`

字符画：环境分支

```
isTauri() ?
  ├─ yes -> 可以调用 @tauri-apps/api/*
  └─ no  -> 走 mock / 禁用功能 / 给出 unavailable 提示
```

## 2. invoke：统一的 RPC 调用入口（含浏览器 mock）

源码对应：`src/platform/invoke.ts`

该模块把两种环境收敛为一个入口：

- Tauri：动态 import `@tauri-apps/api/core` 的 `invoke`
- 浏览器：查找本地注册的 mock handler
- 两者都失败：抛 `InvokeError`（携带 `code/command/args/cause`）

字符画：invoke 决策树

```
invoke(command, args)
  ├─ if isTauri()
  │    └─ import("@tauri-apps/api/core").invoke(command,args)
  ├─ else if has mock(command)
  │    └─ mock(args)
  └─ else
       └─ throw InvokeError{ code=MOCK_NOT_REGISTERED, ... }
```

为什么要做这层抽象？

- **开发体验**：浏览器模式下也能跑 UI（通过 mock）
- **测试友好**：单测可以直接 mock invoke 行为（不依赖 Tauri）
- **错误一致**：上层不需要写两套错误处理分支

## 3. window：窗口/全屏的跨平台封装

源码对应：`src/platform/window.ts`

策略：

- Tauri：动态 import `@tauri-apps/api/window`，使用 `getCurrentWindow()`
- 浏览器：使用标准 Fullscreen API

字符画：全屏切换

```
toggleFullscreen()
  ├─ isTauri() -> currentWindow.isFullscreen() / setFullscreen()
  └─ browser  -> document.fullscreenElement / requestFullscreen / exitFullscreen
```

## 4. 事件：listen 与 emit 的“订阅-推送”模型

与 `invoke` 类似，本项目把 Tauri 事件订阅也抽象成统一入口：

- `src/platform/events.ts`：`listen(eventName, handler)`（动态 import `@tauri-apps/api/event`，避免浏览器模式运行时报错）
- 失败时抛 `EventError`（包含 `code/eventName/cause`），便于上层做降级与提示

本项目实时数据采用 **后端推送**（event stream）：

| eventName | 生产者（Rust） | 消费者（TS） | 用途 |
| --- | --- | --- | --- |
| `spectrum-data` | `src-tauri/src/sensor.rs` | `src/hooks/useSpectrumData.ts` | 传感器模拟的频谱数据 |
| `comm-event` | `src-tauri/src/comm/actor.rs` | `src/hooks/useCommEventBridge.ts` | 串口/TCP 通用事件（连接/收发/错误/重连） |
| `hmip-event` | `src-tauri/src/comm/actor.rs` | `src/hooks/useHmipEventBridge.ts` | HMIP 解码结果/解码错误（对接期观测） |

字符画：事件流（Sequence）

```
Frontend (WebView)                         Backend (Rust)
────────────────────────────────────────────────────────────────
listen("spectrum-data", cb)        (src/platform/events.ts：建立监听，拿到 unlisten)
invoke("start_sensor_simulation")  ───────────────► start()
                                               spawn loop
                                     emit("spectrum-data", frame) ──► cb(frame)
                                     emit("spectrum-data", frame) ──► cb(frame)
invoke("stop_sensor_simulation")   ───────────────► stop()
unlisten()  (cleanup)
```

这个模型对 UI 的好处：

- 数据更新频率高（50ms），用事件推送比轮询更直接
- UI 可以按“视图可见性”控制订阅（详见 `06-monitor-spectrum.md`、`04-layout-and-view-lifecycle.md`）

补充：两种常见消费方式

1) **高频数据（如 spectrum-data）**：推荐用 `useTauriEventStream` 把 listen + start/stop + 门控 + 节流做成可复用能力，然后由特化 hook（如 `useSpectrumData`）补充业务统计。

2) **全局“读模型事件”（如 comm-event/hmip-event）**：推荐在 `MainLayout` 安装 bridge hook，把事件写入 Store（并做告警去重），避免每个视图各自订阅导致 Keep-Alive 泄漏。

## 5. 文件系统能力：plugin-fs 的前后端对应

本项目 Files/日志浏览使用 `@tauri-apps/plugin-fs`：

- 前端：`@tauri-apps/plugin-fs`（`readDir/readTextFile`）
  - 代码：`src/hooks/useFileTree.ts`、`src/hooks/useFilePreview.ts`
- 后端：`tauri-plugin-fs`（在 `src-tauri/src/lib.rs` 安装）

额外还有一条“日志目录路径”的 RPC：

- 前端：`invoke("get_log_dir")`
- 后端：`#[tauri::command] get_log_dir(...)`（`src-tauri/src/commands.rs`）

字符画：Files 模块的跨边界组合

```
FilesView
  ├─ useFileTree()
  │    ├─ invoke("get_log_dir")     -> 返回 Log base path
  │    └─ plugin-fs.readDir(path)   -> 目录树
  └─ useFilePreview()
       └─ plugin-fs.readTextFile()  -> 预览/CSV 解析
```

## 6. 一句话总结：平台抽象层的设计目标

平台抽象层（`src/platform/*`）的核心不是“封装 API”，而是：

- 让上层业务代码**尽可能不关心**自己运行在 Tauri 还是浏览器
- 把差异集中在少数入口（`isTauri`/`invoke`/`events`/`window`）
