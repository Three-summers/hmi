import { useState, useCallback, type ButtonHTMLAttributes } from "react";
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
        (e: React.MouseEvent<HTMLButtonElement>) => {
            if (disabled) return;

            if (behavior === "toggle") {
                const newPressed = !isPressed;
                setInternalPressed(newPressed);
                onPressedChange?.(newPressed);
            }

            onClick?.(e);
        },
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
