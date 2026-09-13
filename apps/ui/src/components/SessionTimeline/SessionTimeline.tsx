import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "@/Dock/DockPanelKit";
import type { ReplayStatus } from "@/types";
import {
  MAX_SESSION_EVENTS,
  sessionEventStore,
  useEvictedSessionEvents,
  useSessionEvents,
  useSessionStartedAt,
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
 * (`bottom-5`, 54 px tall) and its panel (`bottom-[86px]`) are positioned
 * against the map container's bottom edge, so they keep exactly the space
 * they already claimed and the strip sits below all of it. Nothing overlaps
 * the canvas.
 *
 * **Reading as a timeline.** A bar of unexplained marks is a status bar, not a
 * timeline, so the strip states its axis: where it starts (clock time, or 0 in
 * a replay), how long it has been running, and where "now" is. The axis runs
 * from the session start to the present moment and grows continuously — one
 * `setInterval` tick a second drives it, never the event stream, so a burst of
 * WebSocket frames costs no extra render here.
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

const LEGEND: { category: SessionEventCategory; label: string }[] = [
  { category: "incident", label: "Incident" },
  { category: "geofence-enter", label: "Geofence" },
  { category: "dispatch", label: "Dispatch" },
];

export const EMPTY_COPY =
  "No events yet. Incidents, geofence crossings and dispatches will appear here.";

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock `HH:MM:SS` for a live event. */
function clockTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Wall-clock `HH:MM` — the axis ends, where seconds would only be noise. */
export function axisClock(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `MM:SS` offset into a recording. */
function offsetTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * How long the session has been running: `MM:SS`, widening to `H:MM:SS` only
 * once there is an hour to show, so the common case stays four digits wide.
 */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Shortest live axis we will draw. A session two seconds old would otherwise
 * put its only two ticks at opposite ends of a 1200 px strip and imply they
 * were far apart; a floor of a minute keeps early ticks clustered where they
 * belong and gives the axis a stable meaning from the first second.
 */
export const MIN_LIVE_SPAN_MS = 60_000;

/** Live axis length: session start → now, never shorter than the floor. */
export function liveSpan(startedAt: number, now: number): number {
  return Math.max(MIN_LIVE_SPAN_MS, now - startedAt);
}

/**
 * Where each event sits on the axis, as a 0–1 fraction.
 *
 * Replay: the recording's own [0, duration] axis, which is what makes a tick
 * directly seekable.
 *
 * Live: `(at - start) / span`, with the span running from the session start to
 * the present moment. Both ends are *stated* on the strip, so a position means
 * something concrete ("a third of the way through the session") rather than
 * being an unlabelled proportion of an invisible window.
 */
export function tickOffsets(
  events: readonly SessionEvent[],
  seekable: boolean,
  duration: number,
  startedAt: number,
  span: number
): Map<number, number> {
  const out = new Map<number, number>();
  if (seekable) {
    for (const e of events) {
      out.set(e.id, Math.min(Math.max((e.replayTime ?? 0) / duration, 0), 1));
    }
    return out;
  }
  for (const e of events) {
    out.set(e.id, Math.min(Math.max((e.at - startedAt) / span, 0), 1));
  }
  return out;
}

/**
 * Fraction of the strip's width within which two ticks are treated as
 * overlapping. ~1.2% is roughly the 12px tick body at a typical strip width,
 * i.e. the point at which two markers would sit on top of each other and the
 * lower one would become unclickable.
 */
export const CLUSTER_THRESHOLD = 0.012;

/** Which category a merged marker takes its colour from — worst news wins. */
const CATEGORY_RANK: Record<SessionEventCategory, number> = {
  incident: 3,
  "geofence-enter": 2,
  "geofence-exit": 2,
  dispatch: 1,
};

export interface TickCluster {
  /** Cluster identity; stable across renders while its membership holds. */
  key: string;
  offset: number;
  events: SessionEvent[];
  /** Highest-ranked category present, which drives the marker's colour. */
  category: SessionEventCategory;
}

/**
 * Collapses ticks that would render on top of each other into one marker.
 *
 * Without this, a burst — twenty geofence crossings in two seconds — stacks
 * twenty absolutely-positioned buttons at nearly the same offset: the last one
 * rendered swallows every click and the rest are unreachable, while the group
 * reads as a single undifferentiated blob anyway.
 */
export function clusterTicks(
  events: readonly SessionEvent[],
  offsets: Map<number, number>,
  threshold = CLUSTER_THRESHOLD
): TickCluster[] {
  const positioned = events
    .map((e) => ({ e, offset: offsets.get(e.id) ?? 0 }))
    .sort((a, b) => a.offset - b.offset);

  const clusters: TickCluster[] = [];
  for (const { e, offset } of positioned) {
    const open = clusters[clusters.length - 1];
    if (open && offset - open.offset <= threshold) {
      open.events.push(e);
      if (CATEGORY_RANK[e.category] > CATEGORY_RANK[open.category]) open.category = e.category;
      continue;
    }
    clusters.push({ key: `c${e.id}`, offset, events: [e], category: e.category });
  }
  return clusters;
}

export default function SessionTimeline({
  replayStatus,
  onSeek,
  onSelectVehicle,
  className,
}: SessionTimelineProps) {
  const events = useSessionEvents();
  const evicted = useEvictedSessionEvents();
  const duration = replayStatus.duration ?? 0;
  const seekable = replayStatus.mode === "replay" && duration > 0;

  // The right end of the live axis. One state tick a second — deliberately not
  // derived from the event stream, so a burst of WS frames re-renders nothing
  // here and an idle session still shows its clock running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Mount anchors the axis for a session that has not produced an event yet,
  // and loses to the first event when that one is older (a strip mounted after
  // the session began must not claim the session began with it).
  const mountedAtRef = useRef(now);
  useEffect(() => {
    sessionEventStore.noteSessionStart(mountedAtRef.current);
  }, []);
  const storedStart = useSessionStartedAt();
  const startedAt =
    storedStart != null ? Math.min(storedStart, mountedAtRef.current) : mountedAtRef.current;

  const span = seekable ? duration : liveSpan(startedAt, now);
  const elapsed = seekable ? (replayStatus.currentTime ?? 0) : Math.max(0, now - startedAt);

  const offsets = useMemo(
    () => tickOffsets(events, seekable, duration, startedAt, span),
    [events, seekable, duration, startedAt, span]
  );
  const clusters = useMemo(() => clusterTicks(events, offsets), [events, offsets]);

  /**
   * Which member of a merged marker the next click targets. Cycling is what
   * makes every event in a burst reachable — without it the cluster would only
   * ever act on one of them, which is the bug this replaces.
   */
  const cycleRef = useRef(new Map<string, number>());

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

  const isActionable = useCallback(
    (event: SessionEvent) => (seekable ? event.replayTime != null : event.vehicleId != null),
    [seekable]
  );

  const activateCluster = useCallback(
    (cluster: TickCluster) => {
      const reachable = cluster.events.filter(isActionable);
      if (reachable.length === 0) return;
      const seen = cycleRef.current.get(cluster.key) ?? 0;
      const target = reachable[seen % reachable.length];
      cycleRef.current.set(cluster.key, seen + 1);
      activate(target);
    },
    [activate, isActionable]
  );

  const playhead = seekable ? Math.min((replayStatus.currentTime ?? 0) / duration, 1) : null;
  const axisStartLabel = seekable ? offsetTime(0) : axisClock(startedAt);
  const axisEndLabel = seekable ? offsetTime(duration) : axisClock(now);

  return (
    <div
      role="region"
      aria-label="Session timeline"
      data-seekable={seekable ? "" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 border-t border-border surface-glass glass-frost px-2",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <Clock aria-hidden className="size-3 text-muted-foreground/70" strokeWidth={2} />
        <span className="text-meta font-medium leading-none text-muted-foreground">Session</span>
        <span
          data-testid="session-timeline-elapsed"
          title={seekable ? "Position in the recording" : "Time since this session started"}
          className={cn(mono, "text-meta leading-none text-foreground/80")}
        >
          {elapsedLabel(elapsed)}
        </span>
      </div>

      {evicted > 0 && (
        <span
          data-testid="session-timeline-evicted"
          title={`${evicted} earlier event${
            evicted === 1 ? "" : "s"
          } are no longer retained — the strip keeps the most recent ${MAX_SESSION_EVENTS}.`}
          className={cn(
            mono,
            "shrink-0 rounded-sm bg-muted/50 px-1 py-px text-micro leading-none text-muted-foreground"
          )}
        >
          +{evicted} earlier
        </span>
      )}

      <div
        role="group"
        aria-label="Session events"
        className="relative h-full min-w-0 flex-1 overflow-hidden"
      >
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />

        {/* Axis ends, inset so they clear the ticks that sit on them. */}
        <span
          aria-hidden
          data-testid="session-timeline-axis-start"
          className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-micro leading-none text-muted-foreground/60"
        >
          {axisStartLabel}
        </span>
        <span
          aria-hidden
          data-testid="session-timeline-axis-end"
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-micro leading-none text-muted-foreground/60"
        >
          {axisEndLabel}
        </span>

        {playhead != null && (
          <div
            aria-hidden
            data-testid="session-timeline-playhead"
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground/60"
            style={{ left: `${playhead * 100}%` }}
          />
        )}

        {!seekable && (
          <div
            aria-hidden
            data-testid="session-timeline-now"
            className="absolute right-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground/60"
          />
        )}

        {events.length === 0 && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-micro leading-none text-muted-foreground/60">
            {EMPTY_COPY}
          </span>
        )}

        {clusters.map((cluster) => {
          const merged = cluster.events.length > 1;
          const actionable = cluster.events.some(isActionable);
          const describe = (e: SessionEvent) =>
            `${CATEGORY_NAME[e.category]} · ${
              seekable ? offsetTime(e.replayTime ?? 0) : clockTime(e.at)
            } — ${e.label}`;
          const label = merged
            ? `${cluster.events.length} events${
                seekable ? " (click to step through them)" : ""
              }: ${cluster.events.map(describe).join("; ")}`
            : `${describe(cluster.events[0])}${seekable ? " (seek here)" : ""}`;
          return (
            <button
              key={cluster.key}
              type="button"
              data-category={cluster.category}
              data-actionable={actionable ? "" : undefined}
              data-count={merged ? cluster.events.length : undefined}
              aria-disabled={actionable ? undefined : "true"}
              aria-label={label}
              title={label}
              onClick={() => {
                if (actionable) activateCluster(cluster);
              }}
              // 16px of hit area around a 3px mark: the tick stays hairline,
              // the target stays clickable.
              className={cn(
                "group absolute top-1/2 flex h-full w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                actionable ? "cursor-pointer hover:bg-foreground/5" : "cursor-default"
              )}
              style={{ left: `${cluster.offset * 100}%` }}
            >
              <span
                className={cn(
                  "rounded-full transition-[transform,opacity] duration-fast ease-standard",
                  // A merged marker is wider, not taller: height already encodes
                  // category, so widening is the only free channel left.
                  merged ? "w-[7px]" : "w-[3px]",
                  CATEGORY_TICK[cluster.category],
                  CATEGORY_HEIGHT[cluster.category],
                  actionable
                    ? "opacity-90 group-hover:scale-y-125 group-hover:opacity-100"
                    : "opacity-40"
                )}
              />
              {merged && (
                <span
                  aria-hidden
                  className="absolute top-0 left-1/2 -translate-x-1/2 text-micro font-semibold leading-none text-muted-foreground"
                >
                  {cluster.events.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend — glanceable only, so it is the first thing to drop when narrow. */}
      <ul className="hidden shrink-0 items-center gap-2.5 lg:flex">
        {LEGEND.map(({ category, label }) => (
          <li key={category} className="flex items-center gap-1 text-muted-foreground/80">
            <span
              aria-hidden
              className={cn("block size-1.5 rounded-full", CATEGORY_TICK[category])}
            />
            <span className="text-micro leading-none">{label}</span>
          </li>
        ))}
      </ul>

      <span
        className={cn(
          mono,
          "shrink-0 rounded-sm border px-1 py-px text-micro uppercase leading-[1.4] tracking-wider",
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
