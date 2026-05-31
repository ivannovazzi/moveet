import { describe, it, expect, beforeEach } from "vitest";
import { fleetRoster } from "./fleetRoster";

describe("fleetRoster", () => {
  beforeEach(() => {
    fleetRoster.clear();
  });

  it("starts empty", () => {
    expect(fleetRoster.boundVehicleIds()).toEqual([]);
    expect(fleetRoster.snapshot().vehicleIds).toEqual([]);
  });

  it("records vehicles even before any device is bound", () => {
    fleetRoster.upsertVehicle("V1");
    expect(fleetRoster.snapshot().vehicleIds).toEqual(["V1"]);
    // Known but unbound → not yet a bound vehicle.
    expect(fleetRoster.boundVehicleIds()).toEqual([]);
    expect(fleetRoster.devicesForVehicle("V1")).toEqual([]);
  });

  it("binds a device to a vehicle", () => {
    fleetRoster.applyAssignment("dev-1", "V1", "fitted_gps");
    expect(fleetRoster.boundVehicleIds()).toEqual(["V1"]);
    expect(fleetRoster.devicesForVehicle("V1")).toEqual([
      { deviceId: "dev-1", source: "fitted_gps" },
    ]);
  });

  it("implies the vehicle exists when only an assignment is seen", () => {
    fleetRoster.applyAssignment("dev-1", "V9", "shift");
    expect(fleetRoster.snapshot().vehicleIds).toContain("V9");
  });

  it("supports multiple devices bound to one vehicle", () => {
    fleetRoster.applyAssignment("dev-gps", "V1", "fitted_gps");
    fleetRoster.applyAssignment("dev-shift", "V1", "shift");
    const devices = fleetRoster.devicesForVehicle("V1");
    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d.deviceId).sort()).toEqual(["dev-gps", "dev-shift"]);
  });

  it("unbinds a device when vehicle_id is null (last-writer-wins)", () => {
    fleetRoster.applyAssignment("dev-1", "V1", "fitted_gps");
    fleetRoster.applyAssignment("dev-1", null, "fitted_gps");
    expect(fleetRoster.devicesForVehicle("V1")).toEqual([]);
    expect(fleetRoster.boundVehicleIds()).toEqual([]);
  });

  it("reassigns a device from one vehicle to another", () => {
    fleetRoster.applyAssignment("dev-1", "V1", "fitted_gps");
    fleetRoster.applyAssignment("dev-1", "V2", "fitted_gps");
    expect(fleetRoster.devicesForVehicle("V1")).toEqual([]);
    expect(fleetRoster.devicesForVehicle("V2")).toEqual([
      { deviceId: "dev-1", source: "fitted_gps" },
    ]);
  });

  it("clears all state", () => {
    fleetRoster.upsertVehicle("V1");
    fleetRoster.applyAssignment("dev-1", "V1", "fitted_gps");
    fleetRoster.clear();
    expect(fleetRoster.snapshot().vehicleIds).toEqual([]);
    expect(fleetRoster.boundVehicleIds()).toEqual([]);
  });
});
