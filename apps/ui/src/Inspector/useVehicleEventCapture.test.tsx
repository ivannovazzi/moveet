import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVehicleEventCapture } from "./useVehicleEventCapture";
import { vehicleEventStore } from "./vehicleEventStore";

// Capture the handlers the hook registers so we can drive WS frames by hand.
const handlers: Record<string, ((data: never) => void) | undefined> = {};

vi.mock("@/utils/client", () => ({
  default: {
    onVehicleRerouted: vi.fn((h) => {
      handlers.rerouted = h;
    }),
    offVehicleRerouted: vi.fn(),
    onGeofenceEvent: vi.fn((h) => {
      handlers.geofence = h;
    }),
    offGeofenceEvent: vi.fn(),
    onWaypointReached: vi.fn((h) => {
      handlers.waypoint = h;
    }),
    offWaypointReached: vi.fn(),
    onRouteCompleted: vi.fn((h) => {
      handlers.completed = h;
    }),
    offRouteCompleted: vi.fn(),
    onDirection: vi.fn((h) => {
      handlers.direction = h;
    }),
    offDirection: vi.fn(),
  },
}));

/** Drive one WS frame through the handler the hook registered. */
// biome-ignore-start lint/suspicious/noExplicitAny: test driver for typed WS payloads.
const fire = (key: string, data: any) => (handlers[key] as (d: any) => void)(data);
// biome-ignore-end lint/suspicious/noExplicitAny: test driver for typed WS payloads.

beforeEach(() => {
  vehicleEventStore.clear();
  renderHook(() => useVehicleEventCapture());
});

describe("useVehicleEventCapture", () => {
  it("records a reroute with the incident that caused it", () => {
    fire("rerouted", { vehicleId: "v1", incidentId: "inc-3" });
    const [event] = vehicleEventStore.get("v1");
    expect(event.kind).toBe("reroute");
    expect(event.label).toBe("Rerouted around incident");
    expect(event.detail).toBe("inc-3");
  });

  it("records geofence entries and exits with the fence name", () => {
    fire("geofence", {
      type: "geofence:event",
      fenceId: "f1",
      fenceName: "CBD cordon",
      vehicleId: "v1",
      vehicleName: "Van 1",
      event: "enter",
      timestamp: "2026-01-01T08:00:00.000Z",
    });
    fire("geofence", {
      type: "geofence:event",
      fenceId: "f1",
      fenceName: "CBD cordon",
      vehicleId: "v1",
      vehicleName: "Van 1",
      event: "exit",
      timestamp: "2026-01-01T08:05:00.000Z",
    });

    const events = vehicleEventStore.get("v1");
    expect(events.map((e) => e.kind)).toEqual(["geofence-enter", "geofence-exit"]);
    expect(events[0].label).toBe("Entered CBD cordon");
    expect(events[0].at).toBe(Date.parse("2026-01-01T08:00:00.000Z"));
    expect(events[1].label).toBe("Exited CBD cordon");
  });

  it("records waypoints, arrivals and new routes", () => {
    fire("waypoint", { vehicleId: "v1", waypointIndex: 0, remaining: 2 });
    fire("waypoint", { vehicleId: "v1", waypointIndex: 1, waypointLabel: "Depot", remaining: 0 });
    fire("completed", { vehicleId: "v1" });
    fire("direction", { vehicleId: "v1", route: { edges: [], distance: 4.25 } });

    const events = vehicleEventStore.get("v1");
    expect(events.map((e) => e.kind)).toEqual(["waypoint", "waypoint", "arrival", "route"]);
    expect(events[0].label).toBe("Reached waypoint 1");
    expect(events[0].detail).toBe("2 left");
    expect(events[1].label).toBe("Reached Depot");
    expect(events[1].detail).toBe("last waypoint");
    expect(events[3].detail).toBe("4.3 km");
  });

  it("attributes events to the right vehicle", () => {
    fire("rerouted", { vehicleId: "v1", incidentId: "inc-1" });
    fire("rerouted", { vehicleId: "v2", incidentId: "inc-2" });
    expect(vehicleEventStore.get("v1")).toHaveLength(1);
    expect(vehicleEventStore.get("v2")).toHaveLength(1);
  });
});
