import classNames from "classnames";
import type { Fleet, Vehicle, DispatchAssignment, DirectionResult } from "@/types";
import { DispatchState } from "@/hooks/useDispatchState";
import useData from "@/data/useData";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import styles from "./Vehicles.module.css";
import { Search } from "@/components/Icons";

function SpeedBar({ speed, maxSpeed }: { speed: number; maxSpeed: number }) {
  const width = maxSpeed > 0 ? Math.min((speed / maxSpeed) * 100, 100) : 0;

  return <div className={styles.speedBar} style={{ width: `${width}%` }} />;
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

function WaypointBadge({ assignment }: { assignment: DispatchAssignment }) {
  const count = assignment.waypoints.length;
  return (
    <span className={styles.waypointBadge}>
      {count} {count === 1 ? "stop" : "stops"}
    </span>
  );
}

function ResultBadge({ result }: { result: DirectionResult }) {
  if (result.status === "error") {
    return (
      <span className={classNames(styles.resultBadge, styles.resultBadgeError)}>No route</span>
    );
  }

  // Multi-stop result
  if (result.waypointCount && result.waypointCount > 1) {
    const totalDistance = result.legs
      ? result.legs.reduce((sum, leg) => sum + leg.distance, 0)
      : (result.route?.distance ?? 0);
    return (
      <span className={classNames(styles.resultBadge, styles.resultBadgeOk)}>
        {result.waypointCount} stops, {totalDistance.toFixed(1)} km
      </span>
    );
  }

  // Single-stop with ETA
  if (result.eta !== undefined) {
    return (
      <span className={classNames(styles.resultBadge, styles.resultBadgeOk)}>
        ETA {Math.round(result.eta)}s
      </span>
    );
  }

  // OK without ETA
  return <span className={classNames(styles.resultBadge, styles.resultBadgeOk)}>Dispatched</span>;
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
  const { directions } = useData();
  const visibleVehicles = vehicles.filter((v) => v.visible);

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
      >
        <div className={styles.filterInputWrapper}>
          <Search className={styles.filterIcon} aria-hidden="true" />
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search vehicles…"
            className={styles.filterInput}
          />
          {filter ? (
            <button
              className={styles.filterClear}
              onClick={() => onFilterChange("")}
              aria-label="Clear search"
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>
      </PanelHeader>

      <PanelBody
        padded={false}
        className={classNames(styles.vehicles, { [styles.dimmed]: isDispatch })}
      >
        {visibleVehicles.length === 0 ? (
          <PanelEmptyState>
            {filter ? `No vehicles match "${filter}"` : "No vehicles"}
          </PanelEmptyState>
        ) : (
          visibleVehicles.map((vehicle) => {
            const routeDistance = directions.get(vehicle.id)?.route.distance;
            const vehicleFleet = fleets.find((f) => f.vehicleIds.includes(vehicle.id));
            const isChecked = selectedForDispatch?.includes(vehicle.id) ?? false;
            const assignment = assignments?.find((a) => a.vehicleId === vehicle.id);
            const result = results?.find((r) => r.vehicleId === vehicle.id);

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
                className={classNames(styles.vehicle, {
                  [styles.selected]: !showCheckbox && !isResults && vehicle.selected,
                  [styles.dispatchSelected]: showCheckbox && isChecked,
                })}
                type="button"
                onClick={handleClick}
                onMouseEnter={() => onHoverVehicle(vehicle.id)}
                onMouseLeave={() => onUnhoverVehicle()}
                aria-pressed={showCheckbox ? isChecked : vehicle.selected}
                title={`${vehicle.name} · ${Math.round(vehicle.speed)} km/h · ${formatRouteDistance(routeDistance)}`}
              >
                <span className={styles.nameGroup}>
                  {showCheckbox ? (
                    <span
                      className={classNames(styles.checkbox, {
                        [styles.checkboxChecked]: isChecked,
                      })}
                    />
                  ) : (
                    <span
                      className={styles.fleetDot}
                      style={{ backgroundColor: vehicleFleet?.color ?? "transparent" }}
                    />
                  )}
                  <span className={styles.name}>{vehicle.name}</span>
                </span>
                <span className={styles.speed}>
                  {Math.round(vehicle.speed)}
                  <span className={styles.speedUnit}>km/h</span>
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
                <span className={styles.routeRow}>
                  <span className={styles.routeDistance}>{formatRouteDistance(routeDistance)}</span>
                </span>
                <SpeedBar speed={vehicle.speed} maxSpeed={maxSpeed} />
              </button>
            );
          })
        )}
      </PanelBody>
    </>
  );
}
