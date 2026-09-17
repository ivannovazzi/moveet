import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { vehicleStore } from "@/hooks/vehicleStore";
import {
  TELEMETRY_CAPACITY,
  TELEMETRY_SAMPLE_MS,
  pushSample,
  useVehicleTelemetry,
  type TelemetrySample,
} from "./telemetry";
import { createVehicleDTO } from "@/test/mocks/types";

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

  it("reads the ETA off the vehicle sample rather than deriving it", () => {
    // The ETA is whatever the simulator reported. It is NOT re-derived from
    // speed here: that made the ETA series a mirror of the speed series.
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 30, etaSeconds: 480 })]);
    const { result } = renderHook(() => useVehicleTelemetry("v1"));
    expect(result.current[0].eta).toBe(480);

    act(() => {
      // Speed collapses, ETA barely moves — exactly what a model-priced ETA
      // does when a vehicle slows for one turn.
      vehicleStore.enqueue(createVehicleDTO({ id: "v1", speed: 4, etaSeconds: 476 }));
      vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS);
    });
    expect(result.current[1].speed).toBe(4);
    expect(result.current[1].eta).toBe(476);
  });

  it("records a null ETA for an unrouted vehicle rather than a zero", () => {
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 30 })]);
    const { result } = renderHook(() => useVehicleTelemetry("v1"));
    expect(result.current[0].eta).toBeNull();
  });
});
