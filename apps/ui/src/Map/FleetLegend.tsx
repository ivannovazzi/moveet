import { cn } from "@/lib/utils";
import type { Fleet } from "@/types";

interface FleetLegendProps {
  fleets: Fleet[];
  hiddenFleetIds: Set<string>;
  onToggle: (fleetId: string) => void;
}

export default function FleetLegend({ fleets, hiddenFleetIds, onToggle }: FleetLegendProps) {
  if (fleets.length === 0) return null;

  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-2 rounded-lg border border-border bg-card/80 p-3 shadow-lg backdrop-blur-md">
      {fleets.map((fleet) => {
        const hidden = hiddenFleetIds.has(fleet.id);
        return (
          <button
            key={fleet.id}
            type="button"
            onClick={() => onToggle(fleet.id)}
            aria-pressed={!hidden}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hidden && "opacity-40"
            )}
            title={hidden ? `Show ${fleet.name}` : `Hide ${fleet.name}`}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: fleet.color }}
            />
            <span className="whitespace-nowrap text-sm text-foreground">{fleet.name}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {fleet.vehicleIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
