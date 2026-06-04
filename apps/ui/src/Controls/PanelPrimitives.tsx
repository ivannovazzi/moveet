import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelShellProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

// Card-shaped surface (mirrors @/components/ui/card tokens) sized to fill its
// container as a vertical flex panel.
export function PanelShell({ children, className, ...props }: PanelShellProps) {
  return (
    <section
      {...props}
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg",
        className
      )}
    >
      {children}
    </section>
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
    <div {...props} className={cn("flex-shrink-0 border-b border-border px-3 py-2.5", className)}>
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
        "flex min-h-0 flex-1 flex-col",
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
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-2 text-xs font-semibold tabular-nums",
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
}

export function PanelEmptyState({ children, className, ...props }: PanelEmptyStateProps) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/40 p-3 text-center text-xs leading-relaxed text-muted-foreground",
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
