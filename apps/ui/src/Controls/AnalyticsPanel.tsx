import { useCallback, useMemo } from "react";
import client from "@/utils/client";
import { Button } from "@/components/Inputs";
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

// ─── Sparkline ───────────────────────────────────────────────────────

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

function Sparkline({ data, width = 120, height = 40, color = "#4f9" }: SparklineProps) {
  const pathD = useMemo(() => {
    if (data.length < 2) return "";

    const xMin = 0;
    const xMax = data.length - 1;
    const xRange0 = 1;
    const xRange1 = width - 1;
    const xScale = (v: number) => xRange0 + ((v - xMin) / (xMax - xMin)) * (xRange1 - xRange0);

    let yMinVal = data[0];
    let yMaxVal = data[0];
    for (const v of data) {
      if (v < yMinVal) yMinVal = v;
      if (v > yMaxVal) yMaxVal = v;
    }
    if (yMaxVal === yMinVal) yMaxVal = yMinVal + 1;
    const yRange0 = height - 2;
    const yRange1 = 2;
    const yScale = (v: number) =>
      yRange0 + ((v - yMinVal) / (yMaxVal - yMinVal)) * (yRange1 - yRange0);

    const points = data.map((d, i) => `${xScale(i)},${yScale(d)}`);
    return `M${points.join("L")}`;
  }, [data, width, height]);

  if (data.length < 2) return null;

  return (
    <svg
      className="block min-w-0 flex-1 overflow-visible"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        className="fill-none [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]"
        d={pathD}
        stroke={color}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  total?: number;
  unit?: string;
}

function KpiCard({ label, value, total, unit }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-4 transition-colors hover:bg-accent/10">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums text-foreground">
        {value}
        {total != null && (
          <span className="text-sm font-normal text-muted-foreground"> / {total}</span>
        )}
        {unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

// ─── Fleet Card ──────────────────────────────────────────────────────

interface FleetCardProps {
  fleetId: string;
  history: FleetAnalytics[];
}

function FleetCard({ fleetId, history }: FleetCardProps) {
  const latest = history[history.length - 1];
  const speedHistory = useMemo(() => history.map((h) => h.avgSpeed), [history]);

  if (!latest) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:bg-accent/10">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: "#4f9" }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {fleetId}
        </span>
      </div>
      <div className="flex gap-4 text-sm tabular-nums text-muted-foreground">
        <span className="flex items-baseline gap-0.5">
          <span className="font-medium text-foreground">{latest.vehicleCount}</span>
          <span className="text-xs text-muted-foreground"> vehicles</span>
        </span>
        <span className="flex items-baseline gap-0.5">
          <span className="font-medium text-foreground">{formatSpeed(latest.avgSpeed)}</span>
          <span className="text-xs text-muted-foreground"> km/h</span>
        </span>
        <span className="flex items-baseline gap-0.5">
          <span className="font-medium text-foreground">
            {formatDistance(latest.totalDistance)}
          </span>
          <span className="text-xs text-muted-foreground"> km</span>
        </span>
      </div>
      {speedHistory.length >= 2 && (
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-xs text-muted-foreground">Speed</span>
          <Sparkline data={speedHistory} color="#4f9" />
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
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Vehicles" value={summary.activeVehicles} total={summary.totalVehicles} />
          <KpiCard label="Avg Speed" value={formatSpeed(summary.avgSpeed)} unit="km/h" />
          <KpiCard
            label="Distance"
            value={formatDistance(summary.totalDistanceTraveled)}
            unit="km"
          />
          <KpiCard label="Efficiency" value={formatPercent(summary.avgRouteEfficiency)} />
        </div>

        {speedHistory.length >= 2 && (
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap text-xs text-muted-foreground">Speed trend</span>
            <Sparkline data={speedHistory} width={160} height={40} color="#39f" />
          </div>
        )}

        {fleetIds.length > 0 && (
          <div className="mt-3">
            <span className="mb-3 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fleets
            </span>
            <div className="flex flex-col gap-3">
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
