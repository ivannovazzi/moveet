import type { Vehicle, VehicleDTO } from "../types";

export function serializeVehicle(vehicle: Vehicle): VehicleDTO {
  const dto: VehicleDTO = {
    id: vehicle.id,
    name: vehicle.name,
    position: vehicle.position,
    speed: vehicle.speed,
    heading: vehicle.bearing,
  };
  if (vehicle.fleetId) {
    dto.fleetId = vehicle.fleetId;
  }
  return dto;
}
