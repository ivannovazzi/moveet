import classNames from "classnames";
import type { Fleet, Vehicle } from "@/types";
import useData from "@/data/useData";
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
  onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
}

function formatRouteDistance(distance?: number) {
  return distance === undefined ? "No route" : `Route ${distance.toFixed(1)} km`;
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
  onAssignVehicle,
  onUnassignVehicle,
}: VehicleListProps) {
  const { directions } = useData();
  const visibleVehicles = vehicles.filter((v) => v.visible);

  return (
    <>
      <div className={styles.sidebarHeader}>
        <div className={styles.panelEyebrow}>Fleet overview</div>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>Vehicles</h2>
          <span className={styles.panelBadge}>{visibleVehicles.length}</span>
          <p className={styles.panelSubtitle}>
            {filter
              ? `Showing ${visibleVehicles.length} of ${vehicles.length} matching "${filter}"`
              : `${vehicles.length} tracked units`}
          </p>
        </div>

        <div className={styles.filterInputWrapper}>
          <Search className={styles.filterIcon} aria-hidden="true" />
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search vehicles…"
            className={styles.filterInput}
          />
          {filter && (
            <button
              className={styles.filterClear}
              onClick={() => onFilterChange("")}
              aria-label="Clear search"
              type="button"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className={styles.vehicles}>
        {visibleVehicles.length === 0 ? (
          <div className={styles.empty}>
            {filter ? `No vehicles match "${filter}"` : "No vehicles"}
          </div>
        ) : (
          visibleVehicles.map((vehicle) => {
            const routeDistance = directions.get(vehicle.id)?.distance;
            const vehicleFleet = fleets.find((f) => f.vehicleIds.includes(vehicle.id));

            return (
              <button
                key={vehicle.id}
                className={classNames(styles.vehicle, {
                  [styles.selected]: vehicle.selected,
                })}
                type="button"
                onClick={() => onSelectVehicle(vehicle.id)}
                onMouseEnter={() => onHoverVehicle(vehicle.id)}
                onMouseLeave={() => onUnhoverVehicle()}
                aria-pressed={vehicle.selected}
                title={`${vehicle.name} · ${Math.round(vehicle.speed)} km/h · ${formatRouteDistance(routeDistance)}`}
              >
                <span className={styles.nameGroup}>
                  <span className={styles.fleetDot} style={{ backgroundColor: vehicleFleet?.color ?? "transparent" }} />
                  <span className={styles.name}>{vehicle.name}</span>
                </span>
                <span className={styles.speed}>
                  {Math.round(vehicle.speed)}
                  <span className={styles.speedUnit}>km/h</span>
                </span>
                <span className={styles.routeRow}>
                  <span className={styles.routeDistance}>{formatRouteDistance(routeDistance)}</span>
                  <select
                    className={styles.fleetSelect}
                    value={vehicleFleet?.id ?? ""}
                    onChange={(e) => {
                      e.stopPropagation();
                      const val = e.target.value;
                      if (!val && vehicleFleet) onUnassignVehicle(vehicleFleet.id, vehicle.id);
                      else if (val) onAssignVehicle(val, vehicle.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">No fleet</option>
                    {fleets.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </span>
                <SpeedBar speed={vehicle.speed} maxSpeed={maxSpeed} />
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
