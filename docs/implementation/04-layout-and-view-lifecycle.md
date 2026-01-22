# 04 · 主布局与视图生命周期：Keep-Alive、命令系统与副作用门控

本章解释 UI 的“壳”是如何搭建的，以及在 Keep-Alive 模式下如何避免后台消耗。

## 1. MainLayout：应用壳（Shell）

源码对应：`src/components/layout/MainLayout.tsx`

主布局由四块面板拼装：

- `TitlePanel`：顶部状态与标题区
- `InfoPanel`：主视图承载区（Keep-Alive）
- `CommandPanel`：命令按钮区（随视图/子视图变化）
- `NavPanel`：底部主导航

此外还安装全局行为：

- 快捷键：`src/hooks/useKeyboardShortcuts.ts`
- 缩放系统：`src/hooks/useHMIScale.ts`
- 前端日志桥接：`src/hooks/useFrontendLogBridge.ts`（默认关闭）
- 主题切换：通过 `document.documentElement.dataset.theme`

字符画：布局组合

```
MainLayout
  ├─ <TitlePanel/>
  ├─ <InfoPanel currentView=.../>      (Keep-Alive 容器)
  ├─ <CommandPanel currentView=.../>   (命令面板)
  ├─ <NavPanel currentView=.../>       (导航)
  └─ <NotificationToast/>              (全局 toast)
```

## 2. View Registry：视图注册表（路由的替代方案）

本项目未使用 React Router，而是用“视图注册表”统一管理：

源码对应：`src/hmi/viewRegistry.tsx`

- `HMI_NAV_ITEMS`：导航按钮元信息（icon/labelKey）
- `HMI_VIEW_COMPONENTS`：`ViewId -> React.lazy(...)` 的组件映射

字符画：渲染路径

```
NavPanel 点击 -> navigationStore.currentView 变化
  └─ InfoPanel 根据 currentView 选择 HMI_VIEW_COMPONENTS[viewId] 渲染
```

## 3. InfoPanel：Keep-Alive 视图容器

源码对应：`src/components/layout/InfoPanel.tsx`

Keep-Alive 的实现策略：

- 首次访问某视图后，将其加入 `mountedViews`
- 之后切换视图时**不卸载**，只通过 `hidden` 隐藏
- 每个视图外层包 `ViewContextProvider({ viewId, isActive })`

字符画：Keep-Alive 的状态

```
mountedViews = { jobs, monitor, setup, ... }

InfoPanel
  ├─ KeptAliveView(jobs)   hidden=true
  ├─ KeptAliveView(monitor)hidden=false   <-- 当前激活
  └─ KeptAliveView(setup)  hidden=true
```

### 3.1 ViewContext：告诉视图“你现在是否可见”

源码对应：`src/components/layout/ViewContext.tsx`

提供 `useIsViewActive()`：

- 在 Keep-Alive 下，组件仍挂载但不可见
- 视图/子组件可用 `isActive` 去暂停动画/订阅/轮询

## 4. Keep-Alive 的核心问题：隐藏视图仍会“收更新”

如果隐藏视图仍订阅 store/定时器，就会出现：

- 用户切到别的页面，但后台组件仍在渲染/计算
- 频谱/图表这类高频逻辑会持续占用 CPU

本项目给出的解法：**副作用门控**（gating）

### 4.1 useStoreWhenActive：Zustand 订阅门控

源码对应：`src/hooks/useStoreWhenActive.ts`

核心思想：

```
enabled=false 时，不订阅 store（subscribe 返回空清理函数）
enabled=true  时，正常订阅
```

字符画：订阅门控

```
View (keep-alive)
  ├─ isActive=false
  │    └─ useStoreWhenActive(..., {enabled:false}) -> 不会因 store 更新而重渲染
  └─ isActive=true
       └─ 正常订阅
```

### 4.2 useIntervalWhenActive：轮询/定时器门控

源码对应：`src/hooks/useIntervalWhenActive.ts`

用于“视图隐藏时暂停 interval”，避免出现“重复定时器 + 后台空转”。

## 5. CommandPanel：命令系统（视图注册按钮，面板负责渲染）

源码对应：

- `src/components/layout/CommandPanel.tsx`
- `src/components/layout/ViewCommandContext.tsx`
- `src/components/layout/SubViewCommandContext.tsx`

### 5.1 ViewCommandContext：视图级命令

每个主视图（Monitor/Files/Setup/...）可以注册自己的命令：

- 视图侧：`useRegisterViewCommands(viewId, commands, enabled)`
- 面板侧：`CommandPanel` 读取 `commandsByView[currentView]` 并渲染

字符画：主命令注册与消费

```
MonitorView (isActive=true)
  └─ useRegisterViewCommands("monitor", [...])
        └─ ViewCommandContext.setViewCommands("monitor", [...])

CommandPanel(currentView="monitor")
  └─ viewCommands = commandsByView["monitor"]
```

### 5.2 SubViewCommandContext：子页面/Tab 级命令

典型例子：Monitor 的 `SpectrumAnalyzer` Tab 需要自己的“MaxHold/Average/Reset”等命令。

关键约束：

- Tabs 默认 `keepMounted`，切换 Tab 不卸载
- 所以子命令在 `enabled=false` 时必须清理，否则会“残留在命令面板”

字符画：子命令门控清理

```
useRegisterSubViewCommands("monitor", cmds, enabled)
  ├─ enabled=true  -> setSubViewCommands("monitor", cmds)
  └─ enabled=false -> clearSubViewCommands("monitor")
```

### 5.3 为什么把 Context 拆成 actions/state？

源码对应：`src/components/layout/ViewCommandContext.tsx`

Keep-Alive 场景下，很多视图长期挂载。

如果 Context 里既有“可变 state（confirmState/commandsByView）”又有“注册函数”，
那么 confirm 弹窗打开/关闭会导致所有消费该 Context 的视图重渲染。

因此拆分为：

- Actions Context：稳定引用（注册函数 + showConfirm）
- State Context：可变数据（commandsByView + confirmState）主要给 CommandPanel 消费

## 6. 容错：ErrorBoundary 让“壳”不白屏

源码对应：

- `src/components/common/ErrorBoundary.tsx`
- `src/components/layout/MainLayout.tsx`（在 InfoPanel 外包裹）

目标：

- 某个视图渲染异常时，只降级该区域并提供“重试/返回安全视图”，避免整个应用白屏。

