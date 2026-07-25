import { useCallback, useMemo } from "react";
import { AlertTriangle, Send, Waypoints, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "@/Dock/DockPanelKit";
import type { ReplayStatus } from "@/types";
import {
  useSessionEvents,
  type SessionEvent,
  type SessionEventCategory,
} from "./sessionEventStore";

/**
 * Persistent strip marking every incident, geofence crossing and dispatch of
 * the session as a tick on one time axis, so they stay visible after the toast
 * has gone and without opening a panel.
 *
 * **Space.** This is a real flex row at the bottom of the app shell, *below*
 * the map container — not another absolutely-positioned overlay. The dock
 * (`bottom-5`, 54 px tall), its panel (`bottom-[86px]`) and `StartHint`
 * (`bottom-[104px]`) are all positioned against the map container's bottom
 * edge, so they keep exactly the space they already claimed and the strip sits
 * below all of it. Nothing overlaps the canvas.
 *
 * **Seeking.** During a replay a tick's position is its offset into the
 * recording, and clicking it calls the same `seekReplay` path the replay dock's
 * progress bar uses. A live session has no timeline to seek, so clicking a tick
 * selects the vehicle it belongs to instead (and does nothing for ticks with no
 * vehicle, which are visibly dimmed). The strip labels that state "Live" rather
 * than presenting a scrubber that would not respond.
 */

export interface SessionTimelineProps {
  replayStatus: ReplayStatus;
  /** Same handler the replay dock's scrubber uses. Offset into the recording, ms. */
  onSeek: (timestamp: number) => void | Promise<void>;
  /** Live fallback: the app's own vehicle-selection handler. */
  onSelectVehicle: (id: string) => void;
  className?: string;
}

/** Tick fill per category. Geofence enter/exit share a hue and split on fill. */
const CATEGORY_TICK: Record<SessionEventCategory, string> = {
  incident: "bg-status-error",
  "geofence-enter": "bg-accent",
  "geofence-exit": "bg-accent/45",
  dispatch: "bg-status-ok",
};

/** Second visual channel, so the categories don't rely on hue alone. */
const CATEGORY_HEIGHT: Record<SessionEventCategory, string> = {
  incident: "h-[15px]",
  "geofence-enter": "h-[11px]",
  "geofence-exit": "h-[11px]",
  dispatch: "h-[7px]",
};

const CATEGORY_NAME: Record<SessionEventCategory, string> = {
  incident: "Incident",
  "geofence-enter": "Geofence entry",
  "geofence-exit": "Geofence exit",
  dispatch: "Dispatch",
};

const LEGEND: { category: SessionEventCategory; label: string; icon: LucideIcon }[] = [
  { category: "incident", label: "Incident", icon: AlertTriangle },
  { category: "geofence-enter", label: "Geofence", icon: Waypoints },
  { category: "dispatch", label: "Dispatch", icon: Send },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock `HH:MM:SS` for a live event. */
function clockTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `MM:SS` offset into a recording. */
function offsetTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * Where each event sits on the axis, as a 0–1 fraction.
 *
 * Replay: the recording's own [0, duration] axis, which is what makes a tick
 * directly seekable. Live: the retained window — oldest kept event on the left,
 * newest on the right. The live axis therefore only moves when something
 * happens, so the strip needs no ticking clock.
 */
export function tickOffsets(
  events: readonly SessionEvent[],
  seekable: boolean,
  duration: number
): Map<number, number> {
  const out = new Map<number, number>();
  if (seekable) {
    for (const e of events) {
      out.set(e.id, Math.min(Math.max((e.replayTime ?? 0) / duration, 0), 1));
    }
    return out;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (e.at < min) min = e.at;
    if (e.at > max) max = e.at;
  }
  const span = max - min;
  for (const e of events) out.set(e.id, span > 0 ? (e.at - min) / span : 1);
  return out;
}

export default function SessionTimeline({
  replayStatus,
  onSeek,
  onSelectVehicle,
  className,
}: SessionTimelineProps) {
  const events = useSessionEvents();
  const duration = replayStatus.duration ?? 0;
  const seekable = replayStatus.mode === "replay" && duration > 0;

  const offsets = useMemo(
    () => tickOffsets(events, seekable, duration),
    [events, seekable, duration]
  );

  const activate = useCallback(
    (event: SessionEvent) => {
      if (seekable && event.replayTime != null) {
        void onSeek(event.replayTime);
        return;
      }
      if (event.vehicleId) onSelectVehicle(event.vehicleId);
    },
    [seekable, onSeek, onSelectVehicle]
  );

  const playhead = seekable ? Math.min((replayStatus.currentTime ?? 0) / duration, 1) : null;

  return (
    <div
      role="region"
      aria-label="Session timeline"
      data-seekable={seekable ? "" : undefined}
      className={cn(
        "flex h-7 shrink-0 items-center gap-2 border-t border-border bg-card/40 px-2",
        className
      )}
    >
      <span className="shrink-0 text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
        Session
      </span>

      <div
        role="group"
        aria-label="Session events"
        className="relative h-full min-w-0 flex-1 overflow-hidden"
      >
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />

        {playhead != null && (
          <div
            aria-hidden
            data-testid="session-timeline-playhead"
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground/60"
            style={{ left: `${playhead * 100}%` }}
          />
        )}

        {events.length === 0 && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70">
            No incidents, geofence events or dispatches yet
          </span>
        )}

        {events.map((event) => {
          const actionable = seekable ? event.replayTime != null : event.vehicleId != null;
          const when = seekable ? offsetTime(event.replayTime ?? 0) : clockTime(event.at);
          const label = `${CATEGORY_NAME[event.category]} · ${when} — ${event.label}${
            seekable ? " (seek here)" : ""
          }`;
          return (
            <button
              key={event.id}
              type="button"
              data-category={event.category}
              data-actionable={actionable ? "" : undefined}
              aria-disabled={actionable ? undefined : "true"}
              aria-label={label}
              title={label}
              onClick={() => {
                if (actionable) activate(event);
              }}
              className={cn(
                "group absolute top-1/2 flex h-full w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                actionable ? "cursor-pointer" : "cursor-default"
              )}
              style={{ left: `${(offsets.get(event.id) ?? 0) * 100}%` }}
            >
              <span
                className={cn(
                  "w-[3px] rounded-full transition-[transform,opacity] duration-fast ease-standard",
                  CATEGORY_TICK[event.category],
                  CATEGORY_HEIGHT[event.category],
                  actionable ? "opacity-90 group-hover:scale-y-125" : "opacity-40"
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Legend — glanceable only, so it is the first thing to drop when narrow. */}
      <ul className="hidden shrink-0 items-center gap-2.5 lg:flex">
        {LEGEND.map(({ category, label, icon: Icon }) => (
          <li key={category} className="flex items-center gap-1 text-muted-foreground/80">
            <Icon aria-hidden className="size-2.5" strokeWidth={2.5} />
            <span
              aria-hidden
              className={cn("block h-2.5 w-[3px] rounded-full", CATEGORY_TICK[category])}
            />
            <span className="text-[9px] uppercase tracking-[0.06em]">{label}</span>
          </li>
        ))}
      </ul>

      <span
        className={cn(
          mono,
          "shrink-0 rounded-sm border px-1 py-px text-[9px] uppercase leading-[1.4] tracking-[0.06em]",
          seekable
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-muted text-muted-foreground"
        )}
        title={
          seekable
            ? "Replaying a recording — click a tick to seek to it"
            : "Live session — there is no timeline to seek. Replay a recording to jump to an event."
        }
      >
        {seekable ? "Seek" : "Live"}
      </span>
    </div>
  );
}
