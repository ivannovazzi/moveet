import { cn } from "@/lib/utils";

/**
 * Shared building blocks for dock panel contents, encoding the approved
 * mockup's tight-technical density in one place so every panel (Fleet, Tempo,
 * Sinks, Monitor) reads as the same instrument. Panels compose these instead
 * of re-deriving spacing/type — keep new panel chrome here, not inline.
 *
 * Conventions:
 *  • all numerics use `font-mono` + `tabular-nums` (see `mono` helper)
 *  • rows are separated by hairlines (`border-border-soft`), never cards
 *  • labels are 9px uppercase with wide tracking (`Eyebrow`)
 *  • panel content width is fixed by `DockPanel` (w-96) — never set your own
 */

/** Apply to any element holding aligned digits (IDs, speeds, ETAs, clocks). */
export const mono = "font-mono tabular-nums";

export type StatusTone = "ok" | "warn" | "error" | "idle" | "accent";

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-status-ok shadow-[0_0_6px_var(--color-status-ok)]",
  warn: "bg-status-warn shadow-[0_0_6px_var(--color-status-warn)]",
  error: "bg-status-error shadow-[0_0_6px_var(--color-status-error)]",
  idle: "bg-status-idle",
  accent: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
};

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-status-ok",
  warn: "text-status-warn",
  error: "text-status-error",
  idle: "text-muted-foreground",
  accent: "text-accent",
};

/** A 6px status dot in the given semantic tone. */
export function StatusDot({ tone }: { tone: StatusTone }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />;
}

/** Micro uppercase label with wide tracking. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground/75",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A full-bleed 1px hairline divider. */
export function Hairline() {
  return <div className="h-px bg-border-soft" />;
}

/**
 * Panel header: eyebrow + title on the left, an optional right slot (summary
 * stats, a health chip). Matches the mockup's 13/15/11px header rhythm.
 */
export function PanelHead({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-[15px] pb-[11px] pt-[13px]">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <div className="mt-[3px] text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

/** A pill chip stating health/state in a semantic tone. */
export function HealthChip({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 self-center whitespace-nowrap rounded-full border px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.08em]",
        TONE_TEXT[tone],
        tone === "ok" && "border-status-ok/35 bg-status-ok/10",
        tone === "warn" && "border-status-warn/35 bg-status-warn/10",
        tone === "error" && "border-status-error/35 bg-status-error/10",
        (tone === "idle" || tone === "accent") && "border-border bg-muted"
      )}
    >
      {children}
    </span>
  );
}

export interface SegTab<T extends string> {
  value: T;
  label: string;
  /** Optional trailing count, rendered dimmed and monospace. */
  count?: number;
}

/**
 * Segmented sub-tabs (mockup `.seg`): equal-width, quiet until selected.
 * Use for a panel's primary content switch (List/Groups/Dispatch, etc.).
 */
export function SegTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: SegTab<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex gap-0.5 px-[15px] py-[9px]" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-[5px] text-[11px] font-medium",
              "transition-[color,background-color,box-shadow] duration-fast ease-standard",
              selected
                ? "bg-foreground/[0.06] text-foreground shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
                : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cn(mono, "text-[10px] text-muted-foreground/70")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Scrollable region for panel bodies that can overflow (lists, tables). Caps
 * at the mockup's comfortable height; the panel surface itself stays put.
 */
export function PanelScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("max-h-[min(52vh,420px)] overflow-y-auto", className)}>{children}</div>;
}
