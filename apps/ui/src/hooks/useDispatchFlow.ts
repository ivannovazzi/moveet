import { useCallback, useState } from "react";
import client from "@/utils/client";
import type { DirectionResult, DispatchAssignment, Position, Vehicle, Waypoint } from "@/types";
import type { DispatchState } from "./useDispatchState";
import { useDispatchState } from "./useDispatchState";
import { toLatLng } from "@/utils/coordinates";

/** Identifies a specific waypoint within an assignment list. */
export interface WaypointRef {
  vehicleId: string;
  waypointIndex: number;
}

export interface DispatchFlow {
  // State
  dispatchMode: boolean;
  assignments: DispatchAssignment[];
  dispatching: boolean;
  results: DirectionResult[];
  selectedForDispatch: string[];
  dispatchState: DispatchState;
  error: string | null;

  // Actions
  toggleDispatchMode: () => void;
  handleDispatch: () => Promise<void>;
  handleDone: () => void;
  handleRetryFailed: () => void;
  onToggleVehicleForDispatch: (id: string) => void;
  onAddWaypoint: (vehicleId: string, position: Position) => void;
  addWaypointForSelected: (position: Position, vehicles: Vehicle[]) => void;
  moveWaypointGroup: (refs: WaypointRef[], newLat: number, newLng: number) => void;
  removeWaypointGroup: (refs: WaypointRef[]) => void;
  setAssignments: React.Dispatch<React.SetStateAction<DispatchAssignment[]>>;
}

export function useDispatchFlow(): DispatchFlow {
  const [dispatchMode, setDispatchMode] = useState(false);
  const [assignments, setAssignments] = useState<DispatchAssignment[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [results, setResults] = useState<DirectionResult[]>([]);
  const [selectedForDispatch, setSelectedForDispatch] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const dispatchState = useDispatchState({
    dispatchMode,
    selectedForDispatch,
    assignments,
    dispatching,
    results,
  });

  const toggleDispatchMode = useCallback(() => {
    setDispatchMode((prev) => {
      if (prev) {
        setSelectedForDispatch([]);
        setAssignments([]);
        setResults([]);
        setDispatching(false);
      }
      return !prev;
    });
  }, []);

  const onAddWaypoint = useCallback((vehicleId: string, position: Position) => {
    const newWaypoint: Waypoint = { position: toLatLng(position) };
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.vehicleId !== vehicleId) return a;
        return { ...a, waypoints: [...a.waypoints, newWaypoint] };
      })
    );
  }, []);

  const addWaypointForSelected = useCallback(
    (position: Position, vehicles: Vehicle[]) => {
      const newWaypoint: Waypoint = { position: toLatLng(position) };

      setAssignments((prev) => {
        // Append waypoint to existing assignments for selected vehicles
        const updated = prev.map((a) => {
          if (!selectedForDispatch.includes(a.vehicleId)) return a;
          return { ...a, waypoints: [...a.waypoints, newWaypoint] };
        });

        // Create new assignments for vehicles not yet assigned
        const existingIds = new Set(updated.map((a) => a.vehicleId));
        const newAssignments: DispatchAssignment[] = selectedForDispatch
          .filter((id) => !existingIds.has(id))
          .map((id) => {
            const vehicle = vehicles.find((v) => v.id === id);
            return {
              vehicleId: id,
              vehicleName: vehicle?.name ?? id,
              waypoints: [newWaypoint],
            };
          });

        return [...updated, ...newAssignments];
      });
    },
    [selectedForDispatch]
  );

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

    try {
      const response = await client.batchDirection(body);
      if (response.data?.results) {
        setResults(response.data.results);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dispatch failed";
      setError(message);
      console.error("Dispatch failed:", err);
    } finally {
      setDispatching(false);
    }
  }, [assignments]);

  const handleDone = useCallback(() => {
    setDispatchMode(false);
    setSelectedForDispatch([]);
    setAssignments([]);
    setResults([]);
    setDispatching(false);
  }, []);

  const handleRetryFailed = useCallback(() => {
    const failedIds = results.filter((r) => r.status === "error").map((r) => r.vehicleId);
    setSelectedForDispatch(failedIds);
    setAssignments((prev) => prev.filter((a) => failedIds.includes(a.vehicleId)));
    setResults([]);
  }, [results]);

  const moveWaypointGroup = useCallback((refs: WaypointRef[], newLat: number, newLng: number) => {
    if (refs.length === 0) return;
    const byVehicle = new Map<string, Set<number>>();
    for (const r of refs) {
      let set = byVehicle.get(r.vehicleId);
      if (!set) {
        set = new Set();
        byVehicle.set(r.vehicleId, set);
      }
      set.add(r.waypointIndex);
    }
    setAssignments((prev) =>
      prev.map((a) => {
        const indices = byVehicle.get(a.vehicleId);
        if (!indices) return a;
        return {
          ...a,
          waypoints: a.waypoints.map((wp, i) =>
            indices.has(i) ? { ...wp, position: [newLat, newLng] } : wp
          ),
        };
      })
    );
  }, []);

  const removeWaypointGroup = useCallback((refs: WaypointRef[]) => {
    if (refs.length === 0) return;
    const byVehicle = new Map<string, Set<number>>();
    for (const r of refs) {
      let set = byVehicle.get(r.vehicleId);
      if (!set) {
        set = new Set();
        byVehicle.set(r.vehicleId, set);
      }
      set.add(r.waypointIndex);
    }
    setAssignments((prev) => {
      const result: DispatchAssignment[] = [];
      for (const a of prev) {
        const indices = byVehicle.get(a.vehicleId);
        if (!indices) {
          result.push(a);
          continue;
        }
        const remaining = a.waypoints.filter((_, i) => !indices.has(i));
        if (remaining.length === 0) continue; // drop empty assignment
        result.push({ ...a, waypoints: remaining });
      }
      return result;
    });
  }, []);

  const onToggleVehicleForDispatch = useCallback((id: string) => {
    setSelectedForDispatch((prev) =>
      prev.includes(id) ? prev.filter((vid) => vid !== id) : [...prev, id]
    );
  }, []);

  return {
    dispatchMode,
    assignments,
    dispatching,
    results,
    selectedForDispatch,
    dispatchState,
    error,
    toggleDispatchMode,
    handleDispatch,
    handleDone,
    handleRetryFailed,
    onToggleVehicleForDispatch,
    onAddWaypoint,
    addWaypointForSelected,
    moveWaypointGroup,
    removeWaypointGroup,
    setAssignments,
  };
}
