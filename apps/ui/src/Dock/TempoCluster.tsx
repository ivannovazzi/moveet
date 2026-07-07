import { useCallback, useRef } from "react";
import type { TimeOfDay } from "@/types";
import { useClock } from "@/hooks/useClock";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Inputs";
import { Slider } from "@/components/ui/slider";
import { ClockIcon } from "@/components/Icons";
import DockCluster from "./DockCluster";
import DockDrawer from "./DockDrawer";

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning_rush: "Morning Rush",
  midday: "Midday",
  evening_rush: "Evening Rush",
  night: "Night",
};

const EYEBROW_BASE = "text-xs font-bold uppercase tracking-[0.08em]";
const EYEBROW_COLORS: Record<TimeOfDay, string> = {
  morning_rush: "text-status-warn",
  midday: "text-muted-foreground",
  evening_rush: "text-status-warn",
  night: "text-accent",
};

const SPEED_PRESETS = [
  { label: "1×", value: 1 },
  { label: "60×", value: 60 },
  { label: "360×", value: 360 },
  { label: "3600×", value: 3600 },
];

const MAX_MULTIPLIER = 3600;
const LOG_MAX = Math.log10(MAX_MULTIPLIER);

/** Log-scale slider <-> multiplier conversion, ported from `Controls/ClockPanel.tsx`. */
function multiplierToSlider(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return Math.round((Math.log10(Math.max(1, multiplier)) / LOG_MAX) * 100);
}

function sliderToMultiplier(slider: number): number {
  if (slider <= 0) return 1;
  return Math.round(Math.pow(10, (slider / 100) * LOG_MAX));
}

function speedDescription(multiplier: number): string {
  if (multiplier === 1) return "real-time";
  if (multiplier === 60) return "1 sim-min per second";
  if (multiplier === 3600) return "1 sim-hour per second";
  if (multiplier % 3600 === 0) return `${multiplier / 3600} sim-hours per second`;
  if (multiplier % 60 === 0) return `${multiplier / 60} sim-mins per second`;
  return `${multiplier}× speed`;
}

export interface TempoClusterProps {
  /** Whether this cluster's drawer (description + presets) is open. */
  isOpen: boolean;
  /** Toggles the drawer open/closed; wired to the cluster button's click. */
  onToggle: () => void;
  /** Closes the drawer (outside click / Esc, via `DockDrawer`). */
  onClose: () => void;
}

/**
 * Tempo dock cluster: the event-pacing scrubber, promoted from
 * `Controls/ClockPanel.tsx`'s hidden panel to a persistent, always-visible
 * inline control per the design doc. The log-scale slider itself renders
 * directly in the dock (no click needed to reveal or adjust it); the time
 * readout, time-of-day eyebrow, and the four presets — content that doesn't
 * fit inline — live in a `DockDrawer` opened by the cluster button.
 *
 * Self-contained: calls `useClock()` itself, exactly as `ClockPanel.tsx`
 * does (that hook owns no exclusive WS lifecycle — it's safe to mount
 * anywhere).
 */
export default function TempoCluster({ isOpen, onToggle, onClose }: TempoClusterProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { clock, setSpeedMultiplier } = useClock();

  const sliderValue = multiplierToSlider(clock.speedMultiplier);
  const isRealTime = clock.speedMultiplier === 1;

  const handleSliderChange = useCallback(
    (value: number) => setSpeedMultiplier(sliderToMultiplier(value)),
    [setSpeedMultiplier]
  );

  const timeStr = new Date(clock.currentTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="relative flex items-center gap-2">
      <div className="flex w-24 flex-col items-center gap-1 px-1">
        <Slider
          min={0}
          max={100}
          value={[sliderValue]}
          onValueChange={([v]) => handleSliderChange(v)}
          aria-label="Simulation speed multiplier"
        />
        <span
          className={cn(
            "text-[10px] font-semibold leading-none tabular-nums",
            isRealTime ? "text-muted-foreground" : "text-accent"
          )}
        >
          {clock.speedMultiplier}×
        </span>
      </div>

      <DockCluster
        ref={triggerRef}
        icon={<ClockIcon />}
        label="Tempo"
        active={isOpen}
        aria-label="Tempo details"
        onClick={onToggle}
      />

      <DockDrawer
        open={isOpen}
        onClose={onClose}
        anchorRef={triggerRef}
        align="center"
        aria-label="Tempo details"
        className="w-72 p-4"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className={cn(EYEBROW_BASE, EYEBROW_COLORS[clock.timeOfDay])}>
              {TIME_OF_DAY_LABELS[clock.timeOfDay]}
            </span>
            <div className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">
              {timeStr}
            </div>
            <span className="text-xs text-muted-foreground">
              {speedDescription(clock.speedMultiplier)}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {SPEED_PRESETS.map(({ label, value }) => (
              <Button
                key={value}
                variant={clock.speedMultiplier === value ? "default" : "outline"}
                size="sm"
                className="text-xs font-semibold"
                onClick={() => setSpeedMultiplier(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </DockDrawer>
    </div>
  );
}
