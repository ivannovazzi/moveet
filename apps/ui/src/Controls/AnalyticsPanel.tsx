import { useCallback, useMemo } from "react";
import * as d3 from "d3";
import client from "@/utils/client";
import { Button } from "@/components/Inputs";
import { PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import type { AnalyticsSummary, FleetAnalytics } from "@/hooks/analyticsStore";
import styles from "./AnalyticsPanel.module.css";

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

    const xScale = d3
      .scaleLinear()
      .domain([0, data.length - 1])
      .range([1, width - 1]);

    const yExtent = d3.extent(data) as [number, number];
    // Add a small padding so the line doesn't clip
    const yMin = yExtent[0];
    const yMax = yExtent[1] === yMin ? yMin + 1 : yExtent[1];

    const yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([height - 2, 2]);

    const lineGenerator = d3
      .line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d));

    return lineGenerator(data) ?? "";
  }, [data, width, height]);

  if (data.length < 2) return null;

  return (
    <svg
      className={styles.sparkline}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path className={styles.sparklinePath} d={pathD} stroke={color} />
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
    <div className={styles.kpiCard}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>
        {value}
        {total != null && <span className={styles.kpiTotal}> / {total}</span>}
        {unit && <span className={styles.kpiUnit}>{unit}</span>}
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
    <div className={styles.fleetCard}>
      <div className={styles.fleetCardHeader}>
        <span className={styles.fleetDot} style={{ backgroundColor: "#4f9" }} />
        <span className={styles.fleetName}>{fleetId}</span>
      </div>
      <div className={styles.fleetStats}>
        <span className={styles.fleetStat}>
          <span className={styles.fleetStatValue}>{latest.vehicleCount}</span>
          <span className={styles.fleetStatUnit}> vehicles</span>
        </span>
        <span className={styles.fleetStat}>
          <span className={styles.fleetStatValue}>{formatSpeed(latest.avgSpeed)}</span>
          <span className={styles.fleetStatUnit}> km/h</span>
        </span>
        <span className={styles.fleetStat}>
          <span className={styles.fleetStatValue}>{formatDistance(latest.totalDistance)}</span>
          <span className={styles.fleetStatUnit}> km</span>
        </span>
      </div>
      {speedHistory.length >= 2 && (
        <div className={styles.sparklineRow}>
          <span className={styles.sparklineLabel}>Speed</span>
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
          <PanelEmptyState>Waiting for analytics data...</PanelEmptyState>
        </PanelBody>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        title="Analytics"
        subtitle={`${summary.activeVehicles} of ${summary.totalVehicles} vehicles active`}
        actions={
          <Button className={styles.resetButton} onClick={handleReset} type="button">
            Reset
          </Button>
        }
      />
      <PanelBody className={styles.body}>
        <div className={styles.summary}>
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
          <div className={styles.sparklineRow}>
            <span className={styles.sparklineLabel}>Speed trend</span>
            <Sparkline data={speedHistory} width={160} height={40} color="#39f" />
          </div>
        )}

        {fleetIds.length > 0 && (
          <div className={styles.fleetSection}>
            <span className={styles.fleetSectionLabel}>Fleets</span>
            <div className={styles.fleetList}>
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
