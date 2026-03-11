import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import client from "../utils/client";
import type { Modifiers, Position, Vehicle, VehicleDTO } from "../types";
import { vehicleStore } from "./vehicleStore";

export interface Filters {
  filter: string;
  visible: string[];
  selected?: string;
  hovered?: string;
}

export interface FiltersActions {
  onSelectVehicle: (id: string) => void;
  onUnselectVehicle: () => void;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
  onFilterChange: (value: string) => void;
}

export function useFilters(): {
  filters: Filters;
} & FiltersActions {
  const [filters, setFilters] = useState<Filters>({
    filter: "",
    visible: [],
    selected: undefined,
    hovered: undefined,
  });

  const onSelectVehicle = useCallback((id: string) => {
    setFilters((prev) => ({
      ...prev,
      selected: prev.selected === id ? undefined : id,
    }));
  }, []);

  const onUnselectVehicle = useCallback(() => {
    setFilters((prev) => ({ ...prev, selected: undefined }));
  }, []);

  const onHoverVehicle = useCallback((id: string) => {
    setFilters((prev) => ({ ...prev, hovered: id }));
  }, []);

  const onUnhoverVehicle = useCallback(() => {
    setFilters((prev) => ({ ...prev, hovered: undefined }));
  }, []);

  const onFilterChange = useCallback((value: string) => {
    setFilters((prev) => ({ ...prev, filter: value }));
  }, []);

  return {
    filters,
    onSelectVehicle,
    onUnselectVehicle,
    onHoverVehicle,
    onUnhoverVehicle,
    onFilterChange,
  };
}

/** Returns true when the DTO fields that affect rendering have changed. */
export function vehicleDTOChanged(prev: VehicleDTO, next: VehicleDTO): boolean {
  return (
    prev.position[0] !== next.position[0] ||
    prev.position[1] !== next.position[1] ||
    prev.heading !== next.heading ||
    prev.speed !== next.speed ||
    prev.name !== next.name ||
    prev.fleetId !== next.fleetId
  );
}

/**
 * Throttled React state for the vehicle list (control panel).
 * WS updates go into vehicleStore immediately; React state updates
 * at most once per second to avoid 800-element list re-renders.
 */
const REACT_THROTTLE_MS = 1000;

function useVehicleChanges(): [VehicleDTO[], (vehicles: VehicleDTO[]) => void] {
  const [vehicles, setVehicles] = useState<VehicleDTO[]>([]);
  const lastVersionRef = useRef(-1);

  // Wire up WS → vehicleStore (fast path, no React)
  useEffect(() => {
    const onVehicle = (vehicle: VehicleDTO) => {
      vehicleStore.set(vehicle);
    };
    client.onVehicle(onVehicle);
  }, []);

  // Throttled React state sync (slow path for control panel)
  useEffect(() => {
    const tick = () => {
      const currentVersion = vehicleStore.getVersion();
      if (currentVersion !== lastVersionRef.current) {
        lastVersionRef.current = currentVersion;
        setVehicles(vehicleStore.snapshot());
      }
    };

    // Initial sync
    tick();

    const interval = setInterval(tick, REACT_THROTTLE_MS);
    return () => clearInterval(interval);
  }, []);

  const setVehiclesArr = useCallback((vehicles: VehicleDTO[]) => {
    vehicleStore.replace(vehicles);
    setVehicles(vehicles);
  }, []);

  return [vehicles, setVehiclesArr];
}

interface UseVehicle extends FiltersActions {
  vehicles: Vehicle[];
  filters: Filters;
  modifiers: Modifiers;
  setVehicles: (vehicles: VehicleDTO[]) => void;
  setModifiers: React.Dispatch<React.SetStateAction<Modifiers>>;
}

export function useVehicles(): UseVehicle {
  const [vehicles, setVehicles] = useVehicleChanges();
  const { filters, ...actions } = useFilters();
  const [modifiers, setModifiers] = useState<Modifiers>({
    showDirections: true,
    showHeatzones: false,
    showHeatmap: false,
    showVehicles: true,
    showPOIs: false,
  });

  const lowerCaseFilter = useMemo(() => filters.filter.toLowerCase(), [filters.filter]);

  const mappedVehicles = useMemo(() => {
    const visibleSet = filters.visible.length > 0 ? new Set(filters.visible) : null;

    return vehicles.map((vehicle) => ({
      ...vehicle,
      position: [vehicle.position[1], vehicle.position[0]] as Position,
      visible:
        (visibleSet === null || visibleSet.has(vehicle.id)) &&
        vehicle.name.toLowerCase().includes(lowerCaseFilter),
      selected: filters.selected === vehicle.id,
      hovered: filters.hovered === vehicle.id,
    }));
  }, [vehicles, filters.visible, filters.selected, filters.hovered, lowerCaseFilter]);

  return {
    vehicles: mappedVehicles,
    filters,
    setVehicles,
    ...actions,
    modifiers,
    setModifiers,
  };
}
