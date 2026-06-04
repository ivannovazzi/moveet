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
      {fleets.map((fleet) => (
        <div
          key={fleet.id}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-accent/10",
            hiddenFleetIds.has(fleet.id) && "opacity-40"
          )}
          onClick={() => onToggle(fleet.id)}
          title={hiddenFleetIds.has(fleet.id) ? `Show ${fleet.name}` : `Hide ${fleet.name}`}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: fleet.color }}
          />
          <span className="whitespace-nowrap text-sm text-foreground">{fleet.name}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {fleet.vehicleIds.length}
          </span>
        </div>
      ))}
    </div>
  );
}
