import { describe, it, expect, beforeEach, vi } from "vitest";
import { FleetManager } from "../modules/FleetManager";
import { FLEET_COLORS } from "../constants";

describe("FleetManager", () => {
  let fm: FleetManager;

  beforeEach(() => {
    fm = new FleetManager();
  });

  describe("create", () => {
    it("should create a fleet with a name and auto-assigned color", () => {
      const fleet = fm.create("Alpha");
      expect(fleet.id).toBe("fleet-1");
      expect(fleet.name).toBe("Alpha");
      expect(fleet.color).toBe(FLEET_COLORS[0]);
      expect(fleet.vehicleIds).toEqual([]);
    });

    it("should cycle through the color palette", () => {
      const fleets = [];
      for (let i = 0; i < FLEET_COLORS.length + 2; i++) {
        fleets.push(fm.create(`Fleet ${i}`));
      }
      // First 10 should get unique colors
      for (let i = 0; i < FLEET_COLORS.length; i++) {
        expect(fleets[i].color).toBe(FLEET_COLORS[i]);
      }
      // 11th wraps to first color
      expect(fleets[FLEET_COLORS.length].color).toBe(FLEET_COLORS[0]);
    });

    it("should emit fleet:created event", () => {
      const listener = vi.fn();
      fm.on("fleet:created", listener);
      const fleet = fm.create("Beta");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(fleet);
    });
  });

  describe("delete", () => {
    it("should delete an existing fleet", () => {
      const fleet = fm.create("Alpha");
      const result = fm.delete(fleet.id);
      expect(result).toBe(true);
      expect(fm.getAll()).toHaveLength(0);
    });

    it("should return false for non-existent fleet", () => {
      expect(fm.delete("nonexistent")).toBe(false);
    });

    it("should unassign all vehicles when fleet is deleted", () => {
      const fleet = fm.create("Alpha");
      fm.assign(fleet.id, "v1");
      fm.assign(fleet.id, "v2");
      fm.delete(fleet.id);
      expect(fm.getFleetIdForVehicle("v1")).toBeUndefined();
      expect(fm.getFleetIdForVehicle("v2")).toBeUndefined();
    });

    it("should emit fleet:deleted event", () => {
      const listener = vi.fn();
      fm.on("fleet:deleted", listener);
      const fleet = fm.create("Alpha");
      fm.delete(fleet.id);
      expect(listener).toHaveBeenCalledWith({ id: fleet.id });
    });
  });

  describe("assign", () => {
    it("should assign a vehicle to a fleet", () => {
      const fleet = fm.create("Alpha");
      const result = fm.assign(fleet.id, "v1");
      expect(result).toBe(true);
      expect(fm.getFleetIdForVehicle("v1")).toBe(fleet.id);
    });

    it("should return false for non-existent fleet", () => {
      expect(fm.assign("nonexistent", "v1")).toBe(false);
    });

    it("should move vehicle from old fleet to new fleet", () => {
      const alpha = fm.create("Alpha");
      const beta = fm.create("Beta");
      fm.assign(alpha.id, "v1");
      fm.assign(beta.id, "v1");
      expect(fm.getFleetIdForVehicle("v1")).toBe(beta.id);
      const alphaState = fm.get(alpha.id)!;
      expect(alphaState.vehicleIds).not.toContain("v1");
    });

    it("should emit fleet:assigned event", () => {
      const listener = vi.fn();
      fm.on("fleet:assigned", listener);
      const fleet = fm.create("Alpha");
      fm.assign(fleet.id, "v1");
      expect(listener).toHaveBeenCalledWith({ fleetId: fleet.id, vehicleId: "v1" });
    });
  });

  describe("unassign", () => {
    it("should remove vehicle from fleet", () => {
      const fleet = fm.create("Alpha");
      fm.assign(fleet.id, "v1");
      const result = fm.unassign("v1");
      expect(result).toBe(true);
      expect(fm.getFleetIdForVehicle("v1")).toBeUndefined();
      expect(fm.get(fleet.id)!.vehicleIds).not.toContain("v1");
    });

    it("should return false if vehicle not in any fleet", () => {
      expect(fm.unassign("v1")).toBe(false);
    });

    it("should emit fleet:assigned event with null fleetId", () => {
      const listener = vi.fn();
      fm.on("fleet:assigned", listener);
      const fleet = fm.create("Alpha");
      fm.assign(fleet.id, "v1");
      listener.mockClear();
      fm.unassign("v1");
      expect(listener).toHaveBeenCalledWith({ fleetId: null, vehicleId: "v1" });
    });
  });

  describe("getAll", () => {
    it("should return all fleets", () => {
      fm.create("Alpha");
      fm.create("Beta");
      const all = fm.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].name).toBe("Alpha");
      expect(all[1].name).toBe("Beta");
    });
  });

  describe("reset", () => {
    it("should clear all fleets and assignments", () => {
      const fleet = fm.create("Alpha");
      fm.assign(fleet.id, "v1");
      fm.reset();
      expect(fm.getAll()).toHaveLength(0);
      expect(fm.getFleetIdForVehicle("v1")).toBeUndefined();
    });

    it("should reset id counter so new fleets start from fleet-1", () => {
      fm.create("Alpha");
      fm.create("Beta");
      fm.reset();
      const fleet = fm.create("Gamma");
      expect(fleet.id).toBe("fleet-1");
    });
  });
});
