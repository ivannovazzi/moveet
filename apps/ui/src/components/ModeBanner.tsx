import { cn } from "@/lib/utils";
import { Directions, GeofenceIcon } from "@/components/Icons";
import { DispatchState } from "@/hooks/useDispatchState";
import type { InteractionMode } from "@/hooks/useInteractionMode";

interface ModeBannerProps {
  mode: InteractionMode;
  /** Dispatch sub-state, drives the per-phase hint while `mode` is dispatch. */
  dispatchState: DispatchState;
  selectedCount: number;
  stopCount: number;
  /** Vertex count of the in-progress polygon while `mode` is draw-geofence. */
  drawVertexCount: number;
  /** Exit the active mode (cancel draw / end dispatch). */
  onExit: () => void;
}

function dispatchHint(
  state: DispatchState,
  selectedCount: number,
  stopCount: number
): { text: string; busy: boolean } {
  switch (state) {
    case DispatchState.ROUTE:
      return {
        text:
          stopCount > 0
            ? "Click map to add another stop • drag to move • right-click to delete • Enter to dispatch"
            : "Click the map to place a stop for the selected vehicles • Enter to dispatch",
        busy: false,
      };
    case DispatchState.DISPATCH:
      return { text: "Dispatching…", busy: true };
    case DispatchState.RESULTS:
      return { text: "Dispatch complete • review results in the panel", busy: false };
    default:
      // SELECT (and BROWSE, transiently, before the sub-state catches up)
      return {
        text:
          selectedCount > 0
            ? "Click the map to place a stop for selected vehicles"
            : "Click vehicles in the list (or on the map) to select",
        busy: false,
      };
  }
}

function drawHint(vertexCount: number): string {
  if (vertexCount === 0) return "Click the map to place points — at least 3";
  if (vertexCount < 3)
    return `${vertexCount} point${vertexCount === 1 ? "" : "s"} — add ${3 - vertexCount} more`;
  return "Click the first point or press Enter to finish • drag to move • click an edge to insert • right-click to delete";
}

/**
 * The single top-center banner for the active interaction mode. Replaces the
 * dispatch flow's DispatchHint and the geofence draw tool's inline banner,
 * which used to render on top of each other — and, unlike them, it always
 * offers an explicit Exit so a mode can never be orphaned when its side panel
 * is closed.
 */
export default function ModeBanner({
  mode,
  dispatchState,
  selectedCount,
  stopCount,
  drawVertexCount,
  onExit,
}: ModeBannerProps) {
  if (mode.kind === "browse") return null;

  const isDraw = mode.kind === "draw-geofence";
  const { text, busy } = isDraw
    ? { text: drawHint(drawVertexCount), busy: false }
    : dispatchHint(dispatchState, selectedCount, stopCount);
  const Icon = isDraw ? GeofenceIcon : Directions;
  const label = isDraw ? "Draw zone" : "Dispatch";

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none absolute left-1/2 top-3 z-40 flex max-w-[min(90%,720px)] -translate-x-1/2 items-center gap-3",
        "rounded-lg border border-border surface-glass px-4 py-2 shadow-elevated backdrop-blur-md"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider",
          busy ? "text-accent" : "text-muted-foreground"
        )}
      >
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="min-w-0 truncate text-xs font-medium tracking-wide text-foreground">
        {text}
      </span>
      <button
        type="button"
        onClick={onExit}
        className={cn(
          "pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2 py-1",
          "text-xs font-medium text-muted-foreground transition-colors duration-fast ease-standard",
          "hover:bg-foreground/10 hover:text-foreground"
        )}
      >
        Exit
        <kbd className="rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">
          Esc
        </kbd>
      </button>
    </div>
  );
}
