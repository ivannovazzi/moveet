import { cn } from "@/lib/utils";
import type { StatusTone } from "./DockPanelKit";

export interface StatusChip {
  key: string;
  label: string;
  /** Semantic tone of the dot. `idle` reads as "not connected / not running". */
  tone: StatusTone;
  /** Long form for the tooltip and screen readers ("Feeds: needs attention"). */
  title: string;
}

export interface StatusChipsProps {
  chips: StatusChip[];
  className?: string;
}

const DOT_TONE: Record<StatusTone, string> = {
  ok: "bg-status-ok shadow-[0_0_6px_var(--color-status-ok)]",
  warn: "bg-status-warn shadow-[0_0_6px_var(--color-status-warn)]",
  error: "bg-status-error shadow-[0_0_6px_var(--color-status-error)]",
  accent: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
  idle: "bg-muted-foreground",
};

/**
 * The dock's right-edge health read-out: socket, simulation, and feeds. Feeds
 * moved here from a badge on the old Sinks cluster — a health signal belongs
 * with the other health signals, not hidden on the button that opens a config
 * panel.
 */
export default function StatusChips({ chips, className }: StatusChipsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {chips.map(({ key, label, tone, title }) => {
        const live = tone !== "idle";
        return (
          <span
            key={key}
            title={title}
            className={cn(
              "inline-flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em]",
              live ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone])} />
            <span className={live ? "opacity-85" : "opacity-55"}>{label}</span>
            <span className="sr-only">{title}</span>
          </span>
        );
      })}
    </div>
  );
}
