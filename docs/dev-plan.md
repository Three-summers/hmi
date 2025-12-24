# HMI 综合优化 - 开发计划

## 项目概述

针对 React 18 + TypeScript + Tauri 2 的工业 HMI 应用进行架构优化、性能提升和 UI 美观性完善，通过大视图拆分、Zustand 订阅粒度精细化、UI 设计系统统一、动效简化和错误处理完善，提升代码可维护性和用户体验。

---

## 任务分解

### 任务 1：架构重构与类型加固

- **任务 ID**: task-01
- **描述**:
  - 拆分超大视图组件（Files ≈1375 行、Monitor ≈1032 行）与复杂布局（TitlePanel ≈637 行）
  - 抽取通用子组件、自定义 hooks 和纯工具函数
  - 收敛跨模块类型契约，减少隐式耦合
  - 沉淀 `withTimeout`、异步工具复用模块，消除重复实现

- **文件范围**:
  ```
  src/components/views/Files/index.tsx
  src/components/views/Monitor/index.tsx
  src/components/layout/TitlePanel.tsx
  src/types/semi-e95.ts
  src/utils/** (新增通用 async、timeout 等工具)
  src/hooks/** (按需提取新 hooks)
  ```

- **依赖关系**: 无

- **测试命令**:
  ```bash
  npm run build && tsc --noEmit --strict
  ```

- **测试重点**:
  - 组件拆分后 props 接口完整性（TypeScript 严格模式）
  - Files/Monitor 各子组件独立可用性
  - TitlePanel 各分段功能完整性（Title/Info/Command 联动）
  - 工具函数边界情况（timeout 边界、错误回调）
  - 类型检查无 any 或 @ts-ignore（保持 strict 模式）

- **后端推荐**: codex

---

### 任务 2：性能与状态管理优化

- **任务 ID**: task-02
- **描述**:
  - 禁止全量订阅 Zustand store，改用 `useShallow` 或 selector 精细化订阅
  - 优化 Setup 与 Alarms 视图的不必要重渲染
  - 评估 Files 文件树与 Monitor 告警列表的虚拟化需求（profiling 后决策）
  - 完善 Keep-Alive 后台副作用管理（inactive 视图的订阅暂停、定时器清理）

- **文件范围**:
  ```
  src/components/views/Setup/index.tsx (lines 100-118)
  src/components/views/Alarms/index.tsx (lines 34-41)
  src/components/layout/MainLayout.tsx (参考 selector 范式)
  src/components/layout/InfoPanel.tsx (Keep-Alive 副作用)
  src/components/layout/ViewContext.tsx (isActive 状态管理)
  src/stores/** (核查所有 store 订阅点)
  ```

- **依赖关系**: depends on task-01

- **测试命令**:
  ```bash
  npm run build
  ```

- **测试重点**:
  - Setup/Alarms 切换视图时无冗余重渲染（监控 React DevTools Profiler）
  - selector 写法的正确性（引用相等性）
  - Keep-Alive inactive 视图的副作用正确暂停（定时器、订阅）
  - store 字段变化只触发相关订阅组件的重渲染

- **后端推荐**: codex

---

### 任务 3：UI 美观性优化

- **任务 ID**: task-03
- **描述**:
  - 统一色彩系统、间距、排版、过渡时长（4 的倍数 spacing tokens）
  - 规范 Button/Card/Input/Badge 组件的一致性设计
  - 减少 hardcode 的像素值，将所有常用值收敛到 `variables.css` tokens
  - 本地化字体资源（替换 `variables.css` 的远程 Google Fonts import），提升离线一致性与启动稳定性

- **文件范围**:
  ```
  src/styles/variables.css (spacing/transition/typography tokens)
  src/styles/global.css (全局重置与语义)
  src/components/common/*.module.css (Button/Dialog/Tabs/StatusIndicator)
  src/components/layout/*.module.css (TitlePanel/CommandPanel/NavPanel/etc)
  src/components/views/**/*.module.css (按需统一)
  ```

- **依赖关系**: 无

- **测试命令**:
  ```bash
  npm run build
  ```

- **测试重点**:
  - 所有 module.css 中的 spacing/font-size/color 都源自 variables.css tokens（无硬编码）
  - Button/Card/Dialog 等关键组件在不同屏幕分辨率下视觉一致性
  - 本地字体加载成功（font-face 链路正确）
  - CSS 变量覆盖完整性（gap/padding/margin/color）

- **后端推荐**: gemini

---

### 任务 4：动效简化

- **任务 ID**: task-04
- **描述**:
  - 移除非必要的装饰性动画（infinite pulse）
  - 收敛 `transition: all` 为明确属性（opacity/transform/background-color）
  - 保留必要的 hover/focus/loading 反馈与告警语义提示
  - 确保 `prefers-reduced-motion` 降级生效

- **文件范围**:
  ```
  src/components/common/Button.module.css (移除 buttonAlarmPulse)
  src/components/common/Tabs.module.css (移除 tabBadgePulse)
  src/components/views/Alarms/Alarms.module.css (移除 alarmPulse，保留 color 告警标记)
  src/components/views/Monitor/Monitor.module.css (移除 alarmPulse，保留 color)
  src/components/views/System/System.module.css (移除 pulse)
  src/components/layout/TitlePanel.module.css (收敛 transition: all)
  src/styles/global.css (确保 prefers-reduced-motion 规则完整)
  ```

- **依赖关系**: depends on task-03

- **测试命令**:
  ```bash
  npm run build
  ```

- **测试重点**:
  - 动画移除后视觉反馈完整（color/opacity 变化清晰）
  - hover/focus 样式仍生效
  - 告警状态仍通过颜色（红）传达
  - `prefers-reduced-motion` 环境下无动画/过渡
  - 所有 `transition: all` 改为明确属性列表

- **后端推荐**: gemini

---

### 任务 5：错误处理与边界情况

- **任务 ID**: task-05
- **描述**:
  - 完善 ErrorBoundary（捕获渲染错误、显示降级 UI）
  - 加载态与空数据态完整性（文件树、告警列表、图表）
  - 重试策略实现（文件读取、invoke 超时、图表初始化）
  - 规范错误日志链路与用户提示

- **文件范围**:
  ```
  src/components/layout/MainLayout.tsx (ErrorBoundary 增强)
  src/components/views/Files/index.tsx (文件树/预览/图表错误处理)
  src/components/views/Monitor/index.tsx (图表初始化失败处理)
  src/stores/commStore.ts (timeout + 错误约定)
  src/platform/invoke.ts (Tauri invoke 错误降级)
  src/hooks/** (新增 useErrorBoundary、useRetry 等)
  ```

- **依赖关系**: depends on task-01

- **测试命令**:
  ```bash
  npm run build
  ```

- **测试重点**:
  - ErrorBoundary 捕获子组件异常，显示降级 UI（非白屏）
  - 文件树加载失败显示重试按钮
  - invoke 超时后弹出提示与重试选项
  - 空数据态清晰提示（无文件、无告警）
  - 图表初始化失败不阻塞页面
  - 错误日志包含上下文（文件名、行号）

- **后端推荐**: codex

---

## 测试策略

### 当前状态
- **无前端测试框架**：package.json 无 test 脚本、无 vitest/jest 依赖
- **冒烟验证**：以 `npm run build && tsc --noEmit` 作为基线

### 推荐方案

#### 短期（当前迭代）
1. **静态类型检查**（优先）
   - 保持 TypeScript strict 模式强制
   - 测试命令：`npm run build && tsc --noEmit --strict`
   - 覆盖范围：所有任务的类型正确性

2. **构建验证**
   - 确保打包成功（Vite build + Tauri 前端资源）
   - 测试命令：`npm run build`

3. **手动测试 Checklist**（关键交互路径）
   - [ ] Files 视图：打开文件树、切换节点、预览图表
   - [ ] Alarms 视图：确认/取消告警、列表排序
   - [ ] Monitor 视图：频谱分析仪初始化、瀑布图绘制
   - [ ] Setup 视图：参数修改与保存
   - [ ] 视图切换 + Keep-Alive：后台视图不重渲染

#### 中期（后续迭代，建议引入测试框架）
1. **单元测试**（优先级高）
   - 框架：Vitest + React Testing Library
   - 目标覆盖率：≥90%（Zustand stores + 纯工具函数 + 关键 hooks）
   - 关键模块：
     - `src/stores/*` (Zustand 创建/订阅逻辑)
     - `src/utils/*` (工具函数边界情况)
     - `src/hooks/*` (useScale、useAsync、useNavigation 等)

2. **组件测试**
   - 关键交互：Button/Dialog/Tabs/CommandPanel 用户交互
   - 状态管理集成：Props 变化、store 订阅更新
   - 可访问性：键盘导航、屏幕阅读器

3. **集成测试**
   - Keep-Alive 副作用暂停/恢复
   - Tauri invoke 降级（浏览器 dev 模式）
   - ErrorBoundary 捕获与降级

### 覆盖率目标
- **最终目标**：≥90% 代码覆盖（所有 src/** 文件）
- **当前基线**：0%（无测试框架），以 `npm run build` 冒烟验证
- **迭代策略**：
  - Task 01-05 完成后 → 引入 Vitest
  - 优先覆盖 stores 与工具函数（高ROI、低成本）
  - 逐步补充组件与集成测试

---

## 验收标准

### 功能完整性
- [ ] Task 01：所有大视图已拆分，子组件/hooks 独立可用
- [ ] Task 02：Setup/Alarms 视图无冗余重渲染（Profiler 验证）
- [ ] Task 03：所有 CSS spacing/color 源自 variables.css tokens
- [ ] Task 04：无无限脉冲动画，transition 已明确属性
- [ ] Task 05：ErrorBoundary 正常工作，错误路径有重试选项

### 代码质量
- [ ] `npm run build && tsc --noEmit --strict` 通过（无类型错误/警告）
- [ ] 无硬编码魔法值（spacing/color/duration）
- [ ] 代码注释完整（非显而易见的逻辑）
- [ ] 命名规范一致（camelCase 变量、PascalCase 组件）

### 性能指标
- [ ] 首屏加载时间 ≤3s（桌面 dev 环境）
- [ ] 视图切换无感知延迟（<100ms）
- [ ] 内存泄漏检查：DevTools Memory 无持续增长

### 用户体验
- [ ] 所有交互都有视觉反馈（hover/focus/loading）
- [ ] 错误提示清晰且可操作（重试/返回）
- [ ] 空数据态有友好提示（非空白屏幕）
- [ ] 无障碍性：键盘导航完整、屏幕阅读器友好

### 测试覆盖（后续）
- [ ] 当引入测试框架后，目标覆盖率 ≥90%
- [ ] 单元测试覆盖所有 store 与工具函数
- [ ] 关键交互路径有集成测试

---

## 技术决策

### 架构与代码组织
1. **保持现有"壳 + 注册表 + Keep-Alive"架构不变**
   - 证据：`src/hmi/viewRegistry.tsx:23-116`、`src/components/layout/InfoPanel.tsx:37-105`
   - 优点：架构稳定、改动风险小

2. **优先"抽 hooks/子组件/纯函数"而非大重写**
   - 针对 Files/Monitor/TitlePanel 的大文件采用渐进式拆分
   - 每个子组件功能单一、易于测试与复用

3. **类型契约集中在 `src/types/semi-e95.ts`**
   - 跨模块共享的类型统一定义（ViewId、CommandButtonConfig 等）
   - 避免类型重复定义与隐式耦合

### 性能优化
1. **Zustand 订阅粒度约束**
   - 禁止全量订阅：`useStore()` → `useStore((state) => ({ field1, field2 }))`
   - 参考范式：`src/components/layout/MainLayout.tsx:167-181`（useShallow）
   - 目标：减少无关重渲染、提升保持活动视图的响应性

2. **列表虚拟化（按需）**
   - Files 文件树与 Alarms 告警列表先 profiling（DevTools Performance）
   - 确有性能瓶颈再引入 windowing 库（window-size 或类似）
   - 优先用现有 CSS 优化（grid-auto-rows、容器查询）

### UI 与设计系统
1. **单一真源：variables.css**
   - 所有 spacing/color/typography/transition 都从 tokens 衍生
   - 示例：`--spacing-xs: 4px`、`--transition-normal: 150ms`
   - 减少 module.css 硬编码，提升一致性与可维护性

2. **桌体端字体本地化**
   - 替换 `src/styles/variables.css:6` 的远程 Google Fonts
   - 将字体资源放入 `src/assets/fonts/` 并本地加载
   - 优势：离线一致性、启动稳定性、合规性

3. **降级支持：prefers-reduced-motion**
   - 所有动画/过渡都遵循 `@media (prefers-reduced-motion: reduce)`
   - 现有实现完整（`src/styles/global.css:6-12`），后续维护时保持

### 类型安全与代码质量
1. **TypeScript Strict 模式强制**
   - 所有新增代码需通过 `tsc --strict`
   - 禁用 any 与 @ts-ignore（除特殊情况需文档说明）

2. **错误处理规范**
   - 所有 Tauri invoke 需加 try-catch 或 Promise 链式 catch
   - 文件读取、网络请求需重试策略
   - 错误日志需包含上下文（模块名、操作、错误类型）

3. **AccessibilityFirst**
   - Button/Dialog/Tabs 需支持键盘导航
   - Icon 需 aria-label（或关联 label）
   - 颜色不是唯一信息载体（配合图标/文本）

### 依赖管理
1. **最小化新增依赖**
   - 当前栈（React 18、Zustand、TypeScript）已足够应对
   - 虚拟列表库仅在"性能确有瓶颈"时考虑

2. **版本稳定性**
   - package.json 当前已固定大版本（^18.3、^5.0 等）
   - 新增依赖需评估更新频率与维护成本

---

## 风险与约束

### 已知风险
1. **无前端测试框架**
   - 当前依赖手动测试 + 静态检查
   - 建议 Task 完成后逐步引入 Vitest + 补充单元测试

2. **桌面环境差异**
   - Tauri WebView 与浏览器 dev 环境差异需关注（`src/platform/` 已处理）
   - 测试需同时验证两个环境

3. **Keep-Alive 副作用管理复杂**
   - inactive 视图的 hooks/订阅暂停需小心处理
   - 错误会导致状态不同步（Task 05 重点）

### 约束
1. **不改变项目根目录结构**（仅在 src/ 内拆分）
2. **Tauri 命令行调用需保持兼容性**（`src-tauri/tauri.conf.json` 不动）
3. **i18n 多语言支持保持**（新增文本需补充翻译资源）

---

## 任务执行优先级与并行策略

### 推荐执行顺序
1. **Task 01**（必须先做）：架构基础，Task 02/05 依赖
2. **Task 03**（可并行）：UI 设计系统，与代码结构独立
3. **Task 02**（Task 01 完成后）：性能优化，基于拆分结果
4. **Task 04**（Task 03 完成后）：动效简化，依赖 variables.css 整合
5. **Task 05**（Task 01 完成后）：错误处理，与拆分后子组件关联

### 并行执行建议
- Task 01 + Task 03 可并行（无代码冲突）
- Task 02 等待 Task 01 完成
- Task 04 等待 Task 03 完成
- Task 05 等待 Task 01 完成

### 总体耗时估计
- Task 01：3-5 天（大视图拆分）
- Task 02：2-3 天（store 优化 + Keep-Alive）
- Task 03：2-3 天（UI tokens 统一 + 字体本地化）
- Task 04：1-2 天（动效移除/收敛）
- Task 05：2-3 天（错误处理 + 重试）

**总计**：10-16 天（串行估计；并行可缩短至 8-12 天）

---

## 后续迭代

### Phase 2：测试框架集成（推荐在 Task 01-05 完成后）
1. 引入 Vitest + React Testing Library
2. 补充单元测试（stores、hooks、工具函数）
3. 补充组件测试（关键交互）
4. 目标：≥90% 覆盖率

### Phase 3：性能进阶（按需）
1. 代码分割优化（lazy code-splitting 精细化）
2. 虚拟列表引入（基于 profiling 结果）
3. 缓存策略（频谱数据、文件列表）

### Phase 4：可访问性完善（长期）
1. WCAG 2.1 AA 合规性评审
2. 屏幕阅读器测试
3. 键盘导航完整覆盖

---

## 文件清单（涉及的关键文件）

### 核心目录
```
src/
├── components/
│   ├── common/           # 通用组件 (Button/Dialog/Tabs/etc)
│   ├── layout/           # 布局壳 (MainLayout/TitlePanel/etc)
│   └── views/            # 8 个主视图 (Files/Monitor/Alarms/etc)
├── stores/               # Zustand stores (app/nav/alarm/comm/etc)
├── styles/               # 设计 tokens 与全局样式
├── hooks/                # 自定义 hooks
├── utils/                # 工具函数
├── types/                # 类型定义
└── platform/             # Tauri/浏览器兼容层
```

### 关键文件映射

| 任务 | 涉及文件（关键行号） |
|------|------------------|
| Task 01 | Files/index.tsx (1375L) / Monitor/index.tsx (1032L) / TitlePanel.tsx (637L) / semi-e95.ts / utils/* |
| Task 02 | Setup/index.tsx (100-118) / Alarms/index.tsx (34-41) / MainLayout.tsx (167-181) / InfoPanel.tsx / stores/* |
| Task 03 | variables.css (全) / global.css (全) / *.module.css (all) |
| Task 04 | Button.module.css (119-150) / Tabs.module.css (163-183) / Alarms.module.css (151-186) / Monitor.module.css (72-88) / System.module.css (199-217) |
| Task 05 | MainLayout.tsx (39-116) / Files/index.tsx / commStore.ts / invoke.ts |

---

## 相关文档与参考

- **Zustand 选择器最佳实践**：`src/components/layout/MainLayout.tsx:167-181` 示例
- **Keep-Alive 副作用管理**：`src/components/layout/InfoPanel.tsx:37-105` 与 `src/components/layout/ViewContext.tsx:37-40`
- **Tauri 兼容层设计**：`src/platform/invoke.ts:50-68` 与 `src/platform/tauri.ts:11-12`
- **视图注册表机制**：`src/hmi/viewRegistry.tsx:23-116`

---

**文档生成时间**：2025-12-24
**Session ID**：019b4f7e-afd5-7843-bdd9-616a9cd8ac3b
