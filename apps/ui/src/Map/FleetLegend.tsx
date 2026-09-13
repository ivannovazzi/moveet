import { useRef } from "react";
import { cn } from "@/lib/utils";
import { CarIcon } from "@/components/Icons";
import type { Fleet } from "@/types";
import { renderInSlot, type LegendSlot } from "./LegendStack";

interface FleetLegendProps {
  fleets: Fleet[];
  hiddenFleetIds: Set<string>;
  onToggle: (fleetId: string) => void;
  legendSlot?: LegendSlot;
}

/**
 * Which fleets are drawn, as the last card in the legend column (see
 * `LegendStack` / `LEGEND_ORDER.fleets`). Unlike the other legends it is
 * operated as well as read - each row toggles its fleet - so it re-enables
 * pointer events on itself inside the click-through column.
 */
export default function FleetLegend({
  fleets,
  hiddenFleetIds,
  onToggle,
  legendSlot,
}: FleetLegendProps) {
  // Stagger the entrance only on the first paint. The legend re-renders as
  // fleet vehicle counts tick; replaying the fade-up each time would flicker.
  const mountedRef = useRef(false);
  const firstPaint = !mountedRef.current;
  mountedRef.current = true;

  if (fleets.length === 0) return null;

  return renderInSlot(
    legendSlot,
    "fleets",
    <div
      data-testid="fleet-legend"
      className={cn(
        "pointer-events-auto flex max-h-[40vh] w-full flex-col gap-1 overflow-y-auto rounded-lg border border-border",
        "surface-glass glass-frost p-2.5 shadow-elevated"
      )}
    >
      <div className="flex items-center gap-1.5">
        <CarIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate text-meta font-medium tracking-tight text-foreground">
          Fleets
        </span>
      </div>
      {fleets.map((fleet, i) => {
        const hidden = hiddenFleetIds.has(fleet.id);
        return (
          <button
            key={fleet.id}
            type="button"
            onClick={() => onToggle(fleet.id)}
            aria-pressed={!hidden}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-left transition-colors duration-fast ease-standard hover:bg-accent/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hidden && "opacity-40",
              firstPaint && "animate-fade-up"
            )}
            style={firstPaint ? { animationDelay: `${Math.min(i, 6) * 30}ms` } : undefined}
            title={hidden ? `Show ${fleet.name}` : `Hide ${fleet.name}`}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full shadow-raised"
              style={{ backgroundColor: fleet.color }}
            />
            <span className="whitespace-nowrap text-sm tracking-tight text-foreground">
              {fleet.name}
            </span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {fleet.vehicleIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
