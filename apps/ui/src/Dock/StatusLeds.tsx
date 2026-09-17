import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DockSurface from "./DockSurface";
import { toneTextClass, type StatusTone } from "./DockPanelKit";

export interface StatusLed {
  key: string;
  /**
   * The lamp's identity. Chosen by the caller rather than mapped from `key`
   * here, so a lamp whose icon depends on its own state can say so — the
   * weather lamp draws the actual condition (sun / rain / snow / fog), which
   * is what keeps state from resting on colour alone.
   */
  icon: LucideIcon;
  /** Semantic tone of the lamp. `idle` reads as "not connected / not running". */
  tone: StatusTone;
  /** Long form for the tooltip and screen readers ("Feeds: needs attention"). */
  title: string;
}

export interface StatusLedsProps {
  leds: StatusLed[];
  className?: string;
}

/**
 * The run's health lamps, in the top-right corner where a control room puts its
 * annunciator panel: socket, simulation, feeds, weather.
 *
 * They used to ride on the right end of the dock, which put things that are
 * only ever *read* among a row of things that are pressed — and made them the
 * first casualty of a narrow window. Up here they are always visible, always in
 * the same place, and never in the way of a control.
 *
 * **Why icons and not words.** The lamps were labelled `WS` / `SIM` / `FEED` /
 * `WX`. Four characters of uppercase is not a label, it is a crossword: `WX` is
 * meteorology shorthand that means nothing outside aviation, and even `FEED`
 * does not say *whose* feed. An icon plus a tooltip that spells out the whole
 * state in words is both smaller and more legible than an abbreviation nobody
 * can expand.
 *
 * **Why a real tooltip.** The rest of the dock uses the native `title`
 * attribute, which is fine next to a visible label — it adds detail nobody is
 * waiting on. Here the tooltip *is* the label, so an OS tooltip's ~1s delay, no
 * styling and no keyboard path would make the row unreadable. This uses the
 * Radix primitive at `components/ui/tooltip` instead: instant, glass-styled to
 * match the surface it hangs off, and reachable by tab.
 */
export default function StatusLeds({ leds, className }: StatusLedsProps) {
  return (
    // Provider scoped to this component rather than the app root: it is the
    // only Radix tooltip in the tree today, and a lamp row wants its own delay
    // behaviour (none) regardless of what the dock adopts later.
    <TooltipProvider delayDuration={0}>
      <DockSurface
        className={cn(
          // Placed by the shell grid's top-right track, centred on the search
          // band rather than hung off the top edge (see `ShellGrid`).
          "h-auto gap-0 rounded-[10px] p-1",
          "pointer-events-none opacity-0 transition-opacity duration-700 ease-emphasized",
          // Hover and focus only once the app has painted in — the same gate
          // the reveal uses, stated here because the tooltips depend on it.
          "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:opacity-100",
          className
        )}
        role="status"
        aria-label="Run health"
      >
        {leds.map(({ key, icon: Icon, tone, title }, i) => (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              {/*
                A span with a tab stop, not a button: these are readouts, and
                announcing "button" for something that cannot be pressed is
                worse than the keyboard access is good. `asChild` keeps Radix's
                trigger behaviour on it.
              */}
              <span
                tabIndex={0}
                className={cn(
                  "flex items-center px-2 py-1 outline-none",
                  "rounded-[6px] focus-visible:ring-1 focus-visible:ring-ring",
                  i > 0 && "border-l border-border-soft",
                  toneTextClass(tone)
                )}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                {/*
                  The accessible name, and the reason it is a child rather than
                  an `aria-label`: this surface is a `role="status"` live
                  region, which announces changes to its text content. A lamp
                  going amber has to *say* so, not just recolour.
                */}
                <span className="sr-only">{title}</span>
              </span>
            </TooltipTrigger>
            {/*
              The lamps sit in the top-right corner, so a long tooltip runs
              straight into the viewport edge. Keep it off by the same 12px the
              shell grid uses as its gutter, and stand it off the lamps rather
              than letting it sit flush against them — Radix's arrow rides the
              content edge, so the offset moves bubble and arrow together.
            */}
            <TooltipContent side="bottom" sideOffset={8} collisionPadding={12}>
              {title}
            </TooltipContent>
          </Tooltip>
        ))}
      </DockSurface>
    </TooltipProvider>
  );
}
