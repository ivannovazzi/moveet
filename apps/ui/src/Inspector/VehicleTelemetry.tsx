import { useMemo } from "react";
import { Sparkline, type SparkPoint } from "@/components/charts";
import { cn } from "@/lib/utils";
import { Eyebrow, Hairline, mono } from "@/Dock/DockPanelKit";
import { formatDuration } from "@/utils/duration";
import { TELEMETRY_CAPACITY, TELEMETRY_SAMPLE_MS, useVehicleTelemetry } from "./telemetry";

/**
 * Live speed + ETA sparklines for the selected vehicle.
 *
 * Isolated as its own component on purpose: it is the only thing in the
 * inspector that re-renders on a timer (1 Hz, see `telemetry.ts`), so the
 * field list and the step list above it stay untouched between samples.
 */
export interface VehicleTelemetryProps {
  vehicleId: string;
}

const WINDOW_SECONDS = Math.round((TELEMETRY_CAPACITY * TELEMETRY_SAMPLE_MS) / 1000);
const SAMPLE_HZ = 1000 / TELEMETRY_SAMPLE_MS;

function Row({ label, chart, value }: { label: string; chart: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-3 px-[15px] py-[5px]">
      <Eyebrow className="w-[34px] shrink-0">{label}</Eyebrow>
      {/* Holds the chart's width even when the series has no readings yet, so
          the value column stays put instead of sliding left. */}
      <div className="flex min-w-0 flex-1 items-center">{chart}</div>
      <span className={cn(mono, "shrink-0 text-meta font-semibold text-foreground")}>{value}</span>
    </div>
  );
}

export default function VehicleTelemetry({ vehicleId }: VehicleTelemetryProps) {
  const samples = useVehicleTelemetry(vehicleId);

  const speedSeries = useMemo<SparkPoint[]>(() => samples.map((s) => s.speed), [samples]);
  const etaSeries = useMemo<SparkPoint[]>(() => samples.map((s) => s.eta), [samples]);

  const latest = samples[samples.length - 1];
  const hasSeries = samples.length >= 2;

  return (
    <div className="shrink-0">
      <Hairline />
      <div className="flex items-baseline justify-between gap-3 px-[15px] pb-[4px] pt-[10px]">
        <Eyebrow>Telemetry</Eyebrow>
        <span className={cn(mono, "text-micro text-muted-foreground/70")}>
          {WINDOW_SECONDS}s · {SAMPLE_HZ} Hz
        </span>
      </div>

      {!hasSeries ? (
        <div className="px-[15px] pb-[10px] pt-[2px] text-meta text-muted-foreground">
          Collecting telemetry…
        </div>
      ) : (
        <div className="pb-[8px]">
          <Row
            label="Spd"
            chart={
              <Sparkline
                data={speedSeries}
                label="Speed over the last minute"
                color="var(--color-status-ok)"
                height={26}
                floor={0}
              />
            }
            value={`${Math.round(latest?.speed ?? 0)} km/h`}
          />
          <Row
            label="ETA"
            chart={
              <Sparkline
                data={etaSeries}
                label="Remaining time to destination over the last minute"
                height={26}
              />
            }
            value={formatDuration(latest?.eta)}
          />
        </div>
      )}
    </div>
  );
}
