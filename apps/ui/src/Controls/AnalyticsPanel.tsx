import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/Inputs";
import {
  SeriesTable,
  SmallMultiples,
  Sparkline,
  StatTile,
  type FacetSeries,
  type StatDelta,
} from "@/components/charts";
import { Eyebrow, SegTabs, StatusDot, Tag, mono, type SegTab } from "@/Dock/DockPanelKit";
import type { AnalyticsHistoryMeta } from "@moveet/shared-types";
import type { AnalyticsSummary, FleetAnalytics } from "@/hooks/analyticsStore";
import {
  ANALYTICS_RANGES,
  describeAggregation,
  useAnalyticsSeries,
  type AnalyticsHistoryFetcher,
  type AnalyticsRange,
} from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import {
  PanelBody,
  PanelEmptyState,
  PanelErrorState,
  PanelHeader,
  PanelLoadingState,
} from "./PanelPrimitives";

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

/** Axis-grade formatters: short enough for a 34px y gutter. */
const axisCount = (v: number) => String(Math.round(v));
const axisSpeed = (v: number) => v.toFixed(1);
const axisDistance = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(1);
const axisPercent = (v: number) => (v * 100).toFixed(0);

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  live: "Live",
  "1h": "1h",
  "6h": "6h",
  "24h": "24h",
};

const RANGE_TABS: SegTab<AnalyticsRange>[] = ANALYTICS_RANGES.map((r) => ({
  value: r,
  label: RANGE_LABEL[r],
}));

/** Trend samples shown in a KPI tile's sparkline. */
const SPARK_POINTS = 24;

/**
 * Why the plotted window is narrower than the one that was asked for.
 *
 * The simulator answers a limited query from the RECENT end, so whatever it
 * dropped is always older than the first point on the chart. Saying so beats
 * silently drawing a range that does not start where the tab claims it does.
 */
function truncationDetail(meta: AnalyticsHistoryMeta): string {
  const omitted = meta.omitted.toLocaleString();
  const start = meta.coveredFrom ? new Date(meta.coveredFrom).toLocaleString() : null;
  return [
    `The stored window holds more than this query could read: ${omitted} older samples were left out.`,
    start ? `The series starts at ${start} rather than at the start of the range.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function tail(values: number[], count: number): number[] {
  return values.length > count ? values.slice(-count) : values;
}

/** Change across the visible window, formatted with the measure's own unit. */
function windowDelta(
  values: number[],
  format: (v: number) => string,
  polarity: StatDelta["polarity"],
  since: string
): StatDelta | null {
  if (values.length < 2) return null;
  const change = values[values.length - 1] - values[0];
  return { value: change, text: format(Math.abs(change)), polarity, since };
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
    <div className="flex flex-col gap-2.5 py-2.5" data-testid={`fleet-${fleetId}`}>
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
          <Sparkline data={speedHistory} height={24} />
          <span className={cn(mono, "shrink-0 text-[12px] font-semibold text-foreground")}>
            {formatSpeed(latest.avgSpeed)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── AnalyticsPanel ──────────────────────────────────────────────────

export interface AnalyticsPanelProps {
  summary: AnalyticsSummary | null;
  fleetHistory: Map<string, FleetAnalytics[]>;
  summaryHistory: AnalyticsSummary[];
  /**
   * Persisted-history source. Defaults to `GET /analytics/history` on the
   * simulator; injected in tests and swappable if the series ever moves behind
   * a different endpoint.
   */
  fetchHistory?: AnalyticsHistoryFetcher;
}

export default function AnalyticsPanel({
  summary,
  fleetHistory,
  summaryHistory,
  fetchHistory,
}: AnalyticsPanelProps) {
  const [range, setRange] = useState<AnalyticsRange>("live");
  const [view, setView] = useState<"chart" | "table">("chart");

  const series = useAnalyticsSeries({
    range,
    summary,
    summaryHistory,
    fleetHistory,
    fetchHistory,
  });

  const handleReset = useCallback(() => {
    client.resetAnalytics();
  }, []);

  const { summaries, latest, status, bucket, truncated, meta } = series;

  const timestamps = useMemo(() => summaries.map((s) => s.timestamp), [summaries]);

  const columns = useMemo<{
    speed: number[];
    active: number[];
    distance: number[];
    efficiency: number[];
  }>(
    () => ({
      active: summaries.map((s) => s.activeVehicles),
      speed: summaries.map((s) => s.avgSpeed),
      distance: summaries.map((s) => s.totalDistanceTraveled),
      efficiency: summaries.map((s) => s.avgRouteEfficiency),
    }),
    [summaries]
  );

  /**
   * One facet per measure over the shared time axis. Four single-series plots
   * rather than one plot with four y scales — measures this different (a count,
   * a rate, a cumulative distance, a ratio) share no axis honestly.
   */
  const facets = useMemo<FacetSeries[]>(
    () => [
      {
        id: "active",
        label: "Active vehicles",
        unit: "veh",
        values: columns.active,
        format: axisCount,
        hint: describeAggregation("activeVehicles", bucket),
      },
      {
        id: "speed",
        label: "Avg speed",
        unit: "km/h",
        values: columns.speed,
        format: axisSpeed,
        hint: describeAggregation("avgSpeed", bucket),
      },
      {
        id: "distance",
        label: "Distance travelled",
        unit: "km",
        values: columns.distance,
        format: axisDistance,
        hint: describeAggregation("totalDistanceTraveled", bucket),
      },
      {
        id: "efficiency",
        label: "Route efficiency",
        unit: "%",
        values: columns.efficiency,
        format: axisPercent,
        hint: describeAggregation("avgRouteEfficiency", bucket),
      },
    ],
    [columns, bucket]
  );

  const sinceLabel = range === "live" ? "over window" : `over ${RANGE_LABEL[range]}`;
  const fleetIds = useMemo(() => Array.from(series.fleetHistory.keys()), [series.fleetHistory]);

  const subtitle = latest
    ? `${latest.activeVehicles} of ${latest.totalVehicles} vehicles active`
    : undefined;

  return (
    <>
      <PanelHeader title="Analytics" subtitle={subtitle} />
      <PanelBody className="gap-4">
        {/* One filter row, above everything it scopes: the range drives the
            stats, the charts and the table alike. */}
        <div className="flex flex-col gap-2">
          <SegTabs
            tabs={RANGE_TABS}
            value={range}
            onChange={setRange}
            ariaLabel="Analytics time range"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="truncate text-[10px] text-muted-foreground"
                title={
                  bucket
                    ? `Aggregated server-side into ${bucket.label} buckets from ${bucket.sampleCount.toLocaleString()} stored samples. Rates and counts are bucket means; cumulative totals keep the last value in each bucket.`
                    : undefined
                }
              >
                {series.source === "live" ? "In-memory window" : "Stored history"}
                {summaries.length > 0 ? ` · ${summaries.length} samples` : ""}
                {bucket ? ` · ${bucket.label} buckets` : ""}
              </span>
              {truncated && meta ? (
                <span
                  className="shrink-0"
                  data-testid="analytics-truncated"
                  title={truncationDetail(meta)}
                >
                  <Tag tone="warn">Clipped</Tag>
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5" role="group" aria-label="Analytics view">
                {(["chart", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10.5px] font-medium capitalize",
                      "transition-colors duration-fast ease-standard",
                      view === v
                        ? "bg-foreground/[0.06] text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <Button className="h-7 px-3 text-xs" onClick={handleReset} type="button">
                Reset
              </Button>
            </div>
          </div>
        </div>

        {status === "error" ? (
          <PanelErrorState>{series.message ?? "Could not load analytics history."}</PanelErrorState>
        ) : null}

        {status === "unavailable" ? (
          <PanelEmptyState>
            {series.message} Switch to <strong className="font-medium">Live</strong> to read the
            in-memory window instead.
          </PanelEmptyState>
        ) : null}

        {status === "loading" ? (
          <PanelLoadingState>{series.message ?? "Loading analytics…"}</PanelLoadingState>
        ) : null}

        {latest ? (
          <div className="grid grid-cols-2 divide-x divide-y divide-border-soft [&>*:nth-child(-n+2)]:border-t-0 [&>*:nth-child(odd)]:border-l-0">
            <StatTile
              label="Vehicles"
              value={latest.activeVehicles}
              unit={`/ ${latest.totalVehicles}`}
              delta={windowDelta(columns.active, axisCount, "neutral", sinceLabel)}
              trend={tail(columns.active, SPARK_POINTS)}
            />
            <StatTile
              label="Avg Speed"
              value={formatSpeed(latest.avgSpeed)}
              unit="km/h"
              delta={windowDelta(columns.speed, axisSpeed, "up-is-good", sinceLabel)}
              trend={tail(columns.speed, SPARK_POINTS)}
            />
            <StatTile
              label="Distance"
              value={formatDistance(latest.totalDistanceTraveled)}
              unit="km"
              delta={windowDelta(columns.distance, axisDistance, "neutral", sinceLabel)}
              trend={tail(columns.distance, SPARK_POINTS)}
            />
            <StatTile
              label="Efficiency"
              value={formatPercent(latest.avgRouteEfficiency)}
              delta={windowDelta(
                columns.efficiency,
                (v) => `${axisPercent(v)}pp`,
                "up-is-good",
                sinceLabel
              )}
              trend={tail(columns.efficiency, SPARK_POINTS)}
            />
          </div>
        ) : null}

        {status === "collecting" ? <PanelEmptyState>{series.message}</PanelEmptyState> : null}

        {status === "ready" && view === "chart" ? (
          <SmallMultiples title="Fleet over time" timestamps={timestamps} series={facets} />
        ) : null}

        {status === "ready" && view === "table" ? (
          <section>
            <Eyebrow className="mb-1">Fleet over time</Eyebrow>
            <SeriesTable
              timestamps={timestamps}
              series={facets}
              caption="Fleet analytics samples over the selected range"
            />
          </section>
        ) : null}

        {fleetIds.length > 0 && (
          <div>
            <Eyebrow className="mb-1">Fleets</Eyebrow>
            <div className="flex flex-col divide-y divide-border-soft">
              {fleetIds.map((id) => (
                <FleetCard key={id} fleetId={id} history={series.fleetHistory.get(id) ?? []} />
              ))}
            </div>
          </div>
        )}
      </PanelBody>
    </>
  );
}
