import { useRef, useState } from "react";
import { Gear } from "@/components/Icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import DockCluster from "./DockCluster";
import DockDrawer from "./DockDrawer";
import { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import SourceTab from "@/Controls/Adapter/SourceTab";
import SinksTab from "@/Controls/Adapter/SinksTab";
import RealismTab from "@/Controls/Adapter/RealismTab";

type Tab = "source" | "sinks" | "realism";

export interface SinksSourceDrawerProps {
  /** Whether this cluster's drawer is currently open. */
  isOpen: boolean;
  /** Toggle open/closed — wired to the cluster button's own click. */
  onToggle: () => void;
  /** Close the drawer (outside click, Esc, or an explicit close action). */
  onClose: () => void;
}

/**
 * Four-state health summary surfaced both on the dock cluster's badge and
 * inside the drawer header. Same derivation as the old
 * `Controls/Adapter/AdapterDrawer.tsx`'s `drawerStatus` (a coarser, more
 * user-facing readout than `useAdapterConfig`'s 3-state `AdapterStatus`).
 */
type DrawerStatus = "Healthy" | "Needs attention" | "Unconfigured" | "Unreachable";

const STATUS_DOT_CLASS: Record<DrawerStatus, string> = {
  Healthy: "bg-status-ok",
  "Needs attention": "bg-status-warn",
  Unconfigured: "bg-status-idle",
  Unreachable: "bg-status-idle",
};

const STATUS_BADGE_CLASS: Record<DrawerStatus, string> = {
  Healthy: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  "Needs attention": "border-status-warn/30 bg-status-warn/10 text-status-warn",
  Unconfigured: "border-border bg-muted text-foreground",
  Unreachable: "border-border bg-muted text-foreground",
};

/**
 * Sinks & Source dock cluster: re-hosts the Adapter integration (upstream
 * source, downstream sinks, realism config) that used to live in a
 * full-width `Sheet` (`Controls/Adapter/AdapterDrawer.tsx`) inside the new
 * anchored `DockDrawer` shell. Same `useAdapterConfig` hook, same
 * `SourceTab`/`SinksTab`/`RealismTab` content — only the chrome around them
 * changes. Self-contained: owns its own trigger ref, tab state, and data
 * fetching so it can be dropped into `Dock.tsx` without other wiring.
 */
export default function SinksSourceDrawer({ isOpen, onToggle, onClose }: SinksSourceDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>("source");
  const { health, config, loading, error, setSource, addSink, removeSink, setRealism } =
    useAdapterConfig(isOpen);

  const drawerStatus: DrawerStatus = !health
    ? "Unreachable"
    : !health.source && health.sinks.length === 0
      ? "Unconfigured"
      : health.source?.healthy !== false && health.sinks.every((sink) => sink.healthy)
        ? "Healthy"
        : "Needs attention";

  return (
    <div className="relative">
      <DockCluster
        ref={triggerRef}
        icon={<Gear />}
        label="Sinks"
        active={isOpen}
        aria-label={`Sinks & Source (${drawerStatus})`}
        badge={
          <span
            className={cn(
              "block size-2.5 rounded-full border border-background",
              STATUS_DOT_CLASS[drawerStatus]
            )}
            title={drawerStatus}
          />
        }
        onClick={onToggle}
      />

      <DockDrawer
        open={isOpen}
        onClose={onClose}
        anchorRef={triggerRef}
        align="center"
        aria-label="Sinks & Source"
        className="w-96"
      >
        <div className="flex flex-col gap-3 p-4" aria-busy={loading}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Adapter control
              </div>
              <div className="text-lg font-semibold tracking-tight text-foreground">
                Connections
              </div>
            </div>
            <span
              className={cn(
                "inline-flex h-5 items-center justify-center rounded-full border px-2 text-xs font-semibold shadow-raised",
                STATUS_BADGE_CLASS[drawerStatus]
              )}
            >
              {drawerStatus}
            </span>
          </div>

          {loading && <div className="h-0.5 w-full animate-pulse bg-accent" aria-hidden="true" />}

          {error && (
            <div className="rounded-md border border-status-error/40 bg-status-error/10 p-2 text-sm text-status-error">
              {error}
            </div>
          )}

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            className="min-h-0 gap-3"
          >
            <TabsList className="w-full">
              <TabsTrigger value="source">Source</TabsTrigger>
              <TabsTrigger value="sinks">Sinks ({health?.sinks.length ?? 0})</TabsTrigger>
              <TabsTrigger
                value="realism"
                aria-label={`Realism${config?.realism?.status.enabled ? " (active)" : ""}`}
              >
                Realism
                {config?.realism?.status.enabled ? <span aria-hidden="true"> ●</span> : null}
              </TabsTrigger>
            </TabsList>

            <div className="min-h-0">
              {loading && !config ? (
                <div className="flex flex-col gap-2">
                  <div className="h-16 animate-pulse rounded-md bg-muted" />
                  <div className="h-16 animate-pulse rounded-md bg-muted" />
                  <div className="h-16 animate-pulse rounded-md bg-muted" />
                </div>
              ) : !health ? (
                <section className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
                  Adapter service is unreachable. Check the connection settings and try again.
                </section>
              ) : (
                <>
                  <TabsContent value="source">
                    <SourceTab
                      health={health}
                      config={config}
                      loading={loading}
                      onConnect={setSource}
                    />
                  </TabsContent>
                  <TabsContent value="sinks">
                    <SinksTab
                      health={health}
                      config={config}
                      loading={loading}
                      onAdd={addSink}
                      onRemove={removeSink}
                    />
                  </TabsContent>
                  <TabsContent value="realism">
                    <RealismTab config={config} loading={loading} onSetRealism={setRealism} />
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        </div>
      </DockDrawer>
    </div>
  );
}
