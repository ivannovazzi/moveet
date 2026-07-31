import { cn } from "@/lib/utils";
import type { StatusTone } from "./DockPanelKit";

/**
 * Shared chrome for the dock *bar* (the 54px transport strip), as distinct from
 * `DockPanelKit`, which dresses the panel that opens above it. Everything the
 * bar draws — transport buttons, keycaps, rail actions, tone tints — comes from
 * here so the three centre-slot states (launcher, mode rail, replay rail) read
 * as one instrument rather than three components that happen to be adjacent.
 */

/** A 36×42 dock icon button — the transport/rail unit of the bar. */
export function IconButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[42px] w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
        "transition-[color,background-color,opacity] duration-fast ease-standard",
        "hover:bg-foreground/[0.035] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "disabled:pointer-events-none disabled:opacity-35",
        "[&_svg]:size-[17px]",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A keycap. Always paired with the action it triggers, never on its own. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-border bg-foreground/[0.04] px-1 py-px",
        "font-sans text-[9.5px] font-medium leading-[14px] text-muted-foreground",
        className
      )}
    >
      {children}
    </kbd>
  );
}

const RAIL_BUTTON_VARIANT = {
  /** The mode's Enter action. One per rail, filled, accent. */
  primary: cn(
    "bg-accent text-primary-foreground shadow-raised",
    "hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
  ),
  /** Leaving / cancelling. Quiet, bordered. */
  quiet: cn(
    "border border-border bg-foreground/[0.04] text-muted-foreground",
    "hover:bg-foreground/[0.08] hover:text-foreground"
  ),
  /** Destructive confirmation inside the guard prompt. */
  danger: cn("bg-status-error text-background shadow-raised hover:brightness-110"),
} as const;

/** A compact action button sized for the bar (28px tall, 11px label). */
export function RailButton({
  variant = "quiet",
  keycap,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof RAIL_BUTTON_VARIANT;
  /** Trailing keycap, e.g. the Enter/Esc that does the same thing. */
  keycap?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5",
        "text-[11.5px] font-medium transition-[background-color,color,filter,opacity] duration-fast ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        RAIL_BUTTON_VARIANT[variant],
        className
      )}
      {...rest}
    >
      {children}
      {keycap && (
        <Kbd className={variant === "primary" ? "border-white/25 bg-white/10 text-white/80" : ""}>
          {keycap}
        </Kbd>
      )}
    </button>
  );
}

/** Soft tinted wash behind an active centre-slot state. */
export const TONE_WASH: Record<StatusTone, string> = {
  accent:
    "bg-accent/[0.09] shadow-[inset_0_0_0_1px_var(--color-accent-line,oklch(0.62_0.15_250/0.28))]",
  ok: "bg-status-ok/[0.09] shadow-[inset_0_0_0_1px_oklch(0.72_0.16_155/0.28)]",
  warn: "bg-status-warn/[0.10] shadow-[inset_0_0_0_1px_oklch(0.80_0.15_80/0.30)]",
  error: "bg-status-error/[0.10] shadow-[inset_0_0_0_1px_oklch(0.63_0.20_25/0.32)]",
  idle: "bg-foreground/[0.04] shadow-[inset_0_0_0_1px_var(--color-border-soft)]",
};

/** Micro uppercase label used for the mode name in the rail. */
export function RailLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-[9.5px] font-bold uppercase leading-none tracking-[0.14em]",
        className
      )}
    >
      {children}
    </span>
  );
}

/** A small indeterminate spinner matching the rail's type size. */
export function RailSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-transparent border-l-current border-t-current",
        className
      )}
    />
  );
}
