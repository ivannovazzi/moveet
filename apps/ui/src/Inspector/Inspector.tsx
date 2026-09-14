import { cn } from "@/lib/utils";
import type { Fleet, JobDTO, POI, Position, Vehicle } from "@/types";
import { invertLatLng } from "@/utils/coordinates";
import { Eyebrow, StatusDot, Tag, mono } from "@/Dock/DockPanelKit";
import VehicleDirections from "./VehicleDirections";
import VehicleTelemetry from "./VehicleTelemetry";
import VehicleEventTimeline from "./VehicleEventTimeline";
import { useVehicleEventCapture } from "./useVehicleEventCapture";
import { FAULT_KIND_LABEL } from "@/lib/faultPresets";
import type { DeviceFaultInfo } from "@/types";

/**
 * The console's Inspect view: whatever the map currently has selected.
 *
 * It used to be a floating aside at the map's right edge, with its own glass
 * frame, its own header and its own close button — and its own claim on
 * `mapInsets`, because a camera flying to the vehicle it was describing would
 * otherwise put that vehicle behind it. It is a console section now (see
 * `shell/Console`), so the frame, the header and the inset claim all belong to
 * the console, and what is left here is the content.
 *
 * Selection is passed in via props (App owns the selection state). Unlike every
 * other section this one is allowed to render empty — the selection can be
 * cleared while the console is open, and a surface that vanished out from under
 * the operator would read as a bug. Empty means *empty*: the console's header
 * already says "Inspect" with nothing after it, which is the whole message. A
 * line of copy explaining where selections come from pushed the panel's own
 * layout around for something the operator learns once.
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
}

/** One key/value detail line: muted uppercase label left, mono-ish value right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border-soft px-[15px] py-[9px] first:border-t-0">
      <Eyebrow className="shrink-0">{label}</Eyebrow>
      <div className="min-w-0 truncate text-right text-label text-foreground">{children}</div>
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

/** The title the console's header shows for whatever is selected. */
export function inspectorTitle(vehicle?: Vehicle, poi?: POI): string {
  if (vehicle) return vehicle.name;
  if (poi) return poi.name ?? "Point of interest";
  return "Inspect";
}

export default function Inspector({ vehicle, poi, fleet, job }: InspectorProps) {
  // Mounted for as long as the console's Inspect view is, so this is the
  // app-lifetime home for per-vehicle event capture — history exists for a
  // vehicle selected long after the events happened.
  useVehicleEventCapture();

  // Escape is deliberately NOT handled here. The view is driven by the
  // selection, and Escape-to-clear-selection is one branch of the app's single
  // keyboard dispatcher (useInteractionKeyboard) — a listener here would also
  // fire on the press that exits dispatch or cancels a geofence draw.

  const moving = vehicle ? vehicle.speed > 0 : false;

  return (
    <div role="region" aria-label="Inspector" className="flex min-h-0 flex-1 flex-col">
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
    </div>
  );
}
