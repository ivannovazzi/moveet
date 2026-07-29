import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VehicleList from "./Vehicles";
import { createVehicle } from "@/test/mocks/types";
import type { JobDTO } from "@/types";

/**
 * What a vehicle row says about the job it is carrying and the device reporting
 * it. Both exist so an operator can see, without opening anything, that a unit
 * is busy (don't re-dispatch it) or that its telemetry is not to be trusted.
 */
function job(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    reference: "JOB-4F2A",
    status: "en_route",
    pickup: { position: [-1.29, 36.82] },
    dropoff: { position: [-1.3, 36.84] },
    strategy: "nearest",
    vehicleId: "v1",
    vehicleName: "Truck Alpha",
    createdAt: 0,
    slaSeconds: 900,
    slaDeadline: 900_000,
    slaBreached: false,
    ...overrides,
  };
}

const baseProps = {
  filter: "",
  maxSpeed: 100,
  vehicleFleetMap: new Map(),
  onFilterChange: vi.fn(),
  onSelectVehicle: vi.fn(),
  onHoverVehicle: vi.fn(),
  onUnhoverVehicle: vi.fn(),
};

describe("VehicleList job + device annotations", () => {
  it("shows the job reference a unit is carrying instead of its motion state", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[createVehicle({ id: "v1", name: "Truck Alpha", visible: true, speed: 40 })]}
        jobByVehicleId={new Map([["v1", job()]])}
      />
    );

    expect(screen.getByText("JOB-4F2A")).toBeInTheDocument();
    expect(screen.queryByText("enroute")).not.toBeInTheDocument();
  });

  it("falls back to the motion state for a free unit", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[createVehicle({ id: "v1", name: "Truck Alpha", visible: true, speed: 40 })]}
        jobByVehicleId={new Map()}
      />
    );

    expect(screen.getByText("enroute")).toBeInTheDocument();
  });

  it("reads as idle when stopped and unassigned", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[createVehicle({ id: "v1", name: "Truck Alpha", visible: true, speed: 0 })]}
      />
    );

    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("badges the fault kind shaping the last sample", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[
          createVehicle({
            id: "v1",
            name: "Truck Alpha",
            visible: true,
            faults: { active: ["frozen_gps"] },
          }),
        ]}
      />
    );

    expect(screen.getByText("frozen")).toBeInTheDocument();
  });

  it("collapses several concurrent faults into one badge", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[
          createVehicle({
            id: "v1",
            name: "Truck Alpha",
            visible: true,
            faults: { active: ["frozen_gps", "clock_skew", "duplicate"] },
          }),
        ]}
      />
    );

    expect(screen.getByText("frozen +2")).toBeInTheDocument();
  });

  it("says nothing for a device reporting clean", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[
          createVehicle({ id: "v1", name: "Truck Alpha", visible: true, faults: { active: [] } }),
        ]}
      />
    );

    expect(screen.queryByText(/frozen|clock|duplicate/)).not.toBeInTheDocument();
  });

  it("says nothing for a device with no fault profile at all", () => {
    render(
      <VehicleList
        {...baseProps}
        vehicles={[createVehicle({ id: "v1", name: "Truck Alpha", visible: true })]}
      />
    );

    expect(screen.queryByText(/frozen/)).not.toBeInTheDocument();
  });
});
