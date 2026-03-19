import { describe, it, expect, beforeEach, vi } from "vitest";
import { GeoFenceManager } from "../modules/GeoFenceManager";
import type { GeoFence, GeoFenceEvent } from "@moveet/shared-types";
import type { VehicleDTO } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────

/** A simple square polygon in [lng, lat] order centered near 0,0. */
const SQUARE_POLYGON: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0], // closed
];

function makeFence(overrides: Partial<GeoFence> = {}): GeoFence {
  return {
    id: "fence-1",
    name: "Test Zone",
    type: "monitoring",
    polygon: SQUARE_POLYGON,
    active: true,
    ...overrides,
  };
}

function makeVehicle(
  id: string,
  latLng: [number, number],
  overrides: Partial<VehicleDTO> = {}
): VehicleDTO {
  return {
    id,
    name: `Vehicle ${id}`,
    type: "car",
    position: latLng, // [lat, lng]
    speed: 30,
    heading: 0,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("GeoFenceManager", () => {
  let manager: GeoFenceManager;

  beforeEach(() => {
    manager = new GeoFenceManager();
  });

  // ── CRUD ──────────────────────────────────────────────────────────

  describe("addZone / getZone", () => {
    it("stores and retrieves a zone by id", () => {
      const fence = makeFence();
      manager.addZone(fence);
      expect(manager.getZone("fence-1")).toEqual(fence);
    });

    it("returns undefined for unknown id", () => {
      expect(manager.getZone("nonexistent")).toBeUndefined();
    });
  });

  describe("getAllZones", () => {
    it("returns empty array when no zones exist", () => {
      expect(manager.getAllZones()).toEqual([]);
    });

    it("returns all added zones", () => {
      manager.addZone(makeFence({ id: "z1" }));
      manager.addZone(makeFence({ id: "z2" }));
      expect(manager.getAllZones()).toHaveLength(2);
    });
  });

  describe("removeZone", () => {
    it("removes an existing zone and returns true", () => {
      manager.addZone(makeFence());
      expect(manager.removeZone("fence-1")).toBe(true);
      expect(manager.getZone("fence-1")).toBeUndefined();
    });

    it("returns false for unknown id", () => {
      expect(manager.removeZone("nonexistent")).toBe(false);
    });
  });

  describe("updateZone", () => {
    it("applies a partial patch and returns updated zone", () => {
      manager.addZone(makeFence());
      const updated = manager.updateZone("fence-1", { name: "Updated Zone", active: false });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Updated Zone");
      expect(updated!.active).toBe(false);
      expect(updated!.id).toBe("fence-1"); // id must not change
    });

    it("returns null for unknown id", () => {
      expect(manager.updateZone("nonexistent", { name: "X" })).toBeNull();
    });
  });

  describe("toggleZone", () => {
    it("flips active from true to false", () => {
      manager.addZone(makeFence({ active: true }));
      const result = manager.toggleZone("fence-1");
      expect(result).not.toBeNull();
      expect(result!.active).toBe(false);
    });

    it("flips active from false to true", () => {
      manager.addZone(makeFence({ active: false }));
      const result = manager.toggleZone("fence-1");
      expect(result!.active).toBe(true);
    });

    it("returns null for unknown id", () => {
      expect(manager.toggleZone("nonexistent")).toBeNull();
    });
  });

  // ── Ray-casting ───────────────────────────────────────────────────

  describe("checkVehicles — ray-casting", () => {
    /*
     * SQUARE_POLYGON spans lng 0..1, lat 0..1.
     * VehicleDTO.position is [lat, lng].
     * A vehicle at lat=0.5, lng=0.5 → point [lng=0.5, lat=0.5] is inside.
     * A vehicle at lat=2,   lng=2   → point [lng=2, lat=2] is outside.
     */

    it("detects a vehicle inside the polygon and emits 'enter'", () => {
      manager.addZone(makeFence());
      const listener = vi.fn();
      manager.on("geofence:event", listener);

      const inside = makeVehicle("v1", [0.5, 0.5]); // lat=0.5, lng=0.5 → inside
      manager.checkVehicles([inside]);

      expect(listener).toHaveBeenCalledOnce();
      const event: GeoFenceEvent = listener.mock.calls[0][0];
      expect(event.event).toBe("enter");
      expect(event.vehicleId).toBe("v1");
      expect(event.fenceId).toBe("fence-1");
      expect(event.type).toBe("geofence:event");
    });

    it("does not emit for a vehicle outside the polygon", () => {
      manager.addZone(makeFence());
      const listener = vi.fn();
      manager.on("geofence:event", listener);

      const outside = makeVehicle("v2", [2.0, 2.0]); // lat=2, lng=2 → outside
      manager.checkVehicles([outside]);

      expect(listener).not.toHaveBeenCalled();
    });

    it("emits 'exit' when a vehicle leaves the polygon", () => {
      manager.addZone(makeFence());
      const events: GeoFenceEvent[] = [];
      manager.on("geofence:event", (e) => events.push(e));

      const vehicle = makeVehicle("v3", [0.5, 0.5]); // inside
      manager.checkVehicles([vehicle]);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("enter");

      // Move vehicle outside
      const vehicleOutside = makeVehicle("v3", [2.0, 2.0]);
      manager.checkVehicles([vehicleOutside]);
      expect(events).toHaveLength(2);
      expect(events[1].event).toBe("exit");
    });

    it("does not emit when a vehicle stays inside across ticks", () => {
      manager.addZone(makeFence());
      const listener = vi.fn();
      manager.on("geofence:event", listener);

      const vehicle = makeVehicle("v4", [0.5, 0.5]);
      manager.checkVehicles([vehicle]);
      manager.checkVehicles([vehicle]); // second tick, still inside
      expect(listener).toHaveBeenCalledOnce(); // only the initial enter
    });

    it("does not emit when a vehicle stays outside across ticks", () => {
      manager.addZone(makeFence());
      const listener = vi.fn();
      manager.on("geofence:event", listener);

      const vehicle = makeVehicle("v5", [2.0, 2.0]);
      manager.checkVehicles([vehicle]);
      manager.checkVehicles([vehicle]);
      expect(listener).not.toHaveBeenCalled();
    });

    it("ignores inactive zones", () => {
      manager.addZone(makeFence({ active: false }));
      const listener = vi.fn();
      manager.on("geofence:event", listener);

      const inside = makeVehicle("v6", [0.5, 0.5]);
      manager.checkVehicles([inside]);
      expect(listener).not.toHaveBeenCalled();
    });

    it("emits multiple enter events for multiple zones", () => {
      const polygon2: [number, number][] = [
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 11],
        [10, 10],
      ];
      manager.addZone(makeFence({ id: "z1" }));
      manager.addZone(makeFence({ id: "z2", polygon: polygon2 }));

      const events: GeoFenceEvent[] = [];
      manager.on("geofence:event", (e) => events.push(e));

      // Vehicle inside zone z1 only
      manager.checkVehicles([makeVehicle("v7", [0.5, 0.5])]);
      const enterZ1 = events.filter((e) => e.fenceId === "z1" && e.event === "enter");
      const enterZ2 = events.filter((e) => e.fenceId === "z2" && e.event === "enter");
      expect(enterZ1).toHaveLength(1);
      expect(enterZ2).toHaveLength(0);
    });

    it("cleans up zone membership when a zone is removed", () => {
      manager.addZone(makeFence());
      const events: GeoFenceEvent[] = [];
      manager.on("geofence:event", (e) => events.push(e));

      manager.checkVehicles([makeVehicle("v8", [0.5, 0.5])]); // enter
      expect(events).toHaveLength(1);

      manager.removeZone("fence-1");

      // Re-add the same zone; vehicle should enter again (membership was wiped)
      manager.addZone(makeFence());
      manager.checkVehicles([makeVehicle("v8", [0.5, 0.5])]); // should enter again
      expect(events).toHaveLength(2);
      expect(events[1].event).toBe("enter");
    });
  });
});
