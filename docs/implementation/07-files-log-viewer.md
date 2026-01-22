# 07 · Files/日志查看：get_log_dir + plugin-fs + CSV 图表

本章解释 Files 视图是如何“找到日志目录、列目录树、预览文件、把 CSV 绘成图表”的。

## 1. 端到端概览

```
FilesView (src/components/views/Files/index.tsx)
  ├─ useFileTree(t)
  │    ├─ invoke("get_log_dir") -> 后端返回 Log 路径
  │    └─ plugin-fs.readDir()   -> 目录/文件列表
  ├─ useFilePreview(t)
  │    └─ plugin-fs.readTextFile() -> 文本/CSV 内容
  └─ useChartData({ csvData, ... })
       └─ uPlot 多图 + 放大图
```

## 2. 日志目录从哪里来？get_log_dir

源码对应：

- 后端：`src-tauri/src/commands.rs`（`get_log_dir`）
- 前端：`src/hooks/useFileTree.ts`（`invoke("get_log_dir")`）

设计动机：

- 前端不硬编码路径（开发/发布目录结构不同）
- 后端负责确保目录存在（`create_dir_all`）

## 3. useFileTree：目录树 Hook

源码对应：`src/hooks/useFileTree.ts`

职责：

- 获取 `logBasePath`
- 使用 `@tauri-apps/plugin-fs` 的 `readDir` 读取目录
- 维护 `expandedDirectories`（展开/收起）
- 生成渲染用 `visibleItems`（扁平列表）

### 3.1 IO 超时与重试策略

`useFileTree` 使用：

- `withTimeout(...)`（`src/utils/async.ts`）
- `useRetry(...)`（`src/hooks/useRetry.ts`）

默认策略偏保守：主要针对 Timeout 做有限重试，避免“无限挂起”。

字符画：加载流程

```
loadLogBasePath()
  ├─ if !isTauri(): unavailable
  └─ invoke("get_log_dir") withTimeout + retry
       └─ setLogBasePath(path)

loadFileTree()
  └─ readDir(logBasePath) withTimeout + retry
       └─ build FileNode[] (目录优先排序)
```

### 3.2 “扁平列表”如何生成？

`visibleItems` 把树结构转换为渲染友好的数组：

```
[{entry, level, isExpanded}, ...]
```

字符画：展开/收起

```
expandedDirectories = { "/Log/2024-12-31" }

walk(root)
  - push root (level 0)
  - if expanded: walk(children, level+1)
```

## 4. useFilePreview：文件预览 Hook（含 CSV 解析）

源码对应：`src/hooks/useFilePreview.ts`

职责：

- 读取文本：`readTextFile(file.path)`
- 维护预览状态：loading/error/content
- 如果是 CSV：`parseCsv(content)` 解析成 `{ headers, rows }`

### 4.1 竞态处理：requestId

用户快速点击不同文件时，会出现“先发起的请求后返回”的竞态。

Hook 通过 `requestIdRef` 让“最后一次选择”获胜：

```
selectFile(file):
  requestId = ++requestIdRef
  content = await readTextFile(...)
  if requestIdRef != requestId: return (忽略过期结果)
  else: setContent / setCsvData
```

字符画：竞态场景

```
click A -> requestId=1 -> read(A) ..........(慢)
click B -> requestId=2 -> read(B) ...(快) -> apply(B)
read(A) returns -> requestIdRef=2 != 1 -> ignore(A)
```

### 4.2 CSV 解析策略（避免误解析日期）

`parseCsv` 的实现要点：

- 仅当字段是“纯数字”才解析为 number
- 否则优先按固定日期格式解析，再兜底 `new Date(...)`

目的：

- 避免把 `2024-12-17 08:00:00` 这种时间字符串误解析成 `2024`

## 5. useChartData：CSV → 多 uPlot 图表

源码对应：`src/hooks/useChartData.ts`

职责：

- 列选择（enabledColumns）
- 可见图表数量（visibleCharts）
- 小图（列表）与放大图（弹窗）实例管理
- 在 `isChartsVisible=false` 时不创建/更新图表（避免 Keep-Alive 后台消耗）

字符画：图表实例生命周期

```
csvData change
  ├─ destroySmallCharts()
  ├─ destroyEnlargedChart()
  └─ reset selection (defaultVisible columns)

render effect (only if isChartsVisible && data ok)
  └─ for each enabled column:
       create uPlot instance (if missing)
       or setData / setSize (if existing)
```

## 6. 小结：Files 模块的“最小跨边界集合”

Files 视图只依赖两类后端能力：

1) `get_log_dir`（RPC）
2) `plugin-fs`（readDir/readTextFile）

其它逻辑（树结构、CSV 解析、图表实例管理）均在前端完成，利于测试与迭代。

