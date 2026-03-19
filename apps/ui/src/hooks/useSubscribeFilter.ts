import { useEffect, useRef } from "react";
import client from "@/utils/client";
import type { VehicleType } from "@/types";
import type { SubscribeFilter } from "@moveet/shared-types";

/**
 * Centralizes all subscribe filter dimensions (fleet, type) into a
 * single WebSocket subscribe call. Debounces to coalesce rapid changes.
 */
export function useSubscribeFilter(
  fleets: { id: string }[],
  hiddenFleetIds: Set<string>,
  hiddenVehicleTypes: Set<VehicleType>
): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const filter = buildFilter(fleets, hiddenFleetIds, hiddenVehicleTypes);
      client.subscribe(filter);
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [hiddenFleetIds, hiddenVehicleTypes, fleets]);
}

const ALL_VEHICLE_TYPES: VehicleType[] = ["car", "truck", "motorcycle", "ambulance", "bus"];

function buildFilter(
  fleets: { id: string }[],
  hiddenFleetIds: Set<string>,
  hiddenVehicleTypes: Set<VehicleType>
): SubscribeFilter | null {
  const hasFleetFilter = hiddenFleetIds.size > 0;
  const hasTypeFilter = hiddenVehicleTypes.size > 0;

  // No filters active → null (receive everything)
  if (!hasFleetFilter && !hasTypeFilter) return null;

  const filter: SubscribeFilter = {};

  if (hasFleetFilter) {
    filter.fleetIds = fleets.map((f) => f.id).filter((id) => !hiddenFleetIds.has(id));
  }

  if (hasTypeFilter) {
    filter.vehicleTypes = ALL_VEHICLE_TYPES.filter((t) => !hiddenVehicleTypes.has(t));
  }

  return filter;
}
