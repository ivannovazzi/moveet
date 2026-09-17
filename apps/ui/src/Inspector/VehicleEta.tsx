import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { EtaBreakdown } from "@/types";
import { useDirectionContext } from "@/data/useData";
import { Eyebrow, Hairline, Tag, mono } from "@/Dock/DockPanelKit";
import { formatArrivalTime, formatDuration } from "@/utils/duration";

/**
 * The selected vehicle's ETA, and the reasons it is what it is.
 *
 * Until now the UI printed a bare number and the whole ETA-accuracy work —
 * learned per-edge speeds, typed node delays, turn penalties, weather — was
 * invisible from the console. This is where those inputs surface.
 *
 * Two different quantities live here on purpose, and they are labelled as such:
 *
 *  - **Remaining** (the headline, and the arrival clock) comes off the vehicle
 *    sample, recomputed by the simulator every tick from where the vehicle is
 *    on its route.
 *  - **Composition** describes the WHOLE route, priced once when it was
 *    assigned. It does not shrink as the vehicle drives; it answers "what is
 *    this trip made of", not "what is left".
 *
 * Reads the shared direction context rather than calling `useDirections`, so it
 * registers no second set of socket listeners (same reasoning as
 * `VehicleDirections`).
 */
export interface VehicleEtaProps {
  vehicleId: string;
  /** Live remaining-route ETA in seconds, straight off the vehicle sample. */
  etaSeconds?: number;
}

/** The three parts of a route's time, in the order they are stacked and listed. */
const PARTS = [
  {
    key: "drivingSeconds",
    label: "Driving",
    hint: "Moving along the route, at learned or free-flow edge speeds",
    bar: "bg-status-ok",
    dot: "bg-status-ok",
  },
  {
    key: "nodeDelaySeconds",
    label: "Stops",
    hint: "Waiting at signals, stop signs, give-ways and crossings",
    bar: "bg-status-warn",
    dot: "bg-status-warn",
  },
  {
    key: "turnSeconds",
    label: "Turns",
    hint: "Turn manoeuvres between consecutive road segments",
    bar: "bg-primary",
    dot: "bg-primary",
  },
] as const satisfies readonly {
  key: keyof EtaBreakdown;
  label: string;
  hint: string;
  bar: string;
  dot: string;
}[];

/** Weather factor → a short phrase, because "0.82" alone says nothing. */
function weatherLabel(factor: number): string {
  const slowdown = Math.round((1 - factor) * 100);
  return slowdown <= 0 ? "No effect" : `${slowdown}% slower`;
}

export default function VehicleEta({ vehicleId, etaSeconds }: VehicleEtaProps) {
  const { directions } = useDirectionContext();
  const direction = directions.get(vehicleId);
  const breakdown = direction?.etaBreakdown;

  const segments = useMemo(() => {
    if (!breakdown) return [];
    const total = breakdown.drivingSeconds + breakdown.nodeDelaySeconds + breakdown.turnSeconds;
    if (total <= 0) return [];
    return PARTS.map((part) => {
      const seconds = breakdown[part.key] as number;
      return { ...part, seconds, share: seconds / total };
    });
  }, [breakdown]);

  if (!direction) {
    return (
      <div className="shrink-0">
        <Hairline />
        <div className="px-[15px] pb-[10px] pt-[10px]">
          <Eyebrow>ETA</Eyebrow>
          {/* Deliberately not the Directions section's "No active route." —
              two sections repeating the same sentence reads as a rendering
              bug rather than as two honest empty states. */}
          <div className="mt-1 text-meta text-muted-foreground">No route assigned.</div>
        </div>
      </div>
    );
  }

  const learnedPct = breakdown ? Math.round(breakdown.learnedDistanceShare * 100) : 0;
  const weatherFactor = breakdown?.weatherFactor ?? 1;

  return (
    <div className="shrink-0">
      <Hairline />
      <div className="flex items-baseline justify-between gap-3 px-[15px] pb-[6px] pt-[10px]">
        <Eyebrow>ETA</Eyebrow>
        {breakdown && (
          // The confidence signal: how much of this route's distance was priced
          // from observed traversals rather than from OSM speed limits.
          <Tag tone={learnedPct >= 50 ? "ok" : learnedPct > 0 ? "warn" : "idle"}>
            {learnedPct > 0 ? `${learnedPct}% learned` : "Free-flow only"}
          </Tag>
        )}
      </div>

      {/* Arrival first, duration second: an operator reads a wall clock. */}
      <div className="flex items-baseline justify-between gap-3 px-[15px] pb-[9px]">
        <span className={cn(mono, "text-title font-semibold text-foreground")}>
          {formatArrivalTime(etaSeconds)}
        </span>
        <span className={cn(mono, "text-meta text-muted-foreground")}>
          in <span className="font-semibold text-foreground">{formatDuration(etaSeconds)}</span>
        </span>
      </div>

      {segments.length > 0 && (
        <>
          {/* One bar, three segments — the route's time budget at a glance. */}
          <div
            className="mx-[15px] mb-[8px] flex h-[5px] overflow-hidden rounded-full bg-border-soft"
            role="img"
            aria-label={`Route time composition: ${segments
              .map((s) => `${s.label} ${formatDuration(s.seconds, "none")}`)
              .join(", ")}`}
          >
            {segments.map((segment) => (
              <span
                key={segment.key}
                className={cn("h-full", segment.bar)}
                style={{ width: `${segment.share * 100}%` }}
              />
            ))}
          </div>

          <dl className="px-[15px] pb-[10px]">
            <div className="flex items-baseline justify-between gap-3 pb-[3px]">
              <dt className="text-micro uppercase tracking-[0.14em] text-muted-foreground/70">
                Whole route
              </dt>
              <dd className={cn(mono, "text-micro text-muted-foreground/70")}>
                {formatDuration(direction.eta)}
              </dd>
            </div>
            {segments.map((segment) => (
              <div
                key={segment.key}
                className="flex items-baseline justify-between gap-3 py-[2px]"
                title={segment.hint}
              >
                <dt className="flex items-center gap-1.5 text-meta text-foreground/90">
                  <span className={cn("size-[6px] shrink-0 rounded-full", segment.dot)} />
                  {segment.label}
                </dt>
                <dd className={cn(mono, "text-meta text-muted-foreground")}>
                  {formatDuration(segment.seconds, "0 s")}
                </dd>
              </div>
            ))}
            <div
              className="flex items-baseline justify-between gap-3 py-[2px]"
              title="Global weather speed multiplier applied to driving time"
            >
              <dt className="flex items-center gap-1.5 text-meta text-foreground/90">
                <span className="size-[6px] shrink-0 rounded-full bg-muted-foreground/50" />
                Weather
              </dt>
              <dd
                className={cn(
                  mono,
                  "text-meta",
                  weatherFactor < 1 ? "text-status-warn" : "text-muted-foreground"
                )}
              >
                {weatherLabel(weatherFactor)}
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
