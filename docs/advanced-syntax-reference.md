# HMI 项目高级语法参考手册

> 面向已学过 TypeScript / React / Rust / Tauri 但记忆模糊的开发者。
> 本文以本项目实际代码为例，覆盖所有用到的中高级语法点。
>
> 最后更新：2026-07-06

---

## 目录

1. [TypeScript 高级语法](#1-typescript-高级语法)
   - 1.1 [泛型 (Generics)](#11-泛型-generics)
   - 1.2 [字面量类型与联合类型](#12-字面量类型与联合类型)
   - 1.3 [`as const` 断言](#13-as-const-断言)
   - 1.4 [`typeof` 类型推导](#14-typeof-类型推导)
   - 1.5 [工具类型 (Utility Types)](#15-工具类型-utility-types)
   - 1.6 [类型守卫 (Type Guards)](#16-类型守卫-type-guards)
   - 1.7 [`Record<string, never>` 空对象类型](#17-recordstring-never-空对象类型)
   - 1.8 [动态 import](#18-动态-import)
   - 1.9 [可选链 `?.` 和空值合并 `??`](#19-可选链--和空值合并)
   - 1.10 [类 (Class) 与继承](#110-类-class-与继承)
   - 1.11 [`interface` vs `type`](#111-interface-vs-type)
   - 1.12 [路径别名 `@/`](#112-路径别名)
   - 1.13 [函数参数解构与默认值](#113-函数参数解构与默认值)
2. [React 高级语法](#2-react-高级语法)
   - 2.1 [函数组件与 Hooks](#21-函数组件与-hooks)
   - 2.2 [类组件与 Error Boundary](#22-类组件与-error-boundary)
   - 2.3 [React.memo](#23-reactmemo)
   - 2.4 [Context API](#24-context-api)
   - 2.5 [React.lazy 与代码分割](#25-reactlazy-与代码分割)
   - 2.6 [useSyncExternalStore](#26-usesyncexternalstore)
   - 2.7 [useRef 模式](#27-useref-模式)
   - 2.8 [JSX 高级模式](#28-jsx-高级模式)
3. [Zustand 状态管理](#3-zustand-状态管理)
   - 3.1 [create 基础模式](#31-create-基础模式)
   - 3.2 [persist 中间件](#32-persist-中间件)
   - 3.3 [selector 与 useShallow](#33-selector-与-useshallow)
   - 3.4 [getState 脱离 React 获取状态](#34-getstate-脱离-react-获取状态)
4. [Tauri 前端层](#4-tauri-前端层)
   - 4.1 [环境探测与动态加载](#41-环境探测与动态加载)
   - 4.2 [invoke 统一封装](#42-invoke-统一封装)
   - 4.3 [事件订阅](#43-事件订阅)
5. [Rust 高级语法](#5-rust-高级语法)
   - 5.1 [模块系统](#51-模块系统)
   - 5.2 [属性宏 (Attribute Macros)](#52-属性宏-attribute-macros)
   - 5.3 [派生宏 (Derive Macros)](#53-派生宏-derive-macros)
   - 5.4 [条件编译 `#[cfg]` / `#[cfg_attr]` / `cfg!`](#54-条件编译-cfg--cfg_attr--cfg)
   - 5.5 [枚举与代数数据类型](#55-枚举与代数数据类型)
   - 5.6 [模式匹配](#56-模式匹配)
   - 5.7 [泛型与 trait 约束](#57-泛型与-trait-约束)
   - 5.8 [生命周期 (Lifetimes)](#58-生命周期-lifetimes)
   - 5.9 [异步并发原语](#59-异步并发原语)
   - 5.10 [Tokio 并发模型](#510-tokio-并发模型)
   - 5.11 [错误处理](#511-错误处理)
   - 5.12 [Serde 序列化/反序列化](#512-serde-序列化反序列化)
   - 5.13 [智能指针与资源共享](#513-智能指针与资源共享)
   - 5.14 [闭包 (Closures)](#514-闭包-closures)
   - 5.15 [trait 对象 `Box<dyn Trait>`](#515-trait-对象-boxdyn-trait)
   - 5.16 [项目特有模式](#516-项目特有模式)
6. [Tauri 后端层](#6-tauri-后端层)
   - 6.1 [Builder 模式](#61-builder-模式)
   - 6.2 [Command 定义与注入](#62-command-定义与注入)
   - 6.3 [状态管理 `app.manage()` / `State<>`](#63-状态管理-appmanage--state)
   - 6.4 [事件发射 `app.emit()`](#64-事件发射-appemit)
   - 6.5 [异步运行时 `tauri::async_runtime::spawn`](#65-异步运行时-tauriasync_runtimespawn)

---

## 1. TypeScript 高级语法

### 1.1 泛型 (Generics)

泛型让你可以编写与类型无关的可复用代码，在调用时才确定具体类型。

```typescript
// === 文件: src/hooks/useAsync.ts ===

// 函数泛型：<T> 声明了一个类型参数 T
// 调用时 TypeScript 会根据传入的 asyncFn 自动推断 T
export function useAsync<T>(
    asyncFn: () => Promise<T>,       // 返回 Promise<T>
    options: UseAsyncOptions = {},
): UseAsyncReturn<T> {               // 返回值也引用同一个 T
    // ...
    const execute = useCallback(async (): Promise<T | undefined> => {
        const result = await asyncFn(); // result 的类型就是 T
        return result;
    }, [asyncFn]);
    return { execute, loading, error, clearError };
}

// === 文件: src/stores/navigationStore.ts ===

// 泛型约束：<V extends ViewId> 表示 V 必须是 ViewId 的子类型
// 这样 ViewDialogStateMap[V] 就能正确推导出对应的状态类型
setViewDialogState: <V extends ViewId>(
    view: V,
    state: ViewDialogStateMap[V] | undefined,
) => void;

// === 文件: src/platform/invoke.ts ===

// 多泛型参数 + 约束
export function registerInvokeMock<TArgs extends InvokeArgs, TResult>(
    command: string,
    handler: InvokeMockHandler<TArgs, TResult>,
) { /* ... */ }

// 泛型函数调用时显式指定类型参数
export async function invoke<TResult>(
    command: string,
    args?: InvokeArgs,
): Promise<TResult> { /* ... */ }
```

### 1.2 字面量类型与联合类型

将具体的字符串/数字/布尔值作为类型使用，组合成有限集合。

```typescript
// === 文件: src/stores/appStore.ts ===

// 字面量联合类型：只允许这两个值
language: "zh" | "en";
theme: ThemeId;          // ThemeId 定义在 types 中，也是字面量联合
visualEffects: "full" | "reduced";
messageType: "info" | "warning" | "alarm" | null;

// === 文件: src/hooks/useRetry.ts ===

// 字符串字面量联合
export type RetryBackoff = "fixed" | "exponential";

// === 文件: src/platform/invoke.ts ===

export type InvokeErrorCode =
    | "MOCK_NOT_REGISTERED"
    | "TAURI_API_UNAVAILABLE"
    | "INVOKE_FAILED";
```

### 1.3 `as const` 断言

让 TypeScript 把值推断为**最窄**的字面量类型，而不是宽泛的 `string` / `number`。

```typescript
// === 文件: src/platform/secsRpc.ts ===

// 没有 as const：TransportKind.UNSPECIFIED 的类型是 number
// 有了 as const：TransportKind.UNSPECIFIED 的类型是 0（字面量）
// 并且整个对象变为 readonly
export const TransportKind = {
    UNSPECIFIED: 0,
    HSMS: 1,
    SECS1: 2,
} as const;

// 技巧：从 as const 对象推导出联合类型
// 分解：
//   typeof TransportKind → { readonly UNSPECIFIED: 0; readonly HSMS: 1; ... }
//   keyof typeof TransportKind → "UNSPECIFIED" | "HSMS" | "SECS1"
//   (typeof TransportKind)["UNSPECIFIED" | "HSMS" | "SECS1"] → 0 | 1 | 2
export type TransportKind =
    (typeof TransportKind)[keyof typeof TransportKind];
// TransportKind 类型 = 0 | 1 | 2

// 同样模式在 SessionState、ItemType 中使用
```

### 1.4 `typeof` 类型推导

从已有**值**（运行时实体）推导出**类型**（编译时实体）。

```typescript
// === 从变量/常量推导 ===
const DEFAULT_BATCH = {
    machineId: "MCP-03",
    operatorId: "op-001",
    plannedBottleCount: 3,
};
// type BatchDefaults = { machineId: string; operatorId: string; plannedBottleCount: number }
type BatchDefaults = typeof DEFAULT_BATCH;

// === 前面 as const 结合 typeof 的例子 ===
// (typeof TransportKind) → 获取 TransportKind 对象字面量的类型
// [keyof typeof TransportKind] → 获取所有 key 对应的值类型的联合
```

### 1.5 工具类型 (Utility Types)

TypeScript 内置的类型变换工具。

```typescript
// === Partial<T> — 所有字段变为可选 ===
// 文件: src/stores/navigationStore.ts
// 视图的对话框状态可能还没被设置过
type ViewDialogStates = Partial<ViewDialogStateMap>;
// 等价于：{ jobs?: EmptyDialogState; run?: EmptyDialogState; ... }

// === Record<K, V> — 键值对映射类型 ===
// 文件: src/stores/navigationStore.ts
// 每个 ViewId 对应一个 boolean
unfinishedTasks: Record<ViewId, boolean>;

// 文件: src/hmi/viewLoaders.tsx
export const HMI_VIEW_COMPONENTS: Record<
    ViewId,
    LazyExoticComponent<() => JSX.Element>
> = { /* ... */ };

// === Pick<T, K> — 从 T 中选取部分字段 ===
// 文件: src/hooks/useRetry.ts
function computeDelayMs(
    ctx: RetryContext,
    options: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "backoff" | "jitterRatio">>
): number { /* ... */ }
// Pick<RetryOptions, "baseDelayMs" | ...> → 只取这 4 个字段
// Required<...> → 去掉可选标记，全部变为必填

// === Required<T> — 所有字段变为必填 ===
// 文件: src/hooks/useRetry.ts
function normalizeOptions(options: RetryOptions | undefined): Required<RetryOptions> {
    // 返回值保证所有字段都有值，不再需要 ?.
}

// === ReturnType<T> — 获取函数返回值类型（项目中间接使用） ===
```

### 1.6 类型守卫 (Type Guards)

在运行时缩窄类型范围，让后续代码获得更精确的类型。

```typescript
// === 文件: src/utils/async.ts ===

// `error is TimeoutError` 是类型谓词（type predicate）
// TypeScript 在 if 分支内知道 error 是 TimeoutError，可以访问 .timeoutMs
export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof Error && error.name === "TimeoutError";
}

// 使用
try {
    await someAsyncFn();
} catch (err) {
    if (isTimeoutError(err)) {
        console.log(`超时了，超时时间: ${err.timeoutMs}`); // 可以访问 timeoutMs
    }
}
```

### 1.7 `Record<string, never>` 空对象类型

比 `{}` 更严格，表示"一个没有属性的对象"，不能随意赋值。

```typescript
// === 文件: src/stores/navigationStore.ts ===

// 明确表达：某些视图没有额外的对话框状态
// 如果用 `any` 则失去类型安全，用 `{}` 则允许任何对象
type EmptyDialogState = Record<string, never>;
// Record<string, never> ≈ 空对象，即使 `{ foo: 1 }` 也不能赋值给它

// 在映射中使用
export type ViewDialogStateMap = {
    jobs: EmptyDialogState;    // 明确无状态
    run: EmptyDialogState;
    setup: SetupViewDialogState; // 有具体状态
};
```

### 1.8 动态 import

在运行时按需加载模块，返回 Promise。

```typescript
// === 文件: src/platform/invoke.ts ===

// 在 Tauri WebView 中才加载 @tauri-apps/api
// 浏览器开发模式不加载，避免运行时错误
const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
return await tauriInvoke<TResult>(command, args);

// === 文件: src/platform/events.ts ===
const { listen: tauriListen } = await import("@tauri-apps/api/event");
return await tauriListen<TPayload>(eventName, handler);

// === 文件: src/hmi/viewLoaders.tsx — React.lazy 内部使用动态 import ===
const JobsView = lazy(() => import("@/components/views/Jobs"));
const DilutionView = lazy(() => import("@/components/views/Dilution"));
// 只有首次渲染该视图时才加载对应的 JS chunk
```

### 1.9 可选链 `?.` 和空值合并 `??`

```typescript
// 可选链：安全访问可能为 null/undefined 的属性
state.viewDialogStates[view]           // 可能 undefined
state.connectionStates?.[connectionId] // 安全访问

// 空值合并：左侧为 null/undefined 时取右侧
const connectionId = connectionId ?? getDefaultConnectionId(transport);
const maxAttempts = merged.maxAttempts ?? 3;

// 组合使用
batch?.selectedRecipe?.mixTimeMs ?? 300_000
// 等价于：
//   if (batch && batch.selectedRecipe && batch.selectedRecipe.mixTimeMs != null)
//     result = batch.selectedRecipe.mixTimeMs;
//   else result = 300_000;
```

### 1.10 类 (Class) 与继承

```typescript
// === 文件: src/platform/invoke.ts ===

// 自定义错误类继承 Error
export class InvokeError extends Error {
    readonly code: InvokeErrorCode;    // readonly：构造函数外不可修改
    readonly command: string;

    constructor(params: {             // 参数使用对象解构
        code: InvokeErrorCode;
        command: string;
        message: string;
        args?: InvokeArgs;
        cause?: unknown;
    }) {
        super(params.message);        // 调用父类构造函数
        this.name = "InvokeError";    // 设置错误名称（影响 Error 显示）
        this.code = params.code;
        this.command = params.command;
    }
}

// === 文件: src/hooks/useRetry.ts ===
export class RetryCancelledError extends Error {
    constructor(message: string = "Retry cancelled") {
        super(message);
        this.name = "RetryCancelledError";
    }
}

// === 文件: src/components/common/ErrorBoundary.tsx ===
// React 类组件（详见 2.2 节）
```

### 1.11 `interface` vs `type`

本项目中的使用惯例：

- **`interface`**：定义对象形状，可以被扩展/合并
- **`type`**：定义联合类型、工具类型、字面量类型

```typescript
// interface — 对象形状
interface UseAsyncOptions {
    successTitle?: string;
    successMessage?: string;
}

// interface 可以扩展
interface UseAsyncReturn<T> {
    execute: () => Promise<T | undefined>;
    loading: boolean;
}

// type — 联合类型、函数签名、映射类型
export type ErrorHandler = (message: string, error: unknown) => void | Promise<void>;
export type ColorScheme = "turbo" | "viridis" | "jet" | "grayscale";
type ViewDialogStates = Partial<ViewDialogStateMap>;  // 工具类型只能用 type
```

### 1.12 路径别名 `@/`

```json
// tsconfig.json
{
    "compilerOptions": {
        "baseUrl": ".",
        "paths": {
            "@/*": ["src/*"]  // @/xxx → src/xxx
        }
    }
}
```

```typescript
// 在任何文件中使用
import { listen } from "@/platform/events";
import { useAppStore } from "@/stores/appStore";
import type { ViewId } from "@/types";
```

### 1.13 函数参数解构与默认值

```typescript
// === 对象解构 + 默认值 ===
// 文件: src/hooks/useAsync.ts
export function useAsync<T>(
    asyncFn: () => Promise<T>,
    options: UseAsyncOptions = {},   // 默认空对象
): UseAsyncReturn<T> {
    const {
        showSuccessNotification = false,  // 深层默认值
        showErrorNotification = true,
    } = options;
}

// === 嵌套解构 ===
// 文件: src/hooks/useTauriEventStream.ts
const {
    enabled,
    eventName,
    startCommand,
    stopCommand,
} = options;

// === 剩余参数展开 ===
// 文件: src/stores/navigationStore.ts
viewHistory: [...state.viewHistory, state.currentView].slice(-10),
// 展开 state.viewHistory 数组，追加 state.currentView，取最后 10 个
```

---

## 2. React 高级语法

### 2.1 函数组件与 Hooks

本项目全部使用函数组件 + Hooks（仅 ErrorBoundary 是类组件）。

```typescript
// === 基本函数组件 ===
// 文件: src/App.tsx
function App() {
    return <MainLayout />;
}
export default App;

// === 带 props 的函数组件 ===
// 文件: src/components/views/Dilution/index.tsx
function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className={styles.metricCard}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

// === Hooks 速查表 ===
// useState<T>(initialValue)   — 状态管理
// useEffect(fn, [deps])       — 副作用（订阅、定时器、DOM 操作）
// useCallback(fn, [deps])     — 缓存函数引用（避免子组件不必要重渲染）
// useMemo(() => value, [deps])— 缓存计算结果
// useRef<T>(initialValue)     — 跨渲染保持引用（不触发重渲染）
// useContext(Context)         — 读取 Context 值
```

```typescript
// === useState 示例 ===
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);  // 指定类型

// === useEffect 示例 ===
useEffect(() => {
    let cancelled = false;          // 闭包变量防止竞态
    const setup = async () => {
        // 异步初始化...
        if (cancelled) return;     // 组件已卸载则放弃
    };
    void setup();                   // void 关键字：标记忽略 Promise

    return () => {
        cancelled = true;           // 清理函数：组件卸载时执行
        unlistenFn?.();             // 取消监听
    };
}, [enabled, eventName, retryToken]); // 依赖数组：任一变化时重新执行

// === useCallback 示例 ===
const execute = useCallback(async (): Promise<T | undefined> => {
    setLoading(true);
    try {
        return await asyncFn();
    } finally {
        setLoading(false);
    }
}, [asyncFn, addNotification]); // 依赖变化才创建新函数

// === useMemo 示例 ===
const commandList = useMemo<CommandButtonConfig[]>(
    () => [
        {
            id: "createBatch",
            disabled: busy,
            onClick: handleCreateBatch,
        },
        // ...
    ],
    [batch, busy, handleCreateBatch /* ... */], // 依赖变化才重新计算
);
```

### 2.2 类组件与 Error Boundary

React 的 Error Boundary **必须**用类组件实现（没有对应的 Hook）。

```typescript
// === 文件: src/components/common/ErrorBoundary.tsx ===

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    // 类属性声明（不需要 constructor）
    state: ErrorBoundaryState = {
        hasError: false,
        error: null,
    };

    // 静态方法：React 在渲染捕获错误后调用，返回新的 state
    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    // 生命周期：错误被捕获后调用（日志/上报）
    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("[HMI] 组件渲染异常：", error);
        this.props.onError?.(error, errorInfo);
    }

    // 生命周期：props 更新后调用
    componentDidUpdate(prevProps: Readonly<ErrorBoundaryProps>) {
        // 当 resetKeys 变化（如切换视图）时自动恢复
        if (
            this.state.hasError &&
            !areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)
        ) {
            this.reset();
        }
    }

    // 箭头函数作为类方法（自动绑定 this）
    private reset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        // fallback render prop 模式：父组件自定义降级 UI
        const fallback = this.props.fallback?.({
            error: this.state.error ?? new Error("Unknown error"),
            reset: this.reset,
        });
        if (fallback) return fallback;

        // 默认降级 UI
        return <div>页面渲染失败 ...</div>;
    }
}
```

关键点：
- `getDerivedStateFromError` — 把渲染错误转为 state
- `componentDidCatch` — 日志/上报，不阻塞 UI
- `resetKeys` — 切换视图时自动重置（本项目特有模式）

### 2.3 React.memo

跳过不必要重渲染的性能优化。

```typescript
// === 文件: src/components/layout/MainLayout.tsx ===

// 包裹组件，props 未变化时不重渲染
const MemoTitlePanel = memo(TitlePanel);
const MemoInfoPanel = memo(InfoPanel);
const MemoCommandPanel = memo(CommandPanel);
const MemoNavPanel = memo(NavPanel);

// 使用
<MemoTitlePanel currentView={currentView} />
```

### 2.4 Context API

```typescript
// === 文件: src/components/layout/ViewContext.tsx ===

// 1) createContext 创建上下文
const ViewContext = createContext<ViewContextValue | null>(null);

// 2) Provider 提供值
export function ViewContextProvider({
    value,
    children,
}: {
    value: ViewContextValue;
    children: React.ReactNode;    // React.ReactNode 表示可渲染的任何内容
}) {
    return (
        <ViewContext.Provider value={value}>
            {children}
        </ViewContext.Provider>
    );
}

// 3) useContext 消费值
export function useIsViewActive(): boolean {
    const ctx = useContext(ViewContext);
    return ctx ? ctx.isActive : true;   // 未提供 Context 时默认激活
}
```

本项目 Context 使用场景：
- `ViewContext` — 视图激活状态（Keep-Alive 用）
- `ViewCommandContext` — 命令按钮注册
- `SubViewCommandContext` — 子视图命令

### 2.5 React.lazy 与代码分割

```typescript
// === 文件: src/hmi/viewLoaders.tsx ===

import { lazy, type LazyExoticComponent } from "react";

// lazy() 接受一个返回 Promise 的工厂函数
// import() 返回 Promise<模块默认导出>
const JobsView = lazy(() => import("@/components/views/Jobs"));
const DilutionView = lazy(() => import("@/components/views/Dilution"));
const RecipesView = lazy(() => import("@/components/views/Recipes"));
// ...

// 类型注解：LazyExoticComponent 是 lazy 返回的类型
export const HMI_VIEW_COMPONENTS: Record<
    ViewId,
    LazyExoticComponent<() => JSX.Element>
> = {
    jobs: JobsView,
    run: DilutionView,
    // ...
};
```

- `lazy` 组件必须配合 `<Suspense>` 使用（本项目在 InfoPanel 中）
- `type LazyExoticComponent` 是 type-only import，仅在编译时存在，不产生运行时代码

### 2.6 useSyncExternalStore

React 18 提供的原生 API，用于订阅外部 store（本项目用它实现 Zustand 的门控订阅）。

```typescript
// === 文件: src/hooks/useStoreWhenActive.ts ===

import { useCallback, useSyncExternalStore } from "react";

export function useStoreWhenActive<TState, TSlice>(
    store: UseBoundStore<StoreApi<TState>>,
    selector: (state: TState) => TSlice,
    { enabled = true }: { enabled?: boolean } = {},
): TSlice {
    // subscribe 函数：当 enabled=false 时返回空函数（不订阅）
    const subscribe = useCallback(
        (listener: () => void) => {
            if (!enabled) return () => {};       // 不订阅 = 不触发重渲染
            return store.subscribe(() => listener());
        },
        [enabled, store],
    );

    // getSnapshot 返回当前值
    const getSnapshot = useCallback(() => {
        return selector(store.getState());
    }, [selector, store]);

    // useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

### 2.7 useRef 模式

`useRef` 有两个主要用途：
1. 持有 DOM 引用
2. **持有可变值但不触发重渲染**（本项目大量使用）

```typescript
// === 文件: src/hooks/useTauriEventStream.ts ===

// 高频更新的值存入 ref，不触发重渲染
const latestRef = useRef<TPayload | null>(null);
latestRef.current = payload;  // 直接修改 .current，不触发渲染

// 用 ref 持有最新的回调函数，避免 useEffect 依赖变化
const onEventRef = useRef(options.onEvent);
useEffect(() => {
    onEventRef.current = options.onEvent;  // 总是持有最新版本
}, [options.onEvent]);

// 在事件回调中通过 ref 调用最新的回调
onEventRef.current?.(payload, meta);

// === 文件: src/hooks/useRetry.ts ===

// runIdRef 防止并发竞态
const runIdRef = useRef(0);
const run: RetryRunner = useCallback(async (task, overrides) => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    // 如果中途有新的 run 调用，旧的 run 会在循环中检测到
    if (runIdRef.current !== runId) {
        throw new RetryCancelledError();
    }
}, []);

// cancelledRef 用于取消
const cancelledRef = useRef(false);
```

### 2.8 JSX 高级模式

```tsx
// === Spread Props ===
<MemoTitlePanel currentView={currentView} />

// === 条件渲染 ===
{batch?.report && <div>Report available</div>}
{error ? <ErrorDisplay /> : <NormalDisplay />}

// === data-* 属性 ===
<div data-command-position={commandPanelPosition} />
<button data-state={state} data-executing={isExecuting} />

// === 内联样式（对象字面量） ===
<div style={{ padding: "var(--sp-md-rem, 1rem)" }} />

// === Fragment 简写 ===
<>
    <DocumentChromeSync />
    <div>content</div>
</>

// === 可选调用 ?.() ===
onEventRef.current?.(payload, { paused, receivedAtMs: Date.now() });

// === void 忽略 Promise ===
void setup();   // 等价于 setup().catch(console.error) 的简洁写法
```

---

## 3. Zustand 状态管理

### 3.1 create 基础模式

```typescript
// === 文件: src/stores/navigationStore.ts ===

// create<T>()((set, get) => ({ ... }))
// T = NavigationState（接口定义）
// set —— 更新状态（支持部分更新，自动浅合并）
// get —— 读取当前状态
export const useNavigationStore = create<NavigationState>((set, get) => ({
    // 初始状态
    currentView: "jobs",
    viewHistory: [],

    // action：调用 set() 更新状态
    setCurrentView: (view) =>
        set((state) => ({
            currentView: view,
            // 展开运算符创建新数组引用（不可变更新）
            viewHistory: [...state.viewHistory, state.currentView].slice(-10),
        })),

    goBack: () =>
        set((state) => {
            const history = [...state.viewHistory];
            const previousView = history.pop();
            return {
                currentView: previousView || "jobs",
                viewHistory: history,
            };
        }),

    // 用 get() 读取状态（不订阅，不触发重渲染）
    getViewDialogState: (view) => get().viewDialogStates[view],
}));
```

### 3.2 persist 中间件

```typescript
// === 文件: src/stores/appStore.ts ===

export const useAppStore = create<AppState>()(   // 注意多一层括号
    persist(
        (set) => ({
            language: "zh",
            theme: "dark",
            // ...
        }),
        {
            name: "hmi-app-storage",           // localStorage key

            // partialize：只持久化选定的字段
            partialize: (state) => ({
                language: state.language,
                theme: state.theme,
                visualEffects: state.visualEffects,
                commandPanelPosition: state.commandPanelPosition,
                scaleOverride: state.scaleOverride,
                // user 不持久化（登录态每次启动重置）
            }),

            // onRehydrateStorage：从 localStorage 恢复后回调
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.warn("Failed to rehydrate app storage:", error);
                    return;
                }
                if (state?.language) {
                    i18n.changeLanguage(state.language);
                }
            },
        },
    ),
);
```

### 3.3 selector 与 useShallow

```typescript
// === 文件: src/components/layout/MainLayout.tsx ===

import { useShallow } from "zustand/shallow";

// selector：只订阅需要的字段，避免无关重渲染
const { currentView, setCurrentView } = useNavigationStore(
    useShallow((state) => ({
        currentView: state.currentView,
        setCurrentView: state.setCurrentView,
    })),
);

// useShallow 的作用：
// 对 selector 返回的对象做浅比较
// 如果两次 selector 结果浅相等，则不触发重渲染
// 没有 useShallow 时，每次都会返回新对象引用，导致不必要渲染

// 单字段 selector（不需要 useShallow — 直接按值比较）
const commandPanelPosition = useAppStore((state) => state.commandPanelPosition);

// 订阅单个 action（Zustand action 函数引用稳定，不会触发额外渲染）
const addNotification = useNotificationStore(
    (state) => state.addNotification,
);
```

### 3.4 getState 脱离 React 获取状态

```typescript
// === 文件: src/hooks/useHmipEventBridge.ts ===

// 在非 React 上下文中（事件回调）直接读取/写入 store
useHmipStore.getState().handleHmipEvent(payload);
useAlarmStore.getState().addAlarm({
    severity: "warning",
    message: `协议解码失败 ...`,
});

// getState() 的用法：
// - 回调/定时器/事件处理器中
// - 不需要订阅（不触发重渲染）
// - 获取最新状态快照
```

---

## 4. Tauri 前端层

### 4.1 环境探测与动态加载

```typescript
// === 文件: src/platform/tauri.ts ===

export function isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
// 原理：Tauri WebView 会注入 __TAURI_INTERNALS__ 全局变量
// 浏览器开发模式下不存在该变量
```

关键模式：所有 Tauri API 通过**动态 import** 加载，浏览器模式下完全不加载 Tauri 包，避免报错。

### 4.2 invoke 统一封装

```typescript
// === 文件: src/platform/invoke.ts ===

// 核心模式：双环境适配
export async function invoke<TResult>(
    command: string,
    args?: InvokeArgs,
): Promise<TResult> {
    if (isTauri()) {
        // Tauri 环境：动态 import + 真实调用
        const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
        return await tauriInvoke<TResult>(command, args);
    }

    // 浏览器环境：走 mock
    const handler = invokeMocks.get(command);
    if (handler) {
        return (await handler(args)) as TResult;
    }

    // 无 mock：抛出明确错误（而非 silently fail）
    throw new InvokeError({
        code: "MOCK_NOT_REGISTERED",
        command,
        message: `浏览器环境无法调用 Tauri invoke（command=${command}）`,
    });
}

// mock 注册
export function registerInvokeMock<TArgs extends InvokeArgs, TResult>(
    command: string,
    handler: InvokeMockHandler<TArgs, TResult>,
) {
    invokeMocks.set(command, handler);
}
```

### 4.3 事件订阅

```typescript
// === 文件: src/platform/events.ts ===

export async function listen<TPayload>(
    eventName: string,
    handler: ListenHandler<TPayload>,
): Promise<UnlistenFn> {
    if (!isTauri()) {
        throw new EventError({
            code: "TAURI_API_UNAVAILABLE",
            eventName,
            message: `浏览器环境无法订阅 Tauri 事件`,
        });
    }

    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    return await tauriListen<TPayload>(eventName, handler);
}

// 使用模式（文件: src/hooks/useTauriEventStream.ts）
const unlisten = await listen<TPayload>(eventName, (event) => {
    const payload = event.payload;        // event.payload 类型是 TPayload
    latestRef.current = payload;          // 存入 ref，不触发渲染
    onEventRef.current?.(payload, meta);  // 节流后触发 UI 更新
});
```

---

## 5. Rust 高级语法

### 5.1 模块系统

```rust
// === 文件: src-tauri/src/lib.rs ===

// mod 声明子模块（Rust 自动查找同名文件或目录下的 mod.rs）
mod comm;         // → src-tauri/src/comm/mod.rs
mod commands;     // → src-tauri/src/commands.rs
mod craftsmanship;// → src-tauri/src/craftsmanship/mod.rs
mod dilution;     // → src-tauri/src/dilution/mod.rs

// use 引入路径
use tauri::Manager;                              // 引入 trait（扩展方法）
use std::sync::Arc;                               // 引入结构体
use std::sync::atomic::{AtomicU32, Ordering};     // 引入多个项

// pub 控制可见性
pub fn run() { }          // 公开函数
mod tcp;                  // 私有模块（默认）
pub(crate) trait TestIoStream { }  // 仅当前 crate 可见
pub(super) struct RecipeRuntimeState { }  // 仅父模块可见
```

### 5.2 属性宏 (Attribute Macros)

以 `#[...]` 形式作用于下方的项。

```rust
// === Tauri 属性宏 ===

// 将函数注册为 Tauri command（前后端 RPC 入口）
#[tauri::command]
pub fn get_system_overview() -> Result<system::SystemOverview, String> { }

// 标记移动端入口点（仅在 cfg(mobile) 时生效）
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { }

// === 测试相关 ===
#[cfg(test)]              // 仅在 cargo test 时编译
mod tests { }

#[tokio::test]            // tokio 异步测试运行时
async fn test_foo() { }

#[test]                   // 标准同步测试
fn test_bar() { }

#[cfg(unix)]              // 仅在 Unix 平台编译
#[tokio::test]
async fn test_serial() { }
```

### 5.3 派生宏 (Derive Macros)

自动为类型实现标准 trait。

```rust
// === 文件: src-tauri/src/comm/actor.rs ===

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommPriority { High, Normal }

#[derive(Debug, Clone, Serialize)]          // Serialize 来自 serde
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommEvent { /* ... */ }

#[derive(Debug, Clone, Deserialize)]        // Deserialize 来自 serde
#[serde(rename_all = "snake_case")]
pub enum CommPriority { High, Normal }

// 常用派生宏速查：
// Debug   — 格式化输出（println!("{:?}", value)）
// Clone   — .clone() 复制
// Copy    — 按位复制（轻量类型，不需要所有权转移）
// PartialEq / Eq — == 比较
// Default — 提供默认值
// Serialize / Deserialize — JSON/TOML 序列化
```

### 5.4 条件编译 `#[cfg]` / `#[cfg_attr]` / `cfg!`

```rust
// === #[cfg(条件)] — 条件为真才编译此项 ===

#[cfg(target_os = "linux")]
mod linux { /* Linux 平台特有实现 */ }

#[cfg(test)]
pub(crate) fn set_tcp_stream_override(...) { }

// === #[cfg_attr(条件, 属性)] — 条件为真时贴上属性 ===

// 仅在 mobile 编译时加上 #[tauri::mobile_entry_point]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { }

// 仅在非 debug 时设置 windows_subsystem
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// === cfg!() 宏 — 运行时布尔判断（编译时常量折叠） ===

let log_level = if cfg!(debug_assertions) {
    log::LevelFilter::Debug
} else {
    log::LevelFilter::Info
};

// 与 #[cfg] 的区别：cfg! 是允许访问代码的，只是在运行时会优化掉。
// #[cfg] 控制是否编译这段代码，假时根本不参与编译。
```

### 5.5 枚举与代数数据类型

Rust 的枚举可以携带数据，这是本项目最核心的语法之一。

```rust
// === 简单枚举 ===
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommConnectionKind {
    Serial,
    Tcp,
}

// === 带数据的枚举（代数数据类型 / tagged union） ===
// serde(tag = "type") → JSON 序列化用 "type" 字段区分变体
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommEvent {
    Connected {
        transport: String,
        connection_id: String,
        timestamp_ms: u64,
    },
    Disconnected { /* ... */ },
    Reconnecting {
        transport: String,
        connection_id: String,
        attempt: u32,             // 变体特有字段
        delay_ms: u64,
        timestamp_ms: u64,
    },
    Rx { /* ... */ },
    Tx { /* ... */ },
    Error { /* ... */ },
}

// === 内部枚举（私有，控制状态机） ===
enum EnsureConnectionAction {
    Reuse,                        // 无数据
    Connect,                      // 无数据
    Replace(actor::CommActorHandle), // 携带值
}

// === 携带多种数据的复杂枚举 ===
pub enum RecipeRuntimeExternalInput {
    Signal {
        signal_id: String,
        value: Value,
        source: String,
        timestamp_ms: u64,
    },
    DeviceFeedback {
        device_id: String,
        feedback_key: String,
        value: Value,
        source: String,
        timestamp_ms: u64,
    },
}
```

### 5.6 模式匹配

Rust 的模式匹配非常强大，远不止 `switch`。

```rust
// === match 表达式 ===

// 基础 match
match priority {
    CommPriority::High => tx_high,
    CommPriority::Normal => tx_normal,
}

// 枚举解构
match message {
    Some(proto::Message::Hello(v)) => HmipMessageSummary::Hello {
        role: match v.role {
            proto::Role::Client => "client".to_string(),
            proto::Role::Server => "server".to_string(),
        },
        capabilities: v.capabilities,
        name: v.name.clone(),
    },
    Some(proto::Message::Raw { msg_type, payload }) => HmipMessageSummary::Raw {
        msg_type: *msg_type,       // * 解引用
        payload_len: payload.len(),
        payload_base64: b64,
        payload_truncated: truncated,
    },
    None => HmipMessageSummary::Raw { /* ... */ },
}

// 守卫条件
Err(failure) if failure.code == "stop_requested" => {
    // 仅当 code 匹配时进入此分支
}

// === matches! 宏 — 返回 bool ===
// 用于需要布尔值的场景（特别适合 if / assert!）
if matches!(failure.on_error.as_deref(), Some("safe-stop")) { }

assert!(matches!(action, EnsureConnectionAction::Reuse));

// === if let — 单分支匹配 ===
if let Some(source) = source {
    state.snapshot.runtime_values.insert(source, value.clone());
}

if let Err(error) = manager.apply_hmip_feedback_with_app(...).await {
    log::warn!("Failed to bridge HMIP message: {}", error);
}

// === while let — 循环匹配 ===
// 文件: src-tauri/src/comm/actor.rs
loop {
    match hmip_decoder.next_frame() {
        Ok(Some(frame)) => { /* 处理帧 */ }
        Ok(None) => break,         // 数据不足，退出内层循环
        Err(err) => { /* 继续解析 */ continue; }
    }
}

// === let ... else — Rust 1.65+ ===
let Some(managed) = connections.get(connection_id) else {
    return Ok(EnsureConnectionAction::Connect);
};
// 等价于：如果为 None，执行 else 块

let Some(loaded) = state.loaded.clone() else {
    return Err("no recipe has been loaded".to_string());
};
```

### 5.7 泛型与 trait 约束

```rust
// === 泛型函数 ===
pub async fn ensure_tcp_connection<R: Runtime>(
    state: &CommState,
    app: &AppHandle<R>,          // R 被 AppHandle 消费
    connection_id: &str,
    config: tcp::TcpConfig,
) -> Result<(), String> { }

// === 泛型 + 多个 trait 约束 ===
// + 运算符组合多个 trait
#[cfg(test)]
pub(crate) trait TestIoStream: AsyncRead + AsyncWrite + Send + Unpin {}

// 无条件实现：任何满足这些 trait 的类型自动实现 TestIoStream
#[cfg(test)]
impl<T> TestIoStream for T where T: AsyncRead + AsyncWrite + Send + Unpin {}

// === impl Trait 语法（简化返回类型） ===
fn emit_event<R: Runtime>(app: &AppHandle<R>, event: &CommEvent) -> bool { }

// === 泛型结构体 ===
pub struct CommState {
    connections: Arc<Mutex<HashMap<String, ManagedConnectionHandle>>>,
}
// HashMap<K, V> 本身就是泛型

// === 泛型枚举 ===
// Result<T, E> 和 Option<T> 随处可见
fn read_uptime_seconds() -> Result<u64, String> { }
fn base64_preview(bytes: &[u8]) -> (Option<String>, bool) { }
```

### 5.8 生命周期 (Lifetimes)

生命周期标注告诉编译器引用之间有效期的关系。

```rust
// === 'static — 贯穿整个程序生命周期 ===
pub const DEFAULT_SERIAL_CONNECTION_ID: &str = "__default_serial__";
// 字符串字面量的类型是 &'static str

fn tcp_stream_override() -> &'static std::sync::Mutex<Option<TcpStreamOverride>> {
    static OVERRIDE: std::sync::OnceLock<...> = std::sync::OnceLock::new();
    OVERRIDE.get_or_init(|| std::sync::Mutex::new(None))
}
// &'static 引用：指向的数据在整个程序生命周期内有效

// === '_ — 匿名/省略生命周期 ===
pub async fn connect_serial(
    app: AppHandle,
    state: State<'_, CommState>,    // '_ 编译器自动推断
    config: serial::SerialConfig,
) -> Result<(), String> { }

// === 'a — 显式命名生命周期 ===
// 文件: src-tauri/src/comm/proto.rs
pub struct EncodeFrameParams<'a> {
    pub payload: &'a [u8],   // payload 引用必须在 EncodeFrameParams 有效期间保持有效
}
```

### 5.9 异步并发原语

```rust
// === Arc<Mutex<T>> — 多线程共享可变数据 ===
// Arc = 原子引用计数（多线程安全版 Rc）
// Mutex = 互斥锁
pub struct CommState {
    connections: Arc<Mutex<HashMap<String, ManagedConnectionHandle>>>,
}

// 使用模式：lock().await 获取锁
let mut connections = state.connections.lock().await;
connections.insert(connection_id, handle);

// === Arc<Notify> — 通知机制（类似条件变量） ===
pub struct RecipeRuntimeManager {
    value_changed: Arc<Notify>,
}

// 发送通知
self.value_changed.notify_waiters();

// 等待通知
tokio::select! {
    _ = notifier.notified() => {}    // 收到通知，继续循环检查
    _ = tokio::time::sleep(Duration::from_millis(20)) => {}  // 或超时
}

// === Arc<AtomicBool> — 无锁布尔标记 ===
pub(super) struct RuntimeRunControl {
    stop_requested: Arc<AtomicBool>,
    stopped: Arc<Notify>,
}

// store / load 需要指定内存顺序
self.stop_requested.store(true, Ordering::SeqCst);
self.stop_requested.load(Ordering::SeqCst)

// === AtomicU32 — 无锁计数器 ===
static HMIP_NEXT_SEQ: AtomicU32 = AtomicU32::new(1);

fn next_hmip_seq(seq: Option<u32>) -> u32 {
    seq.unwrap_or_else(|| HMIP_NEXT_SEQ.fetch_add(1, Ordering::Relaxed))
    // fetch_add：原子加并返回旧值
}

// === OnceLock — 一次性初始化 ===
static OVERRIDE: std::sync::OnceLock<std::sync::Mutex<Option<TcpStreamOverride>>> =
    std::sync::OnceLock::new();
OVERRIDE.get_or_init(|| std::sync::Mutex::new(None))
```

### 5.10 Tokio 并发模型

```rust
// === tokio::spawn — 启动异步任务 ===
tauri::async_runtime::spawn(async move {
    engine::run_recipe(manager, app, loaded, run_control).await;
});

// === tokio::select! — 竞态等待多个异步操作 ===
tokio::select! {
    biased;                 // 优先匹配先声明的分支（非公平模式）

    _ = &mut *shutdown_rx => {
        return ConnectionExit::Shutdown;   // 最高优先级：退出信号
    }

    Some(data) = high_rx.recv() => {       // 高优先级队列
        // 处理高优先级数据
    }

    Some(data) = normal_rx.recv() => {     // 普通优先级队列
        // 处理普通数据
    }

    read_res = reader.read(&mut buf) => {  // IO 读取
        // 处理接收数据
    }
}
// 关键：select! 的 biased 模式保证 shutdown_rx 总是最先被检查

// === tokio::time::timeout — 超时控制 ===
match tokio::time::timeout(
    Duration::from_millis(WRITE_TIMEOUT_MS),
    writer.write_all(&data)
).await {
    Ok(Ok(())) => { /* 写入成功 */ }
    Ok(Err(err)) => { /* IO 错误 */ }
    Err(_) => { /* 超时 */ }
}

// === mpsc channel — 多生产者单消费者通道 ===
let (tx_high, mut rx_high) = mpsc::channel::<Vec<u8>>(64);   // 容量 64
let (tx_normal, mut rx_normal) = mpsc::channel::<Vec<u8>>(256);

tx.try_send(data).map_err(|err| match err {
    TrySendError::Full(_) => "queue is full",
    TrySendError::Closed(_) => "connection is closed",
})

// === oneshot channel — 一次性通知 ===
let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
// 发送端
let _ = self.shutdown_tx.send(());
// 接收端
_ = &mut shutdown_rx => { return ConnectionExit::Shutdown; }
```

### 5.11 错误处理

```rust
// === Result<T, E> — 要么成功，要么失败 ===
pub fn read_system_overview() -> Result<SystemOverview, String> {
    // Ok(value) → 成功
    // Err("...".to_string()) → 失败
}

// === ? 运算符 — 传播错误 ===
let raw = fs::read_to_string("/proc/uptime")
    .map_err(|error| format!("Failed to read /proc/uptime: {}", error))?;
// ? 等价于：如果 Err，直接 return Err；如果 Ok，拆出值

// === 链式组合子 ===
// map_err — 转换错误类型
fs::read_to_string("/proc/uptime")
    .map_err(|error| format!("Failed: {}", error))?;

// and_then / or_else
app.path()
    .download_dir()
    .map_err(|e| e.to_string())
    .or_else(|_| get_log_dir(app_clone).map(PathBuf::from))?;

// ok_or_else — Option 转 Result
let first = raw.split_whitespace().next()
    .ok_or_else(|| "Missing uptime field".to_string())?;

// unwrap_or / unwrap_or_else — 提供默认值
let delay_ms = compute_backoff_ms(attempt);
connection_id.as_deref().unwrap_or(crate::comm::DEFAULT_SERIAL_CONNECTION_ID)
seq.unwrap_or_else(|| HMIP_NEXT_SEQ.fetch_add(1, Ordering::Relaxed))

// unwrap_or_default — 用 Default 提供默认值
frame.priority.unwrap_or_default()
```

### 5.12 Serde 序列化/反序列化

```rust
// === 基础序列化 ===
#[derive(Debug, Clone, Serialize)]         // 只序列化
#[derive(Debug, Clone, Deserialize)]       // 只反序列化

// === rename_all：自动转换命名风格 ===
#[serde(rename_all = "camelCase")]   // Rust: cpu_usage → JSON: cpuUsage
pub struct SystemOverview { /* ... */ }

#[serde(rename_all = "snake_case")]  // Rust: CommPriority::High → JSON: "high"
pub enum CommPriority { High, Normal }

// === tag：枚举 JSON 表示形式 ===
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommEvent {
    Connected { transport: String, /* ... */ },
    Error { message: String, /* ... */ },
}
// 序列化结果：
//   { "type": "connected", "transport": "serial", ... }
//   { "type": "error", "message": "...", ... }

// 另一个例子，枚举用 kind 字段区分：
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HmipMessageSummary {
    Hello { role: String, capabilities: u32, name: String },
    Heartbeat { timestamp_ms: u64 },
    Request { request_id: u32, /* ... */ },
}
```

### 5.13 智能指针与资源共享

```rust
// === Box<T> — 堆分配，用于 trait 对象和递归类型 ===
#[cfg(test)]
pub(crate) type BoxedTestIoStream = Box<dyn TestIoStream>;
// dyn TestIoStream → trait 对象，运行时多态

// === Arc<T> — 原子引用计数，多所有者共享 ===
pub struct RecipeRuntimeManager {
    inner: Arc<Mutex<RecipeRuntimeState>>,
    value_changed: Arc<Notify>,
}

impl Clone for RecipeRuntimeManager {
    // Arc 的 clone 只增加引用计数，不复制内部数据
}

// === Bytes / BytesMut — 高效字节缓冲区 ===
use bytes::{Buf, Bytes, BytesMut};

pub struct FrameDecoder {
    buf: BytesMut,        // 可变字节缓冲区（写入端）
}

pub struct Frame {
    pub payload: Bytes,   // 不可变字节切片（零拷贝引用）
}

// BytesMut → Bytes：split_to().freeze()
let payload = frame_bytes.slice(header_len..frame_len);
// slice() 返回的是共享数据视图，不复制

// === Vec<T> / &[T] / &str / String ===
// Vec<u8> — 拥有所有权的动态字节数组
// &[u8]  — 字节切片引用（不拥有数据）
// String — 拥有所有权的 UTF-8 字符串
// &str   — 字符串切片引用
```

### 5.14 闭包 (Closures)

```rust
// === 闭包基本语法 ===
|参数1, 参数2| 表达式
|参数1, 参数2| { 多条语句 }

// === move 闭包 — 获取变量的所有权 ===
tauri::async_runtime::spawn(async move {
    // move 将 manager, app, loaded, run_control 的所有权移入异步块
    engine::run_recipe(manager, app, loaded, run_control).await;
});

// === 闭包作为参数 ===
let predicate: F = move |snapshot| {
    let Some(actual) = snapshot.signal_values.get(signal_id.as_str()) else {
        return Ok(false);
    };
    compare_values(actual, operator, &expected)
};

// === 闭包作为函数参数（F: Fn(...) -> ...） ===
async fn wait_for_condition<F>(
    manager: &RecipeRuntimeManager,
    run_control: &RuntimeRunControl,
    predicate: F,            // F 是泛型闭包类型
) -> Result<(), RecipeRuntimeFailure>
where
    F: Fn(&RecipeRuntimeSnapshot) -> Result<bool, String>,
    // Fn trait：不可变借用捕获的变量
{ /* ... */ }

// === Fn / FnMut / FnOnce 的区别 ===
// Fn     — 不可变借用，可多次调用
// FnMut  — 可变借用，可多次调用
// FnOnce — 消耗所有权，只能调用一次
```

### 5.15 trait 对象 `Box<dyn Trait>`

```rust
// === 类型别名用于测试替换 ===
#[cfg(test)]
type TcpStreamOverride =
    Arc<dyn Fn(&tcp::TcpConfig) -> Result<BoxedTestIoStream, String> + Send + Sync>;
//       ^^^ trait 对象：存储任何实现了这些 trait 的类型

// dyn Fn(...) — 闭包 trait 对象
// dyn TestIoStream — 自定义 trait 对象
// + Send + Sync — 额外 trait 约束

// 用于依赖注入：
// 测试时注入 mock stream，生产时使用真实 TCP stream
#[cfg(test)]
if let Some(override_fn) = tcp_override {
    let stream = override_fn(&config)?;  // 使用 mock
    let actor = CommActorHandle::spawn_test_actor(app, "tcp", id, stream);
    return Ok(());
}

let stream = tcp::open_stream(&config).await?;  // 真实连接
```

### 5.16 项目特有模式

```rust
// === saturating_add / saturating_mul — 防溢出算术 ===
attempt = attempt.saturating_add(1);   // 到达 u32::MAX 后不再增长
state.next_run_id = state.next_run_id.saturating_add(1);
let base = RECONNECT_MIN_DELAY_MS.saturating_mul(1u64 << attempt);

// === 迭代器 + collect ===
let actions = bundle.system.actions.iter()
    .cloned()                                  // 克隆每个元素
    .map(|action| (action.id.clone(), action))  // 转换为 (id, action) 元组
    .collect();                                 // 收集到 HashMap

// === filter_map — 同时过滤和映射 ===
let signal_sources = bundle.signals.iter()
    .filter(|signal| signal.enabled)
    .filter_map(|signal| {
        signal.source.as_ref()
            .map(|source| (source.clone(), signal.id.clone()))
    })
    .collect();

// === as_ref() / as_deref() / cloned() ===
Option<String>.as_deref()      → Option<&str>    // Option<String> → Option<&str>
Option<String>.as_ref()        → Option<&String>
Result<T, E>.as_ref()          → Result<&T, &E>
value.clone()                  → 显式克隆

// === is_some_and() — Rust 1.70+ 组合检查 ===
if mapping.matcher.channel
    .is_some_and(|channel| channel != header.channel)
{ return false; }
// 等价于旧的：if matcher.channel.map_or(false, |c| c != header.channel)

// === const fn / const 泛型 ===
const HEADER_LEN_BASE: usize = 16;     // 编译期常量
const HEX: &[u8; 16] = b"0123456789abcdef";  // 字节数组常量

// === 结构体更新语法 ===
Self {
    cfg,
    buf: BytesMut::with_capacity(8 * 1024),
    // 等价于 ...Default::default() 但更明确
}

// === impl Trait for Type（为外部类型实现 trait） ===
impl Default for CommPriority {
    fn default() -> Self {
        Self::Normal      // Self = CommPriority
    }
}
```

---

## 6. Tauri 后端层

### 6.1 Builder 模式

```rust
// === 文件: src-tauri/src/lib.rs ===

tauri::Builder::default()          // 创建 Builder
    .plugin(                        // 注册插件（链式调用）
        LogBuilder::default()
            .level(log_level)
            .clear_targets()
            .target(Target::new(TargetKind::Stdout))
            .build(),
    )
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![   // 注册命令处理器
        commands::get_system_overview,
        commands::craftsmanship_scan_workspace,
        // ... 所有命令
    ])
    .setup(|app| {                 // 应用初始化回调
        app.manage(comm::CommState::default());
        app.manage(craftsmanship::RecipeRuntimeManager::default());
        app.manage(dilution::DilutionManager::new_mock());
        Ok(())
    })
    .run(tauri::generate_context!())  // 启动应用
    .expect("error while running tauri application");
```

### 6.2 Command 定义与注入

```rust
// === 定义命令（文件: src-tauri/src/commands.rs） ===

// 同步命令
#[tauri::command]
pub fn get_system_overview() -> Result<system::SystemOverview, String> {
    system::read_system_overview()
}

// 异步命令（注入 AppHandle + State）
#[tauri::command]
pub async fn craftsmanship_runtime_load_recipe(
    app: AppHandle,                                    // 应用句柄
    state: State<'_, craftsmanship::RecipeRuntimeManager>, // 托管状态
    workspace_root: String,                            // 前端传入参数
    project_id: String,
    recipe_id: String,
) -> Result<craftsmanship::RecipeRuntimeSnapshot, String> {
    state
        .load_recipe(Some(&app), workspace_root, project_id, recipe_id)
        .await
}

// 带 JSON body 的命令（前端传入结构体，自动反序列化）
#[derive(Debug, Clone, Deserialize)]
pub struct HmipSendFrame {
    pub msg_type: u8,
    pub flags: Option<u8>,
    pub payload: Vec<u8>,
}

#[tauri::command]
pub async fn send_tcp_hmip_frame(
    state: State<'_, CommState>,
    frame: HmipSendFrame,     // 自动从 JSON 反序列化
    connection_id: Option<String>,
) -> Result<u32, String> { /* ... */ }

// === 注入命令（文件: src-tauri/src/lib.rs） ===
.invoke_handler(tauri::generate_handler![
    commands::get_system_overview,
    commands::craftsmanship_runtime_load_recipe,
    // 每个命令函数都必须在这里列出
])
```

### 6.3 状态管理 `app.manage()` / `State<>`

```rust
// === 注册状态（在 setup 阶段） ===
.setup(|app| {
    app.manage(comm::CommState::default());              // 通信状态
    app.manage(craftsmanship::RecipeRuntimeManager::default()); // 工艺运行时
    app.manage(dilution::DilutionManager::new_mock());    // 光阻稀释
    Ok(())
})

// === 注入状态到命令 ===
pub async fn dilution_create_batch(
    state: State<'_, dilution::DilutionManager>,  // Tauri 自动注入
    request: dilution::CreateBatchRequest,
) -> Result<dilution::Batch, String> {
    state.create_batch(request)
}

// === 在任意位置获取状态（需要 AppHandle） ===
let manager = app.state::<crate::craftsmanship::RecipeRuntimeManager>();
// 类型参数指定获取哪个状态，Tauri 按类型查找

// 注意：每个类型只能 manage 一个实例
// 多次 manage 同类型会覆盖之前的
```

### 6.4 事件发射 `app.emit()`

```rust
// === 发射事件 ===
app.emit("comm-event", &CommEvent::Connected {
    transport: "tcp".to_string(),
    connection_id: "main".to_string(),
    timestamp_ms: now_ms(),
})
// 第一个参数：事件名（与前端 listen 的事件名一致）
// 第二个参数：实现了 Serialize 的数据

// 错误处理
if let Err(error) = app.emit(RECIPE_RUNTIME_EVENT_NAME, &event) {
    log::warn!("Failed to emit event: {}", error);
}

// === 前端接收（见 4.3 节） ===
listen<CommEvent>("comm-event", (event) => {
    // event.payload 是 CommEvent 类型
})
```

### 6.5 异步运行时 `tauri::async_runtime::spawn`

```rust
// 在 Tauri 的 tokio 运行时中启动后台任务
tauri::async_runtime::spawn(async move {
    engine::run_recipe(manager, app, loaded, run_control).await;
});

// 与 tokio::spawn 的关系：
// tauri::async_runtime::spawn 实际上就是 tokio::spawn
// 但明确表达"使用 Tauri 管理的运行时"
// CommActorHandle 中保存 JoinHandle 用于 shutdown 等待
pub struct CommActorHandle {
    pub tx_high: mpsc::Sender<Vec<u8>>,
    pub tx_normal: mpsc::Sender<Vec<u8>>,
    shutdown_tx: oneshot::Sender<()>,
    join: tauri::async_runtime::JoinHandle<()>,  // 任务句柄
}

// shutdown 时等待任务结束
pub async fn shutdown(self) {
    let _ = self.shutdown_tx.send(());
    if let Err(err) = self.join.await {
        log::warn!("Comm actor task ended with error: {}", err);
    }
}
```

---

## 附录：快速语法速查表

### TypeScript 速查

| 语法 | 含义 | 示例 |
|------|------|------|
| `T` | 泛型参数 | `useAsync<T>(fn)` |
| `\|` | 联合类型 | `"zh" \| "en"` |
| `&` | 交叉类型 | `A & B` |
| `?:` | 可选属性 | `title?: string` |
| `?.` | 可选链 | `obj?.prop` |
| `??` | 空值合并 | `a ?? b` |
| `!` | 非空断言 | `value!` |
| `as const` | 字面量断言 | `{ a: 1 } as const` |
| `typeof x` | 值→类型 | `typeof obj` |
| `keyof T` | 键名联合 | `keyof State` |
| `T[K]` | 索引访问 | `State["key"]` |
| `extends` | 泛型约束 | `<T extends ViewId>` |
| `is` | 类型谓词 | `error is TimeoutError` |

### React 速查

| Hook / API | 用途 |
|------------|------|
| `useState` | 组件状态 |
| `useEffect` | 副作用 |
| `useCallback` | 缓存函数 |
| `useMemo` | 缓存值 |
| `useRef` | 可变引用 |
| `useContext` | 读取 Context |
| `useSyncExternalStore` | 订阅外部 store |
| `React.memo` | 跳过重渲染 |
| `React.lazy` | 代码分割 |
| `createContext` | 创建 Context |

### Rust 速查

| 语法 | 含义 |
|------|------|
| `let` | 变量绑定（默认不可变） |
| `let mut` | 可变变量 |
| `&` | 引用（借用） |
| `&mut` | 可变引用 |
| `*` | 解引用 |
| `::` | 路径分隔 / 关联函数 |
| `=>` | match 分支 |
| `\|...\|` | 闭包 |
| `?` | 错误传播 |
| `!` | 宏调用 |
| `_` | 通配符 / 忽略值 |
| `..` | 范围 / 结构体更新 |
| `#[...]` | 属性 |
| `#![...]` | crate 级属性 |
