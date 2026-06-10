import { useCallback, useState } from "react";
import client from "@/utils/client";
import useContextMenu from "./useContextMenu";
import { DispatchState } from "./useDispatchState";
import type { DispatchFlow } from "./useDispatchFlow";
import { isRoad } from "@/utils/typeGuards";
import { toLatLng } from "@/utils/coordinates";
import type { IncidentType, POI, Position, Road, Vehicle } from "@/types";

interface UseMapInteractionsOptions {
  dispatch: DispatchFlow;
  vehicles: Vehicle[];
  /** Currently selected vehicle id (filters.selected). */
  selectedVehicleId?: string;
  onUnselectVehicle: () => void;
  /** Stable callback from useIncidents. */
  createIncidentAtPosition: (lat: number, lng: number, type: IncidentType) => void;
}

/**
 * Map/context-menu interaction state and callbacks: selected road/POI,
 * right-click destination, map clicks (incl. dispatch waypoint placement),
 * find-road/send-vehicle/directions actions, and incident creation.
 *
 * Extracted from App.tsx — behavior preserved verbatim.
 */
export function useMapInteractions({
  dispatch,
  vehicles,
  selectedVehicleId,
  onUnselectVehicle,
  createIncidentAtPosition,
}: UseMapInteractionsOptions) {
  const [onContextClick, contextMenuRef, contextMenuXY, closeContextMenu] = useContextMenu();
  const [selectedItem, setSelectedItem] = useState<Road | POI | null>(null);
  const [destination, setDestination] = useState<Position | null>(null);

  const clearMap = useCallback(() => {
    closeContextMenu();
    setDestination(null);
    onUnselectVehicle();
    setSelectedItem(null);
  }, [closeContextMenu, onUnselectVehicle]);

  /** Clear selection state on simulation reset (does not touch the menu). */
  const resetSelection = useCallback(() => {
    setSelectedItem(null);
    setDestination(null);
    onUnselectVehicle();
  }, [onUnselectVehicle]);

  const onMapClick = useCallback(
    (_event?: React.MouseEvent, position?: Position) => {
      if (
        dispatch.dispatchState === DispatchState.ROUTE &&
        position &&
        dispatch.selectedForDispatch.length > 0
      ) {
        dispatch.addWaypointForSelected(position, vehicles);
        return;
      }
      clearMap();
    },
    [clearMap, dispatch, vehicles]
  );

  const assignments = dispatch.assignments;
  const onContextMenuAddWaypoint = useCallback(() => {
    if (!destination) return;
    const assignedIds = new Set(assignments.map((a) => a.vehicleId));

    for (const id of dispatch.selectedForDispatch) {
      if (assignedIds.has(id)) {
        dispatch.onAddWaypoint(id, destination);
      }
    }

    const newAssignments = dispatch.selectedForDispatch
      .filter((id) => !assignedIds.has(id))
      .map((id) => {
        const vehicle = vehicles.find((v) => v.id === id);
        return {
          vehicleId: id,
          vehicleName: vehicle?.name ?? id,
          waypoints: [{ position: toLatLng(destination) as [number, number] }],
        };
      });

    if (newAssignments.length > 0) {
      dispatch.setAssignments((prev) => [...prev, ...newAssignments]);
    }

    closeContextMenu();
  }, [destination, assignments, dispatch, vehicles, closeContextMenu]);

  const onCreateIncident = useCallback(
    (type: IncidentType) => {
      if (!destination) return;
      const [lat, lng] = toLatLng(destination);
      createIncidentAtPosition(lat, lng, type);
      closeContextMenu();
    },
    [destination, createIncidentAtPosition, closeContextMenu]
  );

  const setFinalDestination = useCallback(async (position: Position, vehicleIds: string[]) => {
    const coordinates = await client.findNode(position);
    if (!coordinates.data) return;
    await client.direction(vehicleIds, coordinates.data);
  }, []);

  const onDestinationClick = useCallback(async () => {
    let coordinates: Position;
    if (!selectedItem) return;
    if (isRoad(selectedItem)) {
      const getOne = (arr: Position[]) => arr[Math.floor(Math.random() * arr.length)];
      coordinates = getOne(selectedItem.streets.flat());
    } else {
      coordinates = toLatLng(selectedItem.coordinates);
    }
    await setFinalDestination(
      coordinates,
      vehicles.map((v) => v.id)
    );
    clearMap();
  }, [selectedItem, vehicles, setFinalDestination, clearMap]);

  const onPointDestinationClick = useCallback(async () => {
    await setFinalDestination(
      destination!,
      vehicles.map((v) => v.id)
    );
    clearMap();
  }, [destination, vehicles, setFinalDestination, clearMap]);

  const onPointDestinationSingleClick = useCallback(async () => {
    await setFinalDestination(destination!, [selectedVehicleId!]);
    clearMap();
  }, [destination, selectedVehicleId, setFinalDestination, clearMap]);

  const onFindRoadClick = useCallback(async () => {
    const road = await client.findRoad(destination!);
    if (road.data) setSelectedItem(road.data);
    closeContextMenu();
  }, [destination, closeContextMenu]);

  const onMapContextClick = useCallback(
    (e: React.MouseEvent, position: Position) => {
      setDestination(position);
      onContextClick(e);
    },
    [onContextClick]
  );

  return {
    // Context menu
    contextMenuRef,
    contextMenuXY,
    closeContextMenu,
    // Selection state
    selectedItem,
    setSelectedItem,
    // Actions
    resetSelection,
    onMapClick,
    onMapContextClick,
    onContextMenuAddWaypoint,
    onCreateIncident,
    onDestinationClick,
    onPointDestinationClick,
    onPointDestinationSingleClick,
    onFindRoadClick,
  };
}
