/**
 * TitlePanel 子组件
 *
 * 将 TitlePanel 中重复的结构抽象为可复用组件：
 * - StatusItem：用于“状态类”展示（图标 + 内容 + 可选尾部元素）
 * - ActionButton：用于“操作类”按钮（图标 + 可选内容）
 *
 * 注意：该文件只提供结构与类型约束，不绑定具体样式，样式由调用方通过 className 传入。
 *
 * @module TitlePanelItems
 */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type IconWrapperAs = "div" | "span";

interface StatusItemProps
    extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> {
    /** 透传 data-* 属性（用于 CSS 状态选择器） */
    [dataAttribute: `data-${string}`]: unknown;
    /** 根容器 class */
    className: string;
    /** 图标节点 */
    icon: ReactNode;
    /** 图标容器 class */
    iconClassName: string;
    /** 内容容器 class */
    contentClassName: string;
    /** 尾部元素（例如连接状态指示灯） */
    trailing?: ReactNode;
    /** 内容 */
    children: ReactNode;
}

/**
 * 状态展示组件（结构复用）
 *
 * @param props - 组件属性
 * @returns 状态展示 JSX
 */
export function StatusItem({
    className,
    icon,
    iconClassName,
    contentClassName,
    trailing,
    children,
    ...rest
}: StatusItemProps) {
    return (
        <div className={className} {...rest}>
            <div className={iconClassName}>{icon}</div>
            <div className={contentClassName}>{children}</div>
            {trailing}
        </div>
    );
}

interface ActionButtonProps
    extends Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        "children" | "className"
    > {
    /** 透传 data-* 属性（用于 CSS 状态选择器） */
    [dataAttribute: `data-${string}`]: unknown;
    /** 按钮 class */
    className: string;
    /** 图标节点 */
    icon: ReactNode;
    /** 图标包装元素（用于兼容不同的 CSS 选择器与布局） */
    iconWrapperAs?: IconWrapperAs;
    /** 图标包装元素 class */
    iconWrapperClassName?: string;
    /** 按钮内容（可选） */
    children?: ReactNode;
}

/**
 * 操作按钮组件（结构复用）
 *
 * @param props - 组件属性
 * @returns 按钮 JSX
 */
export function ActionButton({
    className,
    icon,
    iconWrapperAs = "span",
    iconWrapperClassName,
    children,
    type = "button",
    ...rest
}: ActionButtonProps) {
    const IconWrapper = iconWrapperAs;

    return (
        <button className={className} type={type} {...rest}>
            <IconWrapper className={iconWrapperClassName}>{icon}</IconWrapper>
            {children}
        </button>
    );
}
