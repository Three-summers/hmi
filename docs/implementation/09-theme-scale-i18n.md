# 09 · 主题/缩放/i18n：跨模块联动的“全局系统”

本章解释三个“全局系统”如何实现：

- 国际化（i18n）
- 主题（CSS 变量 + data-theme）
- 缩放（rem + Canvas/uPlot 缩放系数）

## 1. 国际化：i18next 初始化与切换

源码对应：

- `src/i18n/index.ts`：i18n 初始化（resources / lng / fallback）
- `src/main.tsx`：import `./i18n` 触发初始化
- `src/stores/appStore.ts`：`setLanguage` 调用 `i18n.changeLanguage`

字符画：语言切换链

```
SetupView -> appStore.setLanguage("en")
  └─ i18n.changeLanguage("en")
       └─ useTranslation() 自动更新 t()
```

测试环境初始化：`src/test/setup.ts` 会在 beforeAll 做同步 init，避免测试里出现未初始化警告。

## 2. 主题：data-theme 驱动 CSS 变量

源码对应：

- 主题状态：`src/stores/appStore.ts`（`theme`）
- 应用主题：`src/components/layout/MainLayout.tsx`
  - `document.documentElement.dataset.theme = theme`
- 设计 token：`src/styles/variables.css`
- 全局样式：`src/styles/global.css`

字符画：主题的单向数据流

```
appStore.theme 变化
  └─ MainLayout useEffect
       └─ <html data-theme="dark|light|high-contrast">
            └─ CSS 根据 [data-theme] 切换变量值
```

这套方案的优点：

- 组件样式尽量只使用 CSS 变量（而不是在 TS 里做大量条件分支）
- 主题切换只影响变量表，侵入性低

## 3. 缩放：useHMIScale（rem） + useCanvasScale（Canvas/uPlot）

### 3.1 useHMIScale：动态根字号（rem）

源码对应：`src/hooks/useHMIScale.ts`

做法：

- 根据窗口宽度计算 `font-size`
- 写入到 `<html style="font-size: ...px">`
- `scaleOverride` 来自 `appStore`，用于“自动缩放”之上的手动系数

字符画：根字号计算

```
fontSize = max(12, (window.innerWidth / baseWidth) * baseFontSize * scaleOverride)
```

### 3.2 useCanvasScale：给 Canvas/uPlot 一个“缩放系数”

源码对应：`src/hooks/useCanvasScale.ts`

背景：

- rem 影响 DOM 布局，但 Canvas 仍使用像素常量
- 所以需要一个系数，让 Canvas 绘制能跟着 UI 缩放

做法：

- 读取 `getComputedStyle(document.documentElement).fontSize`
- 返回 `scaleFactor = currentRootFontSize / baseFontSize`

使用处：

- Files 图表：`src/components/views/Files/index.tsx`
- Monitor 图表：`src/components/views/Monitor/SpectrumChart.tsx`
- Waterfall Canvas：`src/components/views/Monitor/WaterfallCanvas.tsx`

字符画：DOM 与 Canvas 的缩放关系

```
useHMIScale -> 改 <html font-size> -> rem 尺寸随之缩放
useCanvasScale -> 读 <html font-size> -> scaleFactor
Canvas/uPlot -> px(value) = round(value * scaleFactor)
```

## 4. 三者的交汇点：Setup 视图

源码对应：`src/components/views/Setup/index.tsx`

Setup 提供 UI 入口修改这些全局系统：

- 语言：`setLanguage`
- 主题：`setTheme` / `cycleTheme`
- 缩放：`setScaleOverride` / `resetScale`

这些都只写入 store，由 MainLayout/Hook/CSS 体系自动接管渲染更新。

