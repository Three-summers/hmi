/**
 * SEMI E95 标准按钮组件
 *
 * 提供符合工业 HMI 标准的按钮交互，支持瞬时/保持两种行为模式。
 *
 * @module Button
 */

import {
    useState,
    useCallback,
    type ButtonHTMLAttributes,
    type MouseEvent,
} from "react";
import type { ButtonBehavior, HighlightStatus } from "@/types";
import styles from "./Button.module.css";

type ButtonSize = "small" | "medium" | "large";
type ButtonVariant = "default" | "primary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** 按钮行为：瞬时（点击触发）或保持（按下/释放两态） */
    behavior?: ButtonBehavior;
    /** 外部受控的按下状态（仅 toggle 生效） */
    pressed?: boolean;
    /** 按下状态变化回调（仅 toggle 生效） */
    onPressedChange?: (pressed: boolean) => void;
    /** 视觉高亮状态（语义色，SEMI E95） */
    highlight?: HighlightStatus;
    /** 尺寸规格 */
    size?: ButtonSize;
    /** 样式规格 */
    variant?: ButtonVariant;
    /** 图标 */
    icon?: React.ReactNode;
}

export type ButtonClickHandlerContext = {
    behavior: ButtonBehavior;
    isPressed: boolean;
    disabled?: boolean;
    setInternalPressed: (pressed: boolean) => void;
    onPressedChange?: (pressed: boolean) => void;
    onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * 统一 Button 点击逻辑（便于在无 DOM 的环境做单测覆盖）
 *
 * @param e - React 点击事件
 * @param context - 点击上下文
 */
export function handleButtonClick(
    e: MouseEvent<HTMLButtonElement>,
    context: ButtonClickHandlerContext,
) {
    const {
        behavior,
        isPressed,
        disabled,
        setInternalPressed,
        onPressedChange,
        onClick,
    } = context;

    if (disabled) return;

    // toggle 模式：切换按下状态
    if (behavior === "toggle") {
        const newPressed = !isPressed;
        setInternalPressed(newPressed);
        onPressedChange?.(newPressed);
    }

    onClick?.(e);
}

/**
 * SEMI E95 按钮组件
 *
 * 设计要点：
 * - 支持瞬时/保持两种行为
 * - CSS 强制最小触控尺寸（约 1.5cm / 70px）
 * - 支持语义高亮（报警/警告/处理中/关注）
 */
export function Button({
    behavior = "momentary",
    pressed: controlledPressed,
    onPressedChange,
    highlight = "none",
    size = "medium",
    variant = "default",
    icon,
    children,
    onClick,
    disabled,
    ...props
}: ButtonProps) {
    // 未受控时使用内部状态维护 toggle 按下状态
    const [internalPressed, setInternalPressed] = useState(false);

    // 优先使用外部受控状态，否则使用内部状态
    const isPressed = controlledPressed ?? internalPressed;

    const handleClick = useCallback(
        (e: MouseEvent<HTMLButtonElement>) =>
            handleButtonClick(e, {
                behavior,
                isPressed,
                disabled,
                setInternalPressed,
                onPressedChange,
                onClick,
            }),
        [behavior, isPressed, disabled, onClick, onPressedChange],
    );

    return (
        <button
            className={styles.button}
            data-size={size}
            data-variant={variant}
            data-pressed={behavior === "toggle" ? isPressed : undefined}
            data-highlight={highlight !== "none" ? highlight : undefined}
            disabled={disabled}
            onClick={handleClick}
            {...props}
        >
            {icon && <span className={styles.icon}>{icon}</span>}
            {children}
        </button>
    );
}
