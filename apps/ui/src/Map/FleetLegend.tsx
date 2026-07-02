import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { Fleet } from "@/types";

interface FleetLegendProps {
  fleets: Fleet[];
  hiddenFleetIds: Set<string>;
  onToggle: (fleetId: string) => void;
}

export default function FleetLegend({ fleets, hiddenFleetIds, onToggle }: FleetLegendProps) {
  // Stagger the entrance only on the first paint. The legend re-renders as
  // fleet vehicle counts tick; replaying the fade-up each time would flicker.
  const mountedRef = useRef(false);
  const firstPaint = !mountedRef.current;
  mountedRef.current = true;

  if (fleets.length === 0) return null;

  return (
    <div className="absolute bottom-20 right-3 z-10 flex max-h-[40vh] flex-col gap-2 overflow-y-auto rounded-lg border border-border surface-glass p-3 shadow-elevated backdrop-blur-md">
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
