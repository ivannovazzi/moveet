// ─── Re-exports from shared types ───────────────────────────────────
// These re-exports ensure all existing imports continue to work.
export type { VehicleType, ExportVehicle, VehicleUpdate, Fleet } from "@moveet/shared-types";

// ─── Adapter-specific types ─────────────────────────────────────────

export enum MedicalType {
  ALS = "ALS",
  BLS = "BLS",
  UNSUPPORTED = "UNSUPPORTED",
  MEDICAL_TAXI = "MEDICAL_TAXI",
  MEDICAL_MOTORBIKE = "MEDICAL_MOTORBIKE",
  HEARSE = "HEARSE",
  BOAT = "BOAT",
}

export enum VehicleTrackingTypes {
  FLARE_APP = "FLARE_APP",
  FLARE_APP_AND_GPS = "FLARE_APP_AND_GPS",
  FLARE_GPS = "FLARE_GPS",
  UNTRACKED = "UNTRACKED",
}

export interface Vehicle {
  id: string;
  callsign: string;
  isOnline: boolean;
  _currentShift: { id: string } | null;
  _trackingType: VehicleTrackingTypes;
  vehicleTypeRef: { value: string };
  latitude: number;
  longitude: number;
}
