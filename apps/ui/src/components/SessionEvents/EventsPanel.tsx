import { cn } from "@/lib/utils";
import type { ReplayStatus } from "@/types";
import { Eyebrow, Tag, mono, type StatusTone } from "@/Dock/DockPanelKit";
import {
  useEvictedSessionEvents,
  useSessionEvents,
  type SessionEvent,
  type SessionEventCategory,
} from "./sessionEventStore";

/**
 * Everything that happened this session: incidents, geofence crossings,
 * dispatches, newest first.
 *
 * This replaces the timeline strip that used to run along the bottom of the
 * app. The strip drew each event as a tick on a time axis, which is the right
 * shape for a recording and the wrong one for a live session: a live session
 * cannot be scrubbed, so the axis was unreadable and the ticks were unlabelled
 * marks you had to hover to identify. It said "Live" where a scrubber would be,
 * and took a band off the bottom of the map to do it.
 *
 * A log is what the data actually is. The same `sessionEventStore` fills it, so
 * nothing is lost; a replay still scrubs from the dock's own transport, where
 * the playback controls already live (see `ReplayRail`).
 */
export interface EventsPanelProps {
  /** Live or replaying — a replayed event can be seeked to, a live one cannot. */
  replayStatus: ReplayStatus;
  /** Same handler the replay transport's scrubber uses. Offset into the recording, ms. */
  onSeek: (timestamp: number) => void | Promise<void>;
  /** Live fallback: select the vehicle the event belongs to. */
  onSelectVehicle: (id: string) => void;
}

const CATEGORY_NAME: Record<SessionEventCategory, string> = {
  incident: "Incident",
  "geofence-enter": "Geofence in",
  "geofence-exit": "Geofence out",
  dispatch: "Dispatch",
};

const CATEGORY_TONE: Record<SessionEventCategory, StatusTone> = {
  incident: "error",
  "geofence-enter": "accent",
  "geofence-exit": "accent",
  dispatch: "ok",
};

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

export const EMPTY_COPY =
  "No events yet. Incidents, geofence crossings and dispatches will appear here.";

export default function EventsPanel({ replayStatus, onSeek, onSelectVehicle }: EventsPanelProps) {
  const events = useSessionEvents();
  const evicted = useEvictedSessionEvents();
  const replaying = replayStatus.mode === "replay";

  if (events.length === 0) {
    return (
      <p className="px-[15px] py-6 text-center text-label text-muted-foreground">{EMPTY_COPY}</p>
    );
  }

  // Newest first: the question this answers is "what just happened", and the
  // answer should not be at the bottom of a list that grows all session.
  const rows = [...events].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {rows.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            replaying={replaying}
            onSeek={onSeek}
            onSelectVehicle={onSelectVehicle}
          />
        ))}
      </ul>
      {evicted > 0 && (
        // A bounded window that silently discards its own history is a log that
        // lies about its extent.
        <p className="shrink-0 border-t border-border-soft px-[15px] py-2 text-meta text-muted-foreground">
          {`${evicted} earlier ${evicted === 1 ? "event" : "events"} dropped from the window.`}
        </p>
      )}
    </div>
  );
}

function EventRow({
  event,
  replaying,
  onSeek,
  onSelectVehicle,
}: {
  event: SessionEvent;
  replaying: boolean;
  onSeek: EventsPanelProps["onSeek"];
  onSelectVehicle: EventsPanelProps["onSelectVehicle"];
}) {
  // Replaying, a row seeks the recording to the moment it describes; live,
  // there is nothing to seek to, so it selects the vehicle instead. A row with
  // neither is a readout, not a control, and says so by not being a button.
  const seekable = replaying && event.replayTime != null;
  const selectable = !replaying && event.vehicleId != null;
  const actionable = seekable || selectable;

  const body = (
    <>
      <span className={cn(mono, "shrink-0 text-meta text-muted-foreground")}>
        {replaying && event.replayTime != null ? offsetTime(event.replayTime) : clockTime(event.at)}
      </span>
      <Tag tone={CATEGORY_TONE[event.category]}>{CATEGORY_NAME[event.category]}</Tag>
      <span className="min-w-0 flex-1 truncate text-label text-foreground">{event.label}</span>
      {event.detail && <Eyebrow className="shrink-0 max-w-[40%] truncate">{event.detail}</Eyebrow>}
    </>
  );

  const rowClass =
    "flex w-full items-center gap-2 border-t border-border-soft px-[15px] py-2 text-left first:border-t-0";

  if (!actionable) {
    return <li className={cn(rowClass, "text-muted-foreground")}>{body}</li>;
  }

  return (
    <li className="contents">
      <button
        type="button"
        onClick={() => {
          if (seekable && event.replayTime != null) void onSeek(event.replayTime);
          else if (event.vehicleId) onSelectVehicle(event.vehicleId);
        }}
        title={seekable ? "Seek the recording here" : "Show this vehicle"}
        className={cn(
          rowClass,
          "cursor-pointer transition-colors duration-fast ease-standard",
          "hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        {body}
      </button>
    </li>
  );
}
