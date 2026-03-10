import type { POI, Road } from "@/types";

export function isRoad(item: Road | POI): item is Road {
  return (item as Road).streets !== undefined;
}

export function isPOI(item: Road | POI): item is POI {
  return (item as POI).type !== undefined;
}
