# HMI 架构优化与 UI 美观性改进 - 开发计划

## 项目概述

基于 SEMI E95 工业标准的 HMI 系统（React 18 + TypeScript + Tauri 2.0）的全面架构重构与界面美观性提升。优化目标包括：统一平台边界抽象、性能优化、UI 视觉一致性、动效简化及错误处理补齐。

## 任务分解

### 任务 1: 平台边界与架构整理

**ID**: `task-01`

**描述**:
建立清晰的 Tauri/浏览器 API 调用边界。通过创建统一的平台抽象层，支持浏览器开发降级策略。完成内容包括：
- 创建 `src/platform/invoke.ts` 统一 Tauri RPC 调用接口
- 创建 `src/platform/window.ts` 统一窗口操作接口
- 改进 `navigationStore.ts` 中对话框状态的类型安全（用泛型约束）
- 收敛重复的常量定义到 `src/constants.ts`
- 梳理 `Setup/index.tsx` 与 `TitlePanel.tsx` 中对话框的状态类型表达
- 统一 `useKeyboardShortcuts.ts` 中的快捷键绑定逻辑

**文件范围**:
- `src/platform/tauri.ts`
- `src/platform/invoke.ts` (新建)
- `src/platform/window.ts` (新建)
- `src/components/views/Setup/index.tsx`
- `src/components/layout/TitlePanel.tsx`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/stores/navigationStore.ts`
- `src/constants.ts`

**依赖关系**: 无

**测试命令**: `npm run build`

**测试聚焦点**:
- 构建成功无 TypeScript 错误
- 浏览器开发环境 (`vite dev`) 启动无 Tauri API 调用错误
- Tauri WebView 环境运行正常
- 常量去重且被正确引用
- 对话框状态类型能正确推导（无 `unknown` 泛滥）

**推荐后端**: `codex`

---

### 任务 2: 性能与状态管理优化

**ID**: `task-02`

**描述**:
通过 Zustand selector 与 shallow 比较方式，消除无关状态变化引发的重渲染。优化 uPlot 生命周期，避免重复初始化。具体内容包括：
- `MainLayout.tsx` 使用 selector 只订阅必要的导航状态
- `NavPanel.tsx` 使用 shallow 比较避免按钮重新渲染
- `Monitor/index.tsx` 优化 Canvas resize 处理，缓存 uPlot 实例
- `Monitor/index.tsx` 实现图表数据增量更新而非全量重绘
- `Files/index.tsx` 优化文件列表渲染性能
- 统一性能基准指标

**文件范围**:
- `src/components/layout/MainLayout.tsx`
- `src/components/layout/NavPanel.tsx`
- `src/components/layout/TitlePanel.tsx`
- `src/components/layout/CommandPanel.tsx`
- `src/components/views/Monitor/index.tsx`
- `src/components/views/Files/index.tsx`

**依赖关系**: 依赖 `task-01` (平台抽象完成后优化状态订阅)

**测试命令**: `npm run build`

**测试聚焦点**:
- 构建成功无性能警告
- Monitor 视图切换时帧率稳定 (≥30 FPS)
- 导航切换时无感知延迟 (<100ms)
- 文件列表滚动流畅 (无卡顿)
- uPlot 实例复用正确（不产生内存泄漏）
- React DevTools Profiler 显示组件重渲染次数减少 ≥50%

**推荐后端**: `codex`

---

### 任务 3: UI 美观性优化

**ID**: `task-03`

**描述**:
基于 `variables.css` 中已定义的设计 token，建立统一的 spacing scale 与色彩系统。消除硬编码色值，统一按钮/卡片/输入框视觉层级。具体内容包括：
- 梳理 `variables.css` 中的 spacing 值（当前缺少标准化的 gap/padding token）
- 在 `variables.css` 新增 spacing scale 变量 (--sp-xs, --sp-sm, --sp-md, --sp-lg, --sp-xl)
- 将 `Button.module.css` 中的硬编码 padding/gap 替换为 token
- 将 `Monitor.module.css` 中的卡片间距标准化
- 将 `Setup.module.css` 中的表单元素对齐
- 将 `Files.module.css` 中的列表间距统一
- `global.css` 中消除重复的颜色变量定义
- 按钮/卡片新增统一的视觉层级（primary/secondary/tertiary）

**文件范围**:
- `src/styles/variables.css`
- `src/styles/global.css`
- `src/components/common/Button.module.css`
- `src/components/views/Monitor/Monitor.module.css`
- `src/components/views/Setup/Setup.module.css`
- `src/components/views/Files/Files.module.css`

**依赖关系**: 无

**测试命令**: `npm run build`

**测试聚焦点**:
- 构建成功，CSS 变量引用无警告
- 所有页面视觉效果一致（色值、间距、圆角）
- 浅色主题、深色主题、高对比度主题切换无色值闪烁
- 按钮组间距均匀（≤1px 差异）
- 卡片内容区 padding 统一
- 响应式布局在不同分辨率下保持一致

**推荐后端**: `gemini`

---

### 任务 4: 动效简化

**ID**: `task-04`

**描述**:
移除装饰性和高频无限循环动画，合并重复的 keyframes 定义。实现对 `prefers-reduced-motion` 媒体查询的支持，满足无障碍访问需求。具体内容包括：
- 梳理 `global.css` 中所有 `@keyframes`，识别重复/冗余定义
- 移除导航按钮的点击弹动动效 (参考近期 commit 记录)
- 移除列表/对话框的黑屏弹跳动画 (参考近期 commit 记录)
- 在 `Dialog.module.css`/`CommandPanel.module.css` 中简化过度动画
- 在 `global.css` 顶部添加 `@media (prefers-reduced-motion)` 块，禁用所有 transition/animation
- 统一 transition 时长：快速(120ms)、正常(200ms)、慢速(350ms)

**文件范围**:
- `src/styles/global.css`
- `src/components/common/Dialog.module.css`
- `src/components/common/StatusIndicator.module.css`
- `src/components/layout/TitlePanel.module.css`
- `src/components/layout/NavPanel.module.css`
- `src/components/layout/CommandPanel.module.css`

**依赖关系**: 依赖 `task-03` (在完整的 token 系统基础上简化动效)

**测试命令**: `npm run build`

**测试聚焦点**:
- 构建成功
- 所有 keyframes 定义无重复 (通过内容去重)
- 导航交互流畅且无多余弹动感
- 对话框打开/关闭动画简洁 (<200ms)
- 系统偏好 `prefers-reduced-motion: reduce` 时，所有 transition/animation 禁用
- 主题切换时无动画延迟

**推荐后端**: `gemini`

---

### 任务 5: 错误处理与边界情况

**ID**: `task-05`

**描述**:
完善异步操作的错误处理链，统一空态/加载态的视觉反馈，补齐 i18n 覆盖。具体内容包括：
- `Setup/index.tsx` 中所有 Tauri 调用添加 try/catch，异常则触发通知
- `commStore.ts` 中的通信操作添加错误回调与超时处理
- `Files/index.tsx` 文件列表加载失败显示友好提示
- `Monitor/index.tsx` 图表数据获取失败时显示空态占位符
- `TitlePanel.tsx` 中的关键操作异常捕获与通知
- `System/index.tsx` 系统信息获取失败处理
- 统一空态/加载态UI (使用 `StatusIndicator` 组件)
- 扫描所有 TSX 文件中的硬编码文案，纳入 i18n
- 补齐 `zh.json`/`en.json` 中缺失的键值对

**文件范围**:
- `src/components/views/Setup/index.tsx`
- `src/stores/commStore.ts`
- `src/components/views/Files/index.tsx`
- `src/components/views/Monitor/index.tsx`
- `src/components/layout/TitlePanel.tsx`
- `src/components/views/System/index.tsx`
- `src/i18n/locales/zh.json`
- `src/i18n/locales/en.json`

**依赖关系**: 依赖 `task-01` (基于统一的错误边界与通知接口)

**测试命令**: `npm run build`

**测试聚焦点**:
- 构建成功无 TypeScript 错误
- Setup 页面中所有按钮操作失败触发通知提示
- 文件列表加载超时或网络错误显示重试按钮
- Monitor 图表数据获取失败显示友好提示（非崩溃）
- 空态/加载态在所有业务页面表现一致
- i18n 键值对 100% 覆盖（无缺失或未翻译项）
- 切换语言时用户界面文案完整更新

**推荐后端**: `codex`

---

## 验收标准

- [ ] Task 01 完成：平台抽象层创建，常量收敛，类型安全提升
- [ ] Task 02 完成：性能指标达成（重渲染减少 ≥50%，帧率 ≥30 FPS）
- [ ] Task 03 完成：UI token 完整，硬编码消除，主题切换无闪烁
- [ ] Task 04 完成：过度动画移除，keyframes 去重，prefers-reduced-motion 支持
- [ ] Task 05 完成：错误处理完善，i18n 100% 覆盖，空态/加载态统一
- [ ] 所有任务构建成功 (`npm run build` 无错误/警告)
- [ ] TypeScript 类型检查通过 (`tsc --noEmit`)
- [ ] 代码风格一致（通过 ESLint/Prettier，若有配置）
- [ ] 浏览器兼容性验证（Chrome/Edge 最新版本）
- [ ] Tauri WebView 与浏览器开发环境均正常运行

---

## 技术注记

### 架构决策

1. **平台抽象层**（Task 01）
   - 通过 `isTauri()` 检查决定 API 调用路由
   - 浏览器环境提供 mock 实现或降级逻辑
   - 避免 Tauri API 散落在业务代码中

2. **状态管理优化**（Task 02）
   - Zustand 官方推荐 selector 模式（见 [文档](https://github.com/pmndrs/zustand/tree/main#selecting-multiple-state-slices)）
   - 使用 `shallow` 比较器比对对象浅相等性
   - uPlot 实例使用 `useRef` 缓存，避免重复初始化

3. **设计系统**（Task 03、04）
   - CSS 变量遵循 BEM 命名规范 (如 `--button-bg-hover`)
   - Spacing scale 遵循 4px 基数 (xs=4px, sm=8px, md=16px, lg=24px, xl=32px)
   - 三主题并存（dark/light/high-contrast），通过 `data-theme` 属性切换

4. **无障碍与性能**
   - `prefers-reduced-motion` 优先级最高，必须禁用所有动画
   - 色彩对比度遵循 WCAG AA 标准
   - 按钮最小尺寸 70px（SEMI E95 触摸规范）

5. **国际化**（Task 05）
   - 使用 `i18next` + `react-i18next`
   - 所有用户可见文案必须纳入 i18n
   - 支持语言：中文 (zh)、英文 (en)

### 约束条件与风险

| 风险项 | 影响 | 缓解策略 |
|--------|------|--------|
| Tauri API 版本变更 | 平台抽象失效 | 版本锁定在 `^2.0.0`，监控官方 breaking changes |
| 性能优化引入 bug | 渲染异常 | 使用 React DevTools Profiler 验证，commit 前手动测试所有页面 |
| CSS 变量浏览器兼容性 | 样式加载失败 | 仅支持 Chrome/Edge 最新版本（Edge 118+） |
| i18n 键值对遗漏 | 用户体验不一致 | 运行时通过 `i18next` 的 debug 模式检测缺失键 |
| 主题切换 FOUC (Flash of Unstyled Content) | 视觉闪烁 | 将主题同步到 localStorage，初始化时直接设置 |

### 后端协作说明

- **codex 任务**（Task 01、02、05）：涉及架构逻辑、类型系统、状态管理、异步处理
  - 由 Codeagent 使用 `codex` 后端执行编码
- **gemini 任务**（Task 03、04）：涉及 UI 设计、样式优化、无障碍
  - 由 Codeagent 使用 `gemini` 后端执行编码

---

## 实施顺序建议

1. **第一阶段**（并行）
   - Task 01: 平台边界（2-3 天）
   - Task 03: UI 美观性（2-3 天）

2. **第二阶段**（串行）
   - Task 02: 性能优化（依赖 Task 01，1-2 天）
   - Task 04: 动效简化（依赖 Task 03，1 天）

3. **第三阶段**
   - Task 05: 错误处理（依赖 Task 01，2 天）

总预计时间：**8-11 天**

---

## 版本信息

- **项目版本**: 0.1.0
- **React**: 18.3.1
- **TypeScript**: 5.6
- **Tauri**: 2.0
- **Zustand**: 5.0.2
- **i18next**: 24.2.0
- **uPlot**: 1.6.31
