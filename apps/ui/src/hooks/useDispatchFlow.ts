import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "@/utils/client";
import { toast, toErrorMessage } from "@/lib/toast";
import { useNetworkContext } from "@/data/useData";
import type {
  DirectionResult,
  DispatchAssignment,
  Position,
  RoadNetwork,
  Vehicle,
  Waypoint,
} from "@/types";
import type { DispatchState } from "./useDispatchState";
import { useDispatchState } from "./useDispatchState";
import { toLatLng } from "@/utils/coordinates";

/** Geographic bounds of the road network in [lat, lng] space. */
interface NetworkBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Margin (in degrees, ~2 km) so clicks just outside the outermost road still pass. */
const BOUNDS_MARGIN_DEG = 0.02;

/** Compute the bounding box of the road network, or null when not loaded. */
export function computeNetworkBounds(network: RoadNetwork): NetworkBounds | null {
  if (network.features.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const feature of network.features) {
    for (const [lng, lat] of feature.geometry.coordinates) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

/** True when a [lat, lng] waypoint lies within bounds (plus margin). */
function isWithinBounds(position: [number, number], bounds: NetworkBounds): boolean {
  const [lat, lng] = position;
  return (
    lat >= bounds.minLat - BOUNDS_MARGIN_DEG &&
    lat <= bounds.maxLat + BOUNDS_MARGIN_DEG &&
    lng >= bounds.minLng - BOUNDS_MARGIN_DEG &&
    lng <= bounds.maxLng + BOUNDS_MARGIN_DEG
  );
}

/** Identifies a specific waypoint within an assignment list. */
export interface WaypointRef {
  vehicleId: string;
  waypointIndex: number;
}

/**
 * Mode wiring: dispatch no longer owns its own on/off boolean — the
 * interaction-mode union (useInteractionMode) is the single owner. `active`
 * is derived from it; `onEnter`/`onExit` request mode transitions.
 */
export interface DispatchFlowOptions {
  /** True while the interaction mode is `dispatch`. */
  active: boolean;
  /** Request entering dispatch mode (refused during replay by the mode hook). */
  onEnter: () => void;
  /** Request exiting to browse mode. */
  onExit: () => void;
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

export function useDispatchFlow({ active, onEnter, onExit }: DispatchFlowOptions): DispatchFlow {
  const [assignments, setAssignments] = useState<DispatchAssignment[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [results, setResults] = useState<DirectionResult[]>([]);
  const [selectedForDispatch, setSelectedForDispatch] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { network } = useNetworkContext();
  const bounds = useMemo(() => computeNetworkBounds(network), [network]);

  const dispatchState = useDispatchState({
    dispatchMode: active,
    selectedForDispatch,
    assignments,
    dispatching,
    results,
  });

  /** Clear all flow state back to a pristine SELECT-ready slate. */
  const resetFlow = useCallback(() => {
    setSelectedForDispatch([]);
    setAssignments([]);
    setResults([]);
    setDispatching(false);
    setError(null);
  }, []);

  // Mode exit can also happen outside this hook (entering geofence drawing,
  // a replay starting, …) — clear the flow on any active → inactive edge so
  // stale assignments never survive a mode switch.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (wasActiveRef.current && !active) resetFlow();
    wasActiveRef.current = active;
  }, [active, resetFlow]);

  const handleDone = useCallback(() => {
    resetFlow();
    onExit();
  }, [resetFlow, onExit]);

  const toggleDispatchMode = useCallback(() => {
    if (active) handleDone();
    else onEnter();
  }, [active, handleDone, onEnter]);

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

    // Validate waypoints against the road network bounds before sending —
    // an immediate, clear error beats a slow server round-trip failure.
    if (bounds) {
      const offNetwork = assignments.filter((a) =>
        a.waypoints.some((wp) => !isWithinBounds(wp.position, bounds))
      );
      if (offNetwork.length > 0) {
        const names = offNetwork.map((a) => a.vehicleName).join(", ");
        const message = `Some stops are outside the road network (${names}). Move or remove them, then dispatch again.`;
        setError(message);
        toast.error(message);
        return;
      }
    }

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
      if (response.error) {
        setError(response.error);
        toast.error(`Dispatch failed: ${response.error}`);
        return;
      }
      const results = response.data?.results ?? [];
      setResults(results);
      const failed = results.filter((r) => r.status === "error").length;
      const succeeded = results.length - failed;
      if (failed > 0) {
        toast.error(
          succeeded > 0
            ? `Dispatched ${succeeded}, ${failed} failed to route`
            : `Dispatch failed for all ${failed} vehicles`
        );
      } else {
        toast.success(`Dispatched ${succeeded} ${succeeded === 1 ? "vehicle" : "vehicles"}`);
      }
    } catch (err) {
      const message = toErrorMessage(err, "Dispatch failed");
      setError(message);
      toast.error(`Dispatch failed: ${message}`);
      console.error("Dispatch failed:", err);
    } finally {
      setDispatching(false);
    }
  }, [assignments, bounds]);

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
    dispatchMode: active,
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
