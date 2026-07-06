import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SquaredButton } from "@/components/Inputs";

interface PanelShellProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

// The sliding aside's glass surface: panels render PanelHeader/PanelBody
// fragments inside it, so the surface (border, blur, scroll containment)
// lives here instead of in App's wrapper markup.
export function PanelShell({ children, className, ...props }: PanelShellProps) {
  return (
    <section
      {...props}
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-border surface-glass shadow-elevated backdrop-blur-2xl",
        className
      )}
    >
      {children}
    </section>
  );
}

interface PanelRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Force the element; defaults to a <button> when `onClick` is set, else a <div>. */
  as?: "button" | "div";
  /** Accent-selected state: tinted background + inset accent bar. */
  selected?: boolean;
  /** Hover tint (on by default; turn off for purely informational rows). */
  hoverable?: boolean;
}

/**
 * Shared list-row shell for the side panels: hairline divider, row padding,
 * hover tone, optional selected treatment, and (for interactive rows) the
 * focus-visible ring. Layout (flex/grid, gaps) stays with the caller via
 * `className`; trailing actions are just trailing children (see
 * RowDeleteButton for the shared danger action).
 */
export function PanelRow({
  as,
  selected = false,
  hoverable = true,
  className,
  type,
  ...props
}: PanelRowProps) {
  const Tag = (as ?? (props.onClick ? "button" : "div")) as "button";
  const isButton = Tag === "button";
  return (
    <Tag
      type={isButton ? (type ?? "button") : undefined}
      {...props}
      className={cn(
        "border-b border-border-soft px-2.5 py-2 transition-colors duration-fast ease-standard",
        hoverable && "hover:bg-white/[0.04]",
        isButton &&
          "w-full cursor-pointer text-left focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
        selected && "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]",
        className
      )}
    />
  );
}

interface RowDeleteButtonProps {
  /** Accessible name + tooltip, e.g. "Delete fleet". */
  label: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

/** The shared trailing danger action for panel rows (delete/remove ×). */
export function RowDeleteButton({ label, onClick, className }: RowDeleteButtonProps) {
  return (
    <SquaredButton
      className={cn("flex-shrink-0", className)}
      icon={<span aria-hidden="true">×</span>}
      variant="ghost"
      tone="danger"
      aria-label={label}
      title={label}
      onClick={onClick}
    />
  );
}

interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  titleAs?: "h2" | "h3";
}

export function PanelHeader({
  eyebrow,
  title,
  subtitle,
  badge,
  titleAs = "h2",
  className,
  ...props
}: PanelHeaderProps) {
  const TitleTag = titleAs;

  return (
    <div
      {...props}
      className={cn("flex-shrink-0 border-b border-border-soft px-3 py-3", className)}
    >
      {eyebrow ? (
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <TitleTag className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
          {title}
        </TitleTag>
        {badge ? <div className="inline-flex flex-shrink-0 items-center gap-2">{badge}</div> : null}
      </div>
      {subtitle ? (
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

interface PanelBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
  scrollable?: boolean;
}

export function PanelBody({
  children,
  padded = true,
  scrollable = true,
  className,
  ...props
}: PanelBodyProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex min-h-0 flex-1 flex-col animate-fade-up",
        padded && "p-3",
        scrollable && "overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}

interface PanelBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: "neutral" | "active" | "healthy" | "warning";
}

const badgeToneClasses: Record<NonNullable<PanelBadgeProps["tone"]>, string> = {
  neutral: "border-border bg-muted text-foreground",
  active: "border-accent/40 bg-accent/10 text-accent",
  healthy: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  warning: "border-status-warn/30 bg-status-warn/10 text-status-warn",
};

export function PanelBadge({ children, tone = "active", className, ...props }: PanelBadgeProps) {
  return (
    <span
      {...props}
      data-tone={tone}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-2 text-xs font-semibold tabular-nums shadow-raised",
        badgeToneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

interface PanelEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Optional glyph shown above the message — give each panel its own
   * identity instead of every empty state looking identical. */
  icon?: ReactNode;
}

export function PanelEmptyState({ children, icon, className, ...props }: PanelEmptyStateProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-lg border border-border-soft surface-raised px-4 py-6 text-center shadow-raised",
        className
      )}
    >
      {icon ? (
        <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

interface PanelLoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional loading message; defaults to "Loading…". */
  children?: ReactNode;
}

// Mirrors PanelEmptyState's dashed surface but reads as an in-progress state,
// with a small animated dot so it's distinguishable from "empty".
export function PanelLoadingState({ children, className, ...props }: PanelLoadingStateProps) {
  return (
    <div
      {...props}
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg border border-border-soft surface-raised p-3 text-center text-xs leading-relaxed text-muted-foreground shadow-raised",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
      />
      {children ?? "Loading…"}
    </div>
  );
}

interface PanelErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

// Error variant of the panel placeholder — destructive-toned dashed surface.
export function PanelErrorState({ children, className, ...props }: PanelErrorStateProps) {
  return (
    <div
      {...props}
      role="alert"
      className={cn(
        "rounded-lg border border-status-error/25 bg-status-error/10 p-3 text-center text-xs leading-relaxed text-status-error shadow-raised",
        className
      )}
    >
      {children}
    </div>
  );
}

interface PanelSectionLabelProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function PanelSectionLabel({ children, className, ...props }: PanelSectionLabelProps) {
  return (
    <span
      {...props}
      className={cn(
        "text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
