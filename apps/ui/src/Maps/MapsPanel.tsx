import { useEffect, useRef, useState } from "react";
import type { MapMeta, MapSource } from "@moveet/shared-types";
import { Button } from "@/components/Inputs";
import { TrashIcon } from "@/components/Icons";
import { PanelEmptyState, PanelErrorState, PanelLoadingState } from "@/Controls/PanelPrimitives";
import { Eyebrow, Tag, mono } from "@/Dock/DockPanelKit";
import { cn } from "@/lib/utils";
import { bboxSpanKm, formatBytes, formatCentre } from "./bbox";
import { MapJobs } from "./MapJobs";
import {
  activate,
  cancelJob,
  dismissWarning,
  refreshLibrary,
  remove,
  useMapsState,
  type MapsState,
} from "./mapsStore";
import NewMapForm from "./NewMapForm";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";

function sourceText(source: MapSource | undefined): string | null {
  switch (source?.type) {
    case "geofabrik":
      return `Geofabrik ${source.path}`;
    case "preset":
      return `Preset ${source.name}`;
    case "import":
      return "Imported";
    case "bundled":
      return "Bundled";
    default:
      return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function mapBytes(map: MapMeta): number {
  return (map.sizes?.networkBytes ?? 0) + (map.sizes?.buildingsBytes ?? 0);
}

/**
 * The Session › Maps tab: the simulator's map library (switch between maps,
 * delete the ones not in use), the builds in progress, and the way into the
 * New map form when the server builds maps.
 */
export default function MapsPanel() {
  const state = useMapsState();
  const [view, setView] = useState<"library" | "new">("library");

  // The library is loaded at app start; refresh it when the panel opens so a
  // map built or deleted from another tab shows up.
  useEffect(() => {
    void refreshLibrary();
  }, []);

  if (view === "new" && state.buildSupport === "enabled") {
    return <NewMapForm library={state.library} onClose={() => setView("library")} />;
  }
  return <Library state={state} onNewMap={() => setView("new")} />;
}

function Library({ state, onNewMap }: { state: MapsState; onNewMap: () => void }) {
  const { library, buildSupport, switching, pending, warning, jobs } = state;
  const busy = switching !== null || pending !== null;
  const limits = library?.builds?.limits;

  return (
    <div className="flex flex-col gap-3 py-2" aria-busy={state.loading}>
      <div role="status" aria-live="polite" className="px-[15px] empty:hidden">
        {switching && (
          <div className="flex flex-col gap-1.5 rounded-md border border-accent/25 bg-accent/8 px-3 py-2">
            <span className="text-meta text-foreground">
              {switching.label ? `Switching to ${switching.label}…` : "Switching maps…"}
            </span>
            <span className="text-micro text-muted-foreground">
              The simulation is paused while the new road network loads.
            </span>
            <div className="h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
            </div>
          </div>
        )}
      </div>

      {warning && (
        <div
          role="alert"
          className="mx-[15px] flex items-start gap-2 rounded-md border border-status-warn/35 bg-status-warn/10 px-3 py-2 text-meta text-status-warn"
        >
          <span className="flex-1 leading-snug">{warning}</span>
          <button
            type="button"
            onClick={dismissWarning}
            aria-label="Dismiss warning"
            className={cn("rounded px-1 text-micro hover:text-foreground", FOCUS_RING)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-[15px]">
        <Eyebrow>
          Library{library ? ` · ${library.maps.length}` : ""}
          {limits?.diskQuotaBytes != null && limits.diskUsedBytes != null && (
            <span className={cn(mono, "ml-2 normal-case tracking-normal")}>
              {formatBytes(limits.diskUsedBytes)} of {formatBytes(limits.diskQuotaBytes)}
            </span>
          )}
        </Eyebrow>
        {buildSupport === "enabled" && (
          <Button size="xs" variant="default" onClick={onNewMap} disabled={busy}>
            New map
          </Button>
        )}
      </div>

      {limits?.diskQuotaBytes != null && limits.diskUsedBytes != null && (
        <DiskBar used={limits.diskUsedBytes} quota={limits.diskQuotaBytes} />
      )}

      {buildSupport === "disabled" && (
        <p className="mx-[15px] rounded-md border border-border-soft bg-muted/40 px-3 py-2 text-meta leading-snug text-muted-foreground">
          Building new maps is turned off on this simulator (<code>ALLOW_MAP_BUILDS</code>). You can
          still switch between the maps already in the library.
        </p>
      )}

      {!library && state.loading && <PanelLoadingState>Reading the map library…</PanelLoadingState>}
      {!library && !state.loading && state.error && (
        <PanelErrorState className="mx-[15px]">
          Could not read the map library: {state.error}
          <div className="mt-2">
            <Button size="xs" onClick={() => void refreshLibrary()}>
              Retry
            </Button>
          </div>
        </PanelErrorState>
      )}

      {library && library.maps.length === 0 && (
        <PanelEmptyState className="mx-[15px]">The map library is empty.</PanelEmptyState>
      )}

      {library && library.maps.length > 0 && (
        <ul aria-label="Map library" className="flex flex-col px-2">
          {library.maps.map((map) => (
            <MapRow
              key={map.id}
              map={map}
              active={map.id === library.activeId}
              pending={pending === map.id}
              switchingHere={switching?.id === map.id}
              busy={busy}
            />
          ))}
        </ul>
      )}

      {buildSupport !== "unsupported" && jobs.length > 0 && (
        <div className="flex flex-col gap-1">
          <Eyebrow className="px-[15px]">Builds</Eyebrow>
          <MapJobs
            jobs={jobs}
            canCancel={buildSupport === "enabled"}
            onCancel={(id) => void cancelJob(id)}
          />
        </div>
      )}
    </div>
  );
}

function DiskBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label="Map library disk usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${formatBytes(used)} of ${formatBytes(quota)}`}
      className="mx-[15px] h-[3px] overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full", pct >= 90 ? "bg-status-warn" : "bg-accent/70")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MapRow({
  map,
  active,
  pending,
  switchingHere,
  busy,
}: {
  map: MapMeta;
  active: boolean;
  pending: boolean;
  switchingHere: boolean;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Move focus into the confirm step and back out of it, so a keyboard user
  // is never left on a button that has just disappeared.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  // A switch starting elsewhere cancels a half-made delete decision.
  useEffect(() => {
    if (busy && !pending) setConfirming(false);
  }, [busy, pending]);

  const span = map.bbox ? bboxSpanKm(map.bbox) : null;
  const facts = [
    formatBytes(mapBytes(map)),
    `${map.featureCount.toLocaleString()} roads`,
    map.nodeCount != null ? `${map.nodeCount.toLocaleString()} nodes` : null,
    map.hasBuildings ? "3D buildings" : null,
  ].filter(Boolean);
  const source = sourceText(map.source);

  return (
    <li
      aria-label={map.label}
      aria-current={active ? "true" : undefined}
      className="grid grid-cols-[3px_1fr_auto] items-center gap-2.5 border-t border-border-soft px-2 py-[9px] first:border-t-0"
    >
      <span
        className={cn("h-[34px] w-[3px] rounded-[2px]", active ? "bg-accent" : "bg-border")}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-label font-medium text-foreground" title={map.id}>
            {map.label}
          </span>
          {active && <Tag tone="accent">Active</Tag>}
        </div>
        {map.bbox && span && (
          <div className={cn(mono, "mt-0.5 truncate text-micro text-muted-foreground/70")}>
            {formatCentre(map.bbox)} · {Math.round(span.widthKm)} × {Math.round(span.heightKm)} km
          </div>
        )}
        <div className={cn(mono, "mt-0.5 truncate text-micro text-muted-foreground/70")}>
          {facts.join(" · ")}
        </div>
        <div className="mt-0.5 truncate text-micro text-muted-foreground/60">
          {[source, formatDate(map.createdAt)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex items-center gap-1 justify-self-end">
        {confirming ? (
          <>
            <Button
              ref={confirmRef}
              size="xs"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void remove(map.id);
              }}
              disabled={busy}
              aria-label={`Confirm deleting ${map.label}`}
            >
              Delete
            </Button>
            <Button size="xs" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            {!active && (
              <Button
                size="xs"
                onClick={() => void activate(map.id)}
                disabled={busy}
                aria-label={`Activate ${map.label}`}
              >
                {switchingHere ? "Switching…" : "Activate"}
              </Button>
            )}
            <Button
              ref={deleteRef}
              size="icon-xs"
              variant="ghost"
              onClick={() => setConfirming(true)}
              disabled={busy || active}
              aria-label={`Delete ${map.label}`}
              title={active ? "The active map cannot be deleted" : `Delete ${map.label}`}
            >
              <TrashIcon />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
