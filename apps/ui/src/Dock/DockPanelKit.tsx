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
 *  • panel width is fixed by the surface that opens it — never set your own
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

/** Text colour for a semantic tone (shared with the dock bar's mode rail). */
export function toneTextClass(tone: StatusTone): string {
  return TONE_TEXT[tone];
}

/** Background fill for a semantic tone, used for dots and rails. */
export function toneFillClass(tone: StatusTone): string {
  return TONE_DOT[tone];
}

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
        "text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground/70",
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
        <div className="mt-[3px] text-title font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

/**
 * The one header row every floating dock panel wears: what you opened on the
 * left, the panel's own switch in the middle, an optional caller slot and the
 * way out on the right.
 *
 * It replaced two headings stacked on top of each other — the panel's eyebrow
 * ("Fleet › List") repeating a tab strip that was already saying the same
 * thing, over a second `PanelHead` inside the body. One row, one heading.
 */
export function PanelHeaderRow({
  icon,
  title,
  children,
  right,
  onClose,
  closeLabel = "Close panel",
}: {
  /** Section glyph, sized to the title. */
  icon?: React.ReactNode;
  title: string;
  /** The panel's own switch (a tab strip), taking the middle of the row. */
  children?: React.ReactNode;
  /** Caller slot before the close button (a health chip, a count). */
  right?: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border-soft px-2.5 py-[7px]">
      <div className="flex shrink-0 items-center gap-1.5 text-foreground [&_svg]:size-[15px]">
        {icon}
        <span className="whitespace-nowrap text-label font-semibold tracking-[-0.01em]">
          {title}
        </span>
      </div>
      {children}
      {right}
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        title={`${closeLabel} (Esc)`}
        className={cn(
          "ml-auto flex size-[22px] shrink-0 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors duration-fast ease-standard",
          "hover:bg-foreground/[0.06] hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor">
          <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** A pill chip stating health/state in a semantic tone. */
export function HealthChip({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 self-center whitespace-nowrap rounded-full border px-2 py-[3px] text-micro font-bold uppercase tracking-wider",
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
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-[5px] text-meta font-medium",
              "transition-[color,background-color,box-shadow] duration-fast ease-standard",
              selected
                ? "bg-foreground/[0.06] text-foreground shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
                : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cn(mono, "text-micro text-muted-foreground/70")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The one height envelope every dock panel body lives in. Shared so the panel's
 * top edge doesn't hop when you step between a section's tabs — a scrolling
 * body and a virtualized list that needs a definite height both measure the
 * same cap.
 */
export const PANEL_BODY_MAX_H = "max-h-[min(60vh,520px)]";

/** Same envelope as a fixed height, for bodies that must measure (react-window). */
export const PANEL_BODY_H = "h-[min(60vh,520px)]";

/**
 * Scrollable region for panel bodies that can overflow (lists, tables). Caps
 * at `PANEL_BODY_MAX_H`; the panel surface itself stays put.
 */
export function PanelScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(PANEL_BODY_MAX_H, "overflow-y-auto", className)}>{children}</div>;
}

export interface PanelTab<T extends string> {
  id: T;
  label: string;
  /** Optional count rendered as a small mono error-tone badge (e.g. incidents). */
  badge?: number;
}

/**
 * A quiet, horizontally-scrollable tab strip for panels with many sections
 * (Monitor, Settings). Unlike `SegTabs` it doesn't stretch tabs to equal
 * width — it scrolls, so a panel can carry 4-7 tabs without cramping.
 */
export function PanelTabStrip<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: PanelTab<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-0.5 overflow-x-auto border-b border-border-soft px-2.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(({ id, label, badge }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={cn(
              "flex-shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-micro font-medium",
              "transition-[color,background-color] duration-fast ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              selected
                ? "bg-foreground/[0.06] text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
            )}
          >
            {label}
            {badge != null && badge > 0 && (
              <span className={cn(mono, "ml-1 text-micro text-status-error")}>{badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── shared list-row language (mockup `.list`/`.lrow`/`.tag`) ─────────────────
// The canonical dense row used across Sinks, Monitor, and Incidents. Lives here
// (not in a panel) so every panel renders the exact same stripe/label/meta
// rhythm instead of re-deriving it. `SevTone` is an alias of `StatusTone`.

export type SevTone = StatusTone;

const SEV_BAR: Record<SevTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  error: "bg-status-error",
  idle: "bg-border",
  accent: "bg-accent",
};

const TAG_TONE: Record<SevTone, string> = {
  ok: "text-status-ok bg-status-ok/12",
  warn: "text-status-warn bg-status-warn/12",
  error: "text-status-error bg-status-error/12",
  idle: "text-muted-foreground bg-muted",
  accent: "text-accent bg-accent/12",
};

/** A right-aligned uppercase state pill (mockup `.tag.ok`/`.tag.warn`). */
export function Tag({ tone, children }: { tone: SevTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-[4px] px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider",
        TAG_TONE[tone]
      )}
    >
      {children}
    </span>
  );
}

/** Column wrapper for a run of `LRow`s: tight padding, first row un-ruled. */
export function LList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col px-2 pb-2.5 pt-1", className)}>{children}</div>;
}

/**
 * A dense connection/status row: left severity stripe, a primary label over a
 * monospace secondary line, and a right-aligned meta slot (a `Tag`, digits, or
 * inline controls). The one row spec for every panel list.
 */
export function LRow({
  tone,
  primary,
  secondary,
  meta,
  className,
}: {
  tone: SevTone;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[3px_1fr_auto] items-center gap-2.5 border-t border-border-soft px-2 py-[9px] first:border-t-0",
        className
      )}
    >
      <span className={cn("h-[26px] w-[3px] rounded-[2px]", SEV_BAR[tone])} />
      <div className="min-w-0">
        <div className="truncate text-label font-medium text-foreground">{primary}</div>
        {secondary != null && (
          <div className={cn(mono, "mt-0.5 truncate text-meta text-muted-foreground/60")}>
            {secondary}
          </div>
        )}
      </div>
      <div className="flex items-center justify-self-end gap-1 text-right">{meta}</div>
    </div>
  );
}
