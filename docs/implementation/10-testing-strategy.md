# 10 · 测试与 Mock：如何在“无 Tauri 环境”验证核心逻辑

本章解释项目的测试策略，重点是：很多逻辑在浏览器/JSDOM 中可测，不依赖真实 Tauri。

## 1. 测试框架与配置

源码对应：

- `vitest.config.ts`：Vitest 配置（merge Vite config、jsdom、coverage include）
- `src/test/setup.ts`：全局测试初始化（i18n、ResizeObserver mock、matchMedia、清理）
- `package.json`：`npm run test` / `test:coverage` 等脚本

字符画：测试环境组成

```
Vitest (jsdom)
  ├─ setupFiles: src/test/setup.ts
  ├─ react-testing-library
  └─ 覆盖：hooks / components / utils / platform
```

## 2. JSDOM 缺失能力的补齐：ResizeObserver + matchMedia

源码对应：`src/test/setup.ts`

为什么需要：

- uPlot/图表布局依赖 ResizeObserver
- 部分绘制逻辑依赖 matchMedia

做法：

- 提供最小 ResizeObserverMock：observe 时立刻回调一个默认 rect
- 若 matchMedia 不存在，补一个最小实现

## 3. “可测试设计”的模式：依赖注入（deps）

在不依赖真实 Tauri 的情况下，很多 IO Hook 通过 deps 注入实现可测。

示例 1：useFileTree

源码对应：`src/hooks/useFileTree.ts`

- deps 可注入：`isTauri/invoke/readDir/timeoutMs`
- 单测可以用 `vi.fn()` 替换 readDir/invoke

示例 2：useFilePreview

源码对应：`src/hooks/useFilePreview.ts`

- deps 可注入：`readTextFile/timeoutMs`
- 还能测试竞态（requestId）与 CSV 解析分支

字符画：deps 注入（概念）

```
useFileTree(t, {
  isTauri: () => true,
  invoke: mockInvoke,
  readDir: mockReadDir,
})
```

## 4. platform/invoke 的测试：mock @tauri-apps/api

源码对应：

- 实现：`src/platform/invoke.ts`
- 单测：`src/platform/__tests__/invoke.test.ts`

重点：

- isTauri=true 时，invoke 会动态 import `@tauri-apps/api/core`
- 测试里用 `vi.doMock("@tauri-apps/api/core", ...)` 提供 mock

## 5. Keep-Alive 场景的测试关注点

Keep-Alive 会导致“组件不卸载但不可见”，因此测试应关注：

- 不可见时是否停止订阅/定时器（`useStoreWhenActive/useIntervalWhenActive`）
- Tab 切换时子命令是否正确清理（`useRegisterSubViewCommands`）

这些点在实际运行中直接影响 CPU 与用户体验，是 Keep-Alive 架构的关键验收项。

## 6. 事件流与桥接的测试：listen mock + 计时控制

随着 `platform/events` 与通用 `useTauriEventStream` 的引入，事件相关逻辑大多可以在 Vitest/JSDOM 下验证：

- `useTauriEventStream`：
  - mock `@/platform/events.listen`，捕获 handler，并验证 `unlisten` 是否在 unmount/错误路径下被调用
  - 控制 `performance.now()`：验证 `maxHz` 节流“不影响 latestRef，但会丢弃过密 onEvent”
- `useCommEventBridge` / `useHmipEventBridge`：
  - mock `Date.now()`：验证错误告警的短窗口去重
  - 注入可观测的 `alarmStore.addAlarm`：避免依赖持久化与内部计数器
- `commStore/hmipStore` 读模型：
  - 直接调用 `handleCommEvent/handleHmipEvent`，验证状态聚合与事件日志上限（防止无限增长）

对照源码与用例：

- `src/hooks/useTauriEventStream.test.ts`
- `src/hooks/useCommEventBridge.test.ts`
- `src/hooks/useHmipEventBridge.test.ts`
- `src/stores/__tests__/commStore.events.test.ts`
- `src/stores/__tests__/hmipStore.events.test.ts`
