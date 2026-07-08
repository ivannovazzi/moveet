import { useState } from "react";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import SourceTab from "@/Controls/Adapter/SourceTab";
import SinksTab from "@/Controls/Adapter/SinksTab";
import RealismTab from "@/Controls/Adapter/RealismTab";
import { cn } from "@/lib/utils";
import {
  HealthChip,
  Hairline,
  PanelHead,
  PanelScroll,
  SegTabs,
  mono,
  type StatusTone,
} from "./DockPanelKit";

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

// ── shared list-row language (mockup `.list`/`.lrow`/`.tag`) ─────────────────
// Exported so the Adapter tabs render the exact same dense rows without every
// file re-deriving the stripe/label/meta rhythm.

/** Semantic tone for a row's left severity stripe and its meta tag. */
export type SevTone = "ok" | "warn" | "error" | "idle" | "accent";

const SEV_BAR: Record<SevTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  error: "bg-status-error",
  idle: "bg-border",
  accent: "bg-accent",
};

const TAG_TONE: Record<SevTone, string> = {
  ok: "text-status-ok bg-status-ok/12",
  warn: "text-status-warn bg-status-warn/12",
  error: "text-status-error bg-status-error/12",
  idle: "text-muted-foreground bg-muted",
  accent: "text-accent bg-accent/12",
};

/** A right-aligned uppercase state pill (mockup `.tag.ok`/`.tag.warn`). */
export function Tag({ tone, children }: { tone: SevTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em]",
        TAG_TONE[tone]
      )}
    >
      {children}
    </span>
  );
}

/** Column wrapper for a run of `LRow`s: tight padding, first row un-ruled. */
export function LList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col px-2 pb-2.5 pt-1", className)}>{children}</div>;
}

/**
 * A dense connection/config row: left severity stripe, a primary label over a
 * monospace secondary line, and a right-aligned meta slot (a `Tag`, digits, or
 * inline controls).
 */
export function LRow({
  tone,
  primary,
  secondary,
  meta,
  className,
}: {
  tone: SevTone;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[3px_1fr_auto] items-center gap-2.5 border-t border-border-soft px-2 py-[9px] first:border-t-0",
        className
      )}
    >
      <span className={cn("h-[26px] w-[3px] rounded-[2px]", SEV_BAR[tone])} />
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium text-foreground">{primary}</div>
        {secondary != null && (
          <div className={cn(mono, "mt-0.5 truncate text-[10.5px] text-muted-foreground/60")}>
            {secondary}
          </div>
        )}
      </div>
      <div className="flex items-center justify-self-end gap-1 text-right">{meta}</div>
    </div>
  );
}

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
