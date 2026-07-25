import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { vehicleStore } from "@/hooks/vehicleStore";
import type { Edge, Node, Position, Route } from "@/types";
import {
  TELEMETRY_CAPACITY,
  TELEMETRY_SAMPLE_MS,
  liveEtaSeconds,
  pushSample,
  useVehicleTelemetry,
  type TelemetrySample,
} from "./telemetry";
import { createVehicleDTO } from "@/test/mocks/types";

function node(coordinates: Position): Node {
  return { id: `n${coordinates.join(",")}`, coordinates, connections: [] };
}

function edge(distance: number, start: Position, end: Position): Edge {
  return {
    id: `e${start.join()}-${end.join()}`,
    streetId: "s1",
    name: "Test St",
    start: node(start),
    end: node(end),
    distance,
    bearing: 0,
    highway: "residential",
    maxSpeed: 50,
    surface: "asphalt",
    oneway: false,
  };
}

const sample = (speed: number): TelemetrySample => ({ t: speed, speed, eta: null });

describe("pushSample", () => {
  it("appends without mutating the input buffer", () => {
    const first: TelemetrySample[] = [sample(1)];
    const next = pushSample(first, sample(2), 5);
    expect(first).toHaveLength(1);
    expect(next.map((s) => s.speed)).toEqual([1, 2]);
  });

  it("is bounded and evicts the oldest samples", () => {
    let buffer: TelemetrySample[] = [];
    for (let i = 0; i < 10; i++) buffer = pushSample(buffer, sample(i), 4);
    expect(buffer).toHaveLength(4);
    expect(buffer.map((s) => s.speed)).toEqual([6, 7, 8, 9]);
  });

  it("defaults to a 60-sample (60 s at 1 Hz) window", () => {
    let buffer: TelemetrySample[] = [];
    for (let i = 0; i < TELEMETRY_CAPACITY * 3; i++) buffer = pushSample(buffer, sample(i));
    expect(buffer).toHaveLength(TELEMETRY_CAPACITY);
    expect(buffer[0].speed).toBe(TELEMETRY_CAPACITY * 2);
  });
});

describe("liveEtaSeconds", () => {
  const route: Route = {
    edges: [edge(1, [0, 0], [0, 2]), edge(2, [0, 10], [0, 12])],
    distance: 3,
  };

  it("derives seconds from the remaining route distance and current speed", () => {
    // Nearest edge is #0 (midpoint [0,1]) → 3 km remaining at 30 km/h = 360 s.
    expect(liveEtaSeconds(route, [0, 1], 30)).toBeCloseTo(360, 5);
    // Nearest edge is #1 (midpoint [0,11]) → 2 km remaining at 30 km/h = 240 s.
    expect(liveEtaSeconds(route, [0, 11], 30)).toBeCloseTo(240, 5);
  });

  it("returns null rather than a fabricated value when it can't be derived", () => {
    expect(liveEtaSeconds(undefined, [0, 1], 30)).toBeNull();
    expect(liveEtaSeconds({ edges: [], distance: 0 }, [0, 1], 30)).toBeNull();
    expect(liveEtaSeconds(route, undefined, 30)).toBeNull();
    expect(liveEtaSeconds(route, [0, 1], 0)).toBeNull();
    expect(liveEtaSeconds(route, [0, 1], Number.NaN)).toBeNull();
  });
});

describe("useVehicleTelemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vehicleStore.replace([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vehicleStore.replace([]);
  });

  it("samples the vehicle store on the 1 Hz cadence, not per tick", () => {
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 10 })]);
    const { result } = renderHook(() => useVehicleTelemetry("v1"));

    // One immediate sample so the panel isn't blank for a second.
    expect(result.current).toHaveLength(1);
    expect(result.current[0].speed).toBe(10);

    // 50 position ticks inside one sampling window collapse into one sample.
    act(() => {
      for (let i = 0; i < 50; i++) {
        vehicleStore.enqueue(createVehicleDTO({ id: "v1", speed: 20 + i }));
      }
      vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS);
    });
    expect(result.current).toHaveLength(2);
    expect(result.current[1].speed).toBe(69);

    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS * 3));
    expect(result.current).toHaveLength(5);
  });

  it("stays bounded at the window capacity", () => {
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 10 })]);
    const { result } = renderHook(() => useVehicleTelemetry("v1"));
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS * (TELEMETRY_CAPACITY + 25)));
    expect(result.current).toHaveLength(TELEMETRY_CAPACITY);
  });

  it("resets the window when the selected vehicle changes", () => {
    vehicleStore.replace([
      createVehicleDTO({ id: "v1", speed: 10 }),
      createVehicleDTO({ id: "v2", speed: 80 }),
    ]);
    const { result, rerender } = renderHook(({ id }) => useVehicleTelemetry(id), {
      initialProps: { id: "v1" },
    });
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS * 3));
    expect(result.current.length).toBeGreaterThan(1);

    rerender({ id: "v2" });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].speed).toBe(80);
  });

  it("records no samples when nothing is selected", () => {
    const { result } = renderHook(() => useVehicleTelemetry(undefined));
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS * 5));
    expect(result.current).toEqual([]);
  });

  it("records an ETA reading only while a route is known", () => {
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 30, position: [0, 1] as Position })]);
    const route: Route = { edges: [edge(1, [0, 0], [0, 2])], distance: 1 };
    const { result, rerender } = renderHook(({ r }) => useVehicleTelemetry("v1", r), {
      initialProps: { r: undefined as Route | undefined },
    });
    expect(result.current[0].eta).toBeNull();

    rerender({ r: route });
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    // 1 km at 30 km/h = 120 s, and the window was not restarted by the route.
    expect(result.current).toHaveLength(2);
    expect(result.current[1].eta).toBeCloseTo(120, 5);
  });
});
