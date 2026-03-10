import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import client from "../utils/client";
import type { Modifiers, Position, Vehicle, VehicleDTO } from "../types";

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

function useVehicleChanges(): [VehicleDTO[], (vehicles: VehicleDTO[]) => void] {
  // Ref is the source of truth; state is only for triggering re-renders.
  // This avoids state updater functions which StrictMode double-invokes.
  const storeRef = useRef(new Map<string, VehicleDTO>());
  const [vehicles, setVehicles] = useState<VehicleDTO[]>([]);

  useEffect(() => {
    let rafId: number | undefined;

    const flush = () => {
      rafId = undefined;
      setVehicles(Array.from(storeRef.current.values()));
    };

    const onVehicle = (vehicle: VehicleDTO) => {
      storeRef.current.set(vehicle.id, vehicle);
      if (rafId === undefined) {
        rafId = requestAnimationFrame(flush);
      }
    };

    client.onVehicle(onVehicle);

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, []);

  const setVehiclesArr = useCallback((vehicles: VehicleDTO[]) => {
    storeRef.current = new Map(vehicles.map((v) => [v.id, v]));
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

  // Memoize lowercased filter to avoid repeated toLowerCase calls
  const lowerCaseFilter = useMemo(() => filters.filter.toLowerCase(), [filters.filter]);

  const mappedVehicles = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        ...vehicle,
        position: [vehicle.position[1], vehicle.position[0]] as Position,
        visible:
          (filters.visible.length === 0 || filters.visible.includes(vehicle.id)) &&
          vehicle.name.toLowerCase().includes(lowerCaseFilter),
        selected: filters.selected === vehicle.id,
        hovered: filters.hovered === vehicle.id,
      })),
    [vehicles, filters.visible, filters.selected, filters.hovered, lowerCaseFilter]
  );

  return {
    vehicles: mappedVehicles,
    filters,
    setVehicles,
    ...actions,
    modifiers,
    setModifiers,
  };
}
