import type { TimeOfDay } from "@/types";
import { useClock } from "@/hooks/useClock";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Inputs";
import { Slider } from "@/components/ui/slider";
import { PanelBody, PanelHeader } from "./PanelPrimitives";

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

export default function ClockPanel() {
  const { clock, setSpeedMultiplier } = useClock();

  const timeStr = new Date(clock.currentTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const sliderValue = multiplierToSlider(clock.speedMultiplier);
  const isRealTime = clock.speedMultiplier === 1;

  function handleSliderChange(value: number) {
    setSpeedMultiplier(sliderToMultiplier(value));
  }

  return (
    <>
      <PanelHeader title="Simulation Clock" subtitle="Nairobi Fleet Simulation" />
      <PanelBody className="gap-5">
        <div className="flex flex-col gap-1 pb-2">
          <span className={cn(EYEBROW_BASE, EYEBROW_COLORS[clock.timeOfDay])}>
            {TIME_OF_DAY_LABELS[clock.timeOfDay]}
          </span>
          <div className="font-mono text-5xl font-bold leading-none tracking-tight text-foreground">
            {timeStr}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            SIMULATION SPEED
          </span>
          <Slider
            min={0}
            max={100}
            value={[sliderValue]}
            onValueChange={([v]) => handleSliderChange(v)}
            aria-label="Speed multiplier"
          />
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "text-2xl font-bold leading-none tabular-nums",
                isRealTime ? "text-foreground" : "text-accent"
              )}
            >
              {clock.speedMultiplier}×
            </span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              {speedDescription(clock.speedMultiplier)}
            </span>
          </div>
        </div>

        <div className="grid w-full grid-cols-4 gap-2">
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
      </PanelBody>
    </>
  );
}
