import type { ComponentProps } from "react";
import RealismTab from "@/Controls/Adapter/RealismTab";
import SinksTab from "@/Controls/Adapter/SinksTab";
import SourceTab from "@/Controls/Adapter/SourceTab";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import AdvancedTuningTab from "./AdvancedTuningTab";
import { HealthChip, PanelScroll } from "./DockPanelKit";
import { FEED_HEALTH_TONE, feedHealth } from "./FeedsSection";
import type { SettingsTabId } from "./dockSections";

export interface SettingsPanelProps {
  tab: SettingsTabId;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
  feeds: {
    /**
     * Full result of the lifted `useAdapterConfig` (owned once in `Dock.tsx`,
     * so health keeps polling for the status lamp while this panel is closed).
     */
    adapter: ReturnType<typeof useAdapterConfig>;
  };
}

/**
 * Contents of the Settings panel — configuration, and only configuration: where
 * telemetry comes from, where it is published, and how the vehicles behave.
 * What the map *draws* is not a panel at all any more: it is the icon rail on
 * the map's left edge (`Map/VisibilityRail`). Recordings and scenarios live in
 * the Session dock (they change the run, not a preference).
 *
 * Source/Sinks/Realism are the dock's own tabs, not a tab strip nested inside a
 * "Feeds & sinks" tab: one 380px panel cannot afford section → tab → inner tab,
 * so `tab` picks a body directly and the panel body holds no tablist of its own.
 */
export default function SettingsPanel({ tab, advanced, feeds }: SettingsPanelProps) {
  if (tab === "advanced") {
    return (
      <PanelScroll>
        <SuppressPanelHeader>
          <AdvancedTuningTab {...advanced} />
        </SuppressPanelHeader>
      </PanelScroll>
    );
  }

  return <AdapterTab tab={tab} adapter={feeds.adapter} />;
}

/**
 * The three adapter-backed tabs. They share the poller, the loading/error
 * chrome and the health line, so they share one wrapper rather than repeating
 * it three times.
 */
function AdapterTab({
  tab,
  adapter,
}: {
  tab: "source" | "sinks" | "realism";
  adapter: ReturnType<typeof useAdapterConfig>;
}) {
  const { health, config, loading, error, setSource, addSink, removeSink, setRealism } = adapter;
  const status = feedHealth(health);

  return (
    <div aria-busy={loading}>
      {/*
       * Health used to occupy a header row of its own that held nothing else.
       * It is a single 28px status line now, so the body starts one row down
       * instead of two.
       */}
      <div className="flex h-7 items-center justify-end gap-1.5 px-[15px]">
        <span className="text-micro font-bold uppercase tracking-[0.12em] text-muted-foreground/75">
          Adapter ·
        </span>
        <HealthChip tone={FEED_HEALTH_TONE[status]}>{status}</HealthChip>
      </div>

      {loading && (
        <div className="mx-[15px] h-0.5 animate-pulse rounded-full bg-accent" aria-hidden />
      )}

      {error && (
        <div className="mx-3 mb-1 rounded-md border border-status-error/40 bg-status-error/10 px-2 py-1.5 text-meta text-status-error">
          {error}
        </div>
      )}

      <PanelScroll>
        <SuppressPanelHeader>
          {loading && !config ? (
            <div className="flex flex-col gap-2 p-3">
              <div className="h-14 animate-pulse rounded-md bg-muted" />
              <div className="h-14 animate-pulse rounded-md bg-muted" />
              <div className="h-14 animate-pulse rounded-md bg-muted" />
            </div>
          ) : !health ? (
            <div className="m-3 rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-meta text-muted-foreground">
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
        </SuppressPanelHeader>
      </PanelScroll>
    </div>
  );
}
