import { useCallback, useId, useMemo, type ReactNode } from "react";
import client from "@/utils/client";
import { Button } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { Eyebrow, StatusDot, mono } from "@/Dock/DockPanelKit";
import { PanelBody, PanelLoadingState, PanelHeader } from "./PanelPrimitives";
import type { AnalyticsSummary, FleetAnalytics } from "@/hooks/analyticsStore";

// ─── Formatting helpers ──────────────────────────────────────────────

function formatSpeed(speed: number): string {
  return speed.toFixed(1);
}

function formatDistance(km: number): string {
  if (km < 1) return km.toFixed(2);
  if (km < 100) return km.toFixed(1);
  return Math.round(km).toLocaleString();
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

const UNIT = "text-[13px] font-normal text-muted-foreground";

// ─── Sparkline ───────────────────────────────────────────────────────

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** A CSS var (accent by default, status-ok for a secondary series). */
  color?: string;
}

/**
 * A considered micro-chart: a faint gradient area fill under the trend line
 * plus an emphasized dot at the latest value, so the spark reads as a chart
 * and not just a squiggle. The dot is a CSS-positioned element (not an SVG
 * circle) so it stays perfectly round under the non-scaling viewBox stretch.
 */
function Sparkline({
  data,
  width = 120,
  height = 40,
  color = "var(--color-accent)",
}: SparklineProps) {
  const gradientId = useId();
  const geom = useMemo(() => {
    if (data.length < 2) return null;

    const xMax = data.length - 1;
    const x0 = 1;
    const x1 = width - 1;
    const xScale = (i: number) => x0 + (i / xMax) * (x1 - x0);

    let lo = data[0];
    let hi = data[0];
    for (const v of data) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi === lo) hi = lo + 1;
    const yBottom = height - 2;
    const yTop = 2;
    const yScale = (v: number) => yBottom + ((v - lo) / (hi - lo)) * (yTop - yBottom);

    const pts = data.map((d, i) => [xScale(i), yScale(d)] as const);
    const line = `M${pts.map((p) => `${p[0]},${p[1]}`).join("L")}`;
    const last = pts[pts.length - 1];
    const area = `${line}L${last[0]},${height}L${pts[0][0]},${height}Z`;

    return {
      line,
      area,
      dotLeft: (last[0] / width) * 100,
      dotTop: (last[1] / height) * 100,
    };
  }, [data, width, height]);

  if (!geom) return null;

  return (
    <div className="relative block min-w-0 flex-1">
      <svg
        className="block w-full overflow-visible"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={geom.area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          className="fill-none [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]"
          d={geom.line}
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="pointer-events-none absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${geom.dotLeft}%`,
          top: `${geom.dotTop}%`,
          backgroundColor: color,
          boxShadow: `0 0 5px ${color}`,
        }}
      />
    </div>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: ReactNode;
  className?: string;
}

/** A bare numeric readout: eyebrow label over a big mono value, no card. */
function Stat({ label, value, className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1.5 px-1 py-2.5", className)}>
      <Eyebrow>{label}</Eyebrow>
      <div
        className={cn(
          mono,
          "text-[21px] font-semibold leading-none tracking-[-0.01em] text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Fleet row ───────────────────────────────────────────────────────

interface FleetCardProps {
  fleetId: string;
  history: FleetAnalytics[];
}

function FleetCard({ fleetId, history }: FleetCardProps) {
  const latest = history[history.length - 1];
  const speedHistory = useMemo(() => history.map((h) => h.avgSpeed), [history]);

  if (!latest) return null;

  return (
    <div className="flex flex-col gap-2.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <StatusDot tone="ok" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
          {fleetId}
        </span>
      </div>
      <div className={cn(mono, "flex gap-4 text-[12px] text-muted-foreground")}>
        <span className="flex items-baseline gap-0.5">
          <span className="font-medium text-foreground">{latest.vehicleCount}</span>
          <span className="text-[10px] text-muted-foreground"> vehicles</span>
        </span>
        <span className="flex items-baseline gap-0.5">
          <span className="font-medium text-foreground">{formatSpeed(latest.avgSpeed)}</span>
          <span className="text-[10px] text-muted-foreground"> km/h</span>
        </span>
        <span className="flex items-baseline gap-0.5">
          <span className="font-medium text-foreground">
            {formatDistance(latest.totalDistance)}
          </span>
          <span className="text-[10px] text-muted-foreground"> km</span>
        </span>
      </div>
      {speedHistory.length >= 2 && (
        <div className="flex items-center gap-3">
          <Eyebrow className="shrink-0">Speed</Eyebrow>
          <Sparkline data={speedHistory} color="var(--color-status-ok)" />
          <span className={cn(mono, "shrink-0 text-[12px] font-semibold text-foreground")}>
            {formatSpeed(latest.avgSpeed)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── AnalyticsPanel ──────────────────────────────────────────────────

interface AnalyticsPanelProps {
  summary: AnalyticsSummary | null;
  fleetHistory: Map<string, FleetAnalytics[]>;
  summaryHistory: AnalyticsSummary[];
}

export default function AnalyticsPanel({
  summary,
  fleetHistory,
  summaryHistory,
}: AnalyticsPanelProps) {
  const handleReset = useCallback(() => {
    client.resetAnalytics();
  }, []);

  const fleetIds = useMemo(() => Array.from(fleetHistory.keys()), [fleetHistory]);

  const speedHistory = useMemo(() => summaryHistory.map((s) => s.avgSpeed), [summaryHistory]);

  if (!summary) {
    return (
      <>
        <PanelHeader title="Analytics" />
        <PanelBody>
          <PanelLoadingState>Waiting for analytics data…</PanelLoadingState>
        </PanelBody>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        title="Analytics"
        subtitle={`${summary.activeVehicles} of ${summary.totalVehicles} vehicles active`}
      />
      <PanelBody className="gap-4">
        <div className="flex justify-end">
          <Button className="h-8 px-4 text-sm" onClick={handleReset} type="button">
            Reset
          </Button>
        </div>

        <div className="grid grid-cols-2">
          <Stat
            label="Vehicles"
            value={
              <>
                {summary.activeVehicles}
                <span className={UNIT}> / {summary.totalVehicles}</span>
              </>
            }
          />
          <Stat
            className="border-l border-border-soft"
            label="Avg Speed"
            value={
              <>
                {formatSpeed(summary.avgSpeed)}
                <span className={UNIT}> km/h</span>
              </>
            }
          />
          <Stat
            className="border-t border-border-soft"
            label="Distance"
            value={
              <>
                {formatDistance(summary.totalDistanceTraveled)}
                <span className={UNIT}> km</span>
              </>
            }
          />
          <Stat
            className="border-l border-t border-border-soft"
            label="Efficiency"
            value={formatPercent(summary.avgRouteEfficiency)}
          />
        </div>

        {speedHistory.length >= 2 && (
          <div>
            <Eyebrow className="mb-2">Speed trend</Eyebrow>
            <div className="flex items-center gap-3">
              <Sparkline data={speedHistory} width={160} height={40} />
              <span className={cn(mono, "shrink-0 text-[13px] font-semibold text-foreground")}>
                {formatSpeed(summary.avgSpeed)}
                <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">km/h</span>
              </span>
            </div>
          </div>
        )}

        {fleetIds.length > 0 && (
          <div>
            <Eyebrow className="mb-1">Fleets</Eyebrow>
            <div className="flex flex-col divide-y divide-border-soft">
              {fleetIds.map((id) => (
                <FleetCard key={id} fleetId={id} history={fleetHistory.get(id) ?? []} />
              ))}
            </div>
          </div>
        )}
      </PanelBody>
    </>
  );
}
