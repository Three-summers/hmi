import styles from "./Tabs.module.css";

export interface TabItem<TId extends string> {
    id: TId;
    label: React.ReactNode;
    disabled?: boolean;
    content: React.ReactNode;
}

export interface TabsProps<TId extends string> {
    tabs: TabItem<TId>[];
    activeId: TId;
    onChange: (id: TId) => void;
    keepMounted?: boolean;
}

/**
 * HMI 标签页组件
 *
 * 设计目标：
 * - “标签页=子页面”的统一交互：所有主页面都可以基于同一套 Tabs 结构扩展子页面
 * - 可保持子页面状态：默认 `keepMounted=true`，切换时仅隐藏不卸载，满足“返回后保持操作”的诉求
 * - 低侵入：Tabs 只负责 UI 与可见性，不强行接管数据与业务逻辑
 */
export function Tabs<TId extends string>({
    tabs,
    activeId,
    onChange,
    keepMounted = true,
}: TabsProps<TId>) {
    return (
        <div className={styles.tabs}>
            <div className={styles.tabList} role="tablist">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        className={styles.tab}
                        role="tab"
                        data-active={tab.id === activeId}
                        aria-selected={tab.id === activeId}
                        aria-controls={`panel-${tab.id}`}
                        disabled={tab.disabled}
                        onClick={() => onChange(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className={styles.panels}>
                {keepMounted ? (
                    tabs.map((tab) => (
                        <div
                            key={tab.id}
                            id={`panel-${tab.id}`}
                            className={styles.panel}
                            role="tabpanel"
                            hidden={tab.id !== activeId}
                        >
                            {tab.content}
                        </div>
                    ))
                ) : (
                    <div className={styles.panel} role="tabpanel">
                        {tabs.find((t) => t.id === activeId)?.content ?? null}
                    </div>
                )}
            </div>
        </div>
    );
}
