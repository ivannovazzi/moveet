import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Fleet, POI, Position, Route, Vehicle } from "@/types";
import { CloseIcon } from "@/components/Icons";
import { Eyebrow, Hairline, PanelHead, StatusDot, Tag, mono } from "@/Dock/DockPanelKit";

/**
 * On-demand right-side detail panel for the currently selected vehicle or POI.
 * Selection is passed in via props (App owns the selection state) — this panel
 * is a pure presenter that renders nothing when neither target is set. It
 * borrows the dock family's glass surface and tight-technical density
 * (monospace numerics, hairline rows, micro uppercase eyebrows) so it reads as
 * the same instrument as the dock panels.
 */
export interface InspectorProps {
  /** The selected vehicle, if any. */
  vehicle?: Vehicle;
  /** The selected POI, if any. Ignored when a vehicle is set. */
  poi?: POI;
  /** Resolved fleet for the selected vehicle (App resolves it from `fleetId`). */
  fleet?: Fleet;
  /** Active route for the selected vehicle (App reads it from the directions map). */
  route?: Route;
  /** Close the inspector (clears selection upstream). */
  onClose: () => void;
}

/** One key/value detail line: muted uppercase label left, mono-ish value right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border-soft px-[15px] py-[9px] first:border-t-0">
      <Eyebrow className="shrink-0">{label}</Eyebrow>
      <div className="min-w-0 truncate text-right text-[12px] text-foreground">{children}</div>
    </div>
  );
}

/** Format a [lng, lat] position as a monospace `lat, lng` pair. */
function formatCoords([lng, lat]: Position): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function Inspector({ vehicle, poi, fleet, route, onClose }: InspectorProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!vehicle && !poi) return null;

  const moving = vehicle ? vehicle.speed > 0 : false;
  const eyebrow = vehicle ? "Vehicle" : "Location";
  const title = vehicle ? vehicle.name : (poi?.name ?? "Point of interest");

  return (
    <aside
      role="region"
      aria-label="Inspector"
      className={cn(
        "absolute right-4 top-4 z-40 w-80 max-w-[calc(100vw-2rem)] origin-top-right",
        "overflow-hidden rounded-[10px] border border-border surface-glass-strong shadow-floating backdrop-blur-2xl backdrop-saturate-150",
        "animate-scale-in"
      )}
    >
      <PanelHead
        eyebrow={eyebrow}
        title={title}
        right={
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            title="Close"
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent",
              "text-muted-foreground transition-colors duration-fast ease-standard",
              "hover:border-border hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            )}
          >
            <CloseIcon className="size-4" />
          </button>
        }
      />
      <Hairline />

      {vehicle && (
        <div className="flex flex-col pb-1">
          <Field label="ID">
            <span className={mono}>{vehicle.id}</span>
          </Field>
          <Field label="Status">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={moving ? "ok" : "idle"} />
              {moving ? "En route" : "Idle"}
            </span>
          </Field>
          <Field label="Type">
            <Tag tone="accent">{vehicle.type}</Tag>
          </Field>
          <Field label="Speed">
            <span className={mono}>{Math.round(vehicle.speed)} km/h</span>
          </Field>
          <Field label="Heading">
            <span className={mono}>{Math.round(vehicle.heading)}°</span>
          </Field>
          <Field label="Fleet">{fleet?.name ?? vehicle.fleetId ?? "—"}</Field>
          {route && (
            <Field label="Route">
              <span className={mono}>{route.distance.toFixed(1)} km</span>
            </Field>
          )}
          <Field label="Coordinates">
            <span className={mono}>{formatCoords(vehicle.position)}</span>
          </Field>
        </div>
      )}

      {poi && !vehicle && (
        <div className="flex flex-col pb-1">
          <Field label="ID">
            <span className={mono}>{poi.id}</span>
          </Field>
          <Field label="Type">
            <Tag tone="accent">{poi.type}</Tag>
          </Field>
          <Field label="Coordinates">
            <span className={mono}>{formatCoords(poi.coordinates)}</span>
          </Field>
        </div>
      )}
    </aside>
  );
}
