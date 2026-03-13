import { useState, useCallback } from "react";
import classNames from "classnames";
import client from "@/utils/client";
import type { Vehicle, DispatchAssignment, DirectionResult } from "@/types";
import styles from "./BatchDispatch.module.css";

interface BatchDispatchProps {
  assignments: DispatchAssignment[];
  onAddAssignment?: (assignment: DispatchAssignment) => void;
  onRemoveAssignment: (vehicleId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  vehicles: Vehicle[];
  isDispatchMode: boolean;
  onToggleDispatchMode: () => void;
}

export default function BatchDispatch({
  assignments,
  onRemoveAssignment,
  onClearAll,
  onClose,
  vehicles,
  isDispatchMode,
  onToggleDispatchMode,
}: BatchDispatchProps) {
  const [results, setResults] = useState<DirectionResult[]>([]);
  const [dispatching, setDispatching] = useState(false);

  const handleDispatch = useCallback(async () => {
    if (assignments.length === 0) return;
    setDispatching(true);
    setResults([]);

    const body = assignments.map((a) => ({
      id: a.vehicleId,
      lat: a.destination[0],
      lng: a.destination[1],
    }));

    const response = await client.batchDirection(body);
    setDispatching(false);

    if (response.data?.results) {
      setResults(response.data.results);
    }
  }, [assignments]);

  const assignedVehicleIds = new Set(assignments.map((a) => a.vehicleId));
  const availableVehicles = vehicles.filter((v) => v.visible && !assignedVehicleIds.has(v.id));

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>Dispatch</span>
        <button
          className={styles.closeButton}
          onClick={onClose}
          type="button"
          aria-label="Close dispatch panel"
        >
          x
        </button>
      </div>

      <button
        type="button"
        className={classNames(styles.modeToggle, {
          [styles.modeToggleActive]: isDispatchMode,
        })}
        onClick={onToggleDispatchMode}
      >
        <span
          className={classNames(styles.modeDot, {
            [styles.modeDotActive]: isDispatchMode,
          })}
        />
        <span className={styles.modeLabel}>
          {isDispatchMode ? "Click map to set destination" : "Enable map click mode"}
        </span>
      </button>

      {availableVehicles.length > 0 && (
        <select className={styles.vehicleSelect} disabled title="Select vehicles, then click the map">
          <option>
            {availableVehicles.length} vehicle{availableVehicles.length !== 1 ? "s" : ""} available
          </option>
        </select>
      )}

      <div className={styles.assignmentList}>
        {assignments.length === 0 ? (
          <div className={styles.empty}>
            {isDispatchMode
              ? "Select vehicles in the list, then click the map"
              : "No pending assignments"}
          </div>
        ) : (
          assignments.map((assignment) => (
            <div key={assignment.vehicleId} className={styles.assignment}>
              <span className={styles.assignmentName}>{assignment.vehicleName}</span>
              <span className={styles.assignmentArrow}>&rarr;</span>
              <span className={styles.assignmentCoords}>
                {assignment.destination[0].toFixed(4)}, {assignment.destination[1].toFixed(4)}
              </span>
              <button
                className={styles.removeButton}
                onClick={() => onRemoveAssignment(assignment.vehicleId)}
                type="button"
                title="Remove assignment"
              >
                x
              </button>
            </div>
          ))
        )}
      </div>

      {results.length > 0 && (
        <div className={styles.results}>
          {results.map((result) => {
            const vehicle = vehicles.find((v) => v.id === result.vehicleId);
            return (
              <div
                key={result.vehicleId}
                className={classNames(styles.resultRow, {
                  [styles.resultOk]: result.status === "ok",
                  [styles.resultError]: result.status === "error",
                })}
              >
                <span className={styles.resultName}>{vehicle?.name ?? result.vehicleId}</span>
                <span className={styles.resultDetail}>
                  {result.status === "ok"
                    ? result.eta != null
                      ? `ETA ${result.eta.toFixed(0)}s`
                      : "Dispatched"
                    : result.error ?? "Failed"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.dispatchButton}
          onClick={handleDispatch}
          disabled={assignments.length === 0 || dispatching}
          type="button"
        >
          {dispatching ? "Dispatching..." : `Dispatch All (${assignments.length})`}
        </button>
        {assignments.length > 0 && (
          <button className={styles.clearButton} onClick={onClearAll} type="button">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
