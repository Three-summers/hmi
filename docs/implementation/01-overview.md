# 01 · 总览：运行形态、入口与模块边界

本项目是典型的 **Tauri 2 + React(Vite)** 结构：前端负责 UI 与交互，后端负责系统能力（串口/TCP/文件系统/事件推送等）。

## 1. 运行形态（双模）

本项目需要同时支持两种运行方式：

1) **Tauri 模式（桌面应用）**
- 前端运行在 WebView 中，可用 `@tauri-apps/api/*` 与后端通信

2) **浏览器开发模式（vite dev）**
- 直接在浏览器中运行前端
- **无法使用 Tauri API**（因此需要 `isTauri()` 判断 + invoke mock）

源码对应：

- Tauri 环境判断：`src/platform/tauri.ts`（`isTauri()`）
- invoke 抽象：`src/platform/invoke.ts`（Tauri 调用/浏览器 mock 统一入口）
- 事件订阅抽象：`src/platform/events.ts`（Tauri listen 动态 import + 错误收敛）

## 2. 启动入口（前端 / 后端）

### 2.1 前端入口

源码对应：

- `src/main.tsx`：挂载 React、初始化 i18n、引入全局样式
- `src/App.tsx`：渲染 `MainLayout`
- `src/components/layout/MainLayout.tsx`：应用“壳”，安装全局行为（快捷键/缩放/日志桥接/主题等）

字符画：前端启动链

```
main.tsx
  ├─ import "./i18n"
  ├─ import "./styles/*"
  └─ ReactDOM.createRoot(...).render(<App/>)
                     │
                     ▼
App.tsx
  └─ <MainLayout/>
```

### 2.2 后端入口（Rust/Tauri）

源码对应：

- `src-tauri/src/main.rs`：二进制入口（仅调用 `hmi_lib::run()`）
- `src-tauri/src/lib.rs`：Tauri Builder、插件安装、命令注册、状态注入
- `src-tauri/tauri.conf.json`：Tauri 配置（窗口、devUrl、frontendDist）
- `src-tauri/capabilities/default.json`：Tauri 2 capability/permissions（fs/window/log/shell 等）

字符画：Tauri dev 启动链（概念）

```
tauri dev
  ├─ beforeDevCommand: "npm run dev"
  │    └─ Vite dev server: http://localhost:1420   (vite.config.ts)
  └─ Rust backend 启动
       └─ WebView 加载 devUrl
```

## 3. 模块边界（以目录为主）

从“实现原理”角度，本仓库可以按如下模块拆解（后续文档按这些模块深入）：

```
Frontend (src/)
  ├─ platform/          平台抽象（isTauri / invoke / events / window）
  ├─ stores/            状态管理（Zustand）
  ├─ hooks/             副作用与逻辑复用（订阅、图表、重试等）
  ├─ components/layout/ 主布局 + Keep-Alive + 命令系统
  ├─ components/views/  各业务视图（Monitor/Files/Setup/...）
  ├─ i18n/              国际化资源与初始化
  └─ styles/            主题变量与全局样式

Backend (src-tauri/src/)
  ├─ lib.rs              Tauri Builder / plugins / command 注册 / state 注入
  ├─ commands.rs         #[tauri::command] RPC 接口集合
  ├─ comm/               串口/TCP 字节流 + Actor + HMIP 协议封装
  └─ sensor.rs           频谱数据模拟 + 事件推送
```

## 4. “调用”与“推送”两条主干

实现原理里最重要的两条链路：

1) **前端调用后端（RPC / invoke）**

```
UI/Store/Hook
  └─ invoke("command_name", args)         (src/platform/invoke.ts)
       └─ Rust #[tauri::command] fn ...   (src-tauri/src/commands.rs)
```

2) **后端推送前端（Event / emit + listen）**

```
Rust: app.emit("spectrum-data", payload)  (src-tauri/src/sensor.rs)
  └─ Frontend: listen("spectrum-data", cb) (src/platform/events.ts / src/hooks/useSpectrumData.ts)

Rust: app.emit("comm-event", payload)     (src-tauri/src/comm/actor.rs)
  └─ Frontend: useCommEventBridge() -> 写入 commStore 读模型 + 告警映射 (MainLayout 安装)

Rust: app.emit("hmip-event", payload)     (src-tauri/src/comm/actor.rs)
  └─ Frontend: useHmipEventBridge() -> 写入 hmipStore 读模型 + 告警映射 (MainLayout 安装)
```

后续模块文档会围绕这两条主干展开：哪里发起、哪里消费、怎么做性能/错误处理/降级。
