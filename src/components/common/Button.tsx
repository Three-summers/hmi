import { useState, useCallback, type ButtonHTMLAttributes } from "react";
import type { ButtonBehavior, HighlightStatus } from "@/types";
import styles from "./Button.module.css";

type ButtonSize = "small" | "medium" | "large";
type ButtonVariant = "default" | "primary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button behavior: momentary (click) or toggle (press/release) */
  behavior?: ButtonBehavior;
  /** Current pressed state for toggle buttons */
  pressed?: boolean;
  /** Callback when pressed state changes (for toggle buttons) */
  onPressedChange?: (pressed: boolean) => void;
  /** Visual highlight status per SEMI E95 */
  highlight?: HighlightStatus;
  /** Button size variant */
  size?: ButtonSize;
  /** Button style variant */
  variant?: ButtonVariant;
  /** Icon to display */
  icon?: React.ReactNode;
}

/**
 * SEMI E95 compliant button component
 * - Supports momentary (instant) and toggle (two-state) behaviors
 * - Minimum touch size of 1.5cm (70px) enforced via CSS
 * - Title Case text formatting
 * - Highlight states for status indication
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
  // Internal state for uncontrolled toggle buttons
  const [internalPressed, setInternalPressed] = useState(false);

  // Use controlled or uncontrolled pressed state
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
    [behavior, isPressed, disabled, onClick, onPressedChange]
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
