import type { LucideIcon } from "lucide-react";
import { Flag, LogIn, LogOut, MapPin, Route as RouteIcon, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow, Hairline, mono } from "@/Dock/DockPanelKit";
import { useVehicleEvents, type VehicleEventKind } from "./vehicleEventStore";

/**
 * Chronological (newest first) list of the selected vehicle's recent events,
 * read from the bounded `vehicleEventStore`. A vehicle with no events shows an
 * empty state — the list is never padded with placeholders.
 */
export interface VehicleEventTimelineProps {
  vehicleId: string;
}

const KIND_ICON: Record<VehicleEventKind, LucideIcon> = {
  route: RouteIcon,
  reroute: Shuffle,
  waypoint: MapPin,
  arrival: Flag,
  "geofence-enter": LogIn,
  "geofence-exit": LogOut,
};

const KIND_TONE: Record<VehicleEventKind, string> = {
  route: "border-border bg-muted text-muted-foreground",
  reroute: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  waypoint: "border-border bg-muted text-muted-foreground",
  arrival: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  "geofence-enter": "border-accent/40 bg-accent/10 text-accent",
  "geofence-exit": "border-accent/40 bg-accent/10 text-accent",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock `HH:MM:SS` — absolute, so no timer is needed to keep it fresh. */
export function formatEventTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function VehicleEventTimeline({ vehicleId }: VehicleEventTimelineProps) {
  const events = useVehicleEvents(vehicleId);
  // Newest first; `events` is oldest → newest and owned by the store.
  const ordered = events.slice().reverse();

  return (
    <div className="shrink-0">
      <Hairline />
      <div className="flex items-baseline justify-between gap-3 px-[15px] pb-[6px] pt-[10px]">
        <Eyebrow>Events</Eyebrow>
        {ordered.length > 0 && (
          <span className={cn(mono, "text-[10px] text-muted-foreground/70")}>
            {ordered.length} recent
          </span>
        )}
      </div>

      {ordered.length === 0 ? (
        <div className="px-[15px] pb-[10px] text-[11px] text-muted-foreground">
          No events recorded for this vehicle.
        </div>
      ) : (
        <ol
          aria-label="Vehicle event timeline"
          className="max-h-[min(26vh,200px)] overflow-y-auto overscroll-contain pb-2"
        >
          {ordered.map((event) => {
            const Icon = KIND_ICON[event.kind];
            return (
              <li
                key={event.id}
                data-kind={event.kind}
                className="flex items-start gap-2.5 border-t border-border-soft px-[15px] py-[7px] first:border-t-0"
              >
                <span
                  className={cn(
                    "mt-px flex size-[20px] shrink-0 items-center justify-center rounded-full border",
                    KIND_TONE[event.kind]
                  )}
                >
                  <Icon className="size-3" strokeWidth={2.25} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] leading-snug text-foreground/90">
                    {event.label}
                  </span>
                  {event.detail && (
                    <span
                      className={cn(
                        mono,
                        "mt-0.5 block truncate text-[10px] text-muted-foreground/70"
                      )}
                    >
                      {event.detail}
                    </span>
                  )}
                </span>
                <time
                  dateTime={new Date(event.at).toISOString()}
                  className={cn(mono, "shrink-0 pt-px text-[10px] text-muted-foreground/70")}
                >
                  {formatEventTime(event.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
