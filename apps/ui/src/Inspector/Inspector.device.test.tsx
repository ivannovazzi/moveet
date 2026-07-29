import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Inspector from "./Inspector";
import { createVehicle } from "@/test/mocks/types";
import { vehicleEventStore } from "./vehicleEventStore";
import type { JobDTO } from "@/types";

beforeEach(() => vehicleEventStore.clear());

function job(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    reference: "JOB-4F2A",
    status: "transporting",
    pickup: { position: [-1.29, 36.82] },
    dropoff: { position: [-1.3, 36.84] },
    strategy: "nearest",
    vehicleId: "v1",
    vehicleName: "Unit 1",
    createdAt: 0,
    slaSeconds: 900,
    slaDeadline: 900_000,
    slaBreached: false,
    ...overrides,
  };
}

describe("Inspector job field", () => {
  it("names the job a vehicle is carrying", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} job={job()} onClose={vi.fn()} />);

    expect(screen.getByText("JOB-4F2A")).toBeInTheDocument();
  });

  it("flags a job past its SLA", () => {
    render(
      <Inspector
        vehicle={createVehicle({ id: "v1" })}
        job={job({ slaBreached: true })}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Late")).toBeInTheDocument();
  });

  it("omits the field for a free vehicle", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} onClose={vi.fn()} />);

    expect(screen.queryByText("Job")).not.toBeInTheDocument();
  });
});

describe("Inspector device section", () => {
  it("renders nothing for a device with no fault profile", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} onClose={vi.fn()} />);

    expect(screen.queryByText("Device")).not.toBeInTheDocument();
  });

  it("says a profiled device is reporting clean", () => {
    render(
      <Inspector vehicle={createVehicle({ id: "v1", faults: { active: [] } })} onClose={vi.fn()} />
    );

    expect(screen.getByText("Device")).toBeInTheDocument();
    expect(screen.getByText("Reporting clean")).toBeInTheDocument();
  });

  it("names each fault shaping the current sample", () => {
    render(
      <Inspector
        vehicle={createVehicle({ id: "v1", faults: { active: ["frozen_gps", "duplicate"] } })}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("frozen")).toBeInTheDocument();
    expect(screen.getByText("duplicate")).toBeInTheDocument();
    expect(screen.queryByText("Reporting clean")).not.toBeInTheDocument();
  });

  it("shows the remaining battery when the profile models one", () => {
    render(
      <Inspector
        vehicle={createVehicle({ id: "v1", faults: { active: [], battery: 37.4 } })}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("37%")).toBeInTheDocument();
  });

  it("shows a signed clock skew and the device's own clock", () => {
    render(
      <Inspector
        vehicle={createVehicle({
          id: "v1",
          faults: { active: ["clock_skew"], skewMs: -45_000 },
          timestamp: Date.UTC(2026, 0, 1, 12, 0, 0),
        })}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("-45s")).toBeInTheDocument();
    expect(screen.getByText("Clock skew")).toBeInTheDocument();
    expect(screen.getByText("Device time")).toBeInTheDocument();
  });

  it("omits a zero skew rather than reporting 0s", () => {
    render(
      <Inspector
        vehicle={createVehicle({ id: "v1", faults: { active: [], skewMs: 0 } })}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText("Clock skew")).not.toBeInTheDocument();
  });
});
