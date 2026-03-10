import { useMapControls } from "@/components/Map/hooks";
import type { Vehicle } from "@/types";
import { useEffect } from "react";

export default function useTracking(
  vehicles: Vehicle[],
  selected: string | undefined,
  duration: number = 0
) {
  const { focusOn } = useMapControls();
  const vehicle = vehicles.find((v) => v.id === selected);
  const [lng, lat] = vehicle?.position || [null, null];

  useEffect(() => {
    if (selected && lng != null && lat != null) {
      focusOn(lng, lat, 15, { duration });
    }
  }, [selected, lng, lat, duration, focusOn]);
}
