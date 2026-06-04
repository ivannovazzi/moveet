import React from "react";
import { Button as UIButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SquaredButtonTone = "neutral" | "active" | "success" | "danger";
type SquaredButtonVariant = "surface" | "ghost";
type SquaredButtonSize = "md" | "lg";

type SquaredButtonProps = Omit<
  React.ComponentProps<typeof UIButton>,
  "className" | "children" | "variant" | "size" | "disabled"
> & {
  icon: React.ReactNode;
  tone?: SquaredButtonTone;
  variant?: SquaredButtonVariant;
  size?: SquaredButtonSize;
  active?: boolean;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
  title?: string;
  /** Standard HTML disabled attribute */
  disabled?: boolean;
  /** Legacy react-aria alias — mapped to native disabled (isDisabled ?? disabled) */
  isDisabled?: boolean;
};

const toneActiveClasses: Record<SquaredButtonTone, string> = {
  neutral: "bg-accent/15 border-accent/30 text-foreground",
  active: "bg-accent/15 border-accent/40 text-accent",
  success: "bg-status-ok/15 border-status-ok/30 text-status-ok",
  danger: "bg-status-error/15 border-status-error/30 text-status-error",
};

const toneHoverClasses: Record<SquaredButtonTone, string> = {
  neutral: "hover:text-foreground",
  active: "hover:text-accent",
  success: "hover:text-status-ok",
  danger: "hover:text-status-error",
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
  disabled,
  isDisabled,
  ...props
}: SquaredButtonProps) {
  const iconNode = React.isValidElement<{ className?: string }>(icon)
    ? React.cloneElement(icon, {
        className: cn(icon.props.className, iconClassName),
      })
    : icon;

  return (
    <UIButton
      type="button"
      variant={variant === "ghost" ? "ghost" : "outline"}
      size="icon"
      disabled={isDisabled ?? disabled}
      className={cn(
        "aspect-square text-muted-foreground",
        size === "lg" && "size-10 [&_svg:not([class*='size-'])]:size-5",
        toneHoverClasses[tone],
        active && toneActiveClasses[tone],
        className
      )}
      {...props}
    >
      {iconNode}
      {children}
    </UIButton>
  );
}
