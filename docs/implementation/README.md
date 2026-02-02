# 实现原理（按模块拆解）

本文档目录用于**对照源码**解释本项目的实现原理。与 `docs/architecture.md` 的“架构层面”不同，这里更强调：

- 以模块为单位拆解（前端/后端/跨边界）
- 明确指出“代码在什么位置、由谁调用、数据如何流动”
- 解释尽量用字符画（ASCII）把调用链、数据流、状态变化画出来

> 建议阅读顺序：先看 `01-overview.md` 把“运行形态 + 入口 + 边界”搞清楚，再按你关心的模块下钻。

## 快速导航

- `01-overview.md`：项目运行形态（Tauri / 浏览器模式）与入口总览
- `02-backend-rust.md`：Rust 后端（Tauri 2）启动、命令、事件推送
- `03-ipc-and-platform.md`：前后端边界（invoke / event listen）与平台抽象层
- `04-layout-and-view-lifecycle.md`：主布局、Keep-Alive 视图系统、命令面板系统
- `05-state-stores.md`：Zustand 状态管理（app/nav/alarm/comm/spectrum/notification）
- `06-monitor-spectrum.md`：Monitor 频谱链路（Sensor → Event → Hook → Canvas/uPlot）
- `07-files-log-viewer.md`：Files/日志目录链路（get_log_dir → fs readDir/readTextFile → CSV 图表）
- `08-error-retry-logging.md`：错误处理、重试体系、前端日志桥接
- `09-theme-scale-i18n.md`：主题/缩放/i18n 的实现方式与联动点
- `10-testing-strategy.md`：单元测试与 mock 策略（Vitest/JSDOM/依赖注入）
- `11-hmip-binary-protocol.md`：HMIP 二进制协议（帧格式/CRC/消息类型/事件流）

## 约定：如何在文档里“对照源码”

文档里会用如下方式引用源码位置（不写行号，方便代码调整后仍可定位）：

- 路径：`src/components/layout/MainLayout.tsx`
- 函数/类型：`useSpectrumData()`、`CommState`、`SensorSimulator::start()`

遇到不确定的细节，文档会给出“如何定位”的建议（例如 `rg` 搜索关键字）。

## 总览：项目的“前后端”边界

```
┌──────────────────────────────┐
│          Frontend            │
│  React + TS + Vite           │
│  代码：src/                  │
└───────────────┬──────────────┘
                │ invoke / event listen
                │  - invoke: src/platform/invoke.ts (动态 import @tauri-apps/api/core)
                │  - listen: src/platform/events.ts (动态 import @tauri-apps/api/event)
                ▼
┌──────────────────────────────┐
│           Backend             │
│  Rust + Tauri 2 + Tokio       │
│  代码：src-tauri/src/         │
└──────────────────────────────┘
```

关键点：

- **调用（RPC）**：前端通过 `src/platform/invoke.ts` 统一入口调用后端 `#[tauri::command]`
- **推送（Event）**：后端通过 `app.emit(...)` 推送多条事件流，前端通过 `src/platform/events.ts` 统一入口订阅
  - `spectrum-data`：传感器模拟的 SpectrumData（Monitor 频谱链路）
  - `comm-event`：串口/TCP 连接/收发/错误等通用事件（写入 commStore 读模型）
  - `hmip-event`：HMIP 协议解码结果/解码错误（写入 hmipStore 读模型）
- **双模运行**：浏览器模式下没有 Tauri API，需要 `isTauri()` 分支与 invoke/events 的降级策略（详见 `03-ipc-and-platform.md`）
