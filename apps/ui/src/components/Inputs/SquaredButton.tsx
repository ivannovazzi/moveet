import React from "react";
import styles from "./Inputs.module.css";
import classNames from "classnames";

type SquaredButtonTone = "neutral" | "active" | "success" | "danger";
type SquaredButtonVariant = "surface" | "ghost";
type SquaredButtonSize = "md" | "lg";

interface SquaredButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  tone?: SquaredButtonTone;
  variant?: SquaredButtonVariant;
  size?: SquaredButtonSize;
  active?: boolean;
  iconClassName?: string;
}

export function SquaredButton({
  icon,
  tone = "neutral",
  variant = "surface",
  size = "md",
  active = false,
  className,
  iconClassName,
  children,
  ...props
}: SquaredButtonProps) {
  const iconNode = React.isValidElement<{ className?: string }>(icon)
    ? React.cloneElement(icon, {
        className: classNames(styles.squaredButtonIcon, icon.props.className, iconClassName),
      })
    : icon;

  return (
    <button
      type="button"
      {...props}
      className={classNames(
        styles.squaredButton,
        styles[`squaredButton${size === "lg" ? "Lg" : "Md"}`],
        styles[`squaredButton${variant === "ghost" ? "Ghost" : "Surface"}`],
        styles[
          `squaredButtonTone${
            tone === "active"
              ? "Active"
              : tone === "success"
                ? "Success"
                : tone === "danger"
                  ? "Danger"
                  : "Neutral"
          }`
        ],
        {
          [styles.squaredButtonActive]: active,
        },
        className
      )}
    >
      {iconNode}
      {children}
    </button>
  );
}
