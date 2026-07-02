/**
 * Shared vehicle-type domain data: display color and short label per type.
 *
 * Single source of truth for both the map layer (VehiclesLayer.tsx, which
 * resolves these CSS var references to concrete colors for its sprite atlas)
 * and sidebar list UI (Vehicles.tsx) — avoids maintaining duplicate copies of
 * the same type -> color/label mapping in multiple files.
 */

/**
 * Type-specific default colors (used when no fleet color). These reference
 * the shared --color-vehicle-* tokens (tokens.css).
 */
export const VEHICLE_TYPE_COLORS: Record<string, string> = {
  car: "var(--color-vehicle-car)",
  truck: "var(--color-vehicle-truck)",
  motorcycle: "var(--color-vehicle-motorcycle)",
  ambulance: "var(--color-vehicle-ambulance)",
  bus: "var(--color-vehicle-bus)",
};

/** Short uppercase labels for non-default vehicle types shown in list rows. */
export const VEHICLE_TYPE_LABELS: Record<string, string> = {
  truck: "TRK",
  motorcycle: "MC",
  ambulance: "AMB",
  bus: "BUS",
};

/** Full display names for all types, used where space allows (e.g. the Visibility panel). */
export const VEHICLE_TYPE_FULL_LABELS: Record<string, string> = {
  car: "Car",
  truck: "Truck",
  motorcycle: "Moto",
  ambulance: "Ambulance",
  bus: "Bus",
};

/** Ordered list of all vehicle types, for rendering a fixed-order legend/toggle list. */
export const VEHICLE_TYPES_ORDER = ["car", "truck", "motorcycle", "ambulance", "bus"] as const;
