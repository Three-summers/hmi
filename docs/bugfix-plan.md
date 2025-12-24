# HMI 缩放和布局问题修复计划

## 问题总结

根据用户反馈，当前实现存在三个主要问题：

### 问题 1：Info 面板内容缩放不足 ⚠️
**现象**：
- 当前只有按钮、面板高度等核心 UI 元素等比例放大
- Info 面板内的内容（文本、表格、图表等）仍使用固定 px 字体大小
- 操作人员离远了看不清楚内容区域的文字

**根本原因**：
- 视图组件（Jobs、Alarms、Recipes等）的 CSS 中有大量硬编码的 font-size（如 28px, 15px, 11px）
- 这些组件没有迁移到 rem 单位，不会随根字体缩放

**影响范围**：
- `src/components/views/Jobs/Jobs.module.css`（4 处硬编码）
- `src/components/views/shared.module.css`（1 处：48px）
- `src/components/views/Alarms/Alarms.module.css`
- `src/components/views/Recipes/Recipes.module.css`
- `src/components/views/Monitor/SpectrumAnalyzer.module.css`（多处 12px、11px）
- 其他视图组件...

**解决方案**：
将所有硬编码的 font-size 迁移到 rem 或使用 CSS 变量的 rem 版本。

---

### 问题 2：瀑布图全屏布局问题 🚨
**现象**：
- 打开瀑布图并"全屏"后，会挤压导航栏
- 导航栏被挤出屏幕，超出可操作范围

**可能原因**：
1. **布局高度计算问题**：SpectrumAnalyzer 的 `.root` 使用 `height: 100%`，但可能在某些状态下高度计算错误
2. **Flex 布局冲突**：MainLayout 的 grid 布局与 SpectrumAnalyzer 的 flex 布局冲突
3. **z-index 层级问题**：虽然有 backdrop (z-index: 10) 和 drawer (z-index: 11)，但可能没有正确覆盖导航栏

**需要调查**：
- 用户所说的"全屏"是指什么操作？（浏览器全屏？组件展开？）
- 哪个组件被挤压了？（NavPanel？CommandPanel？）
- 是否有特定的交互触发这个问题？

**临时解决方案**：
1. 为 SpectrumAnalyzer 添加 `max-height: 100%` 和 `overflow: hidden`
2. 确保 MainLayout 的 grid 布局正确分配空间
3. 检查 NavPanel 的 z-index 和 position

---

### 问题 3：缺少手动缩放控制 🎛️
**现象**：
- 当前缩放完全基于屏幕宽度自动计算
- 用户无法根据实际需求调整缩放比例（如操作人员视力、观看距离、个人偏好）

**需求**：
- 在 TitlePanel 或 Settings 中添加缩放比例调节器
- 支持预设缩放比例（如 80%、100%、120%、150%、200%）
- 或提供滑块连续调节（范围：75% - 200%）
- 缩放比例持久化到 localStorage

**实现方案**：
1. 在 `appStore` 中添加 `scaleOverride` 状态（范围：0.75 - 2.0）
2. 修改 `useHMIScale` Hook，支持缩放系数：
   ```typescript
   const finalFontSize = Math.max(12, baseFontSize * scaleOverride * (currentWidth / baseWidth));
   ```
3. 在 TitlePanel 或 Settings 中添加缩放控件（快捷按钮 + 滑块）
4. 提供重置按钮，恢复自动缩放（scaleOverride = 1.0）

---

## 修复任务分解

### Task 5: Info 面板内容字体迁移到 rem
**目标**：将所有视图组件的硬编码 font-size 迁移到 rem

**文件范围**：
- `src/components/views/Jobs/Jobs.module.css`
- `src/components/views/Alarms/Alarms.module.css`
- `src/components/views/Recipes/Recipes.module.css`
- `src/components/views/Monitor/SpectrumAnalyzer.module.css`
- `src/components/views/Monitor/Monitor.module.css`
- `src/components/views/shared.module.css`
- 其他视图组件...

**迁移策略**：
```css
/* 修改前 */
.statValue {
    font-size: 28px;  /* 大号数字 */
}

.statLabel {
    font-size: 11px;  /* 小号标签 */
}

/* 修改后 */
.statValue {
    font-size: 1.75rem;  /* 28px / 16 = 1.75rem */
}

.statLabel {
    font-size: 0.6875rem;  /* 11px / 16 = 0.6875rem */
}
```

**验收标准**：
- 所有硬编码 font-size 替换为 rem
- 1280x800 下字体大小与原来一致
- 1920x1080 下字体等比例放大（约 1.5 倍）
- 无视觉回归或布局错位

---

### Task 6: 修复瀑布图全屏布局
**目标**：修复瀑布图展开时挤压导航栏的问题

**调查步骤**：
1. 重现问题：打开 Monitor 视图 → 切换到频谱分析 Tab → 触发"全屏"操作
2. 使用开发者工具检查：
   - MainLayout 的 grid 布局计算值
   - SpectrumAnalyzer 的高度计算值
   - NavPanel 的位置和 z-index

**可能的修复方案**：

**方案 A：限制 SpectrumAnalyzer 最大高度**
```css
/* SpectrumAnalyzer.module.css */
.root {
    position: relative;
    height: 100%;
    max-height: 100%;  /* 添加最大高度限制 */
    min-height: 0;
    overflow: hidden;  /* 防止溢出 */
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
}
```

**方案 B：调整 MainLayout 布局计算**
```css
/* MainLayout.module.css */
.mainLayout {
    display: grid;
    grid-template-rows:
        var(--title-panel-height-rem, var(--title-panel-height))  /* 顶部栏固定 */
        minmax(0, 1fr)  /* InfoPanel 自适应，使用 minmax */
        var(--nav-panel-height-rem, var(--nav-panel-height));  /* 底部栏固定 */
    /* ... */
    height: 100vh;  /* 确保总高度为视口高度 */
    overflow: hidden;  /* 防止整体溢出 */
}
```

**方案 C：为 NavPanel 添加固定定位保护**
```css
/* NavPanel.module.css */
.navPanel {
    position: sticky;  /* 或 fixed */
    bottom: 0;
    z-index: 100;  /* 确保在最上层 */
}
```

**验收标准**：
- 瀑布图展开后，NavPanel 始终可见且可操作
- 所有视图在各种状态下布局正常
- 无滚动条或内容溢出

---

### Task 7: 添加手动缩放比例调节功能
**目标**：实现用户可调节的缩放比例控件

**实现步骤**：

**1. 扩展 appStore**
```typescript
// src/stores/appStore.ts
interface AppState {
    // ... 现有字段

    /** 手动缩放系数（范围：0.75 - 2.0，默认 1.0 表示自动） */
    scaleOverride: number;

    /**
     * 设置缩放系数
     * @param scale - 缩放系数（0.75 - 2.0）
     */
    setScaleOverride: (scale: number) => void;

    /**
     * 重置为自动缩放
     */
    resetScale: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            // ... 现有实现
            scaleOverride: 1.0,
            setScaleOverride: (scale) => set({ scaleOverride: Math.max(0.75, Math.min(2.0, scale)) }),
            resetScale: () => set({ scaleOverride: 1.0 }),
        }),
        {
            name: "hmi-app-storage",
            partialize: (state) => ({
                language: state.language,
                theme: state.theme,
                commandPanelPosition: state.commandPanelPosition,
                scaleOverride: state.scaleOverride,  // 持久化缩放系数
            }),
        },
    ),
);
```

**2. 修改 useHMIScale Hook**
```typescript
// src/hooks/useHMIScale.ts
import { useAppStore } from "@/stores";

export function useHMIScale(baseWidth = 1280, baseFontSize = 16): void {
    const scaleOverride = useAppStore((state) => state.scaleOverride);

    useEffect(() => {
        const updateScale = () => {
            const currentWidth = window.innerWidth;
            const autoScale = currentWidth / baseWidth;
            const finalScale = autoScale * scaleOverride;  // 应用用户自定义系数
            const fontSize = Math.max(12, baseFontSize * finalScale);
            document.documentElement.style.fontSize = `${fontSize}px`;
        };

        updateScale();
        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, [baseWidth, baseFontSize, scaleOverride]);  // 监听 scaleOverride 变化
}
```

**3. 添加缩放控件（TitlePanel）**
```tsx
// src/components/layout/TitlePanel.tsx
import { useAppStore } from "@/stores";

// 在 TitlePanel 组件中添加缩放控件
const { scaleOverride, setScaleOverride, resetScale } = useAppStore(
    useShallow((state) => ({
        scaleOverride: state.scaleOverride,
        setScaleOverride: state.setScaleOverride,
        resetScale: state.resetScale,
    })),
);

// 预设缩放比例
const scalePresets = [
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1.0 },
    { label: "125%", value: 1.25 },
    { label: "150%", value: 1.5 },
    { label: "200%", value: 2.0 },
];

// 添加缩放按钮到 actionButtons（或创建单独的缩放模态框）
```

**4. CSS 样式（TitlePanel.module.css）**
```css
/* 缩放控件容器 */
.scaleControl {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-md);
}

/* 缩放预设按钮组 */
.scalePresets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: var(--sp-sm);
}

/* 缩放按钮 */
.scaleButton {
    min-height: 48px;
    padding: var(--sp-sm);
    border: 2px solid var(--border-color);
    border-radius: var(--button-radius);
    background: var(--button-bg);
    color: var(--text-primary);
    font-size: var(--font-size-large);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: all var(--transition-fast);
}

.scaleButton:hover {
    border-color: var(--accent-primary);
    background: var(--button-bg-hover);
}

.scaleButton[data-active="true"] {
    border-color: var(--accent-primary);
    background: var(--button-primary-bg);
    color: var(--text-on-accent);
}

/* 缩放滑块 */
.scaleSlider {
    width: 100%;
    accent-color: var(--accent-primary);
}

/* 缩放显示值 */
.scaleValue {
    font-family: var(--font-mono);
    font-size: var(--font-size-large);
    font-weight: var(--font-weight-bold);
    color: var(--accent-primary);
    text-align: center;
}
```

**验收标准**：
- 点击缩放按钮后，界面立即等比例缩放
- 滑块拖动时实时更新缩放比例
- 缩放比例持久化到 localStorage
- 重置按钮恢复为自动缩放（100%）
- 所有预设比例下界面无布局错位
- 最小字体保护仍然生效（≥12px）

---

## 实现优先级

### 高优先级（P0）
1. **Task 5：Info 面板内容字体迁移到 rem** - 解决内容看不清的核心问题
2. **Task 7：添加手动缩放比例调节功能** - 满足用户自定义需求

### 中优先级（P1）
3. **Task 6：修复瀑布图全屏布局** - 需要先重现问题并确认根本原因

---

## 测试计划

### 测试用例 1：内容区域缩放验证
1. 启动 `npm run dev`
2. 调整窗口宽度为 1280px
3. 打开 Jobs 视图，测量统计数字字体大小（应为 28px）
4. 调整窗口宽度为 1920px
5. 再次测量统计数字字体大小（应约为 42px = 28 * 1.5）

### 测试用例 2：手动缩放功能
1. 点击 TitlePanel 的缩放按钮
2. 选择 150% 缩放比例
3. 验证所有 UI 元素（按钮、文字、面板）都放大了 1.5 倍
4. 刷新页面，验证缩放比例保持（持久化）
5. 点击重置按钮，验证恢复为自动缩放

### 测试用例 3：瀑布图布局
1. 打开 Monitor 视图 → 频谱分析 Tab
2. 触发瀑布图展开操作（如果有）
3. 验证 NavPanel 仍然可见且可点击
4. 调整窗口大小，验证布局稳定

---

## 风险和缓解

### 风险 1：字体迁移后视觉回归
- **风险**：某些组件的硬编码字体大小可能有特殊用途（如图标、图表标签）
- **缓解**：
  1. 逐个组件迁移并测试
  2. 保留特殊情况的 px 值（如 Canvas 图表）
  3. 使用截图对比工具验证视觉一致性

### 风险 2：缩放比例过大或过小导致布局错位
- **风险**：200% 缩放下可能导致内容溢出或重叠
- **缓解**：
  1. 添加缩放范围限制（75% - 200%）
  2. 测试极端缩放比例下的布局
  3. 为关键容器添加 `min-width` 和 `max-width`

### 风险 3：瀑布图布局问题根本原因不明
- **风险**：在未重现问题的情况下，修复可能无效
- **缓解**：
  1. 与用户沟通，确认具体操作步骤
  2. 录制问题视频或截图
  3. 先实施防御性修复（如最大高度限制）

---

## 下一步

1. **用户确认**：请用户确认以上问题分析和修复方案
2. **优先级排序**：根据用户反馈调整任务优先级
3. **并行执行**：Task 5 和 Task 7 可并行开发
4. **迭代验证**：每完成一个任务，立即请用户验证效果
