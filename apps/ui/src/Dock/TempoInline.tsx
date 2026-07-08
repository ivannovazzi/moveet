import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { ClockState } from "@/types";
import { Slider } from "@/components/ui/slider";
import { ClockIcon } from "@/components/Icons";
import DockCluster from "./DockCluster";
import { multiplierToSlider, sliderToMultiplier } from "./tempoScale";

export interface TempoInlineProps {
  /** Lifted clock state (owned once in `Dock.tsx` — never call `useClock` twice). */
  clock: ClockState;
  onSetMultiplier: (multiplier: number) => void;
  /** Whether the Tempo details panel is open (drives the clock button state). */
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Ref forwarded to the clock button (the panel's outside-click anchor). */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * The always-visible tempo control living in the dock bar: a compact log-scale
 * scrubber plus the current multiplier, and a clock button that opens the
 * Tempo details panel. The scrubber never needs a click to reveal or adjust —
 * per the design, tempo is touched constantly.
 */
export default function TempoInline({
  clock,
  onSetMultiplier,
  detailsOpen,
  onToggleDetails,
  buttonRef,
}: TempoInlineProps) {
  const localRef = useRef<HTMLButtonElement>(null);
  const ref = buttonRef ?? localRef;
  const sliderValue = multiplierToSlider(clock.speedMultiplier);
  const isRealTime = clock.speedMultiplier === 1;

  return (
    <div className="flex items-center gap-[9px] px-1.5">
      <div className="w-[78px]">
        <Slider
          min={0}
          max={100}
          value={[sliderValue]}
          onValueChange={([v]) => onSetMultiplier(sliderToMultiplier(v))}
          aria-label="Simulation tempo"
        />
      </div>
      <span
        className={cn(
          "min-w-[34px] font-mono text-[12px] font-semibold tabular-nums",
          isRealTime ? "text-muted-foreground" : "text-accent"
        )}
      >
        {clock.speedMultiplier}×
      </span>
      <DockCluster
        ref={ref}
        icon={<ClockIcon />}
        active={detailsOpen}
        aria-label="Tempo details"
        title="Tempo details"
        className="min-w-0 px-2"
        onClick={onToggleDetails}
      />
    </div>
  );
}
