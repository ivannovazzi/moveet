import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import type { Fleet, Vehicle, DispatchAssignment, DirectionResult } from "@/types";
import { DispatchState } from "@/hooks/useDispatchState";
import { useDirectionContext } from "@/data/useData";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import { Search } from "@/components/Icons";
import { Input } from "@/components/ui/input";

const INITIAL_VISIBLE = 50;
const LOAD_MORE_COUNT = 50;

function SpeedBar({ speed, maxSpeed }: { speed: number; maxSpeed: number }) {
  const width = maxSpeed > 0 ? Math.min((speed / maxSpeed) * 100, 100) : 0;

  return (
    <div
      className="col-span-full h-[3px] rounded-r-full bg-gradient-to-r from-orange-500/60 via-yellow-400/65 to-status-ok/70 transition-[width] duration-700"
      style={{ width: `${width}%`, gridArea: "bar" }}
    />
  );
}

interface VehicleListProps {
  filter: string;
  vehicles: Vehicle[];
  maxSpeed: number;
  onFilterChange: (value: string) => void;
  onSelectVehicle: (id: string) => void;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
  fleets: Fleet[];
  dispatchState?: DispatchState;
  selectedForDispatch?: string[];
  onToggleVehicleForDispatch?: (id: string) => void;
  assignments?: DispatchAssignment[];
  results?: DirectionResult[];
}

function formatRouteDistance(distance?: number) {
  return distance === undefined ? "No route" : `Route ${distance.toFixed(1)} km`;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  truck: "Truck",
  motorcycle: "Moto",
  ambulance: "Ambulance",
  bus: "Bus",
};

function WaypointBadge({ assignment }: { assignment: DispatchAssignment }) {
  const count = assignment.waypoints.length;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-accent/20 bg-accent/10 px-2 py-px text-xs font-medium leading-snug text-accent">
      {count} {count === 1 ? "stop" : "stops"}
    </span>
  );
}

function ResultBadge({ result }: { result: DirectionResult }) {
  if (result.status === "error") {
    return (
      <span className="inline-flex items-center whitespace-nowrap text-xs font-medium leading-snug text-status-error">
        No route
      </span>
    );
  }

  const okClass =
    "inline-flex items-center whitespace-nowrap text-xs font-medium leading-snug text-status-ok";

  // Multi-stop result
  if (result.waypointCount && result.waypointCount > 1) {
    const totalDistance = result.legs
      ? result.legs.reduce((sum, leg) => sum + leg.distance, 0)
      : (result.route?.distance ?? 0);
    return (
      <span className={okClass}>
        {result.waypointCount} stops, {totalDistance.toFixed(1)} km
      </span>
    );
  }

  // Single-stop with ETA
  if (result.eta !== undefined) {
    return <span className={okClass}>ETA {Math.round(result.eta)}s</span>;
  }

  // OK without ETA
  return <span className={okClass}>Dispatched</span>;
}

export default function VehicleList({
  filter,
  vehicles,
  maxSpeed,
  onFilterChange,
  onSelectVehicle,
  onHoverVehicle,
  onUnhoverVehicle,
  fleets,
  dispatchState,
  selectedForDispatch,
  onToggleVehicleForDispatch,
  assignments,
  results,
}: VehicleListProps) {
  const { directions } = useDirectionContext();
  const visibleVehicles = vehicles.filter((v) => v.visible);

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [filter]);
  const slicedVehicles = visibleVehicles.slice(0, visibleCount);
  const hasMore = visibleVehicles.length > visibleCount;

  const isSelectOrRoute =
    dispatchState === DispatchState.SELECT || dispatchState === DispatchState.ROUTE;
  const isDispatch = dispatchState === DispatchState.DISPATCH;
  const isResults = dispatchState === DispatchState.RESULTS;
  const showCheckbox = isSelectOrRoute || isDispatch;

  return (
    <>
      <PanelHeader
        title="Vehicles"
        subtitle={
          filter
            ? `Showing ${visibleVehicles.length} of ${vehicles.length} matching "${filter}"`
            : `${vehicles.length} tracked units`
        }
        badge={<PanelBadge>{visibleVehicles.length}</PanelBadge>}
      />

      <PanelBody
        padded={false}
        className={cn("gap-1.5 p-3", isDispatch && "pointer-events-none opacity-60")}
      >
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search vehicles…"
            className="pl-9 pr-10"
            aria-label="Search vehicles"
          />
          {filter && (
            <button
              type="button"
              onClick={() => onFilterChange("")}
              className="absolute right-2 flex size-6 items-center justify-center rounded-md border border-transparent bg-accent/50 text-base leading-none text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {visibleVehicles.length === 0 ? (
          <PanelEmptyState>
            {filter ? `No vehicles match "${filter}"` : "No vehicles"}
          </PanelEmptyState>
        ) : (
          slicedVehicles.map((vehicle) => {
            const routeDistance = directions.get(vehicle.id)?.route.distance;
            const vehicleFleet = fleets.find((f) => f.vehicleIds.includes(vehicle.id));
            const isChecked = selectedForDispatch?.includes(vehicle.id) ?? false;
            const assignment = assignments?.find((a) => a.vehicleId === vehicle.id);
            const result = results?.find((r) => r.vehicleId === vehicle.id);
            const isSelected = !showCheckbox && !isResults && vehicle.selected;
            const isDispatchSelected = showCheckbox && isChecked;

            const handleClick = () => {
              if (showCheckbox && onToggleVehicleForDispatch) {
                onToggleVehicleForDispatch(vehicle.id);
              } else if (!isDispatch) {
                onSelectVehicle(vehicle.id);
              }
            };

            return (
              <button
                key={vehicle.id}
                className={cn(
                  "grid w-full flex-shrink-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 overflow-hidden rounded-md border border-border bg-card px-2.5 pb-1.5 pt-2 text-left transition-colors hover:border-border/80 hover:bg-accent/10 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  isSelected &&
                    "border-accent/25 bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]",
                  isDispatchSelected &&
                    "border-accent/20 bg-accent/5 shadow-[inset_3px_0_0_var(--color-accent)]"
                )}
                style={{
                  gridTemplateAreas: '"name speed" "route route" "bar bar"',
                }}
                type="button"
                onClick={handleClick}
                onMouseEnter={() => onHoverVehicle(vehicle.id)}
                onMouseLeave={() => onUnhoverVehicle()}
                aria-pressed={showCheckbox ? isChecked : vehicle.selected}
                aria-label={`${vehicle.name}, ${Math.round(vehicle.speed)} km/h, ${formatRouteDistance(routeDistance)}`}
                title={`${vehicle.name} · ${Math.round(vehicle.speed)} km/h · ${formatRouteDistance(routeDistance)}`}
              >
                <span className="flex min-w-0 items-center gap-2" style={{ gridArea: "name" }}>
                  {showCheckbox ? (
                    <span
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-label={`Select ${vehicle.name}`}
                      className={cn(
                        "size-3.5 flex-shrink-0 rounded-sm border border-foreground/25 transition-colors",
                        isChecked && "border-accent bg-accent"
                      )}
                    />
                  ) : (
                    <span
                      className="size-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: vehicleFleet?.color ?? "transparent" }}
                    />
                  )}
                  <span className="min-w-0 self-center truncate text-[13px] font-medium text-foreground">
                    {vehicle.name}
                  </span>
                  {vehicle.type && vehicle.type !== "car" && (
                    <span className="ml-2 rounded-sm bg-foreground/10 px-2 py-px text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {VEHICLE_TYPE_LABELS[vehicle.type] ?? vehicle.type}
                    </span>
                  )}
                </span>
                <span
                  className="flex flex-shrink-0 items-baseline gap-1 justify-self-end text-[13px] font-medium tabular-nums text-foreground"
                  style={{ gridArea: "speed" }}
                >
                  {Math.round(vehicle.speed)}
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    km/h
                  </span>
                  {dispatchState === DispatchState.ROUTE && assignment && (
                    <>
                      {" "}
                      <WaypointBadge assignment={assignment} />
                    </>
                  )}
                  {isResults && result && (
                    <>
                      {" "}
                      <ResultBadge result={result} />
                    </>
                  )}
                </span>
                <span className="flex items-center gap-3" style={{ gridArea: "route" }}>
                  <span className="text-xs text-muted-foreground">
                    {formatRouteDistance(routeDistance)}
                  </span>
                </span>
                <SpeedBar speed={vehicle.speed} maxSpeed={maxSpeed} />
              </button>
            );
          })
        )}
        {hasMore && (
          <button
            type="button"
            className="w-full rounded-md border border-dashed border-accent/20 p-2 text-xs text-accent transition-colors hover:border-accent/35 hover:bg-accent/5"
            onClick={() => setVisibleCount((c) => c + LOAD_MORE_COUNT)}
          >
            Show more ({visibleVehicles.length - visibleCount} remaining)
          </button>
        )}
      </PanelBody>
    </>
  );
}
