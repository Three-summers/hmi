# 06 · Monitor 频谱链路：从后端 emit 到前端 Canvas/uPlot

本章以 Monitor 为主线，解释频谱数据如何产生、如何跨边界传输、如何在前端渲染与交互。

## 1. 一张图看懂“端到端链路”

```
┌──────────────────────────────┐
│ Backend: SensorSimulator      │
│  src-tauri/src/sensor.rs      │
│  - 50ms 生成一帧 SpectrumData  │
│  - app.emit("spectrum-data")  │
└───────────────┬──────────────┘
                │ Tauri Event
                ▼
┌──────────────────────────────┐
│ Frontend: useSpectrumData     │
│  src/hooks/useSpectrumData.ts │
│  - listen(eventName, cb)      │
│  - invoke(start/stop)         │
│  - 节流 + stats 计算          │
└───────────────┬──────────────┘
                │ onFrame(frame)
                ▼
┌──────────────────────────────┐
│ Monitor 视图组件              │
│  src/components/views/Monitor │
│  - Overview(Canvas)           │
│  - Waterfall(Canvas)          │
│  - SpectrumAnalyzer(uPlot)    │
└──────────────────────────────┘
```

## 2. 后端：事件生产（SensorSimulator）

源码对应：

- `src-tauri/src/sensor.rs`：`SensorSimulator` / `SpectrumData` / `app.emit`
- `src-tauri/src/commands.rs`：`start_sensor_simulation` / `stop_sensor_simulation`

### 2.1 事件名与 payload 结构

- 事件名：`"spectrum-data"`
- payload：`SpectrumData`（包含 frequencies/amplitudes/peak/average 等）

### 2.2 事件生成频率与终止条件

实现要点：

- loop 周期：`tokio::time::sleep(Duration::from_millis(50))`
- stop：`running=false` 后 loop 退出
- 当 `emit` 失败（窗口关闭）时退出 loop

## 3. 前端：订阅与控制（useSpectrumData）

源码对应：`src/hooks/useSpectrumData.ts`

这是 Monitor 系统的“核心 hook”，负责把：

- `listen`（事件订阅）
- `invoke(start/stop)`（生命周期控制）
- `status/error`（可展示状态）
- `latestRef`（高频数据不触发渲染）
- `stats`（低频 UI 统计）

统一封装起来。

### 3.1 enabled + isTauri：双门控

字符画：什么时候会真正订阅？

```
enabled=false  -> 直接 return（不 listen、不 invoke）
enabled=true
  ├─ isTauri() == false -> status="unavailable"
  └─ isTauri() == true  -> listen + invoke(start)
```

这两层门控分别解决：

- enabled：视图可见性 / tab 激活
- isTauri：浏览器模式下无法使用事件系统

### 3.2 高/低频分离：latestRef vs setState

`useSpectrumData` 的典型优化策略：

- 每次事件都更新 `latestRef.current = frame`（不触发重渲染）
- 只有当需要 UI 更新时才 `setStats(...)` 或调用 `onFrame`
- 支持 `maxHz` 做节流（控制 onFrame/stats 的最大频率）

字符画：事件消费分层

```
on event:
  latestRef = frame              (always)
  if paused && !emitWhenPaused:  return
  if maxHz 限制触发:              maybe return
  if statsEnabled && !paused:    setStats(...)
  onFrame(frame)                 (optional)
```

## 4. MonitorView：视图拆分与 Tab keepMounted

源码对应：`src/components/views/Monitor/index.tsx`

Monitor 拆分为多个可测试子组件：

- `MonitorOverview`：统计卡片 + Canvas 实时频谱（Overview tab）
- `WaterfallChart`：瀑布图（Canvas）
- `AlarmList`：快速告警列表
- `SpectrumAnalyzer`：专业频谱分析仪（uPlot + Canvas）

关键约束：Tabs 默认 keepMounted

```
Tab 切换 ≠ 组件卸载
  -> 子组件必须用 isActive 控制订阅/绘制
```

因此 Monitor 会计算：

- `isViewActive = useIsViewActive()`（来自 Keep-Alive 容器）
- `isSpectrumAnalyzerTabActive = isViewActive && activeTab==="spectrum-analyzer"`

并用 `useRegisterSubViewCommands(..., enabled)` 控制子命令的注册/清理。

## 5. Waterfall：Canvas 绘制 + 离屏缓冲

源码对应：

- 入口组件：`src/components/views/Monitor/WaterfallChart.tsx`
- Canvas 实现：`src/components/views/Monitor/WaterfallCanvas.tsx`
- 配色映射：`src/utils/colormap.ts`（`amplitudeToColor`）
- 配置与缓冲：`src/stores/spectrumAnalyzerStore.ts`（threshold/historyDepth/refreshRate/colorScheme）

### 5.1 WaterfallChart：订阅与视图态

`WaterfallChart` 复用 `useSpectrumData`：

- `enabled = isActive && isViewActive`
- `maxHz = refreshRate`（来自 store）
- `onFrame(frame) -> setAmplitudes(frame.amplitudes)`

### 5.2 WaterfallCanvas：为何需要离屏缓冲？

瀑布图是“随时间滚动”的图像，如果每帧都重绘整张图会很重。

`WaterfallCanvas` 使用离屏 buffer：

```
bufferCanvas (width = waterfallWidth, height = historyDepth)
  每来一帧：
    - 把 bufferCanvas 的内容下移一行（或通过像素拷贝实现滚动）
    - 在顶部写入新的一行 ImageData
```

并做 DPR/尺寸缓存、rAF 合并等优化（详见源码 `WaterfallCanvas.tsx`）。

字符画：瀑布图滚动概念

```
new row
  ▼
┌───────────────┐
│ [t=0]  ████    │  <- 最新
│ [t=1]  ███     │
│ [t=2]  ██      │
│ ...            │
│ [t=n]  ░░░░    │  <- 最旧
└───────────────┘
```

## 6. SpectrumAnalyzer：uPlot（频谱曲线）+ Canvas（瀑布）

源码对应：

- `src/components/views/Monitor/SpectrumAnalyzer.tsx`
- `src/components/views/Monitor/SpectrumChart.tsx`（uPlot）
- `src/components/views/Monitor/WaterfallCanvas.tsx`（同上）
- `src/hooks/useChartInit.ts`：图表初始化错误收敛与重试

### 6.1 “专业曲线”的三条 trace

SpectrumChart 的 alignedData 结构包含：

```
[ x(kHz), current(dBm), maxHold(dBm), average(dBm), thresholdLine(dBm) ]
```

其中 maxHold/average 由 `spectrumAnalyzerStore` 维护（以及 UI 命令触发 reset）。

### 6.2 ResizeObserver 驱动的懒初始化

SpectrumChart 只有在容器获得有效尺寸后才创建 uPlot：

```
ResizeObserver -> 得到 width/height
  if uplot exists: setSize
  else if initStatus != "error": run(factory) 创建 uPlot
```

这能避免：

- 容器宽高为 0 时初始化失败
- 在错误状态下无限重试

## 7. 迁移到真实数据：保持“事件契约”不变

最推荐的演进路径：

```
替换后端数据源（串口/TCP/设备 SDK）
  但仍 emit("spectrum-data", SpectrumData-like payload)
前端无需改动 useSpectrumData/Monitor 渲染层
```

这能最大程度复用已有 UI/交互/性能策略。

