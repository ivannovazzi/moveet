import { describe, it, expect, beforeEach, vi } from "vitest";
import { FleetManager } from "../modules/FleetManager";

const PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
  "#fabed4",
  "#dcbeff",
];

describe("FleetManager", () => {
  let fm: FleetManager;

  beforeEach(() => {
    fm = new FleetManager();
  });

  describe("createFleet", () => {
    it("should create a fleet with a name and auto-assigned color", () => {
      const fleet = fm.createFleet("Alpha");
      expect(fleet.id).toBeDefined();
      expect(fleet.name).toBe("Alpha");
      expect(fleet.color).toBe(PALETTE[0]);
      expect(fleet.source).toBe("local");
      expect(fleet.vehicleIds).toEqual([]);
    });

    it("should cycle through the color palette", () => {
      const fleets = [];
      for (let i = 0; i < PALETTE.length + 2; i++) {
        fleets.push(fm.createFleet(`Fleet ${i}`));
      }
      for (let i = 0; i < PALETTE.length; i++) {
        expect(fleets[i].color).toBe(PALETTE[i]);
      }
      expect(fleets[PALETTE.length].color).toBe(PALETTE[0]);
    });

    it("should emit fleet:created event", () => {
      const listener = vi.fn();
      fm.on("fleet:created", listener);
      const fleet = fm.createFleet("Beta");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(fleet);
    });
  });

  describe("deleteFleet", () => {
    it("should delete an existing fleet", () => {
      const fleet = fm.createFleet("Alpha");
      fm.deleteFleet(fleet.id);
      expect(fm.getFleets()).toHaveLength(0);
    });

    it("should throw for non-existent fleet", () => {
      expect(() => fm.deleteFleet("nonexistent")).toThrow();
    });

    it("should throw when deleting external fleet", () => {
      const fleet = fm.createFleet("External", "external");
      expect(() => fm.deleteFleet(fleet.id)).toThrow("Cannot delete external fleet");
    });

    it("should unassign all vehicles when fleet is deleted", () => {
      const fleet = fm.createFleet("Alpha");
      fm.assignVehicles(fleet.id, ["v1", "v2"]);
      fm.deleteFleet(fleet.id);
      expect(fm.getVehicleFleetId("v1")).toBeUndefined();
      expect(fm.getVehicleFleetId("v2")).toBeUndefined();
    });

    it("should emit fleet:deleted event", () => {
      const listener = vi.fn();
      fm.on("fleet:deleted", listener);
      const fleet = fm.createFleet("Alpha");
      fm.deleteFleet(fleet.id);
      expect(listener).toHaveBeenCalledWith({ id: fleet.id });
    });
  });

  describe("assignVehicles", () => {
    it("should assign vehicles to a fleet", () => {
      const fleet = fm.createFleet("Alpha");
      fm.assignVehicles(fleet.id, ["v1"]);
      expect(fm.getVehicleFleetId("v1")).toBe(fleet.id);
      expect(fm.getFleets()[0].vehicleIds).toContain("v1");
    });

    it("should throw for non-existent fleet", () => {
      expect(() => fm.assignVehicles("nonexistent", ["v1"])).toThrow();
    });

    it("should move vehicle from old fleet to new fleet", () => {
      const alpha = fm.createFleet("Alpha");
      const beta = fm.createFleet("Beta");
      fm.assignVehicles(alpha.id, ["v1"]);
      fm.assignVehicles(beta.id, ["v1"]);
      expect(fm.getVehicleFleetId("v1")).toBe(beta.id);
      expect(fm.getFleets().find((f) => f.id === alpha.id)!.vehicleIds).not.toContain("v1");
    });

    it("should emit fleet:assigned event", () => {
      const listener = vi.fn();
      fm.on("fleet:assigned", listener);
      const fleet = fm.createFleet("Alpha");
      fm.assignVehicles(fleet.id, ["v1"]);
      expect(listener).toHaveBeenCalledWith({ fleetId: fleet.id, vehicleIds: ["v1"] });
    });
  });

  describe("unassignVehicles", () => {
    it("should remove vehicle from fleet", () => {
      const fleet = fm.createFleet("Alpha");
      fm.assignVehicles(fleet.id, ["v1"]);
      fm.unassignVehicles(fleet.id, ["v1"]);
      expect(fm.getVehicleFleetId("v1")).toBeUndefined();
      expect(fm.getFleets()[0].vehicleIds).not.toContain("v1");
    });

    it("should throw for non-existent fleet", () => {
      expect(() => fm.unassignVehicles("nonexistent", ["v1"])).toThrow();
    });

    it("should emit fleet:assigned event with null fleetId", () => {
      const listener = vi.fn();
      fm.on("fleet:assigned", listener);
      const fleet = fm.createFleet("Alpha");
      fm.assignVehicles(fleet.id, ["v1"]);
      listener.mockClear();
      fm.unassignVehicles(fleet.id, ["v1"]);
      expect(listener).toHaveBeenCalledWith({ fleetId: null, vehicleIds: ["v1"] });
    });
  });

  describe("getFleets", () => {
    it("should return all fleets", () => {
      fm.createFleet("Alpha");
      fm.createFleet("Beta");
      const all = fm.getFleets();
      expect(all).toHaveLength(2);
      expect(all[0].name).toBe("Alpha");
      expect(all[1].name).toBe("Beta");
    });
  });

  describe("reset", () => {
    it("should clear all fleets and assignments", () => {
      const fleet = fm.createFleet("Alpha");
      fm.assignVehicles(fleet.id, ["v1"]);
      fm.reset();
      expect(fm.getFleets()).toHaveLength(0);
      expect(fm.getVehicleFleetId("v1")).toBeUndefined();
    });

    it("should reset color index so new fleets start from first color", () => {
      fm.createFleet("Alpha");
      fm.createFleet("Beta");
      fm.reset();
      const fleet = fm.createFleet("Gamma");
      expect(fleet.color).toBe(PALETTE[0]);
    });
  });
});
