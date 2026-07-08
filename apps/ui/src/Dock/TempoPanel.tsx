import type { ClockState, TimeOfDay } from "@/types";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Eyebrow, Hairline, PanelHead, mono } from "./DockPanelKit";
import {
  SPEED_PRESETS,
  multiplierToSlider,
  sliderToMultiplier,
  speedDescription,
} from "./tempoScale";

export interface TempoPanelProps {
  /** Lifted clock state (owned once in `Dock.tsx`). */
  clock: ClockState;
  onSetMultiplier: (multiplier: number) => void;
}

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning_rush: "Morning Rush",
  midday: "Midday",
  evening_rush: "Evening Rush",
  night: "Night",
};

/** Time-of-day eyebrow tint: rush hours warn, night accent, midday neutral. */
const TIME_OF_DAY_TONE: Record<TimeOfDay, string> = {
  morning_rush: "text-status-warn",
  midday: "text-muted-foreground",
  evening_rush: "text-status-warn",
  night: "text-accent",
};

/**
 * Tempo details panel (mockup `panels.tempo`): a big monospace multiplier with
 * its human phrasing on the left, a time-of-day eyebrow + big clock readout on
 * the right, a full-width log-scale scrubber, and the four speed presets.
 * Clock state is lifted in `Dock.tsx` — this panel never calls `useClock`.
 */
export default function TempoPanel({ clock, onSetMultiplier }: TempoPanelProps) {
  const sliderValue = multiplierToSlider(clock.speedMultiplier);
  const timeStr = new Date(clock.currentTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <>
      <PanelHead eyebrow="Simulation Tempo" title="Event pacing" />
      <Hairline />
      <div className="flex flex-col gap-[15px] p-[15px]">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div
              className={cn(
                mono,
                "text-[34px] font-semibold leading-[0.9] tracking-[-0.02em] text-foreground"
              )}
            >
              {clock.speedMultiplier}
              <span className="text-[15px] font-medium text-muted-foreground">×</span>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {speedDescription(clock.speedMultiplier)}
            </div>
          </div>
          <div className="text-right">
            <Eyebrow className={TIME_OF_DAY_TONE[clock.timeOfDay]}>
              {TIME_OF_DAY_LABELS[clock.timeOfDay]}
            </Eyebrow>
            <div
              className={cn(
                mono,
                "mt-[3px] text-[26px] font-semibold leading-none text-foreground"
              )}
            >
              {timeStr}
            </div>
          </div>
        </div>

        <Slider
          min={0}
          max={100}
          value={[sliderValue]}
          onValueChange={([v]) => onSetMultiplier(sliderToMultiplier(v))}
          aria-label="Simulation tempo"
        />

        <div className="grid grid-cols-4 gap-1.5">
          {SPEED_PRESETS.map((preset) => {
            const active = clock.speedMultiplier === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => onSetMultiplier(preset)}
                className={cn(
                  mono,
                  "rounded-[7px] border py-[7px] text-[12px] font-semibold",
                  "transition-[color,background-color,box-shadow] duration-fast ease-standard",
                  active
                    ? "border-transparent surface-accent text-white shadow-glow-accent"
                    : "border-border-soft bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                )}
              >
                {preset}×
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
