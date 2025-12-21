# HMI 系统扩展指南

> 如何为 HMI 系统添加新视图、命令和功能

---

## 目录

1. [快速开始](#1-快速开始)
2. [添加新视图](#2-添加新视图)
3. [添加视图命令](#3-添加视图命令)
4. [添加图标](#4-添加图标)
5. [使用确认对话框](#5-使用确认对话框)
6. [完整示例](#6-完整示例)
7. [常见问题](#7-常见问题)

---

## 1. 快速开始

### 1.1 系统架构概览

HMI 使用以下核心机制：

- **视图注册表** (`src/hmi/viewRegistry.tsx`)：统一管理所有视图的导航项和组件映射
- **命令系统** (`ViewCommandContext` + `SubViewCommandContext`)：视图/子视图级命令注册
- **图标库** (`src/components/common/Icons.tsx`)：从 `react-icons/md` 统一导入图标
- **Keep-Alive 机制** (`InfoPanel`)：已访问视图保持挂载，切换时隐藏而非卸载

### 1.2 开发流程

1. 在 `src/components/views/` 创建视图组件
2. 在 `src/types/semi-e95.ts` 添加 `ViewId` 类型
3. 在 `src/hmi/viewRegistry.tsx` 注册视图
4. 在 `src/i18n/locales/` 添加国际化文案
5. （可选）注册视图命令到 `CommandPanel`

---

## 2. 添加新视图

### 2.1 创建视图目录和文件

```bash
mkdir -p src/components/views/NewView
touch src/components/views/NewView/index.tsx
touch src/components/views/NewView/NewView.module.css
```

### 2.2 编写视图组件

**基础模板** (`src/components/views/NewView/index.tsx`):

```typescript
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandButtonConfig } from '@/types';
import { useIsViewActive } from '@/components/layout/ViewContext';
import { useRegisterViewCommands } from '@/components/layout/ViewCommandContext';
import styles from './NewView.module.css';

export default function NewView() {
  const { t } = useTranslation();
  const isViewActive = useIsViewActive();

  // 定义视图命令（可选）
  const commands = useMemo<CommandButtonConfig[]>(() => [
    {
      id: 'refresh',
      labelKey: 'newview.refresh',
      onClick: () => console.log('刷新')
    }
  ], []);

  // 注册命令到 CommandPanel（仅在视图激活时生效）
  useRegisterViewCommands('newview', commands, isViewActive);

  return (
    <div className={styles.view}>
      <h2>{t('nav.newview')}</h2>
      <p>{t('newview.description')}</p>
      {/* 视图内容 */}
    </div>
  );
}
```

### 2.3 更新类型定义

在 `src/types/semi-e95.ts` 中添加新视图 ID：

```typescript
export type ViewId =
  | "jobs"
  | "system"
  | "monitor"
  | "recipes"
  | "files"
  | "setup"
  | "alarms"
  | "help"
  | "newview";  // 新增
```

### 2.4 注册到视图注册表

在 `src/hmi/viewRegistry.tsx` 中：

#### ① 添加懒加载导入

```typescript
const NewView = lazy(() => import("@/components/views/NewView"));
```

#### ② 添加导航项到 `HMI_NAV_ITEMS`

```typescript
export const HMI_NAV_ITEMS: HmiNavItem[] = [
  // ... 现有项
  {
    id: "newview",
    labelKey: "nav.newview",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        {/* Material Design 图标路径 */}
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ),
  },
];
```

**提示**：可以从 [Material Design Icons](https://fonts.google.com/icons) 获取 SVG 路径。

#### ③ 注册视图组件到 `HMI_VIEW_COMPONENTS`

```typescript
export const HMI_VIEW_COMPONENTS = {
  // ... 现有项
  newview: NewView,
} satisfies Record<ViewId, LazyExoticComponent<() => JSX.Element>>;
```

### 2.5 添加国际化文案

在 `src/i18n/locales/zh.json` 中：

```json
{
  "nav": {
    "newview": "新视图"
  },
  "newview": {
    "description": "这是一个新视图",
    "refresh": "刷新数据"
  }
}
```

在 `src/i18n/locales/en.json` 中：

```json
{
  "nav": {
    "newview": "New View"
  },
  "newview": {
    "description": "This is a new view",
    "refresh": "Refresh Data"
  }
}
```

---

## 3. 添加视图命令

### 3.1 主视图命令

主视图命令会显示在 `CommandPanel`，适用于视图级操作（刷新、导出等）。

```typescript
import { useMemo } from 'react';
import type { CommandButtonConfig } from '@/types';
import { useIsViewActive } from '@/components/layout/ViewContext';
import { useRegisterViewCommands } from '@/components/layout/ViewCommandContext';

function MyView() {
  const isViewActive = useIsViewActive();

  const commands = useMemo<CommandButtonConfig[]>(() => [
    {
      id: 'refresh',              // 命令ID（需在 CommandIcons 中有对应图标）
      labelKey: 'common.refresh', // i18n key
      onClick: handleRefresh,     // 点击回调
      disabled: false,            // 可选：禁用状态
      highlight: 'none',          // 可选：高亮状态 ('none' | 'alarm' | 'warning' | 'processing' | 'attention')
      behavior: 'momentary'       // 可选：按钮行为 ('momentary' | 'toggle')
    },
    {
      id: 'pause',
      labelKey: 'common.pause',
      onClick: handlePause,
      highlight: 'attention'      // 显示警告色
    }
  ], [handleRefresh, handlePause]);

  // 注册命令，仅在视图激活时生效
  useRegisterViewCommands('myview', commands, isViewActive);

  return <div>...</div>;
}
```

### 3.2 子视图命令（Tab 内命令）

当视图包含 `Tabs` 时，不同 Tab 可以注册自己的命令集合。

```typescript
import { useState, useMemo } from 'react';
import { Tabs } from '@/components/common';
import { useIsViewActive } from '@/components/layout/ViewContext';
import { useRegisterViewCommands, useRegisterSubViewCommands } from '@/components/layout';

function ViewWithTabs() {
  const isViewActive = useIsViewActive();
  const [activeTab, setActiveTab] = useState<'overview' | 'details'>('overview');

  // 主视图命令（所有 Tab 共享）
  const viewCommands = useMemo<CommandButtonConfig[]>(() => [
    { id: 'refresh', labelKey: 'common.refresh', onClick: handleRefresh }
  ], [handleRefresh]);

  useRegisterViewCommands('myview', viewCommands, isViewActive);

  // 子视图命令（仅 details Tab 激活时显示）
  const isDetailsActive = isViewActive && activeTab === 'details';
  const detailsCommands = useMemo<CommandButtonConfig[]>(() => {
    if (!isDetailsActive) return [];  // 未激活时必须返回空数组
    return [
      { id: 'export', labelKey: 'common.export', onClick: handleExport }
    ];
  }, [isDetailsActive, handleExport]);

  useRegisterSubViewCommands('myview', detailsCommands, isDetailsActive);

  return (
    <Tabs
      activeId={activeTab}
      onChange={setActiveTab}
      tabs={[
        { id: 'overview', label: '概览', content: <Overview /> },
        { id: 'details', label: '详情', content: <Details /> }
      ]}
    />
  );
}
```

**关键点**：
- `enabled` 参数必须准确反映激活状态：`isViewActive && activeTab === '...'`
- SubViewCommands 在未激活时必须返回空数组 `[]`，否则会残留在 CommandPanel

### 3.3 命令配置选项

```typescript
interface CommandButtonConfig {
  id: string;              // 命令ID，用于图标映射
  labelKey: string;        // i18n key
  icon?: string;           // 可选：自定义图标（通常由 CommandIcons[id] 自动提供）
  disabled?: boolean;      // 可选：禁用状态
  highlight?: HighlightStatus;  // 可选：'none' | 'alarm' | 'warning' | 'processing' | 'attention'
  behavior?: ButtonBehavior;    // 可选：'momentary' | 'toggle'
  onClick?: () => void;    // 点击回调
}
```

---

## 4. 添加图标

### 4.1 使用现有图标

在 `src/components/common/Icons.tsx` 的 `CommandIcons` Record 中查找已有图标：

```typescript
export const CommandIcons: Record<string, JSX.Element> = {
  newJob: <AddIcon />,
  refresh: <RefreshIcon />,
  pause: <PauseIcon />,
  export: <ExportIcon />,
  // ...
};
```

命令的 `id` 会自动映射到 `CommandIcons[id]`。

### 4.2 添加新图标

#### ① 从 react-icons 导入

在 `src/components/common/Icons.tsx` 中：

```typescript
import {
  // ... 现有导入
  MdYourNewIcon
} from "react-icons/md";

export const YourNewIcon = MdYourNewIcon;
```

#### ② 添加到 CommandIcons 映射

```typescript
export const CommandIcons: Record<string, JSX.Element> = {
  // ... 现有项
  yourAction: <YourNewIcon />,
};
```

#### ③ 在命令中使用

```typescript
const commands = [
  { id: 'yourAction', labelKey: '...', onClick: ... }
];
```

### 4.3 图标资源

- [Material Design Icons](https://react-icons.github.io/react-icons/icons/md/)：查找并复制图标名称
- 图标命名规则：`Md` 前缀 + PascalCase（如 `MdSettings`, `MdRefresh`）

---

## 5. 使用确认对话框

### 5.1 基本用法

从 `ViewCommandContext` 获取 `showConfirm`：

```typescript
import { useViewCommandActions } from '@/components/layout/ViewCommandContext';

function MyView() {
  const { showConfirm } = useViewCommandActions();

  const handleDelete = () => {
    showConfirm({
      title: t('dialog.confirmDelete'),
      message: t('dialog.deleteWarning'),
      onConfirm: () => {
        // 用户点击确认后执行
        performDelete();
      }
    });
  };

  return <button onClick={handleDelete}>删除</button>;
}
```

### 5.2 在命令中使用确认

```typescript
const commands = useMemo<CommandButtonConfig[]>(() => [
  {
    id: 'clearAll',
    labelKey: 'common.clearAll',
    highlight: 'warning',
    onClick: () => {
      showConfirm({
        title: t('dialog.confirmClear'),
        message: t('dialog.clearWarning'),
        onConfirm: handleClearAll
      });
    }
  }
], [showConfirm, t]);
```

**特性**：
- 对话框由 `CommandPanel` 统一渲染，无需在视图中引入额外组件
- 支持标题、消息、确认/取消回调
- 自动处理关闭逻辑

---

## 6. 完整示例

### 6.1 简单视图示例

```typescript
// src/components/views/Tasks/index.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandButtonConfig } from '@/types';
import { useIsViewActive } from '@/components/layout/ViewContext';
import { useRegisterViewCommands } from '@/components/layout/ViewCommandContext';
import styles from './Tasks.module.css';

export default function TasksView() {
  const { t } = useTranslation();
  const isViewActive = useIsViewActive();

  const commands = useMemo<CommandButtonConfig[]>(() => [
    { id: 'refresh', labelKey: 'common.refresh', onClick: () => console.log('刷新') }
  ], []);

  useRegisterViewCommands('tasks', commands, isViewActive);

  return (
    <div className={styles.view}>
      <h2>{t('nav.tasks')}</h2>
      <p>{t('tasks.description')}</p>
    </div>
  );
}
```

### 6.2 带 Tabs 和子命令的复杂视图

```typescript
// src/components/views/Analysis/index.tsx
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@/components/common';
import { useIsViewActive } from '@/components/layout/ViewContext';
import {
  useRegisterViewCommands,
  useRegisterSubViewCommands,
  useViewCommandActions
} from '@/components/layout';
import type { CommandButtonConfig } from '@/types';

export default function AnalysisView() {
  const { t } = useTranslation();
  const isViewActive = useIsViewActive();
  const { showConfirm } = useViewCommandActions();
  const [activeTab, setActiveTab] = useState<'chart' | 'data'>('chart');
  const [isPaused, setIsPaused] = useState(false);

  // 主视图命令（所有 Tab 共享）
  const viewCommands = useMemo<CommandButtonConfig[]>(() => [
    { id: 'refresh', labelKey: 'common.refresh', onClick: () => console.log('刷新') }
  ], []);

  useRegisterViewCommands('analysis', viewCommands, isViewActive);

  // 图表 Tab 的子命令
  const isChartActive = isViewActive && activeTab === 'chart';
  const chartCommands = useMemo<CommandButtonConfig[]>(() => {
    if (!isChartActive) return [];
    return [
      {
        id: isPaused ? 'start' : 'pause',
        labelKey: isPaused ? 'common.resume' : 'common.pause',
        highlight: isPaused ? 'warning' : 'none',
        onClick: () => setIsPaused(!isPaused)
      },
      {
        id: 'reset',
        labelKey: 'common.reset',
        highlight: 'warning',
        onClick: () => {
          showConfirm({
            title: t('dialog.confirmReset'),
            message: t('dialog.resetWarning'),
            onConfirm: () => console.log('重置')
          });
        }
      }
    ];
  }, [isChartActive, isPaused, showConfirm, t]);

  useRegisterSubViewCommands('analysis', chartCommands, isChartActive);

  // 数据 Tab 的子命令
  const isDataActive = isViewActive && activeTab === 'data';
  const dataCommands = useMemo<CommandButtonConfig[]>(() => {
    if (!isDataActive) return [];
    return [
      { id: 'export', labelKey: 'common.export', onClick: () => console.log('导出') }
    ];
  }, [isDataActive]);

  useRegisterSubViewCommands('analysis', dataCommands, isDataActive);

  return (
    <div>
      <Tabs
        activeId={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'chart', label: t('analysis.chart'), content: <ChartTab isPaused={isPaused} /> },
          { id: 'data', label: t('analysis.data'), content: <DataTab /> }
        ]}
      />
    </div>
  );
}

function ChartTab({ isPaused }: { isPaused: boolean }) {
  return <div>{isPaused ? '已暂停' : '实时图表'}</div>;
}

function DataTab() {
  return <div>数据表格</div>;
}
```

---

## 7. 常见问题

### 7.1 命令按钮没有图标？

**原因**：命令的 `id` 在 `CommandIcons` Record 中没有对应条目。

**解决**：
1. 检查 `src/components/common/Icons.tsx` 中 `CommandIcons` 是否包含该 `id`
2. 如果是新命令，需要先添加图标映射：

```typescript
export const CommandIcons: Record<string, JSX.Element> = {
  // ...
  yourNewAction: <YourNewIcon />,
};
```

### 7.2 切换视图后命令没有更新？

**原因**：`useRegisterViewCommands` 的 `enabled` 参数未传入 `useIsViewActive()`。

**解决**：

```typescript
const isViewActive = useIsViewActive();
useRegisterViewCommands('myview', commands, isViewActive);  // 传入 isViewActive
```

### 7.3 切换 Tab 后命令残留？

**原因**：SubViewCommands 未在 `enabled=false` 时返回空数组。

**解决**：

```typescript
const isTabActive = isViewActive && activeTab === 'tab1';

const tabCommands = useMemo<CommandButtonConfig[]>(() => {
  if (!isTabActive) return [];  // 必须返回空数组
  return [{ id: '...', ... }];
}, [isTabActive]);

useRegisterSubViewCommands('view', tabCommands, isTabActive);
```

### 7.4 如何添加快捷键？

在 `src/hooks/useKeyboardShortcuts.ts` 中添加快捷键映射：

```typescript
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    // ... 现有快捷键
    if (event.key === 'F9') {
      event.preventDefault();
      setCurrentView('newview');
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [setCurrentView]);
```

### 7.5 如何持久化视图状态？

创建 Zustand store 并配置 `persist` middleware，参考 `alarmStore` 实现：

```typescript
// src/stores/myViewStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface MyViewState {
  data: string[];
  addData: (item: string) => void;
}

export const useMyViewStore = create<MyViewState>()(
  persist(
    (set) => ({
      data: [],
      addData: (item) => set((state) => ({ data: [...state.data, item] })),
    }),
    {
      name: 'my-view-storage', // localStorage key
    }
  )
);
```

### 7.6 如何访问视图激活状态？

使用 `useIsViewActive` Hook：

```typescript
import { useIsViewActive } from '@/components/layout/ViewContext';

function MyView() {
  const isActive = useIsViewActive();

  useEffect(() => {
    if (!isActive) {
      // 视图切换到后台，暂停动画/订阅
      return;
    }
    // 视图激活，启动动画/订阅
    const unsubscribe = startSubscription();
    return () => unsubscribe();
  }, [isActive]);
}
```

**典型场景**：
- 暂停/恢复 Canvas 动画
- 启动/停止 Tauri 事件监听
- 控制命令注册的 `enabled` 参数

### 7.7 `commands` 依赖项警告？

**问题**：`useMemo` 的依赖项包含回调函数，导致每次渲染都重新创建 commands 数组。

**解决**：使用 `useCallback` 包装回调函数：

```typescript
const handleRefresh = useCallback(() => {
  // ...
}, []);

const handlePause = useCallback(() => {
  // ...
}, []);

const commands = useMemo<CommandButtonConfig[]>(() => [
  { id: 'refresh', labelKey: '...', onClick: handleRefresh },
  { id: 'pause', labelKey: '...', onClick: handlePause }
], [handleRefresh, handlePause]);  // 稳定的依赖项
```

---

## 附录

### A. 相关文件清单

| 文件路径 | 作用 |
|---------|------|
| `src/hmi/viewRegistry.tsx` | 视图注册表（导航项 + 组件映射） |
| `src/components/layout/ViewCommandContext.tsx` | 主视图命令上下文 |
| `src/components/layout/SubViewCommandContext.tsx` | 子视图命令上下文 |
| `src/components/layout/CommandPanel.tsx` | 命令面板（消费命令并渲染） |
| `src/components/layout/ViewContext.tsx` | 视图激活状态上下文 |
| `src/components/common/Icons.tsx` | 图标库 + CommandIcons 映射 |
| `src/types/semi-e95.ts` | 类型定义（ViewId, CommandButtonConfig 等） |
| `src/i18n/locales/zh.json` | 中文语言包 |
| `src/i18n/locales/en.json` | 英文语言包 |

### B. 推荐阅读

- [SEMI E95 规范](./SEMI_E95_UI_Guide.md)
- [HMI 架构文档](./architecture.md)
- [React Icons 文档](https://react-icons.github.io/react-icons/)
- [Zustand 文档](https://zustand-demo.pmnd.rs/)

---

*文档版本: 1.0.0*
*最后更新: 2025-12*
