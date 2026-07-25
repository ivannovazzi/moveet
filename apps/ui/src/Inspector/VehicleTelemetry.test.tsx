import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import VehicleTelemetry from "./VehicleTelemetry";
import { TELEMETRY_SAMPLE_MS } from "./telemetry";
import { vehicleStore } from "@/hooks/vehicleStore";
import { DirectionContext, type DirectionMap } from "@/data/context";
import { createVehicleDTO } from "@/test/mocks/types";
import type { Edge, Node, Position, Route } from "@/types";

function node(coordinates: Position): Node {
  return { id: `n${coordinates.join(",")}`, coordinates, connections: [] };
}

const straightRoute: Route = {
  edges: [
    {
      id: "e1",
      streetId: "s1",
      name: "Test St",
      start: node([0, 0]),
      end: node([0, 2]),
      distance: 0.5,
      bearing: 0,
      highway: "residential",
      maxSpeed: 50,
      surface: "asphalt",
      oneway: false,
    } satisfies Edge,
  ],
  distance: 0.5,
};

function renderTelemetry(route?: Route) {
  const directions: DirectionMap = new Map();
  if (route) directions.set("v1", { route });
  return render(
    <DirectionContext.Provider value={{ directions, setDirections: vi.fn() }}>
      <VehicleTelemetry vehicleId="v1" />
    </DirectionContext.Provider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 40, position: [0, 1] as Position })]);
});
afterEach(() => {
  vi.useRealTimers();
  vehicleStore.replace([]);
});

describe("VehicleTelemetry", () => {
  it("shows a collecting state until there are two samples", () => {
    renderTelemetry();
    expect(screen.getByText("Collecting telemetry…")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Speed/ })).not.toBeInTheDocument();
  });

  it("advertises its sampling window and rate", () => {
    renderTelemetry();
    expect(screen.getByText("60s · 1 Hz")).toBeInTheDocument();
  });

  it("draws the speed spark once a series exists", () => {
    renderTelemetry();
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    expect(screen.getByRole("img", { name: /Speed over the last minute/ })).toBeInTheDocument();
    expect(screen.getByText("40 km/h")).toBeInTheDocument();
  });

  it("draws the derived ETA spark and readout when a route is known", () => {
    renderTelemetry(straightRoute);
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    expect(screen.getByRole("img", { name: /Estimated time of arrival/ })).toBeInTheDocument();
    // 0.5 km at 40 km/h = 45 s.
    expect(screen.getByText("45 s")).toBeInTheDocument();
  });

  it("leaves the ETA blank rather than inventing one without a route", () => {
    renderTelemetry();
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Estimated time of arrival/ })
    ).not.toBeInTheDocument();
  });
});
