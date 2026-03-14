import { useState, useCallback } from "react";
import classNames from "classnames";
import client from "@/utils/client";
import type { Vehicle, DispatchAssignment, DirectionResult } from "@/types";
import styles from "./BatchDispatch.module.css";

interface BatchDispatchProps {
  assignments: DispatchAssignment[];
  onRemoveAssignment: (vehicleId: string) => void;
  onRemoveWaypoint: (vehicleId: string, waypointIndex: number) => void;
  onClearAll: () => void;
  onClose: () => void;
  vehicles: Vehicle[];
  isDispatchMode: boolean;
  onToggleDispatchMode: () => void;
  selectedForDispatch: string[];
  onToggleVehicleForDispatch: (id: string) => void;
  onSelectAllForDispatch: () => void;
  onClearSelection: () => void;
}

export default function BatchDispatch({
  assignments,
  onRemoveAssignment,
  onRemoveWaypoint,
  onClearAll,
  onClose,
  vehicles,
  isDispatchMode,
  onToggleDispatchMode,
  selectedForDispatch,
  onToggleVehicleForDispatch,
  onSelectAllForDispatch,
  onClearSelection,
}: BatchDispatchProps) {
  const [results, setResults] = useState<DirectionResult[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(new Set());
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((vehicleId: string) => {
    setExpandedAssignments((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) {
        next.delete(vehicleId);
      } else {
        next.add(vehicleId);
      }
      return next;
    });
  }, []);

  const toggleResultExpanded = useCallback((vehicleId: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) {
        next.delete(vehicleId);
      } else {
        next.add(vehicleId);
      }
      return next;
    });
  }, []);

  const handleDispatch = useCallback(async () => {
    if (assignments.length === 0) return;
    setDispatching(true);
    setResults([]);
    setError(null);

    const body = assignments.map((a) => {
      const dest = a.waypoints[a.waypoints.length - 1];
      return {
        id: a.vehicleId,
        lat: dest.position[0],
        lng: dest.position[1],
        ...(a.waypoints.length > 1
          ? {
              waypoints: a.waypoints.map((wp) => ({
                lat: wp.position[0],
                lng: wp.position[1],
                ...(wp.label ? { label: wp.label } : {}),
                ...(wp.dwellTime != null ? { dwellTime: wp.dwellTime } : {}),
              })),
            }
          : {}),
      };
    });

    const response = await client.batchDirection(body);
    setDispatching(false);

    if (response.data?.results) {
      setResults(response.data.results);
    } else {
      setError(response.error ?? "Dispatch failed");
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

      {isDispatchMode && assignments.length > 0 && (
        <button type="button" className={styles.doneButton} onClick={onToggleDispatchMode}>
          Done adding waypoints
        </button>
      )}

      {isDispatchMode && availableVehicles.length > 0 && (
        <div className={styles.vehiclePicker}>
          <div className={styles.vehiclePickerHeader}>
            <span className={styles.vehiclePickerLabel}>
              {selectedForDispatch.length > 0
                ? `${selectedForDispatch.length} selected — click map to assign`
                : "Select vehicles to dispatch"}
            </span>
            <div className={styles.vehiclePickerActions}>
              {selectedForDispatch.length < availableVehicles.length ? (
                <button
                  type="button"
                  className={styles.vehiclePickerAction}
                  onClick={onSelectAllForDispatch}
                >
                  All
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.vehiclePickerAction}
                  onClick={onClearSelection}
                >
                  None
                </button>
              )}
            </div>
          </div>
          <div className={styles.vehiclePickerList}>
            {availableVehicles.map((v) => {
              const isSelected = selectedForDispatch.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  className={classNames(styles.vehiclePickerItem, {
                    [styles.vehiclePickerItemSelected]: isSelected,
                  })}
                  onClick={() => onToggleVehicleForDispatch(v.id)}
                >
                  <span
                    className={classNames(styles.vehiclePickerCheck, {
                      [styles.vehiclePickerCheckActive]: isSelected,
                    })}
                  />
                  <span className={styles.vehiclePickerName}>{v.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.assignmentList}>
        {assignments.length === 0 ? (
          <div className={styles.empty}>
            {isDispatchMode
              ? "Select vehicles in the list, then click the map"
              : "No pending assignments"}
          </div>
        ) : (
          assignments.map((assignment) => {
            const dest = assignment.waypoints[assignment.waypoints.length - 1];
            const waypointCount = assignment.waypoints.length;
            const isExpanded = expandedAssignments.has(assignment.vehicleId);

            return (
              <div key={assignment.vehicleId} className={styles.assignmentGroup}>
                <div className={styles.assignment}>
                  <span className={styles.assignmentName}>{assignment.vehicleName}</span>
                  <span className={styles.assignmentArrow}>&rarr;</span>
                  <span className={styles.assignmentCoords}>
                    {waypointCount > 1
                      ? `${waypointCount} stops`
                      : `${dest.position[0].toFixed(4)}, ${dest.position[1].toFixed(4)}`}
                  </span>
                  {waypointCount > 1 && (
                    <button
                      type="button"
                      className={styles.waypointBadge}
                      onClick={() => toggleExpanded(assignment.vehicleId)}
                      title={isExpanded ? "Collapse waypoints" : "Expand waypoints"}
                    >
                      {waypointCount} pts
                    </button>
                  )}
                  <button
                    className={styles.removeButton}
                    onClick={() => onRemoveAssignment(assignment.vehicleId)}
                    type="button"
                    title="Remove assignment"
                  >
                    x
                  </button>
                </div>
                {waypointCount > 1 && isExpanded && (
                  <div className={styles.waypointList}>
                    {assignment.waypoints.map((wp, i) => (
                      <div key={i} className={styles.waypointRow}>
                        <span className={styles.waypointIndex}>{i + 1}</span>
                        <span className={styles.waypointCoords}>
                          {wp.position[0].toFixed(4)}, {wp.position[1].toFixed(4)}
                        </span>
                        {wp.label && <span className={styles.waypointLabel}>{wp.label}</span>}
                        <button
                          type="button"
                          className={styles.waypointRemove}
                          onClick={() => onRemoveWaypoint(assignment.vehicleId, i)}
                          title={`Remove waypoint ${i + 1}`}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div className={classNames(styles.resultRow, styles.resultError)}>
          <span className={styles.resultDetail}>{error}</span>
        </div>
      )}

      {results.length > 0 && (
        <div className={styles.results}>
          {results.map((result) => {
            const vehicle = vehicles.find((v) => v.id === result.vehicleId);
            const hasLegs = result.legs != null && result.legs.length > 0;
            const isExpanded = expandedResults.has(result.vehicleId);
            const totalDistance =
              result.waypointCount != null && result.route?.distance != null
                ? (result.route.distance / 1000).toFixed(1)
                : null;

            const buildDetail = () => {
              if (result.status !== "ok") return result.error ?? "Failed";
              const parts: string[] = [];
              if (result.waypointCount != null) {
                parts.push(
                  `${result.waypointCount} stop${result.waypointCount !== 1 ? "s" : ""}${totalDistance != null ? `, ${totalDistance} km` : ""}`
                );
              }
              if (result.eta != null) {
                parts.push(`ETA ${result.eta.toFixed(0)}s`);
              }
              if (parts.length > 0) return parts.join(" \u00B7 ");
              return "Dispatched";
            };

            return (
              <div key={result.vehicleId}>
                <div
                  className={classNames(styles.resultRow, {
                    [styles.resultOk]: result.status === "ok",
                    [styles.resultError]: result.status === "error",
                    [styles.resultExpandable]: hasLegs,
                  })}
                  onClick={hasLegs ? () => toggleResultExpanded(result.vehicleId) : undefined}
                >
                  <span className={styles.resultName}>{vehicle?.name ?? result.vehicleId}</span>
                  <span className={styles.resultDetail}>{buildDetail()}</span>
                  {hasLegs && (
                    <span className={styles.resultDetail}>
                      {isExpanded ? "\u25B4" : "\u25BE"}
                    </span>
                  )}
                </div>
                {hasLegs && isExpanded && (
                  <div className={styles.legList}>
                    {result.legs!.map((leg, i) => (
                      <div key={i} className={styles.legRow}>
                        Leg {i + 1}: {(leg.distance / 1000).toFixed(1)} km
                      </div>
                    ))}
                  </div>
                )}
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
