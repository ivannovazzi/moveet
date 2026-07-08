import { useEffect, useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  MapPin,
  Navigation,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Position } from "@/types";
import { useDirectionContext } from "@/data/useData";
import {
  buildDirectionSteps,
  findActiveEdgeIndex,
  remainingDistanceKm,
  stepIndexForEdge,
  totalDistanceKm,
  type Maneuver,
} from "@/utils/directionSteps";
import {
  clearDirectionHighlight,
  sameStep,
  setHoveredStep,
  togglePinnedStep,
  useDirectionHighlight,
} from "@/hooks/directionHighlightStore";
import { Eyebrow, Hairline, mono } from "@/Dock/DockPanelKit";

/**
 * Turn-by-turn directions for the selected vehicle, rendered inside the
 * Inspector. Reads the shared direction context directly (rather than calling
 * `useDirections`) so it never registers a second set of WS listeners — the
 * always-mounted map `Direction` layer owns that subscription and this panel
 * just consumes the resulting map. The heavy step derivation is memoized on the
 * route object, so live position ticks only recompute the cheap active-step
 * lookup, not the whole list.
 */
export interface VehicleDirectionsProps {
  vehicleId: string;
  /** Current vehicle position ([lat, lng]) — drives progress highlighting. */
  position?: Position;
}

const MANEUVER_ICON: Record<Maneuver, LucideIcon> = {
  depart: Navigation,
  straight: ArrowUp,
  "slight-left": ArrowUpLeft,
  left: CornerUpLeft,
  "sharp-left": CornerUpLeft,
  "slight-right": ArrowUpRight,
  right: CornerUpRight,
  "sharp-right": CornerUpRight,
  uturn: RotateCcw,
  arrive: MapPin,
};

/** Compact distance: metres under 1 km, one-decimal km above. */
function formatDistance(km: number): string {
  if (km <= 0) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** ETA seconds → "45 s" / "12 min" / "1 h 5 min". */
function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export default function VehicleDirections({ vehicleId, position }: VehicleDirectionsProps) {
  const { directions } = useDirectionContext();
  const direction = directions.get(vehicleId);

  const steps = useMemo(
    () => (direction ? buildDirectionSteps(direction.route.edges) : []),
    [direction]
  );

  const activeStep = useMemo(() => {
    if (!direction) return -1;
    const edgeIndex = findActiveEdgeIndex(direction.route.edges, position);
    return stepIndexForEdge(steps, edgeIndex);
  }, [direction, steps, position]);

  const { hovered, pinned } = useDirectionHighlight();

  // Clear the map highlight when the panel unmounts or the vehicle changes, so
  // a stale segment never lingers after switching / closing the inspector.
  useEffect(() => clearDirectionHighlight, [vehicleId]);

  if (!direction || steps.length === 0) return null;

  const total = totalDistanceKm(direction.route);
  const remaining = activeStep >= 0 ? remainingDistanceKm(steps, activeStep) : total;
  // Steps minus the terminal "arrive" pseudo-step, for a "turns left" readout.
  const turnCount = Math.max(0, steps.length - 1);
  const eta = formatEta(direction.eta ?? 0);

  return (
    <>
      <Hairline />
      <div className="flex items-baseline justify-between gap-3 px-[15px] pb-[6px] pt-[10px]">
        <Eyebrow>Directions</Eyebrow>
        <div className={cn(mono, "flex items-center gap-1.5 text-[10.5px] text-muted-foreground")}>
          <span className="text-foreground">{formatDistance(remaining)}</span>
          {eta && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{eta}</span>
            </>
          )}
          <span className="text-muted-foreground/40">·</span>
          <span>
            {turnCount} step{turnCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <ol className="pb-2" aria-label="Turn-by-turn directions">
        {steps.map((step, i) => {
          const Icon = MANEUVER_ICON[step.maneuver];
          const isActive = i === activeStep;
          const isDone = activeStep >= 0 && i < activeStep;
          const isTerminal = step.maneuver === "arrive";
          const dist = formatDistance(step.distanceKm);
          // Only steps with a real edge span can be drawn on the map.
          const ref = { vehicleId, start: step.edgeStart, end: step.edgeEnd };
          const canHighlight = step.edgeEnd > step.edgeStart;
          const isPinned = canHighlight && sameStep(pinned, ref);
          const isHovered = canHighlight && sameStep(hovered, ref);
          return (
            <li
              key={`${step.edgeStart}-${step.maneuver}-${i}`}
              aria-current={isActive ? "step" : undefined}
            >
              <button
                type="button"
                disabled={!canHighlight}
                aria-pressed={canHighlight ? isPinned : undefined}
                onMouseEnter={canHighlight ? () => setHoveredStep(ref) : undefined}
                onMouseLeave={canHighlight ? () => setHoveredStep(null) : undefined}
                onFocus={canHighlight ? () => setHoveredStep(ref) : undefined}
                onBlur={canHighlight ? () => setHoveredStep(null) : undefined}
                onClick={canHighlight ? () => togglePinnedStep(ref) : undefined}
                className={cn(
                  "relative flex w-full items-start gap-2.5 border-t border-border-soft px-[15px] py-2 text-left transition-colors duration-fast",
                  "first:border-t-0 disabled:cursor-default",
                  canHighlight &&
                    "hover:bg-accent/60 focus-visible:outline-none focus-visible:bg-accent/60",
                  (isPinned || isHovered) && "bg-primary/10",
                  isDone && !isPinned && !isHovered && "opacity-45"
                )}
              >
                {isPinned && (
                  <span
                    className="absolute inset-y-1 left-0 w-[2px] rounded-r bg-primary"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full border",
                    isActive
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : isTerminal
                        ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                        : "border-border bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={2.25} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[12px] leading-snug",
                      isActive || isPinned ? "font-medium text-foreground" : "text-foreground/90"
                    )}
                  >
                    {step.instruction}
                  </span>
                  {dist && (
                    <span className={cn(mono, "mt-0.5 block text-[10px] text-muted-foreground/70")}>
                      {dist}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
