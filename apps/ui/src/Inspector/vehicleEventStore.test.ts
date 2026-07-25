import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_EVENTS_PER_VEHICLE,
  MAX_TRACKED_VEHICLES,
  vehicleEventStore,
  type VehicleEventInput,
} from "./vehicleEventStore";

function ev(overrides: Partial<VehicleEventInput> = {}): VehicleEventInput {
  return {
    vehicleId: "v1",
    kind: "waypoint",
    at: 1_000,
    label: "Reached waypoint 1",
    ...overrides,
  };
}

beforeEach(() => vehicleEventStore.clear());

describe("vehicleEventStore", () => {
  it("returns an empty list for a vehicle with no events", () => {
    expect(vehicleEventStore.get("nobody")).toEqual([]);
  });

  it("keeps events oldest → newest with stable ids", () => {
    vehicleEventStore.record(ev({ label: "first" }));
    vehicleEventStore.record(ev({ label: "second" }));
    const events = vehicleEventStore.get("v1");
    expect(events.map((e) => e.label)).toEqual(["first", "second"]);
    expect(events[0].id).not.toBe(events[1].id);
  });

  it("bounds each vehicle's history and evicts the oldest", () => {
    for (let i = 0; i < MAX_EVENTS_PER_VEHICLE + 10; i++) {
      vehicleEventStore.record(ev({ label: `e${i}` }));
    }
    const events = vehicleEventStore.get("v1");
    expect(events).toHaveLength(MAX_EVENTS_PER_VEHICLE);
    expect(events[0].label).toBe("e10");
    expect(events[events.length - 1].label).toBe(`e${MAX_EVENTS_PER_VEHICLE + 9}`);
  });

  it("bounds how many vehicles it tracks, dropping the least recently active", () => {
    for (let i = 0; i < MAX_TRACKED_VEHICLES; i++) {
      vehicleEventStore.record(ev({ vehicleId: `v${i}` }));
    }
    // Touch v0 so v1 becomes the least recently active.
    vehicleEventStore.record(ev({ vehicleId: "v0", label: "touched" }));
    vehicleEventStore.record(ev({ vehicleId: "newcomer" }));

    expect(vehicleEventStore.size()).toBe(MAX_TRACKED_VEHICLES);
    expect(vehicleEventStore.get("v1")).toEqual([]);
    expect(vehicleEventStore.get("v0")).toHaveLength(2);
    expect(vehicleEventStore.get("newcomer")).toHaveLength(1);
  });

  it("collapses the direction frame that trails a reroute into one entry", () => {
    vehicleEventStore.record(ev({ kind: "reroute", at: 5_000, label: "Rerouted around incident" }));
    vehicleEventStore.record(ev({ kind: "route", at: 5_050, label: "New route assigned" }));
    expect(vehicleEventStore.get("v1").map((e) => e.kind)).toEqual(["reroute"]);
  });

  it("keeps a route assignment that is not part of a reroute", () => {
    vehicleEventStore.record(ev({ kind: "reroute", at: 5_000 }));
    vehicleEventStore.record(ev({ kind: "route", at: 20_000 }));
    expect(vehicleEventStore.get("v1").map((e) => e.kind)).toEqual(["reroute", "route"]);
  });

  it("returns a stable snapshot for vehicles untouched by a new event", () => {
    vehicleEventStore.record(ev({ vehicleId: "v1" }));
    const before = vehicleEventStore.get("v1");
    vehicleEventStore.record(ev({ vehicleId: "v2" }));
    expect(vehicleEventStore.get("v1")).toBe(before);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = vehicleEventStore.subscribe(listener);
    vehicleEventStore.record(ev());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    vehicleEventStore.record(ev());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
