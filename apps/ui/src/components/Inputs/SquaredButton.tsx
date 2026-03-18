import React, { useRef, useEffect } from "react";
import { Button as AriaButton, type ButtonProps } from "react-aria-components";
import styles from "./Inputs.module.css";
import classNames from "classnames";

type SquaredButtonTone = "neutral" | "active" | "success" | "danger";
type SquaredButtonVariant = "surface" | "ghost";
type SquaredButtonSize = "md" | "lg";

// Omit React Aria's onClick/isDisabled to replace with standard React/HTML attrs
type SquaredButtonProps = Omit<ButtonProps, "className" | "children" | "onClick" | "isDisabled"> & {
  icon: React.ReactNode;
  tone?: SquaredButtonTone;
  variant?: SquaredButtonVariant;
  size?: SquaredButtonSize;
  active?: boolean;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
  /** title attribute — applied via ref since React Aria filters it from DOM props */
  title?: string;
  onClick?: React.MouseEventHandler<Element>;
  /** Standard HTML disabled attribute — mapped to React Aria's isDisabled */
  disabled?: boolean;
  isDisabled?: boolean;
};

export function SquaredButton({
  icon,
  tone = "neutral",
  variant = "surface",
  size = "md",
  active = false,
  className,
  iconClassName,
  children,
  title,
  disabled,
  isDisabled,
  ...props
}: SquaredButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // React Aria's filterDOMProps strips 'title', so apply it manually via ref
  useEffect(() => {
    if (ref.current && title) {
      ref.current.setAttribute("title", title);
    }
  }, [title]);

  const iconNode = React.isValidElement<{ className?: string }>(icon)
    ? React.cloneElement(icon, {
        className: classNames(styles.squaredButtonIcon, icon.props.className, iconClassName),
      })
    : icon;

  return (
    <AriaButton
      ref={ref}
      type="button"
      isDisabled={isDisabled ?? disabled}
      {...(props as ButtonProps)}
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
    </AriaButton>
  );
}
