import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DirectionResult, ReplayStatus } from "@/types";
import { useSessionEventCapture } from "./useSessionEventCapture";
import { sessionEventStore } from "./sessionEventStore";

/** Handlers the hook registers, so we can drive WS frames by hand. */
const handlers: Record<string, ((data: never) => void) | undefined> = {};

vi.mock("@/utils/client", () => ({
  default: {
    onIncidentCreated: vi.fn((h) => {
      handlers.incident = h;
    }),
    offIncidentCreated: vi.fn(),
    onGeofenceEvent: vi.fn((h) => {
      handlers.geofence = h;
    }),
    offGeofenceEvent: vi.fn(),
  },
}));

// biome-ignore-start lint/suspicious/noExplicitAny: test driver for typed WS payloads.
const fire = (key: string, data: any) => (handlers[key] as (d: any) => void)(data);
// biome-ignore-end lint/suspicious/noExplicitAny: test driver for typed WS payloads.

const LIVE: ReplayStatus = { mode: "live" };

function mount(replayStatus: ReplayStatus = LIVE, dispatchResults: DirectionResult[] = []) {
  return renderHook(
    (props: { replayStatus: ReplayStatus; dispatchResults: DirectionResult[] }) =>
      useSessionEventCapture(props),
    { initialProps: { replayStatus, dispatchResults } }
  );
}

beforeEach(() => {
  sessionEventStore.reset();
});

describe("useSessionEventCapture", () => {
  it("records an incident tick with no replay offset while live", () => {
    mount();

    fire("incident", { id: "inc-1", type: "road_closure" });

    const [event] = sessionEventStore.all();
    expect(event.category).toBe("incident");
    expect(event.label).toBe("road closure incident");
    expect(event.detail).toBe("inc-1");
    expect(event.replayTime).toBeUndefined();
  });

  it("records geofence entries and exits, attributed to the vehicle", () => {
    mount();

    for (const kind of ["enter", "exit"] as const) {
      fire("geofence", {
        type: "geofence:event",
        fenceId: "f1",
        fenceName: "CBD cordon",
        vehicleId: "v1",
        vehicleName: "Van 1",
        event: kind,
        timestamp: "2026-01-01T08:00:00.000Z",
      });
    }

    const events = sessionEventStore.all();
    expect(events.map((e) => e.category)).toEqual(["geofence-enter", "geofence-exit"]);
    expect(events[0].label).toBe("Van 1 entered CBD cordon");
    expect(events[0].vehicleId).toBe("v1");
    expect(events[0].at).toBe(Date.parse("2026-01-01T08:00:00.000Z"));
    expect(events[1].label).toBe("Van 1 exited CBD cordon");
  });

  it("records one dispatch tick per vehicle in a batch", () => {
    const { rerender } = mount();

    rerender({
      replayStatus: LIVE,
      dispatchResults: [
        { vehicleId: "v1", status: "ok" },
        { vehicleId: "v2", status: "error", error: "no route" },
      ],
    });

    const events = sessionEventStore.all();
    expect(events.map((e) => e.category)).toEqual(["dispatch", "dispatch"]);
    expect(events[0].label).toBe("Vehicle dispatched");
    expect(events[0].vehicleId).toBe("v1");
    expect(events[1].label).toBe("Dispatch failed");
    expect(events[1].detail).toBe("no route");
  });

  it("does not re-record the same dispatch batch on an unrelated re-render", () => {
    const results: DirectionResult[] = [{ vehicleId: "v1", status: "ok" }];
    const { rerender } = mount(LIVE, results);
    expect(sessionEventStore.size()).toBe(1);

    rerender({ replayStatus: { ...LIVE }, dispatchResults: results });

    expect(sessionEventStore.size()).toBe(1);
  });

  it("stamps events observed during a replay with their playback offset", () => {
    mount({
      mode: "replay",
      file: "run-1.ndjson",
      duration: 60_000,
      currentTime: 20_000,
      speed: 1,
      paused: true,
    });

    fire("incident", { id: "inc-1", type: "accident" });

    const [event] = sessionEventStore.all();
    // Paused, so the offset is exactly the last reported playback position.
    expect(event.replayTime).toBe(20_000);
  });

  it("clamps a replay offset to the recording's duration", () => {
    mount({
      mode: "replay",
      file: "run-1.ndjson",
      duration: 10_000,
      currentTime: 9_999,
      speed: 4,
      paused: false,
    });

    fire("incident", { id: "inc-1", type: "accident" });

    expect(sessionEventStore.all()[0].replayTime).toBeLessThanOrEqual(10_000);
  });

  it("drops live history when a replay starts — the axes are not comparable", () => {
    const { rerender } = mount();
    fire("incident", { id: "inc-1", type: "accident" });
    expect(sessionEventStore.size()).toBe(1);

    rerender({
      replayStatus: { mode: "replay", file: "run-1.ndjson", duration: 60_000, currentTime: 0 },
      dispatchResults: [],
    });

    expect(sessionEventStore.size()).toBe(0);
  });

  it("drops replay history again when the session returns to live", () => {
    const { rerender } = mount({
      mode: "replay",
      file: "run-1.ndjson",
      duration: 60_000,
      currentTime: 0,
    });
    fire("incident", { id: "inc-1", type: "accident" });
    expect(sessionEventStore.size()).toBe(1);

    rerender({ replayStatus: LIVE, dispatchResults: [] });

    expect(sessionEventStore.size()).toBe(0);
  });
});
