import { cn } from "@/lib/utils";
import type { Fleet, JobDTO, POI, Position, Vehicle } from "@/types";
import { CloseIcon } from "@/components/Icons";
import { invertLatLng } from "@/utils/coordinates";
import { Eyebrow, Hairline, PanelHead, StatusDot, Tag, mono } from "@/Dock/DockPanelKit";
import VehicleDirections from "./VehicleDirections";
import VehicleTelemetry from "./VehicleTelemetry";
import VehicleEventTimeline from "./VehicleEventTimeline";
import { useVehicleEventCapture } from "./useVehicleEventCapture";
import { FAULT_KIND_LABEL } from "@/lib/faultPresets";
import type { DeviceFaultInfo } from "@/types";

/**
 * On-demand right-side detail panel for the currently selected vehicle or POI.
 * Selection is passed in via props (App owns the selection state) — this panel
 * is a pure presenter that renders nothing when neither target is set. It
 * borrows the dock family's glass surface and tight-technical density
 * (monospace numerics, hairline rows, micro uppercase eyebrows) so it reads as
 * the same instrument as the dock panels.
 *
 * Four sections for a vehicle: identity fields, live telemetry sparklines,
 * turn-by-turn steps with route progress, and an event timeline.
 *
 * Performance note: this component is *not* wired to the vehicle hot path. Its
 * `vehicle` prop comes from App's already-throttled (1 Hz) `useVehicles`
 * snapshot, and the sparklines poll `vehicleStore` on their own 1 Hz timer from
 * a leaf component rather than subscribing to it. Nothing here re-renders per
 * position tick.
 */
export interface InspectorProps {
  /** The selected vehicle, if any. */
  vehicle?: Vehicle;
  /** The selected POI, if any. Ignored when a vehicle is set. */
  poi?: POI;
  /** Resolved fleet for the selected vehicle (App resolves it from `fleetId`). */
  fleet?: Fleet;
  /** The live job this vehicle is carrying, if any (App resolves it from the board). */
  job?: JobDTO;
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

/**
 * What the simulated DEVICE is doing to this vehicle's telemetry.
 *
 * Renders nothing for a device with no fault profile (the common case), so the
 * inspector is unchanged unless faults are actually armed. When they are, this
 * is the difference between "the map looks wrong" and "this tracker is frozen".
 */
function DeviceFaults({ faults, timestamp }: { faults?: DeviceFaultInfo; timestamp?: number }) {
  if (!faults) return null;

  const active = faults.active;
  const battery = faults.battery;
  const skewSeconds = faults.skewMs != null ? Math.round(faults.skewMs / 1000) : undefined;

  return (
    <div className="shrink-0 border-t border-border-soft pt-2">
      <div className="flex items-center justify-between gap-2 px-[15px] pb-1.5">
        <Eyebrow>Device</Eyebrow>
        {active.length === 0 ? (
          <Tag tone="ok">Reporting clean</Tag>
        ) : (
          <span className="flex flex-wrap justify-end gap-1">
            {active.map((kind) => (
              <Tag key={kind} tone={kind === "battery_dead" ? "error" : "warn"}>
                {FAULT_KIND_LABEL[kind]}
              </Tag>
            ))}
          </span>
        )}
      </div>
      {battery != null && (
        <Field label="Battery">
          <span
            className={cn(mono, battery <= 10 ? "text-status-error" : undefined)}
          >{`${Math.round(battery)}%`}</span>
        </Field>
      )}
      {skewSeconds != null && skewSeconds !== 0 && (
        <Field label="Clock skew">
          <span className={cn(mono, "text-status-warn")}>
            {skewSeconds > 0 ? `+${skewSeconds}s` : `${skewSeconds}s`}
          </span>
        </Field>
      )}
      {timestamp != null && (
        <Field label="Device time">
          <span className={mono}>{new Date(timestamp).toLocaleTimeString()}</span>
        </Field>
      )}
    </div>
  );
}

export default function Inspector({ vehicle, poi, fleet, job, onClose }: InspectorProps) {
  // App renders <Inspector/> unconditionally (it self-hides below), so this is
  // the app-lifetime home for per-vehicle event capture — history exists for a
  // vehicle selected long after the events happened.
  useVehicleEventCapture();

  // Escape is deliberately NOT handled here. The inspector is driven by the
  // selection, and Escape-to-clear-selection is one branch of the app's single
  // keyboard dispatcher (useInteractionKeyboard) — a listener here would also
  // fire on the press that exits dispatch or cancels a geofence draw.

  if (!vehicle && !poi) return null;

  const moving = vehicle ? vehicle.speed > 0 : false;
  const eyebrow = vehicle ? "Vehicle" : "Location";
  const title = vehicle ? vehicle.name : (poi?.name ?? "Point of interest");

  return (
    <aside
      role="region"
      aria-label="Inspector"
      className={cn(
        "absolute right-4 top-4 z-40 flex max-h-[calc(100vh-2rem)] w-80 max-w-[calc(100vw-2rem)] flex-col origin-top-right",
        "overflow-hidden rounded-[10px] border border-border surface-glass-strong glass-frost-strong shadow-floating",
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
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Identity stays pinned; the analysis sections below it scroll. */}
          <div className="shrink-0">
            <Field label="ID">
              <span className={mono}>{vehicle.id}</span>
            </Field>
            <Field label="Status">
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={moving ? "ok" : "idle"} />
                {moving ? "En route" : "Idle"}
              </span>
            </Field>
            {job && (
              <Field label="Job">
                <span className="inline-flex items-center gap-1.5">
                  {job.slaBreached && <Tag tone="error">Late</Tag>}
                  <span className={mono}>{job.reference}</span>
                </span>
              </Field>
            )}
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
            <Field label="Coordinates">
              <span className={mono}>{formatCoords(vehicle.position)}</span>
            </Field>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            <DeviceFaults faults={vehicle.faults} timestamp={vehicle.timestamp} />
            <VehicleTelemetry vehicleId={vehicle.id} />
            {/* Vehicle positions are [lng, lat] here; edge coords are [lat, lng].
                Invert so the active-step lookup compares matching axes. */}
            <VehicleDirections vehicleId={vehicle.id} position={invertLatLng(vehicle.position)} />
            <VehicleEventTimeline vehicleId={vehicle.id} />
          </div>
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
