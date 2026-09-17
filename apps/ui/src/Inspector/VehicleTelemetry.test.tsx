import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import VehicleTelemetry from "./VehicleTelemetry";
import { TELEMETRY_SAMPLE_MS } from "./telemetry";
import { vehicleStore } from "@/hooks/vehicleStore";
import { createVehicleDTO } from "@/test/mocks/types";

function renderTelemetry() {
  return render(<VehicleTelemetry vehicleId="v1" />);
}

beforeEach(() => {
  vi.useFakeTimers();
  vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 40 })]);
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

  it("draws the ETA spark and readout from the simulator's own ETA", () => {
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 40, etaSeconds: 45 })]);
    renderTelemetry();
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    expect(screen.getByRole("img", { name: /Remaining time to destination/ })).toBeInTheDocument();
    expect(screen.getByText("45 s")).toBeInTheDocument();
  });

  it("leaves the ETA blank rather than inventing one for an unrouted vehicle", () => {
    renderTelemetry();
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Remaining time to destination/ })
    ).not.toBeInTheDocument();
  });
});
