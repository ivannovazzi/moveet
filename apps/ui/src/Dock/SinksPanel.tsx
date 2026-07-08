import { useState } from "react";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import SourceTab from "@/Controls/Adapter/SourceTab";
import SinksTab from "@/Controls/Adapter/SinksTab";
import RealismTab from "@/Controls/Adapter/RealismTab";
import {
  HealthChip,
  Hairline,
  PanelHead,
  PanelScroll,
  SegTabs,
  type StatusTone,
} from "./DockPanelKit";

// The dense row primitives moved to the kit (shared with Monitor/Incidents).
// Re-exported here so the Adapter tabs' existing `@/Dock/SinksPanel` imports
// keep resolving without churn.
export { LRow, LList, Tag } from "./DockPanelKit";
export type { SevTone } from "./DockPanelKit";

export interface SinksPanelProps {
  /** Full result of the lifted `useAdapterConfig` (owned once in `Dock.tsx`,
   * so the health dot keeps polling while the panel is closed). */
  adapter: ReturnType<typeof useAdapterConfig>;
}

type Tab = "source" | "sinks" | "realism";

/**
 * Coarse, user-facing health readout — same four-state derivation as the
 * pre-redesign `SinksSourceDrawer` (a friendlier readout than the hook's
 * 3-state `AdapterStatus`).
 */
type DrawerStatus = "Healthy" | "Needs attention" | "Unconfigured" | "Unreachable";

const STATUS_TONE: Record<DrawerStatus, StatusTone> = {
  Healthy: "ok",
  "Needs attention": "warn",
  Unconfigured: "idle",
  Unreachable: "idle",
};

/**
 * Sinks & Source panel: the Data Pipeline instrument in the redesigned dock.
 * Renders into the shared morphing `DockPanel` surface (no width/position of
 * its own). Consumes the lifted `useAdapterConfig` result — never calls the
 * hook — so health keeps polling while the panel is closed.
 */
export default function SinksPanel({ adapter }: SinksPanelProps) {
  const { health, config, loading, error, setSource, addSink, removeSink, setRealism } = adapter;
  const [tab, setTab] = useState<Tab>("source");

  const status: DrawerStatus = !health
    ? "Unreachable"
    : !health.source && health.sinks.length === 0
      ? "Unconfigured"
      : health.source?.healthy !== false && health.sinks.every((sink) => sink.healthy)
        ? "Healthy"
        : "Needs attention";

  return (
    <div aria-busy={loading}>
      <PanelHead
        eyebrow="Data Pipeline"
        title="Connections"
        right={<HealthChip tone={STATUS_TONE[status]}>{status}</HealthChip>}
      />
      <Hairline />

      <SegTabs<Tab>
        ariaLabel="Data pipeline sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "source", label: "Source" },
          { value: "sinks", label: "Sinks", count: health?.sinks.length ?? 0 },
          { value: "realism", label: "Realism" },
        ]}
      />

      {loading && (
        <div className="mx-[15px] h-0.5 animate-pulse rounded-full bg-accent" aria-hidden />
      )}

      {error && (
        <div className="mx-3 mb-1 rounded-md border border-status-error/40 bg-status-error/10 px-2 py-1.5 text-[11.5px] text-status-error">
          {error}
        </div>
      )}

      <PanelScroll>
        {loading && !config ? (
          <div className="flex flex-col gap-2 p-3">
            <div className="h-14 animate-pulse rounded-md bg-muted" />
            <div className="h-14 animate-pulse rounded-md bg-muted" />
            <div className="h-14 animate-pulse rounded-md bg-muted" />
          </div>
        ) : !health ? (
          <div className="m-3 rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-[11.5px] text-muted-foreground">
            Adapter service is unreachable. Check the connection settings and try again.
          </div>
        ) : tab === "source" ? (
          <SourceTab health={health} config={config} loading={loading} onConnect={setSource} />
        ) : tab === "sinks" ? (
          <SinksTab
            health={health}
            config={config}
            loading={loading}
            onAdd={addSink}
            onRemove={removeSink}
          />
        ) : (
          <RealismTab config={config} loading={loading} onSetRealism={setRealism} />
        )}
      </PanelScroll>
    </div>
  );
}
