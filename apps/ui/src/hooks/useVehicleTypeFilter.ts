import { useCallback, useState } from "react";
import type { VehicleType } from "@/types";

export interface UseVehicleTypeFilter {
  hiddenVehicleTypes: Set<VehicleType>;
  toggleVehicleType: (type: VehicleType) => void;
}

export function useVehicleTypeFilter(): UseVehicleTypeFilter {
  const [hiddenVehicleTypes, setHiddenVehicleTypes] = useState<Set<VehicleType>>(new Set());

  const toggleVehicleType = useCallback((type: VehicleType) => {
    setHiddenVehicleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  return { hiddenVehicleTypes, toggleVehicleType };
}
