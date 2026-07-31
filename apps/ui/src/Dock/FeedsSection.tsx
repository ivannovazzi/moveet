import { useState } from "react";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import SourceTab from "@/Controls/Adapter/SourceTab";
import SinksTab from "@/Controls/Adapter/SinksTab";
import RealismTab from "@/Controls/Adapter/RealismTab";
import { SegTabs, type StatusTone } from "./DockPanelKit";

export interface FeedsSectionProps {
  /**
   * Full result of the lifted `useAdapterConfig` (owned once in `Dock.tsx`, so
   * health keeps polling for the status chip while this section is closed).
   */
  adapter: ReturnType<typeof useAdapterConfig>;
}

type Tab = "source" | "sinks" | "realism";

/** Coarse, user-facing health readout shared with the dock's FEED chip. */
export type FeedHealth = "Healthy" | "Needs attention" | "Unconfigured" | "Unreachable";

export const FEED_HEALTH_TONE: Record<FeedHealth, StatusTone> = {
  Healthy: "ok",
  "Needs attention": "warn",
  Unconfigured: "idle",
  Unreachable: "idle",
};

/** The one derivation of feed health, read by both this section and the chip. */
export function feedHealth(health: ReturnType<typeof useAdapterConfig>["health"]): FeedHealth {
  if (!health) return "Unreachable";
  if (!health.source && health.sinks.length === 0) return "Unconfigured";
  const ok = health.source?.healthy !== false && health.sinks.every((sink) => sink.healthy);
  return ok ? "Healthy" : "Needs attention";
}

/**
 * Where simulated telemetry comes from and where it is published — a Settings
 * tab rather than its own dock cluster. It was "Sinks & Source" on the bar,
 * which named the plumbing rather than the job; the live signal an operator
 * actually watches for (is it healthy?) now reads on the status chips instead,
 * and this is the place to change it.
 *
 * Renders no panel header: `SettingsPanel` owns the title.
 */
export default function FeedsSection({ adapter }: FeedsSectionProps) {
  const { health, config, loading, error, setSource, addSink, removeSink, setRealism } = adapter;
  const [tab, setTab] = useState<Tab>("source");

  return (
    <div aria-busy={loading}>
      <SegTabs<Tab>
        ariaLabel="Feed sections"
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
    </div>
  );
}
