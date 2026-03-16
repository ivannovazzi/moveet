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
export type VehicleType = "car" | "truck" | "motorcycle" | "ambulance" | "bus";

export interface ExportVehicle {
  id: string;
  name: string;
  position: [number, number];
  type?: VehicleType;
}

export interface VehicleUpdate {
  latitude: number;
  longitude: number;
  id: string;
  type?: VehicleType;
}

export interface Fleet {
  id: string;
  name: string;
  color: string;
  source: "local" | "external";
  vehicleIds: string[];
}
