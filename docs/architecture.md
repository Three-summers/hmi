# HMI 系统架构文档

> 基于 SEMI E95 规范的工业人机界面系统

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [系统架构总览](#3-系统架构总览)
4. [分层架构](#4-分层架构)
5. [目录结构](#5-目录结构)
6. [前端架构详解](#6-前端架构详解)
7. [后端架构详解](#7-后端架构详解)
8. [数据流转图](#8-数据流转图)
9. [状态管理架构](#9-状态管理架构)
10. [通信架构](#10-通信架构)
11. [视图系统](#11-视图系统)
12. [视图命令系统](#12-视图命令系统)
13. [平台抽象层](#13-平台抽象层)
14. [国际化架构](#14-国际化架构)
15. [主题系统](#15-主题系统)
16. [响应式缩放系统](#16-响应式缩放系统)
17. [测试架构](#17-测试架构)
18. [部署架构](#18-部署架构)

---

## 1. 项目概述

HMI（Human-Machine Interface）是一个基于 **SEMI E95** 规范设计的工业人机界面系统，采用 **Tauri + React** 技术栈构建。系统主要用于半导体制造设备的监控、配置和操作控制。

### 1.1 核心特性

- **SEMI E95 合规**：遵循半导体设备通信标准的 UI 规范
- **跨平台支持**：通过 Tauri 实现 Windows/Linux/macOS 桌面应用
- **双模运行**：支持 Tauri WebView 和纯浏览器开发模式
- **工业级通信**：内置串口和 TCP 通信能力
- **实时监控**：频谱数据实时可视化
- **国际化**：中英文双语支持
- **主题切换**：深色/浅色/高对比度主题

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **KISS** | 保持简单，避免过度设计 |
| **YAGNI** | 只实现当前需要的功能 |
| **关注点分离** | 前后端职责清晰划分 |
| **平台无关** | 前端通过抽象层隔离平台差异 |

---

## 2. 技术栈

### 2.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3.x | UI 框架 |
| TypeScript | 5.6.x | 类型安全 |
| Zustand | 5.0.x | 状态管理 |
| i18next | 24.x | 国际化 |
| uPlot | 1.6.x | 高性能图表 |
| Vite | 6.0.x | 构建工具 |
| CSS Modules | - | 样式隔离 |
| **Vitest** | **3.x** | **单元测试框架** |
| **@testing-library/react** | **16.x** | **React 组件测试** |
| **jsdom** | **26.x** | **DOM 环境模拟** |

### 2.2 后端 (Tauri)

| 技术 | 版本 | 用途 |
|------|------|------|
| Rust | stable | 系统编程 |
| Tauri | 2.0.x | 桌面应用框架 |
| Tokio | - | 异步运行时 |
| tokio-serial | - | 串口通信 |
| serde | - | 序列化 |

---

## 3. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        HMI 应用系统                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Presentation Layer                      │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐  │  │
│  │  │TitlePanel│ │InfoPanel│ │NavPanel │ │ CommandPanel   │  │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘  │  │
│  │                         ▼                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │                   View Registry                      │  │  │
│  │  │  Jobs | System | Monitor | Recipes | Files | Setup  │  │  │
│  │  │               Alarms | Help                          │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    State Management                        │  │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  │  │
│  │  │ appStore  │ │ navStore  │ │alarmStore │ │ commStore │  │  │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Platform Abstraction                     │  │
│  │  ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐  │  │
│  │  │   invoke.ts   │ │   tauri.ts    │ │   window.ts     │  │  │
│  │  └───────────────┘ └───────────────┘ └─────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    ▼                   ▼                        │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │   Browser Mock       │  │       Tauri IPC Bridge           │ │
│  │  (Development Mode)  │  │      (Production Mode)           │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                     Tauri Backend (Rust)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      Commands Layer                        │  │
│  │  get_log_dir | get_serial_ports | connect_serial | ...    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Service Layer                           │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │  │
│  │  │   Serial    │ │    TCP      │ │  SensorSimulator    │  │  │
│  │  │ Connection  │ │ Connection  │ │                     │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Hardware / Network                       │  │
│  │  Serial Ports (RS232/RS485) | TCP Sockets | File System   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 分层架构

### 4.1 架构分层图

```
┌────────────────────────────────────────────────────────────────┐
│                    Layer 1: Presentation                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React Components (TSX)                                   │  │
│  │  • Layout: MainLayout, TitlePanel, NavPanel, etc.        │  │
│  │  • Views: Jobs, Monitor, Setup, Alarms, etc.             │  │
│  │  • Common: Button, Dialog, StatusIndicator, etc.         │  │
│  └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                    Layer 2: Application Logic                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hooks & Utilities                                        │  │
│  │  • useKeyboardShortcuts - 全局快捷键                      │  │
│  │  • useFrontendLogBridge - 日志桥接                        │  │
│  │  • useAsync - 异步操作封装                                │  │
│  │  • useNotify - 通知触发                                   │  │
│  │  • useConfirm - 确认对话框                                │  │
│  │  **• useStoreWhenActive - Keep-Alive 订阅门控**          │  │
│  │  **• useIntervalWhenActive - Keep-Alive 定时器门控**     │  │
│  │  **• useSpectrumData - 频谱数据订阅（统一 hook）**        │  │
│  │  **• useFileTree - 文件树状态管理**                       │  │
│  │  **• useFilePreview - 文件预览逻辑**                      │  │
│  │  **• useChartData - 图表数据处理**                        │  │
│  │  **• useCommandHandler - 命令交互逻辑**                   │  │
│  │  **• useRetry - 重试策略**                                │  │
│  │  **• useErrorBoundary - 错误边界**                        │  │
│  └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                    Layer 3: State Management                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Zustand Stores                                           │  │
│  │  • appStore - 全局应用状态（主题/语言/会话）              │  │
│  │  • navigationStore - 视图导航状态                         │  │
│  │  • alarmStore - 告警管理（持久化）                        │  │
│  │  • commStore - 通信状态管理                               │  │
│  │  • notificationStore - 通知队列                           │  │
│  └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                    Layer 4: Platform Abstraction                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Platform Bridge                                          │  │
│  │  • invoke.ts - Tauri RPC 调用封装                         │  │
│  │  • tauri.ts - 环境检测 (isTauri)                          │  │
│  │  • window.ts - 窗口操作封装                               │  │
│  └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                    Layer 5: Backend Services                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Rust Tauri Backend                                       │  │
│  │  • commands.rs - Tauri 命令入口                           │  │
│  │  • comm/serial.rs - 串口通信服务                          │  │
│  │  • comm/tcp.rs - TCP 通信服务                             │  │
│  │  • sensor.rs - 传感器数据模拟                             │  │
│  └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                    Layer 6: Infrastructure                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  System Resources                                         │  │
│  │  • Serial Ports (RS232/RS485/USB)                        │  │
│  │  • TCP/IP Network                                         │  │
│  │  • File System (Log Directory)                            │  │
│  │  • LocalStorage (State Persistence)                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 各层职责

| 层级 | 职责 | 技术实现 |
|------|------|----------|
| Presentation | UI 渲染、用户交互 | React + CSS Modules |
| Application Logic | 业务逻辑、副作用管理 | React Hooks |
| State Management | 状态存储、状态变更 | Zustand |
| Platform Abstraction | 平台差异隔离 | TypeScript 封装 |
| Backend Services | 系统资源访问、通信 | Rust + Tauri |
| Infrastructure | 硬件/OS 资源 | 串口、网络、文件系统 |

---

## 5. 目录结构

```
hmi/
├── docs/                           # 文档目录
│   ├── architecture.md             # 架构文档（本文件）
│   ├── EXTENSION_GUIDE.md          # 扩展指南（如何添加视图/命令）
│   ├── dev-plan.md                 # 开发计划
│   ├── HMI_ARCHITECTURE.md         # HMI 架构说明
│   ├── SEMI_E95_UI_Guide.md        # SEMI E95 UI 指南
│   └── raspberry-pi-deploy/        # 树莓派部署文档
│
├── src/                            # 前端源码
│   ├── App.tsx                     # 应用入口组件
│   ├── main.tsx                    # React 挂载入口
│   ├── constants.ts                # 应用常量配置
│   ├── vite-env.d.ts               # Vite 类型声明
│   │
│   ├── components/                 # React 组件
│   │   ├── common/                 # 通用组件
│   │   │   ├── Button.tsx          # 按钮
│   │   │   ├── Dialog.tsx          # 对话框
│   │   │   ├── ErrorBoundary.tsx   # **错误边界组件**
│   │   │   ├── Icons.tsx           # 图标库
│   │   │   ├── StatusIndicator.tsx # 状态指示器
│   │   │   ├── Tabs.tsx            # 标签页
│   │   │   └── index.ts            # 导出入口
│   │   │
│   │   ├── layout/                 # 布局组件
│   │   │   ├── MainLayout.tsx      # 主布局
│   │   │   ├── TitlePanel.tsx      # 标题面板（重构：三段式结构）
│   │   │   ├── TitleSection.tsx    # **标题段组件**
│   │   │   ├── InfoSection.tsx     # **信息段组件**
│   │   │   ├── CommandSection.tsx  # **命令段组件**
│   │   │   ├── InfoPanel.tsx       # 信息面板（视图容器）
│   │   │   ├── NavPanel.tsx        # 导航面板
│   │   │   ├── CommandPanel.tsx    # 命令面板
│   │   │   ├── ViewCommandContext.tsx    # 视图命令上下文
│   │   │   ├── SubViewCommandContext.tsx # 子视图命令上下文
│   │   │   ├── NotificationToast.tsx # 通知弹出
│   │   │   └── ViewContext.tsx     # 视图上下文
│   │   │
│   │   └── views/                  # 业务视图
│   │       ├── Jobs/               # 作业视图
│   │       ├── System/             # 系统视图
│   │       ├── Monitor/            # 监控视图（重构：拆分为子组件）
│   │       │   ├── index.tsx       # 视图主入口（366 行，原 1032 行）
│   │       │   ├── SpectrumAnalyzer.tsx  # **频谱分析仪子组件**
│   │       │   ├── SpectrumChart.tsx     # **频谱图表**
│   │       │   ├── WaterfallChart.tsx    # **瀑布图子组件**
│   │       │   ├── WaterfallCanvas.tsx   # **瀑布图 Canvas**
│   │       │   └── AlarmList.tsx         # **告警列表子组件**
│   │       ├── Recipes/            # 配方视图
│   │       ├── Files/              # 文件视图（重构：拆分为子组件）
│   │       │   ├── index.tsx       # 视图主入口（重构后）
│   │       │   ├── FileTreePanel.tsx     # **文件树面板**
│   │       │   ├── FilePreviewPanel.tsx  # **文件预览面板**
│   │       │   └── ChartPanel.tsx        # **图表面板**
│   │       ├── Setup/              # 设置视图
│   │       ├── Alarms/             # 告警视图
│   │       └── Help/               # 帮助视图
│   │
│   ├── hmi/                        # HMI 核心配置
│   │   └── viewRegistry.tsx        # 视图注册表
│   │
│   ├── hooks/                      # 自定义 Hooks
│   │   ├── index.ts                # 导出入口
│   │   ├── useAsync.ts             # 异步操作
│   │   ├── useConfirm.ts           # 确认对话框
│   │   ├── useFrontendLogBridge.ts # 日志桥接
│   │   ├── useKeyboardShortcuts.ts # 键盘快捷键
│   │   ├── useNotify.ts            # 通知触发
│   │   ├── useHMIScale.ts          # HMI 缩放系统（rem + 动态根字号）
│   │   ├── useCanvasScale.ts       # Canvas 缩放适配
│   │   ├── **useStoreWhenActive.ts**  # **Keep-Alive 订阅门控**
│   │   ├── **useIntervalWhenActive.ts** # **Keep-Alive 定时器门控**
│   │   ├── **useSpectrumData.ts**    # **频谱数据订阅 hook**
│   │   ├── **useFileTree.ts**        # **文件树状态管理**
│   │   ├── **useFilePreview.ts**     # **文件预览逻辑**
│   │   ├── **useChartData.ts**       # **图表数据处理**
│   │   ├── **useCommandHandler.ts**  # **命令交互逻辑**
│   │   ├── **useRetry.ts**           # **重试策略 hook**
│   │   └── **useErrorBoundary.ts**   # **错误边界 hook**
│   │
│   ├── i18n/                       # 国际化
│   │   ├── index.ts                # i18next 配置
│   │   └── locales/                # 语言包
│   │       ├── zh.json             # 中文
│   │       └── en.json             # 英文
│   │
│   ├── platform/                   # 平台抽象层
│   │   ├── invoke.ts               # Tauri RPC 封装（增强：InvokeError）
│   │   ├── tauri.ts                # 环境检测
│   │   └── window.ts               # 窗口操作
│   │
│   ├── stores/                     # 状态管理
│   │   ├── index.ts                # 导出入口
│   │   ├── appStore.ts             # 应用状态
│   │   ├── navigationStore.ts      # 导航状态
│   │   ├── alarmStore.ts           # 告警状态
│   │   ├── commStore.ts            # 通信状态（优化：timeout 中文）
│   │   └── notificationStore.ts    # 通知状态
│   │
│   ├── styles/                     # 全局样式
│   │   ├── global.css              # 全局样式（优化：动效简化）
│   │   ├── variables.css           # CSS 变量（统一：4px tokens、本地字体）
│   │   └── components/             # 组件样式
│   │
│   ├── utils/                      # 工具函数
│   │   ├── index.ts                # 导出入口
│   │   ├── **async.ts**            # **统一异步工具（withTimeout, TimeoutError）**
│   │   ├── **error.ts**            # **错误处理工具（toErrorMessage）**
│   │   ├── readCssVar.ts           # 动态读取 CSS 变量
│   │   ├── parseCssColorToRgb.ts   # 解析 CSS 颜色为 RGB
│   │   └── withAlpha.ts            # 添加透明度到 RGB
│   │
│   ├── types/                      # 类型定义
│   │   ├── index.ts                # 导出入口
│   │   ├── semi-e95.ts             # SEMI E95 UI 类型（完善：CommandButtonConfig）
│   │   └── comm.ts                 # 通信类型
│   │
│   └── **test/**                   # **测试配置**
│       └── **setup.ts**            # **Vitest 全局测试配置**
│
├── src-tauri/                      # Tauri 后端
│   ├── Cargo.toml                  # Rust 依赖配置
│   ├── tauri.conf.json             # Tauri 配置
│   ├── build.rs                    # 构建脚本
│   │
│   ├── src/                        # Rust 源码
│   │   ├── main.rs                 # 入口
│   │   ├── lib.rs                  # 库入口
│   │   ├── commands.rs             # Tauri 命令
│   │   ├── sensor.rs               # 传感器模拟
│   │   └── comm/                   # 通信模块
│   │       ├── mod.rs              # 模块入口
│   │       ├── serial.rs           # 串口通信
│   │       └── tcp.rs              # TCP 通信
│   │
│   └── Log/                        # 日志目录
│
├── tests/                          # 测试代码
├── index.html                      # HTML 入口
├── package.json                    # NPM 配置
├── tsconfig.json                   # TypeScript 配置
├── vite.config.ts                  # Vite 配置
└── **vitest.config.ts**            # **Vitest 测试配置（90% 覆盖率阈值）**
```

---

## 6. 前端架构详解

### 6.1 组件层次结构

```
App
└── MainLayout                      # 主布局壳（包含 ErrorBoundary）
    ├── TitlePanel                  # 顶部：标题、状态、操作按钮（重构：三段式）
    │   ├── InfoSection             # 左侧：设备信息区
    │   ├── TitleSection            # 中央：标题 + 状态指示器
    │   └── CommandSection          # 右侧：窗口命令（缩放/登录/全屏）
    ├── InfoPanel                   # 中央：视图容器（Keep-Alive）
    │   └── ViewContextProvider     # 视图上下文（isActive 判断）
    │       └── KeptAliveView       # 缓存的视图包装器
    │           └── [View Component] # 具体视图（示例见下）
    │               ├── Monitor/    # 监控视图（重构：拆分为子组件）
    │               │   ├── 概览 Tab: WaterfallChart + AlarmList
    │               │   └── 频谱分析仪 Tab: SpectrumAnalyzer
    │               │       ├── SpectrumChart（频谱图）
    │               │       └── WaterfallCanvas（瀑布图）
    │               ├── Files/      # 文件视图（重构：拆分为子组件）
    │               │   ├── FileTreePanel（文件树）
    │               │   ├── FilePreviewPanel（预览）
    │               │   └── ChartPanel（图表）
    │               └── ...         # 其他视图（Jobs/System/...）
    ├── CommandPanel                # 侧边：上下文命令按钮
    ├── NavPanel                    # 底部：主导航按钮
    └── NotificationToast           # 浮层：通知弹出
```

**重构亮点**：
- **TitlePanel**：由单体 637 行拆分为 InfoSection/TitleSection/CommandSection，职责清晰
- **Monitor**：由 1032 行拆分为 366 行主入口 + 多个子组件（SpectrumAnalyzer/WaterfallChart/AlarmList）
- **Files**：由 1375 行拆分为多个子组件（FileTreePanel/FilePreviewPanel/ChartPanel）
- **共享数据源**：WaterfallChart 与 SpectrumAnalyzer 复用 `useSpectrumData` hook，确保数据一致性

### 6.2 视图生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                     InfoPanel (Keep-Alive)                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  Jobs   │    │ Monitor │    │  Setup  │    │ Alarms  │  │
│  │ (active)│    │(hidden) │    │(hidden) │    │(hidden) │  │
│  │ visible │    │ mounted │    │ mounted │    │  lazy   │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│       ▲                                                      │
│       │ currentView === "jobs"                               │
│                                                              │
│  策略：                                                       │
│  • 首次访问：懒加载（React.lazy）                            │
│  • 切换后：保持挂载，通过 hidden 属性隐藏                     │
│  • ViewContext：提供 isActive 状态供子组件判断               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 组件通信模式

```
┌──────────────────────────────────────────────────────────────┐
│                      Component Communication                  │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Props 传递（父 → 子）                                     │
│     MainLayout → NavPanel (currentView, onViewChange)        │
│                                                               │
│  2. Zustand Store（跨组件共享）                               │
│     useNavigationStore() → currentView, setCurrentView       │
│     useAlarmStore() → alarms, addAlarm, acknowledgeAlarm     │
│                                                               │
│  3. Context（局部共享）                                       │
│     ViewContextProvider → useIsViewActive()                  │
│                                                               │
│  4. 命令上下文（视图 → CommandPanel）                         │
│     ViewCommandProvider:                                     │
│       视图: useRegisterViewCommands(id, commands, enabled)   │
│       面板: useViewCommandState() → commandsByView           │
│     SubViewCommandProvider:                                  │
│       子视图: useRegisterSubViewCommands(id, cmds, enabled)  │
│       面板: useSubViewCommandState() → subCommandsByView     │
│                                                               │
│  5. Event Emitter（Tauri → Frontend）                        │
│     Rust: app.emit("spectrum-data", &data)                   │
│     React: listen("spectrum-data", callback)                 │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. 后端架构详解

### 7.1 Rust 模块结构

```
src-tauri/src/
├── main.rs                 # 应用入口（生成 main 函数）
├── lib.rs                  # 库入口（Tauri Builder 配置）
│   ├── 插件注册
│   │   ├── tauri_plugin_log      # 日志插件
│   │   ├── tauri_plugin_shell    # Shell 插件
│   │   └── tauri_plugin_fs       # 文件系统插件
│   │
│   ├── 命令注册
│   │   └── invoke_handler(...)   # 注册所有 Tauri 命令
│   │
│   └── 状态管理
│       ├── CommState             # 通信状态
│       └── SensorSimulator       # 传感器模拟器
│
├── commands.rs             # Tauri 命令定义
│   ├── get_log_dir               # 获取日志目录
│   ├── get_serial_ports          # 列出可用串口
│   ├── connect_serial            # 连接串口
│   ├── disconnect_serial         # 断开串口
│   ├── send_serial_data          # 发送串口数据
│   ├── connect_tcp               # 连接 TCP
│   ├── disconnect_tcp            # 断开 TCP
│   ├── send_tcp_data             # 发送 TCP 数据
│   ├── start_sensor_simulation   # 启动传感器模拟
│   ├── stop_sensor_simulation    # 停止传感器模拟
│   └── frontend_log_batch        # 前端日志批量转发
│
├── sensor.rs               # 传感器数据模拟
│   ├── SpectrumData              # 频谱数据结构
│   └── SensorSimulator           # 模拟器状态机
│
└── comm/                   # 通信模块
    ├── mod.rs                    # 模块入口 + CommState
    ├── serial.rs                 # 串口通信
    │   ├── SerialConfig          # 配置结构
    │   ├── SerialConnection      # 连接管理
    │   └── list_ports()          # 枚举端口
    └── tcp.rs                    # TCP 通信
        ├── TcpConfig             # 配置结构
        └── TcpConnection         # 连接管理
```

### 7.2 Tauri 命令调用流程

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  Frontend  │────▶│  invoke()  │────▶│   IPC      │────▶│  Tauri     │
│  (React)   │     │ (TS/JS)    │     │  Bridge    │     │  Command   │
│            │◀────│            │◀────│            │◀────│  (Rust)    │
└────────────┘     └────────────┘     └────────────┘     └────────────┘
     │                   │                  │                  │
     │  commStore.       │  invoke(         │  serialize       │  #[tauri::command]
     │  connectSerial()  │  "connect_serial"│  JSON params     │  pub async fn
     │                   │  {config})       │                  │  connect_serial()
     │                   │                  │                  │
     │◀──────────────────│◀─────────────────│◀─────────────────│
     │  Promise<void>    │  Result<T>       │  deserialize     │  Result<(), String>
     │                   │                  │  JSON response   │
```

---

## 8. 数据流转图

### 8.1 用户操作 → 状态更新 → UI 渲染

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Interaction Flow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌────────┐ │
│  │   User    │───▶│  Event    │───▶│   Store   │───▶│  React │ │
│  │  Action   │    │  Handler  │    │  Update   │    │ Render │ │
│  └───────────┘    └───────────┘    └───────────┘    └────────┘ │
│       │                │                │                │      │
│       │                │                │                │      │
│  点击导航按钮     onClick回调      setCurrentView()    组件重渲染 │
│  (Jobs → Monitor)    触发            更新 store        新视图显示 │
│                                                                  │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  示例：导航切换                                                   │
│                                                                  │
│  NavPanel                                                        │
│    │                                                             │
│    └──▶ onClick={() => onViewChange("monitor")}                 │
│              │                                                   │
│              └──▶ useNavigationStore.setCurrentView("monitor")  │
│                        │                                         │
│                        └──▶ state.currentView = "monitor"       │
│                                   │                              │
│                                   └──▶ MainLayout re-render     │
│                                             │                    │
│                                             └──▶ InfoPanel       │
│                                                  显示 MonitorView│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 实时数据流（传感器模拟 → 图表）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Real-time Data Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Rust Backend                          Frontend (React)          │
│  ────────────                          ─────────────────         │
│                                                                  │
│  ┌───────────────────┐                                          │
│  │ SensorSimulator   │                                          │
│  │                   │                                          │
│  │  loop (50ms) {    │                                          │
│  │    data = gen()   │                                          │
│  │    emit(data)     │─────┐                                    │
│  │  }                │     │                                    │
│  └───────────────────┘     │                                    │
│                            │                                    │
│                            │  Tauri Event                       │
│                            │  "spectrum-data"                   │
│                            │                                    │
│                            ▼                                    │
│                    ┌───────────────────┐                        │
│                    │ useSpectrumData   │ **统一数据订阅 Hook**   │
│                    │ (共享 hook)       │                        │
│                    │                   │                        │
│                    │ • listen()        │                        │
│                    │ • start_sensor    │                        │
│                    │ • stop_sensor     │                        │
│                    │ • retry()         │                        │
│                    └───────────────────┘                        │
│                            │                                    │
│                   ┌────────┴────────┐                           │
│                   ▼                 ▼                           │
│          ┌────────────────┐  ┌────────────────┐                │
│          │ WaterfallChart │  │SpectrumAnalyzer│                │
│          │ (概览 Tab)     │  │ (频谱分析 Tab) │                │
│          │                │  │                │                │
│          │ onFrame: {     │  │ onFrame: {     │                │
│          │   setAmplitudes│  │   setFreqs     │                │
│          │ }              │  │   setAmps      │                │
│          └────────────────┘  │   updateMaxHold│                │
│                              │   updateAverage│                │
│                              └────────────────┘                │
│                                      │                          │
│                                      ▼                          │
│                              ┌────────────────┐                │
│                              │ SpectrumChart  │                │
│                              │ + WaterfallCanvas               │
│                              │ (uPlot 渲染)   │                │
│                              └────────────────┘                │
│                                                                  │
│  数据结构：                                                       │
│  SpectrumData {                                                 │
│    timestamp: u64,          // 时间戳                            │
│    frequencies: Vec<f64>,   // 频率数组 (0-10kHz)               │
│    amplitudes: Vec<f64>,    // 幅值数组 (dB)                    │
│    peak_frequency: f64,     // 峰值频率                          │
│    peak_amplitude: f64,     // 峰值幅值                          │
│    average_amplitude: f64   // 平均幅值                          │
│  }                                                               │
│                                                                  │
│  **关键设计**：                                                   │
│  • WaterfallChart 与 SpectrumAnalyzer 使用相同的               │
│    useSpectrumData hook，确保数据源一致性                        │
│  • hook 内部统一管理 listen/invoke/错误处理，避免重复实现        │
│  • 支持 isActive 门控，inactive 视图自动停止订阅                 │
│  • 提供 retry() 方法，用于错误后重试                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 通信数据流（串口/TCP）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Communication Data Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────┐      ┌────────────┐      ┌────────────────────┐ │
│  │ Setup View │─────▶│ commStore  │─────▶│ invoke()           │ │
│  │ (React)    │      │ (Zustand)  │      │ "connect_serial"   │ │
│  └────────────┘      └────────────┘      └────────────────────┘ │
│                             │                      │             │
│                             │                      ▼             │
│                             │            ┌────────────────────┐ │
│                             │            │ commands.rs        │ │
│                             │            │ connect_serial()   │ │
│                             │            └────────────────────┘ │
│                             │                      │             │
│                             │                      ▼             │
│                             │            ┌────────────────────┐ │
│                             │            │ SerialConnection   │ │
│                             │            │ ::new(config)      │ │
│                             │            └────────────────────┘ │
│                             │                      │             │
│                             │                      ▼             │
│                             │            ┌────────────────────┐ │
│                             │            │ tokio_serial       │ │
│                             │            │ open_native_async()│ │
│                             │            └────────────────────┘ │
│                             │                      │             │
│                             │                      ▼             │
│                             │            ┌────────────────────┐ │
│                             │            │ Physical Serial    │ │
│                             │            │ Port (Hardware)    │ │
│                             │            └────────────────────┘ │
│                             │                                    │
│  ◀──────────────────────────┴────────────────────────────────── │
│  状态更新：                                                       │
│  • serialConnected: true                                        │
│  • serialConfig: {...}                                          │
│  • lastError: undefined                                         │
│                                                                  │
│  错误处理：                                                       │
│  try {                                                          │
│    await invokeWithTimeout(...)                                 │
│    set({ serialConnected: true })                               │
│  } catch (error) {                                              │
│    set({ lastError: message })                                  │
│    options?.onError?.(message, error)                           │
│    throw error  // 继续向上抛出                                   │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. 状态管理架构

### 9.1 Store 拓扑图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Zustand Store Topology                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     appStore (全局)                          ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │  user: UserSession | null        # 会话（不持久化）   │    ││
│  │  │  language: "zh" | "en"           # 语言（持久化）     │    ││
│  │  │  theme: ThemeId                  # 主题（持久化）     │    ││
│  │  │  commandPanelPosition: "left"|"right" # 布局（持久化）│    ││
│  │  │  debugLogBridgeEnabled: boolean  # 调试开关（持久化） │    ││
│  │  │  message: string                 # 系统消息           │    ││
│  │  │  messageType: "info"|"warning"|"alarm"|null          │    ││
│  │  └─────────────────────────────────────────────────────┘    ││
│  │  持久化: localStorage (hmi-app-storage)                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                  navigationStore (导航)                      ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │  currentView: ViewId             # 当前视图           │    ││
│  │  │  viewHistory: ViewId[]           # 历史栈（最近10条）  │    ││
│  │  │  unfinishedTasks: Record<ViewId, boolean>            │    ││
│  │  │  viewDialogStates: Partial<ViewDialogStateMap>       │    ││
│  │  └─────────────────────────────────────────────────────┘    ││
│  │  持久化: 无                                                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    alarmStore (告警)                         ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │  alarms: AlarmItem[]             # 告警列表           │    ││
│  │  │  unacknowledgedAlarmCount: number                    │    ││
│  │  │  unacknowledgedWarningCount: number                  │    ││
│  │  └─────────────────────────────────────────────────────┘    ││
│  │  持久化: localStorage (hmi-alarm-storage)                    ││
│  │  特殊处理: 恢复时将 timestamp 字符串还原为 Date              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     commStore (通信)                         ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │  serialConnected: boolean                            │    ││
│  │  │  tcpConnected: boolean                               │    ││
│  │  │  serialConfig?: SerialConfig                         │    ││
│  │  │  tcpConfig?: TcpConfig                               │    ││
│  │  │  lastError?: string                                  │    ││
│  │  └─────────────────────────────────────────────────────┘    ││
│  │  持久化: 无                                                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                notificationStore (通知)                      ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │  notifications: Notification[]   # 通知队列           │    ││
│  │  └─────────────────────────────────────────────────────┘    ││
│  │  持久化: 无                                                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Store 使用最佳实践

```typescript
// 推荐：使用 selector 只订阅必要字段
const { currentView, setCurrentView } = useNavigationStore(
    useShallow((state) => ({
        currentView: state.currentView,
        setCurrentView: state.setCurrentView,
    })),
);

// 不推荐：全量订阅会导致任意字段变化都触发重渲染
const state = useNavigationStore();
```

---

## 10. 通信架构

### 10.1 通信协议支持

```
┌─────────────────────────────────────────────────────────────────┐
│                    Communication Protocols                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Serial (RS232/RS485)                    │  │
│  │                                                            │  │
│  │  参数：                                                     │  │
│  │  • port: string          (e.g., "/dev/ttyUSB0", "COM1")   │  │
│  │  • baud_rate: u32        (9600, 19200, 38400, 57600, 115200)│ │
│  │  • data_bits: u8         (5, 6, 7, 8)                     │  │
│  │  • stop_bits: u8         (1, 2)                           │  │
│  │  • parity: string        ("none", "odd", "even")          │  │
│  │                                                            │  │
│  │  操作：                                                     │  │
│  │  • list_ports() → Vec<String>                             │  │
│  │  • connect(config) → Result<(), String>                   │  │
│  │  • send(data) → Result<(), String>                        │  │
│  │  • receive(buffer) → Result<usize, String>                │  │
│  │  • disconnect() → Result<(), String>                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                         TCP                                │  │
│  │                                                            │  │
│  │  参数：                                                     │  │
│  │  • host: string          (e.g., "127.0.0.1", "192.168.1.1")│ │
│  │  • port: u16             (1-65535)                        │  │
│  │  • timeout_ms: u64       (默认 5000ms)                    │  │
│  │                                                            │  │
│  │  操作：                                                     │  │
│  │  • connect(config) → Result<(), String>                   │  │
│  │  • send(data) → Result<(), String>                        │  │
│  │  • receive(buffer) → Result<usize, String>                │  │
│  │  • disconnect() → Result<(), String>                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 通信状态机

```
┌─────────────────────────────────────────────────────────────────┐
│                    Connection State Machine                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                      ┌──────────────┐                           │
│                      │  Disconnected │                           │
│                      │  (Initial)    │                           │
│                      └───────┬───────┘                           │
│                              │                                   │
│                    connect() │                                   │
│                              ▼                                   │
│                      ┌──────────────┐                           │
│             ┌────────│  Connecting  │────────┐                  │
│             │        └──────────────┘        │                  │
│             │                                │                  │
│      timeout│                         success│                  │
│             ▼                                ▼                  │
│     ┌──────────────┐                ┌──────────────┐           │
│     │    Error     │                │  Connected   │◀──┐       │
│     │              │                │              │   │       │
│     └──────┬───────┘                └───────┬──────┘   │       │
│            │                                │          │       │
│            │                      send()    │    recv()│       │
│            │                                ▼          │       │
│            │                       ┌──────────────┐   │       │
│            │                       │ Communicating│───┘       │
│            │                       └──────────────┘           │
│            │                                │                  │
│            │                     disconnect()                   │
│            │                                │                  │
│            └────────────────────────────────┼──────────────────│
│                                             ▼                  │
│                                      ┌──────────────┐          │
│                                      │  Disconnected │          │
│                                      └──────────────┘          │
│                                                                  │
│  状态存储：                                                       │
│  • serialConnected / tcpConnected: boolean                      │
│  • serialConfig / tcpConfig: 当前配置                            │
│  • lastError: 最近一次错误信息                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. 视图系统

### 11.1 视图注册表架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      View Registry System                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  viewRegistry.tsx                                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  HMI_NAV_ITEMS: HmiNavItem[]                              │  │
│  │  ┌───────────────────────────────────────────────────┐    │  │
│  │  │ { id: "jobs",    labelKey: "nav.jobs",    icon }  │    │  │
│  │  │ { id: "system",  labelKey: "nav.system",  icon }  │    │  │
│  │  │ { id: "monitor", labelKey: "nav.monitor", icon }  │    │  │
│  │  │ { id: "recipes", labelKey: "nav.recipes", icon }  │    │  │
│  │  │ { id: "files",   labelKey: "nav.files",   icon }  │    │  │
│  │  │ { id: "setup",   labelKey: "nav.setup",   icon }  │    │  │
│  │  │ { id: "alarms",  labelKey: "nav.alarms",  icon }  │    │  │
│  │  │ { id: "help",    labelKey: "nav.help",    icon }  │    │  │
│  │  └───────────────────────────────────────────────────┘    │  │
│  │                                                            │  │
│  │  HMI_VIEW_COMPONENTS: Record<ViewId, LazyExoticComponent> │  │
│  │  ┌───────────────────────────────────────────────────┐    │  │
│  │  │ jobs:    lazy(() => import("views/Jobs"))         │    │  │
│  │  │ system:  lazy(() => import("views/System"))       │    │  │
│  │  │ monitor: lazy(() => import("views/Monitor"))      │    │  │
│  │  │ recipes: lazy(() => import("views/Recipes"))      │    │  │
│  │  │ files:   lazy(() => import("views/Files"))        │    │  │
│  │  │ setup:   lazy(() => import("views/Setup"))        │    │  │
│  │  │ alarms:  lazy(() => import("views/Alarms"))       │    │  │
│  │  │ help:    lazy(() => import("views/Help"))         │    │  │
│  │  └───────────────────────────────────────────────────┘    │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  使用方式：                                                       │
│  • NavPanel: 遍历 HMI_NAV_ITEMS 渲染导航按钮                     │
│  • InfoPanel: 通过 HMI_VIEW_COMPONENTS[viewId] 渲染视图          │
│                                                                  │
│  图标说明：                                                       │
│  • HMI_NAV_ITEMS 中的 icon 为内联 SVG JSX Element               │
│  • 从 Material Design Icons 获取 SVG 路径                        │
│  • 保持视觉一致性，避免硬编码字符串图标                           │
│                                                                  │
│  扩展方式：                                                       │
│  1. 在 views/ 下新建视图组件                                      │
│  2. 在 viewRegistry.tsx 添加注册项                               │
│  3. 在 types/semi-e95.ts 的 ViewId 中添加 ID                     │
│  4. （可选）注册视图命令到 ViewCommandContext                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 SEMI E95 视图映射

| ViewId | 视图名称 | SEMI E95 对应 | 功能描述 |
|--------|----------|---------------|----------|
| jobs | Jobs | Job Control | 作业/批次管理 |
| system | System | Equipment Status | 设备状态监控 |
| monitor | Monitor | Process Monitoring | 过程数据监控 |
| recipes | Recipes | Recipe Management | 配方管理 |
| files | Files | File Management | 文件浏览管理 |
| setup | Setup | Equipment Setup | 设备配置/通信设置 |
| alarms | Alarms | Alarm Management | 告警管理 |
| help | Help | Online Help | 在线帮助 |

---

## 12. 视图命令系统

### 12.1 双层命令架构

系统支持两层命令注册机制，实现视图与 CommandPanel 的解耦：

- **ViewCommandContext**：主视图级命令（如 Monitor 视图的刷新、暂停、导出）
- **SubViewCommandContext**：子视图级命令（如 Monitor 视图内 Spectrum Analyzer Tab 的特有命令）

```
┌─────────────────────────────────────────────────────────────────┐
│               Command System Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ViewCommandProvider                                            │
│  ├── ViewCommandActionsContext (稳定引用)                        │
│  │   ├── setViewCommands(viewId, commands[])                   │
│  │   ├── clearViewCommands(viewId)                             │
│  │   └── showConfirm({ title, message, onConfirm })            │
│  └── ViewCommandStateContext (响应式状态)                        │
│      ├── commandsByView: Partial<Record<ViewId, Commands[]>>   │
│      ├── confirmState: { isOpen, title, message }              │
│      ├── closeConfirm()                                         │
│      └── handleConfirm()                                        │
│                                                                  │
│  SubViewCommandProvider                                         │
│  ├── SubViewCommandActionsContext                              │
│  │   ├── setSubViewCommands(viewId, commands[])                │
│  │   └── clearSubViewCommands(viewId)                          │
│  └── SubViewCommandStateContext                                │
│      └── subCommandsByView: Partial<Record<ViewId, Commands[]>>│
│                                                                  │
│  CommandPanel (消费者)                                           │
│  ├── 读取 commandsByView[currentView]                           │
│  ├── 读取 subCommandsByView[currentView]                        │
│  ├── 合并渲染所有命令按钮                                        │
│  └── 显示统一确认弹窗                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 命令注册流程

#### 主视图命令注册

视图通过 `useRegisterViewCommands` Hook 注册命令：

```typescript
// 示例：Monitor/index.tsx
import { useRegisterViewCommands } from '@/components/layout/ViewCommandContext';
import { useIsViewActive } from '@/components/layout/ViewContext';

const commands = useMemo<CommandButtonConfig[]>(() => [
  { id: 'refresh', labelKey: 'common.refresh', onClick: handleRefresh },
  { id: 'pause', labelKey: 'common.pause', onClick: handlePause },
  { id: 'export', labelKey: 'monitor.exportData', onClick: handleExport }
], [handleRefresh, handlePause, handleExport]);

useRegisterViewCommands('monitor', commands, useIsViewActive());
```

#### 子视图命令注册

子视图（如 Tabs）通过 `useRegisterSubViewCommands` Hook 注册命令：

```typescript
// 示例：Monitor 视图的 Spectrum Analyzer Tab
const isSpectrumAnalyzerTabActive = isViewActive && activeTab === 'spectrum-analyzer';

const subCommands = useMemo<CommandButtonConfig[]>(() => {
  if (!isSpectrumAnalyzerTabActive) return [];  // 未激活时必须返回空数组
  return [
    { id: 'start', labelKey: '...', onClick: ... },
    { id: 'reset', labelKey: '...', onClick: ... }
  ];
}, [isSpectrumAnalyzerTabActive, ...]);

useRegisterSubViewCommands('monitor', subCommands, isSpectrumAnalyzerTabActive);
```

### 12.3 性能优化设计

#### Context 拆分策略

为适配 Keep-Alive 场景（InfoPanel 缓存已访问视图，多视图长期挂载），系统将 Context 拆分为 Actions 和 State 两层：

| Context 类型 | 包含内容 | 更新频率 | 订阅者 |
|-------------|---------|---------|--------|
| **ActionsContext** | 稳定的注册函数（`setViewCommands`, `showConfirm`） | 几乎不变 | 各视图组件 |
| **StateContext** | 响应式状态（`commandsByView`, `confirmState`） | 频繁变化 | CommandPanel |

**优势**：
- 视图注册命令时不会因其他视图的状态变化而重渲染
- 仅 CommandPanel 订阅状态变化，精确控制渲染范围

#### useLayoutEffect 减少闪烁

命令注册使用 `useLayoutEffect` 而非 `useEffect`，在浏览器绘制前同步更新 CommandPanel，避免视图切换时命令面板闪烁。

#### Keep-Alive 兼容

- `enabled` 参数控制命令激活：`enabled=false` 时自动清理命令
- 子视图命令在 Tab 切换时必须返回空数组，防止残留

### 12.4 确认对话框机制

通过 ViewCommandContext 统一管理确认对话框：

```typescript
const { showConfirm } = useViewCommandActions();

const handleDelete = () => {
  showConfirm({
    title: t('dialog.confirmDelete'),
    message: t('dialog.deleteMessage'),
    onConfirm: () => performDelete()
  });
};
```

**特性**：
- 对话框由 CommandPanel 统一渲染，避免各视图重复实现
- 支持标题、消息、确认/取消回调
- 自动处理关闭逻辑

### 12.5 命令配置选项

```typescript
interface CommandButtonConfig {
  id: string;                  // 命令ID，用于图标映射（CommandIcons[id]）
  labelKey: string;            // i18n key
  onClick?: () => void;        // 点击回调
  disabled?: boolean;          // 可选：禁用状态
  highlight?: HighlightStatus; // 可选：高亮状态
  behavior?: ButtonBehavior;   // 可选：按钮行为（'momentary' | 'toggle'）
}

type HighlightStatus = 'none' | 'alarm' | 'warning' | 'processing' | 'attention';
```

---

## 13. 平台抽象层

### 13.1 双模运行架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Platform Abstraction Layer                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  src/platform/                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  tauri.ts - 环境检测                                       │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  export function isTauri(): boolean {               │  │  │
│  │  │    return typeof window !== "undefined"             │  │  │
│  │  │           && window.__TAURI_INTERNALS__ !== undefined│  │  │
│  │  │  }                                                  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  invoke.ts - RPC 调用封装                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  export async function invoke<T>(cmd, args): T {    │  │  │
│  │  │    if (isTauri()) {                                 │  │  │
│  │  │      // 动态 import Tauri API，避免浏览器报错          │  │  │
│  │  │      const { invoke } = await import("@tauri/api"); │  │  │
│  │  │      return invoke<T>(cmd, args);                   │  │  │
│  │  │    }                                                │  │  │
│  │  │    // 浏览器模式：查找 mock handler                   │  │  │
│  │  │    const handler = invokeMocks.get(cmd);            │  │  │
│  │  │    if (handler) return handler(args);               │  │  │
│  │  │    throw new Error("Tauri not available");          │  │  │
│  │  │  }                                                  │  │  │
│  │  │                                                     │  │  │
│  │  │  export function registerInvokeMock(cmd, handler) { │  │  │
│  │  │    invokeMocks.set(cmd, handler);                   │  │  │
│  │  │  }                                                  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  window.ts - 窗口操作封装                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  export async function minimizeWindow() { ... }     │  │  │
│  │  │  export async function maximizeWindow() { ... }     │  │  │
│  │  │  export async function closeWindow() { ... }        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  运行模式：                                                       │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │  Tauri WebView      │    │  Browser Dev Mode   │            │
│  │  (Production)       │    │  (Development)      │            │
│  │                     │    │                     │            │
│  │  isTauri() = true   │    │  isTauri() = false  │            │
│  │  → 调用真实后端      │    │  → 使用 Mock        │            │
│  └─────────────────────┘    └─────────────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 13.2 Mock 注册示例

```typescript
// 在开发模式下注册 mock
if (!isTauri()) {
    registerInvokeMock("get_serial_ports", () => {
        return ["/dev/ttyUSB0", "/dev/ttyACM0", "COM1"];
    });

    registerInvokeMock("connect_serial", (args) => {
        console.log("Mock: Connecting to", args.config.port);
        return Promise.resolve();
    });
}
```

---

## 14. 国际化架构

### 14.1 i18n 配置结构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Internationalization (i18n)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  src/i18n/                                                      │
│  ├── index.ts          # i18next 初始化配置                      │
│  └── locales/                                                   │
│      ├── zh.json       # 中文语言包                              │
│      └── en.json       # 英文语言包                              │
│                                                                  │
│  配置说明：                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  i18n                                                      │  │
│  │    .use(initReactI18next)                                 │  │
│  │    .init({                                                 │  │
│  │      resources: { zh, en },                               │  │
│  │      lng: "zh",              // 默认语言                   │  │
│  │      fallbackLng: "en",      // 回退语言                   │  │
│  │      interpolation: {                                      │  │
│  │        escapeValue: false    // React 已处理 XSS          │  │
│  │      }                                                     │  │
│  │    });                                                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  语言包结构示例 (zh.json)：                                       │
│  {                                                               │
│    "nav": {                                                     │
│      "jobs": "作业",                                             │
│      "system": "系统",                                           │
│      "monitor": "监控",                                          │
│      ...                                                         │
│    },                                                            │
│    "common": {                                                   │
│      "loading": "加载中...",                                     │
│      "confirm": "确认",                                          │
│      "cancel": "取消",                                           │
│      ...                                                         │
│    },                                                            │
│    "alarms": {                                                   │
│      "title": "告警管理",                                        │
│      "acknowledge": "确认",                                      │
│      ...                                                         │
│    }                                                             │
│  }                                                               │
│                                                                  │
│  使用方式：                                                       │
│  const { t } = useTranslation();                                │
│  <span>{t("nav.jobs")}</span>  // 输出：作业                     │
│                                                                  │
│  语言切换：                                                       │
│  const { setLanguage } = useAppStore();                         │
│  setLanguage("en");  // 切换到英文，同步更新 i18n 和 store       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 15. 主题系统

### 15.1 CSS 变量驱动的主题切换

```
┌─────────────────────────────────────────────────────────────────┐
│                        Theme System                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  实现方式：通过 data-theme 属性切换 CSS 变量                       │
│                                                                  │
│  src/styles/variables.css                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  :root {                                                   │  │
│  │    /* 默认主题变量（深色） */                                │  │
│  │    --color-bg-primary: #1a1a2e;                           │  │
│  │    --color-bg-secondary: #16213e;                         │  │
│  │    --color-text-primary: #ffffff;                         │  │
│  │    --color-accent: #0066cc;                               │  │
│  │    ...                                                     │  │
│  │  }                                                         │  │
│  │                                                            │  │
│  │  [data-theme="light"] {                                   │  │
│  │    --color-bg-primary: #f5f5f5;                           │  │
│  │    --color-bg-secondary: #ffffff;                         │  │
│  │    --color-text-primary: #1a1a1a;                         │  │
│  │    ...                                                     │  │
│  │  }                                                         │  │
│  │                                                            │  │
│  │  [data-theme="high-contrast"] {                           │  │
│  │    --color-bg-primary: #000000;                           │  │
│  │    --color-text-primary: #ffffff;                         │  │
│  │    --color-accent: #ffff00;                               │  │
│  │    ...                                                     │  │
│  │  }                                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  切换逻辑 (MainLayout.tsx)：                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  useEffect(() => {                                         │  │
│  │    document.documentElement.dataset.theme = theme;        │  │
│  │  }, [theme]);                                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  主题顺序 (constants.ts)：                                       │
│  THEME_ORDER = ["dark", "light", "high-contrast"]               │
│                                                                  │
│  循环切换 (appStore.ts)：                                        │
│  cycleTheme: () => set((state) => {                             │
│    const idx = THEME_ORDER.indexOf(state.theme);                │
│    return { theme: THEME_ORDER[(idx + 1) % THEME_ORDER.length] }│
│  })                                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 15.2 主题变量清单

| 变量类别 | 变量名 | 用途 |
|----------|--------|------|
| 背景色 | --color-bg-primary | 主背景 |
| | --color-bg-secondary | 次级背景 |
| | --color-bg-panel | 面板背景 |
| 文字色 | --color-text-primary | 主文字 |
| | --color-text-secondary | 次级文字 |
| | --color-text-muted | 弱化文字 |
| 强调色 | --color-accent | 主强调色 |
| | --color-accent-hover | 悬停态 |
| 状态色 | --color-alarm | 告警红 |
| | --color-warning | 警告黄 |
| | --color-success | 成功绿 |
| | --color-info | 信息蓝 |
| 过渡 | --transition-fast | 快速 (120ms) |
| | --transition-normal | 正常 (200ms) |
| | --transition-slow | 慢速 (350ms) |

### 15.3 动态颜色读取

系统支持运行时读取 CSS 变量值，用于 Canvas 绘图、图表渲染等场景：

```typescript
import { readCssVar, parseCssColorToRgb, withAlpha } from '@/utils';

// 读取 CSS 变量
const accentColor = readCssVar('--accent-primary');  // "#0ea5e9"

// 解析颜色为 RGB
const [r, g, b] = parseCssColorToRgb(accentColor)!;  // [14, 165, 233]

// 添加透明度
const rgba = withAlpha([r, g, b], 0.5);  // "rgba(14, 165, 233, 0.5)"
```

**应用场景**：
- uPlot 图表动态主题适配
- Canvas 2D 绘图颜色同步
- 动画渐变效果

---

## 16. 响应式缩放系统

### 16.1 缩放架构概览

HMI 采用 **rem 变量 + 动态根字号** 的统一缩放方案，确保所有组件在不同分辨率下保持一致的空间比例与视觉协调性。

```
┌─────────────────────────────────────────────────────────────────┐
│                   Responsive Scaling System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  useHMIScale Hook (全局缩放)                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  监听窗口尺寸变化                                           │  │
│  │       ▼                                                    │  │
│  │  计算缩放因子                                               │  │
│  │  fontSize = max(12, (currentWidth / 1280) * 16 * override)│  │
│  │       ▼                                                    │  │
│  │  更新 document.documentElement.style.fontSize              │  │
│  │       ▼                                                    │  │
│  │  所有 rem 单位自动响应                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            │                                     │
│                            ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                CSS Variables (rem)                         │  │
│  │  --sp-xs-rem: 0.25rem      (4px @ 1x)                     │  │
│  │  --sp-sm-rem: 0.5rem       (8px @ 1x)                     │  │
│  │  --sp-md-rem: 1rem         (16px @ 1x)                    │  │
│  │  --button-min-size-rem: 3.75rem  (60px @ 1x)              │  │
│  │  --font-size-normal-rem: 0.875rem (14px @ 1x)             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│  ┌──────────┐      ┌──────────┐      ┌──────────────┐          │
│  │  Layout  │      │  Common  │      │    View      │          │
│  │Components│      │Components│      │  Components  │          │
│  │          │      │          │      │              │          │
│  │ padding  │      │ gap      │      │ Canvas需特殊处理│        │
│  │ margin   │      │ size     │      │              │          │
│  │ width    │      │ radius   │      │    ▼         │          │
│  └──────────┘      └──────────┘      └──────┬───────┘          │
│                                              │                  │
│                                              ▼                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  useCanvasScale Hook (Canvas 专用)                         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  监听根字号变化                                      │  │  │
│  │  │       ▼                                             │  │  │
│  │  │  scaleFactor = currentFontSize / 16                 │  │  │
│  │  │       ▼                                             │  │  │
│  │  │  所有 Canvas 绘制操作乘以 scaleFactor                │  │  │
│  │  │  (文字、坐标、padding、lineWidth 等)                │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 核心 Hooks

#### useHMIScale

**文件**: `src/hooks/useHMIScale.ts`

**功能**: 全局 HMI 缩放系统，通过动态调整根元素字号实现 rem 单位的响应式缩放。

**缩放公式**:
```typescript
const baseFontSize = 16;  // 基准字号 (px)
const baseWidth = 1280;   // 基准宽度 (px)

fontSize = max(12, (currentWidth / baseWidth) * baseFontSize * scaleOverride)
```

**特性**:
- 自动监听窗口 resize 事件
- 支持手动缩放倍率 (`scaleOverride`，范围 0.75x - 2.0x)
- 最小字号限制 12px，防止过小不可读
- 在 `MainLayout` 中调用，全局生效

**示例**:
```typescript
// MainLayout.tsx
import { useHMIScale } from '@/hooks';

export function MainLayout() {
    useHMIScale();  // 启用全局缩放
    // ...
}
```

#### useCanvasScale

**文件**: `src/hooks/useCanvasScale.ts`

**功能**: 为 Canvas 2D 绘图提供缩放因子，使 Canvas 元素能够响应 `useHMIScale` 的字号变化。

**计算公式**:
```typescript
scaleFactor = currentRootFontSize / baseFontSize
```

**监听机制**:
- `window.resize` 事件
- `MutationObserver` 监听 `document.documentElement` 的 `style`/`class`/`data-theme` 属性变化

**使用方式**:
```typescript
// SpectrumChart.tsx
import { useCanvasScale } from '@/hooks';

const scaleFactor = useCanvasScale(16);

// 绘制时乘以 scaleFactor
ctx.font = `bold ${15 * scaleFactor}px system-ui`;
ctx.fillRect(x * scaleFactor, y * scaleFactor, w * scaleFactor, h * scaleFactor);
```

### 16.3 CSS 变量体系

**文件**: `src/styles/variables.css`

#### 双单位变量

每个尺寸变量提供 **px** 和 **-rem** 两个版本，优先使用 rem 变量：

```css
:root {
    /* 间距 */
    --sp-xs: 4px;
    --sp-xs-rem: 0.25rem;   /* 优先使用 */

    --sp-sm: 8px;
    --sp-sm-rem: 0.5rem;

    --sp-md: 16px;
    --sp-md-rem: 1rem;

    /* 按钮 */
    --button-min-size: 70px;
    --button-min-size-rem: 3.75rem;  /* 优先使用 */

    /* 字号 */
    --font-size-xs: 10px;
    --font-size-xs-rem: 0.625rem;   /* 优先使用 */

    --font-size-normal: 14px;
    --font-size-normal-rem: 0.875rem;
}
```

#### 面板尺寸

```css
:root {
    --title-panel-height: 80px;
    --title-panel-height-rem: 5rem;

    --nav-panel-height: 80px;
    --nav-panel-height-rem: 5rem;

    --command-panel-width: 180px;
    --command-panel-width-rem: 11.25rem;
}
```

#### 响应式断点

统一的断点标准（使用 px，不受缩放影响）：

```css
:root {
    --breakpoint-sm: 600px;
    --breakpoint-md: 900px;
    --breakpoint-lg: 1200px;
    --breakpoint-xl: 1600px;
}
```

### 16.4 响应式策略

#### 媒体查询

全局响应式调整（`src/styles/global.css`）：

```css
@media (max-width: 1200px) {
    :root {
        --command-panel-width: 160px;
    }
}

@media (max-width: 900px) {
    :root {
        --command-panel-width: 140px;
        --button-min-size: 60px;
    }
}
```

#### 组件级适配

单个组件的响应式调整（如 `Monitor.module.css`）：

```css
@media (max-width: 1200px) {
    .monitor {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 900px) {
    .monitor {
        padding: var(--sp-sm-rem);
    }
}
```

### 16.5 最佳实践

#### 1. 组件样式

✅ **推荐**：使用 rem 变量 + `var()` 回退
```css
.button {
    padding: var(--sp-sm-rem, var(--sp-sm));
    font-size: var(--font-size-normal-rem, var(--font-size-normal));
    min-height: var(--button-min-size-rem, var(--button-min-size));
}
```

❌ **不推荐**：硬编码 px 值
```css
.button {
    padding: 8px;
    font-size: 14px;
    min-height: 60px;
}
```

#### 2. Canvas 绘图

✅ **推荐**：使用 `useCanvasScale` Hook
```typescript
const scaleFactor = useCanvasScale(16);

ctx.font = `${14 * scaleFactor}px sans-serif`;
ctx.fillText(text, x * scaleFactor, y * scaleFactor);
```

❌ **不推荐**：固定 px 值
```typescript
ctx.font = '14px sans-serif';  // 不会响应缩放
ctx.fillText(text, x, y);
```

#### 3. 内联样式

✅ **推荐**：使用 rem 单位
```typescript
<div style={{ padding: 'var(--sp-md-rem, 1rem)' }}>
```

❌ **不推荐**：硬编码 px
```typescript
<div style={{ padding: '16px' }}>
```

### 16.6 缩放控制

用户可在 **Setup → 显示设置** 中调整全局缩放倍率：

```typescript
// appStore.ts
interface AppState {
    scaleOverride: number;  // 0.75 ~ 2.0
    setScaleOverride: (scale: number) => void;
}

// 使用
const { scaleOverride, setScaleOverride } = useAppStore();
setScaleOverride(1.5);  // 放大到 1.5x
```

**效果**：
- 1.0x (默认)：16px 根字号，1rem = 16px
- 1.5x：24px 根字号，1rem = 24px
- 2.0x：32px 根字号，1rem = 32px

### 16.7 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 组件不随缩放变化 | 使用了硬编码 px 值 | 改用 rem 变量 |
| Canvas 绘图模糊 | 未应用 `scaleFactor` | 使用 `useCanvasScale` Hook |
| 文字过小不可读 | 缩放倍率过小 | 检查 `scaleOverride`，最小值 0.75x |
| 布局错位 | 混用 px 和 rem | 统一使用 rem 变量 |
| 响应式断点失效 | 断点值使用了 rem | 断点必须使用 px |

---

## 17. 测试架构

### 17.1 测试框架概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Testing Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  测试框架：Vitest + React Testing Library (RTL)                 │
│  环境：jsdom（模拟浏览器 DOM）                                   │
│  覆盖率工具：v8（Vitest 内置）                                   │
│  覆盖率目标：≥90%（全局阈值）                                    │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   vitest.config.ts                         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ • environment: 'jsdom'                              │  │  │
│  │  │ • globals: true（支持 describe/it 全局 API）        │  │  │
│  │  │ • setupFiles: ['src/test/setup.ts']                │  │  │
│  │  │ • coverage.provider: 'v8'                           │  │  │
│  │  │ • coverage.thresholds: {                            │  │  │
│  │  │     lines: 90, branches: 90,                        │  │  │
│  │  │     functions: 90, statements: 90                   │  │  │
│  │  │   }                                                 │  │  │
│  │  │ • coverage.include: [                               │  │  │
│  │  │     'src/components/**/*.{ts,tsx}',                 │  │  │
│  │  │     'src/hooks/**/*.ts',                            │  │  │
│  │  │     'src/stores/**/*.ts',                           │  │  │
│  │  │     'src/utils/**/*.ts'                             │  │  │
│  │  │   ]                                                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 17.2 测试文件组织

```
src/
├── components/
│   ├── common/
│   │   ├── Button.tsx
│   │   └── __tests__/
│   │       └── Button.test.tsx           # 组件单元测试
│   ├── layout/
│   │   ├── TitlePanel.tsx
│   │   ├── InfoSection.tsx
│   │   └── __tests__/
│   │       ├── TitlePanel.test.tsx
│   │       ├── InfoSection.test.tsx
│   │       └── CommandSection.test.tsx
│   └── views/
│       ├── Monitor/
│       │   ├── SpectrumAnalyzer.tsx
│       │   └── __tests__/
│       │       ├── SpectrumAnalyzer.test.tsx
│       │       └── WaterfallChart.test.tsx
│       └── Files/
│           ├── FileTreePanel.tsx
│           └── __tests__/
│               ├── FileTreePanel.test.tsx
│               ├── FilePreviewPanel.test.tsx
│               └── ChartPanel.test.tsx
│
├── hooks/
│   ├── useSpectrumData.ts
│   ├── useSpectrumData.test.ts          # Hook 单元测试
│   ├── useStoreWhenActive.ts
│   ├── useStoreWhenActive.test.ts
│   ├── useRetry.ts
│   └── useRetry.test.ts
│
├── stores/
│   ├── appStore.ts
│   └── __tests__/
│       ├── appStore.test.ts             # Store 单元测试
│       └── commStore.test.ts
│
└── utils/
    ├── async.ts
    └── __tests__/
        ├── async.test.ts                # 工具函数单元测试
        └── error.test.ts
```

**组织原则**：
- 组件测试：与组件同级的 `__tests__/` 目录
- Hook/Store/Utils 测试：与源文件同级的 `.test.ts` 文件
- 测试文件命名：`<源文件名>.test.ts(x)`

### 17.3 测试分类与策略

#### 组件测试

**目标**：验证 UI 渲染、用户交互、状态变化

**示例（TitlePanel.test.tsx）**：
```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TitlePanel from '../TitlePanel';

describe('TitlePanel', () => {
  it('renders InfoSection, TitleSection, CommandSection', () => {
    render(<TitlePanel />);
    expect(screen.getByTestId('info-section')).toBeInTheDocument();
    expect(screen.getByTestId('title-section')).toBeInTheDocument();
    expect(screen.getByTestId('command-section')).toBeInTheDocument();
  });

  it('handles login/logout command', async () => {
    const user = userEvent.setup();
    render(<TitlePanel />);

    const loginBtn = screen.getByRole('button', { name: /login/i });
    await user.click(loginBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

**覆盖要求**：
- 所有渲染分支（ready/loading/error/empty）
- 用户交互（点击、输入、键盘事件）
- Props 变化触发的重渲染
- 条件渲染逻辑

#### Hook 测试

**目标**：验证状态管理、副作用、边界条件

**示例（useSpectrumData.test.ts）**：
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSpectrumData } from '../useSpectrumData';

describe('useSpectrumData', () => {
  beforeEach(() => {
    vi.mock('@/platform/invoke');
  });

  it('returns loading status initially', () => {
    const { result } = renderHook(() =>
      useSpectrumData({ enabled: true })
    );
    expect(result.current.status).toBe('loading');
  });

  it('transitions to ready when data received', async () => {
    const { result } = renderHook(() =>
      useSpectrumData({ enabled: true })
    );

    // 模拟事件触发
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
  });

  it('provides retry function on error', async () => {
    const { result } = renderHook(() =>
      useSpectrumData({ enabled: true })
    );

    // 模拟错误
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    // 测试重试
    result.current.retry();
    expect(result.current.status).toBe('loading');
  });
});
```

**覆盖要求**：
- 初始化状态
- 副作用触发（useEffect/useLayoutEffect）
- 依赖项变化
- 清理函数（cleanup）
- 错误处理

#### Store 测试

**目标**：验证状态变更、持久化、选择器

**示例（appStore.test.ts）**：
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({ language: 'zh', theme: 'dark' });
  });

  it('updates language and persists to localStorage', () => {
    useAppStore.getState().setLanguage('en');
    expect(useAppStore.getState().language).toBe('en');

    const stored = JSON.parse(
      localStorage.getItem('hmi-app-storage') || '{}'
    );
    expect(stored.state.language).toBe('en');
  });

  it('cycles through themes', () => {
    const { cycleTheme } = useAppStore.getState();

    cycleTheme(); // dark -> light
    expect(useAppStore.getState().theme).toBe('light');

    cycleTheme(); // light -> high-contrast
    expect(useAppStore.getState().theme).toBe('high-contrast');
  });
});
```

**覆盖要求**：
- 状态初始化
- 同步/异步 action
- 持久化逻辑
- 选择器函数

#### 工具函数测试

**目标**：验证纯函数逻辑、边界值、异常处理

**示例（async.test.ts）**：
```typescript
import { describe, it, expect, vi } from 'vitest';
import { withTimeout, TimeoutError } from '../async';

describe('withTimeout', () => {
  it('resolves when promise completes within timeout', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('success');
  });

  it('rejects with TimeoutError when promise exceeds timeout', async () => {
    const promise = new Promise((resolve) =>
      setTimeout(() => resolve('too late'), 2000)
    );

    await expect(
      withTimeout(promise, 100, 'Operation timed out')
    ).rejects.toThrow(TimeoutError);
  });
});
```

**覆盖要求**：
- 正常路径（happy path）
- 边界值（空输入、最大值、负数）
- 异常路径（错误输入、超时）
- 类型边界（TypeScript 泛型）

### 17.4 测试命令

```bash
# 运行所有测试
npm run test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 运行测试（UI 模式）
npm run test:ui

# 监听模式（开发时）
npm run test -- --watch

# 运行单个测试文件
npm run test -- src/hooks/useSpectrumData.test.ts

# 运行匹配模式的测试
npm run test -- --grep "useSpectrumData"
```

### 17.5 覆盖率报告

**生成路径**：`coverage/index.html`

**示例输出**：
```
-----------------------------|---------|----------|---------|---------|
File                         | % Stmts | % Branch | % Funcs | % Lines |
-----------------------------|---------|----------|---------|---------|
All files                    |   92.34 |    91.78 |   93.12 |   92.56 |
 src/components/common       |   94.21 |    93.45 |   95.00 |   94.33 |
  Button.tsx                 |   95.00 |    94.00 |   96.00 |   95.12 |
  ErrorBoundary.tsx          |   92.50 |    91.20 |   93.00 |   92.67 |
 src/hooks                   |   91.67 |    90.34 |   92.45 |   91.89 |
  useSpectrumData.ts         |   93.00 |    92.00 |   94.00 |   93.22 |
  useStoreWhenActive.ts      |   90.00 |    88.00 |   91.00 |   90.45 |
 src/stores                  |   92.00 |    91.00 |   93.00 |   92.11 |
  appStore.ts                |   94.00 |    93.00 |   95.00 |   94.22 |
  commStore.ts               |   90.00 |    89.00 |   91.00 |   90.00 |
-----------------------------|---------|----------|---------|---------|
```

**阈值检查**：
- 任何模块低于 90% → CI 失败
- 报告高亮未覆盖分支
- 生成 HTML 详细报告（行级标注）

### 17.6 Mock 策略

#### Tauri API Mock

**文件**：`src/test/setup.ts`

```typescript
import { vi } from 'vitest';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd, args) => {
    if (cmd === 'get_serial_ports') {
      return Promise.resolve(['/dev/ttyUSB0', 'COM1']);
    }
    if (cmd === 'connect_serial') {
      return Promise.resolve();
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  }),
}));

// Mock Tauri event listener
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event, callback) => {
    // 模拟事件触发
    setTimeout(() => {
      callback({
        payload: {
          timestamp: Date.now(),
          frequencies: [100, 200, 300],
          amplitudes: [-50, -45, -55],
        },
      });
    }, 100);

    return Promise.resolve(() => {}); // unlisten function
  }),
}));
```

#### Store Mock

```typescript
import { vi } from 'vitest';
import { useAppStore } from '@/stores';

// 重置 store 状态
beforeEach(() => {
  useAppStore.setState({
    language: 'zh',
    theme: 'dark',
    user: null,
  });
});

// Mock 特定 action
vi.spyOn(useAppStore.getState(), 'setLanguage');
```

#### 组件 Props Mock

```typescript
const mockOnClick = vi.fn();
const mockOnChange = vi.fn();

render(
  <Button onClick={mockOnClick}>Click me</Button>
);

fireEvent.click(screen.getByText('Click me'));
expect(mockOnClick).toHaveBeenCalledTimes(1);
```

### 17.7 CI/CD 集成

**GitHub Actions 示例**：
```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm run test:coverage
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

**覆盖率徽章**：
```markdown
![Coverage](https://img.shields.io/codecov/c/github/your-org/hmi)
```

### 17.8 测试最佳实践

#### 1. 测试文件命名

✅ **推荐**：
```
Button.tsx          → Button.test.tsx
useSpectrumData.ts  → useSpectrumData.test.ts
appStore.ts         → appStore.test.ts
```

❌ **不推荐**：
```
Button.tsx          → button.spec.tsx
useSpectrumData.ts  → SpectrumDataTest.ts
```

#### 2. 测试组织

✅ **推荐**：
```typescript
describe('Button', () => {
  describe('rendering', () => {
    it('renders children text', () => { ... });
    it('applies variant styles', () => { ... });
  });

  describe('interactions', () => {
    it('handles click event', () => { ... });
    it('disables when disabled prop is true', () => { ... });
  });

  describe('accessibility', () => {
    it('has correct ARIA attributes', () => { ... });
  });
});
```

❌ **不推荐**：
```typescript
it('button works', () => {
  // 测试所有功能在一个测试中
});
```

#### 3. 断言清晰性

✅ **推荐**：
```typescript
expect(screen.getByRole('button', { name: /submit/i }))
  .toBeInTheDocument();
```

❌ **不推荐**：
```typescript
expect(!!document.querySelector('.btn')).toBe(true);
```

#### 4. 异步处理

✅ **推荐**：
```typescript
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument();
});
```

❌ **不推荐**：
```typescript
setTimeout(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument();
}, 1000);
```

---

## 18. 部署架构

### 18.1 构建产物

```
┌─────────────────────────────────────────────────────────────────┐
│                      Build & Deployment                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  开发构建：                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  npm run dev         # 启动 Vite 开发服务器（仅前端）        │  │
│  │  npm run tauri dev   # 启动 Tauri 开发环境（前端 + 后端）    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  生产构建：                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  npm run build          # 仅构建前端                        │  │
│  │  npm run tauri build    # 构建完整桌面应用                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  产物结构：                                                       │
│  src-tauri/target/release/                                      │
│  ├── hmi                   # Linux 可执行文件                    │
│  ├── hmi.exe               # Windows 可执行文件                  │
│  └── bundle/                                                    │
│      ├── deb/              # Debian 包                          │
│      ├── rpm/              # RPM 包                             │
│      ├── msi/              # Windows 安装包                      │
│      └── dmg/              # macOS 安装包                        │
│                                                                  │
│  日志目录：                                                       │
│  • 开发模式：src-tauri/Log/                                      │
│  • 发布模式：与可执行文件同级的 Log/                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 18.2 树莓派部署

详见 `docs/raspberry-pi-deploy/README.md`

```
┌─────────────────────────────────────────────────────────────────┐
│                   Raspberry Pi Deployment                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  目标环境：                                                       │
│  • Raspberry Pi 4B / 5                                          │
│  • 64-bit Raspberry Pi OS                                       │
│  • 触摸屏显示器                                                   │
│                                                                  │
│  交叉编译：                                                       │
│  1. 安装 aarch64-unknown-linux-gnu 工具链                        │
│  2. 配置 .cargo/config.toml                                     │
│  3. 运行 cargo build --release --target aarch64-unknown-linux-gnu│
│                                                                  │
│  Docker 构建：                                                    │
│  docker build -f docs/raspberry-pi-deploy/Dockerfile -t hmi .   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 附录

### A. 快捷键映射

| 快捷键 | 功能 | 对应视图/操作 |
|--------|------|---------------|
| F1 | 切换到 Jobs 视图 | jobs |
| F2 | 切换到 System 视图 | system |
| F3 | 切换到 Monitor 视图 | monitor |
| F4 | 切换到 Alarms 视图 | alarms |
| F5 | 切换到 Recipes 视图 | recipes |
| F6 | 切换到 Setup 视图 | setup |
| F7 | 切换到 Help 视图 | help |
| F8 | 切换到 Files 视图 | files |

### B. Tauri 命令清单

| 命令名 | 功能 | 参数 | 返回值 |
|--------|------|------|--------|
| get_log_dir | 获取日志目录 | - | String |
| get_serial_ports | 列出可用串口 | - | Vec<String> |
| connect_serial | 连接串口 | SerialConfig | () |
| disconnect_serial | 断开串口 | - | () |
| send_serial_data | 发送串口数据 | Vec<u8> | () |
| connect_tcp | 连接 TCP | TcpConfig | () |
| disconnect_tcp | 断开 TCP | - | () |
| send_tcp_data | 发送 TCP 数据 | Vec<u8> | () |
| start_sensor_simulation | 启动传感器模拟 | - | () |
| stop_sensor_simulation | 停止传感器模拟 | - | () |
| frontend_log_batch | 前端日志批量转发 | Vec<LogEntry> | () |

### C. 常量配置速查

| 配置项 | 值 | 说明 |
|--------|-----|------|
| COMM_CONFIG.TCP_TIMEOUT_MS | 5000 | TCP 超时 |
| COMM_CONFIG.DEFAULT_BAUD_RATE | 9600 | 默认波特率 |
| LOG_BRIDGE_CONFIG.MAX_BATCH_SIZE | 50 | 日志批量大小 |
| LOG_BRIDGE_CONFIG.FLUSH_INTERVAL_MS | 250 | 日志刷新间隔 |
| NOTIFICATION_CONFIG.DEFAULT_DURATION | 5000 | 通知显示时长 |

### D. 扩展开发

详见 **[HMI 系统扩展指南](./EXTENSION_GUIDE.md)**，包含：

- [如何添加新视图](./EXTENSION_GUIDE.md#2-添加新视图)
- [如何添加视图命令](./EXTENSION_GUIDE.md#3-添加视图命令)
- [如何添加图标](./EXTENSION_GUIDE.md#4-添加图标)
- [如何使用确认对话框](./EXTENSION_GUIDE.md#5-使用确认对话框)
- [完整示例代码](./EXTENSION_GUIDE.md#6-完整示例)
- [常见问题解答](./EXTENSION_GUIDE.md#7-常见问题)

---

*文档版本: 1.2.0*
*最后更新: 2025-12-24*
*重大更新: 新增测试架构章节（Vitest + 90% 覆盖率）、反映 T00-T08 重构成果*
