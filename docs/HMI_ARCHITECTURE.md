# HMI 架构说明（Codex）

日期：2025-12-17  
执行者：Codex

本文件用于说明当前项目的“HMI 壳 + 视图模块”的总体架构与扩展方式，目标是让整体布局可在其它项目中复用，并且在页面切换时保持操作状态。

## 1. 总体结构

- **壳（Shell）**：负责整体布局、主题、主导航、命令区与视图承载。
  - `src/components/layout/MainLayout.tsx`
  - `src/components/layout/TitlePanel.tsx`
  - `src/components/layout/NavPanel.tsx`
  - `src/components/layout/CommandPanel.tsx`
  - `src/components/layout/InfoPanel.tsx`
- **视图（Views）**：每个主页面一个入口组件，可包含标签页（子页面）。
  - `src/components/views/*/index.tsx`
- **注册表（Registry）**：统一管理“视图 ID / 导航图标 / 文案 key / 组件懒加载”。
  - `src/hmi/viewRegistry.tsx`

## 2. 状态保持（Keep-Alive）

需求：切换主页面后返回，保持此前的选择与操作（例如文件树展开、CSV 选中、图表缩放、当前标签页等）。

实现：

- `InfoPanel` 对“访问过的视图”**常驻挂载**，切换时仅通过 `hidden` 控制可见性（不卸载组件）。
- `Tabs` 组件默认 `keepMounted=true`，标签页切换也不卸载子页面。

关键文件：

- `src/components/layout/InfoPanel.tsx`
- `src/components/common/Tabs.tsx`

## 3. 副作用门控（性能）

Keep-Alive 会让页面在后台仍然挂载，因此需要避免：

- `setInterval` 在后台持续运行
- `requestAnimationFrame` 在后台持续绘制
- 图表/布局在隐藏时被 resize 成 0 导致“切回空白”

方案：

- 在 `InfoPanel` 内对每个视图注入 `ViewContextProvider`，视图内部通过 `useIsViewActive()` 获取“当前是否可见”。
- 视图在不可见时自行暂停定时器/动画/订阅；可见时恢复。

关键文件：

- `src/components/layout/ViewContext.tsx`
- `src/components/views/System/index.tsx`
- `src/components/views/Monitor/index.tsx`
- `src/components/views/Files/index.tsx`

## 4. 主题系统（可扩展）

目标：主题可动态切换且对业务 CSS 低侵入，新增主题时尽量只改变量。

方案：

- `document.documentElement.dataset.theme = theme`
- `src/styles/variables.css` 通过 `[data-theme="..."]` 覆盖 CSS 变量
- 增加 `--overlay-*` 等语义变量，逐步替换硬编码 `rgba(...)`，提升主题一致性

关键文件：

- `src/stores/appStore.ts`
- `src/components/layout/MainLayout.tsx`
- `src/styles/variables.css`

## 5. 调试日志桥接（前端 → 终端）

目标：可手动开启，将 WebView 内的 console 输出、全局错误等转发到终端，便于调试；默认关闭避免性能影响。

实现：

- Rust 侧使用 `tauri-plugin-log` 输出到 `Stdout`
- 前端 Hook 通过批量 `invoke("frontend_log_batch")` 转发日志（console.* / window.onerror / unhandledrejection）
- 开关在 Setup → 调试，可持久化保存

关键文件：

- `src/hooks/useFrontendLogBridge.ts`
- `src/stores/appStore.ts`
- `src/components/views/Setup/index.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`

## 6. 如何扩展一个新主页面

1. 增加视图组件：`src/components/views/<YourView>/index.tsx`
2. 在 `src/types/semi-e95.ts` 的 `ViewId` 中加入新 ID（破坏性变更，按项目策略执行）
3. 在 `src/hmi/viewRegistry.tsx` 注册：
   - `id`
   - `labelKey`（并在 `src/i18n/locales/*` 增加翻译）
   - `icon`
   - `lazy(() => import(...))` 组件
4. 如页面含轮询/动画/订阅，建议使用 `useIsViewActive()` 做可见性门控

## 7. 通信/协议事件桥接（后端 → Store/告警）

目标：把后端的“连接/收发/协议解码”观测信息稳定注入前端数据层，并驱动 E95 语义高亮（Nav/Title/Command）。

实现方式：在 `MainLayout` 统一安装 bridge hook（避免各视图自行订阅导致 Keep-Alive 泄漏）。

- `useCommEventBridge`：
  - 订阅后端 `comm-event`（连接/重连/收发/错误）
  - 写入 `commStore` 读模型（status/计数/事件日志）
  - 将关键错误映射为 warning 告警（含短窗口去重）
- `useHmipEventBridge`：
  - 订阅后端 `hmip-event`（HMIP 解码结果/解码错误）
  - 写入 `hmipStore` 读模型（统计 + 事件日志）
  - 将 decode_error / 协议错误映射为 warning 告警（含短窗口去重）

关键文件：

- `src/components/layout/MainLayout.tsx`
- `src/hooks/useCommEventBridge.ts`
- `src/hooks/useHmipEventBridge.ts`
- `src/stores/commStore.ts`
- `src/stores/hmipStore.ts`

协议细节：见 `docs/implementation/11-hmip-binary-protocol.md`。
