import type { POI } from "@/types";

export function isBusStop(poi: POI) {
  return poi.type === "bus_stop";
}

export function isNotBusStop(poi: POI) {
  return !isBusStop(poi);
}

export function getFillByType(type: string): string {
  if (type === "shop") {
    return "var(--color-poi-shop)";
  }
  if (type === "leisure") {
    return "var(--color-poi-leisure)";
  }
  if (type === "craft") {
    return "var(--color-poi-craft)";
  }
  if (type === "office") {
    return "var(--color-poi-office)";
  }
  if (type === "bus_stop") {
    return "var(--color-poi-bus)";
  }
  return "var(--color-poi-default)";
}
