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

function useVehicleChanges(): [VehicleDTO[], (vehicles: VehicleDTO[]) => void] {
  // storeRef holds the latest DTO per vehicle (source of truth from WS).
  // prevArrayRef holds the last array we passed to React state so we can
  // diff element-by-element and reuse unchanged object references.
  const storeRef = useRef(new Map<string, VehicleDTO>());
  const prevArrayRef = useRef<VehicleDTO[]>([]);
  const [vehicles, setVehicles] = useState<VehicleDTO[]>([]);

  useEffect(() => {
    let rafId: number | undefined;

    const flush = () => {
      rafId = undefined;
      const store = storeRef.current;
      const prevArray = prevArrayRef.current;

      // Fast path: if the store size matches and no entry changed, reuse
      // the previous array reference entirely to avoid a React re-render.
      const prevMap = new Map<string, VehicleDTO>();
      for (const v of prevArray) prevMap.set(v.id, v);

      if (store.size === prevMap.size) {
        let anyChanged = false;
        for (const [id, next] of store) {
          const prev = prevMap.get(id);
          if (!prev || vehicleDTOChanged(prev, next)) {
            anyChanged = true;
            break;
          }
        }
        if (!anyChanged) return; // nothing changed — skip setState entirely
      }

      // Build a new array, reusing previous object references for
      // vehicles whose data hasn't changed.
      const nextArray: VehicleDTO[] = [];
      for (const [id, next] of store) {
        const prev = prevMap.get(id);
        nextArray.push(prev && !vehicleDTOChanged(prev, next) ? prev : next);
      }

      prevArrayRef.current = nextArray;
      setVehicles(nextArray);
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
    prevArrayRef.current = vehicles;
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

  // Track the previous mapped vehicles so we can reuse object references
  // for vehicles whose source DTO and computed flags haven't changed.
  const prevMappedRef = useRef(new Map<string, Vehicle>());

  const mappedVehicles = useMemo(() => {
    const prevMapped = prevMappedRef.current;
    const nextMapped = new Map<string, Vehicle>();
    const visibleSet =
      filters.visible.length > 0 ? new Set(filters.visible) : null;

    const result: Vehicle[] = [];
    for (const vehicle of vehicles) {
      const visible =
        (visibleSet === null || visibleSet.has(vehicle.id)) &&
        vehicle.name.toLowerCase().includes(lowerCaseFilter);
      const selected = filters.selected === vehicle.id;
      const hovered = filters.hovered === vehicle.id;

      const prev = prevMapped.get(vehicle.id);

      // Reuse previous mapped object if neither the source DTO nor the
      // computed UI flags changed.  The source DTO check is by reference
      // equality — useVehicleChanges already preserves references for
      // unchanged vehicles.
      if (
        prev &&
        prev.visible === visible &&
        prev.selected === selected &&
        prev.hovered === hovered &&
        // Reference equality: useVehicleChanges reuses the same object
        // when the DTO hasn't changed, so this is O(1).
        prevMapped.get(vehicle.id) !== undefined &&
        prev.position[0] === vehicle.position[1] &&
        prev.position[1] === vehicle.position[0] &&
        prev.heading === vehicle.heading &&
        prev.speed === vehicle.speed &&
        prev.name === vehicle.name &&
        prev.fleetId === vehicle.fleetId
      ) {
        result.push(prev);
        nextMapped.set(vehicle.id, prev);
      } else {
        const mapped: Vehicle = {
          ...vehicle,
          position: [vehicle.position[1], vehicle.position[0]] as Position,
          visible,
          selected,
          hovered,
        };
        result.push(mapped);
        nextMapped.set(vehicle.id, mapped);
      }
    }

    prevMappedRef.current = nextMapped;
    return result;
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
