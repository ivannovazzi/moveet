import type { Vehicle, VehicleDTO } from "../types";

export function serializeVehicle(vehicle: Vehicle, fleetId?: string): VehicleDTO {
  return {
    id: vehicle.id,
    name: vehicle.name,
    position: vehicle.position,
    speed: vehicle.speed,
    heading: vehicle.bearing,
    fleetId,
  };
}
