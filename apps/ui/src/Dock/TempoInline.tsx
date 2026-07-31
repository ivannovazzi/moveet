import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { ClockState } from "@/types";
import { ClockIcon } from "@/components/Icons";
import { multiplierToSlider } from "./tempoScale";

export interface TempoInlineProps {
  /** Lifted clock state (owned once in `Dock.tsx` — never call `useClock` twice). */
  clock: ClockState;
  /** Whether the Tempo panel is open (drives the button's lit state). */
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Ref forwarded to the button — the Tempo panel anchors to it. */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  /**
   * Tempo drives the live simulation clock, which a replay isn't running on, so
   * the readout goes quiet rather than implying it steers the playback (replay
   * speed lives in the centre slot's replay rail).
   */
  disabled?: boolean;
}

/**
 * The tempo key: the current multiplier as a readout, and the clock that opens
 * the Tempo panel to change it.
 *
 * The inline scrubber that used to live here is gone. It read as a progress bar
 * for a simulation that has no end, it was the only draggable track on a bar of
 * discrete keys, and it made the dock's left half look like a media player. The
 * scale, the presets and the time-of-day readout are all in the panel, one
 * click away, where there is room for them.
 */
export default function TempoInline({
  clock,
  detailsOpen,
  onToggleDetails,
  buttonRef,
  disabled = false,
}: TempoInlineProps) {
  const localRef = useRef<HTMLButtonElement>(null);
  const ref = buttonRef ?? localRef;
  const isRealTime = clock.speedMultiplier === 1;
  // How far up the log scale we are, as a 4-segment gauge beside the number.
  const lit = Math.round((multiplierToSlider(clock.speedMultiplier) / 100) * 4);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggleDetails}
      disabled={disabled}
      aria-expanded={detailsOpen}
      aria-controls="dock-tempo-panel"
      aria-label={`Tempo ${clock.speedMultiplier}×`}
      title={
        disabled
          ? "Tempo applies to the live simulation, not a replay"
          : `Tempo ${clock.speedMultiplier}× — open tempo controls`
      }
      className={cn(
        "group relative flex h-[42px] shrink-0 items-center gap-2 self-center rounded-[10px] px-2.5",
        "transition-[background-color,color,opacity] duration-fast ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "disabled:pointer-events-none disabled:opacity-40",
        "[&_svg]:size-[17px]",
        detailsOpen
          ? "bg-accent/[0.10] text-accent"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      )}
    >
      <ClockIcon />
      <span
        className={cn(
          "font-mono text-[12px] font-semibold tabular-nums",
          isRealTime ? "text-foreground/80" : "text-accent"
        )}
      >
        {clock.speedMultiplier}×
      </span>
      {/* four-segment gauge: how far up the tempo scale the run is */}
      <span aria-hidden className="flex items-end gap-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] rounded-full transition-[background-color,height] duration-normal ease-emphasized",
              i === 0 && "h-[5px]",
              i === 1 && "h-[8px]",
              i === 2 && "h-[11px]",
              i === 3 && "h-[14px]",
              i < lit ? "bg-accent" : "bg-foreground/15"
            )}
          />
        ))}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-[9px] bottom-[3px] h-[2px] rounded-full bg-accent transition-opacity duration-normal",
          detailsOpen ? "opacity-100 shadow-[0_0_8px_var(--color-accent)]" : "opacity-0"
        )}
      />
    </button>
  );
}
