import { cn } from "@/lib/utils";
import DockSurface from "./DockSurface";
import type { StatusTone } from "./DockPanelKit";

export interface StatusLed {
  key: string;
  label: string;
  /** Semantic tone of the lamp. `idle` reads as "not connected / not running". */
  tone: StatusTone;
  /** Long form for the tooltip and screen readers ("Feeds: needs attention"). */
  title: string;
}

export interface StatusLedsProps {
  leds: StatusLed[];
  className?: string;
}

const LAMP: Record<StatusTone, string> = {
  ok: "bg-status-ok shadow-[0_0_7px_var(--color-status-ok)]",
  warn: "bg-status-warn shadow-[0_0_7px_var(--color-status-warn)]",
  error: "bg-status-error shadow-[0_0_7px_var(--color-status-error)]",
  accent: "bg-accent shadow-[0_0_7px_var(--color-accent)]",
  idle: "bg-muted-foreground/60",
};

/**
 * The run's health lamps, in the top-right corner where a control room puts its
 * annunciator panel: socket, simulation, feeds.
 *
 * They used to ride on the right end of the dock, which put three things that
 * are only ever *read* among a row of things that are pressed — and made them
 * the first casualty of a narrow window. Up here they are always visible,
 * always in the same place, and never in the way of a control.
 */
export default function StatusLeds({ leds, className }: StatusLedsProps) {
  return (
    <DockSurface
      className={cn(
        "absolute right-3 top-3 z-30 h-auto gap-0 rounded-[10px] p-1",
        "pointer-events-none opacity-0 transition-opacity duration-700 ease-emphasized",
        "[[data-ready]_&]:opacity-100",
        className
      )}
      role="status"
      aria-label="Run health"
    >
      {leds.map(({ key, label, tone, title }, i) => (
        <span
          key={key}
          title={title}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1",
            i > 0 && "border-l border-border-soft",
            tone === "idle" ? "text-muted-foreground" : "text-foreground/85"
          )}
        >
          <span className={cn("size-[5px] shrink-0 rounded-full", LAMP[tone])} />
          <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]">{label}</span>
          <span className="sr-only">{title}</span>
        </span>
      ))}
    </DockSurface>
  );
}
