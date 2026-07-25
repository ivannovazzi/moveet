import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import VehicleEventTimeline from "./VehicleEventTimeline";
import { MAX_EVENTS_PER_VEHICLE, vehicleEventStore } from "./vehicleEventStore";

beforeEach(() => vehicleEventStore.clear());

describe("VehicleEventTimeline", () => {
  it("shows an empty state for a vehicle with no events", () => {
    render(<VehicleEventTimeline vehicleId="v1" />);
    expect(screen.getByText("No events recorded for this vehicle.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists the vehicle's events newest first", () => {
    vehicleEventStore.record({
      vehicleId: "v1",
      kind: "geofence-enter",
      at: Date.parse("2026-01-01T08:00:00Z"),
      label: "Entered CBD cordon",
    });
    vehicleEventStore.record({
      vehicleId: "v1",
      kind: "reroute",
      at: Date.parse("2026-01-01T08:01:00Z"),
      label: "Rerouted around incident",
      detail: "inc-7",
    });

    render(<VehicleEventTimeline vehicleId="v1" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Rerouted around incident");
    expect(rows[0]).toHaveTextContent("inc-7");
    expect(rows[0]).toHaveAttribute("data-kind", "reroute");
    expect(rows[1]).toHaveTextContent("Entered CBD cordon");
  });

  it("only shows events belonging to the selected vehicle", () => {
    vehicleEventStore.record({ vehicleId: "v1", kind: "arrival", at: 1, label: "Mine" });
    vehicleEventStore.record({ vehicleId: "v2", kind: "arrival", at: 2, label: "Theirs" });
    render(<VehicleEventTimeline vehicleId="v1" />);
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
  });

  it("picks up events recorded while mounted, capped at the buffer bound", () => {
    render(<VehicleEventTimeline vehicleId="v1" />);
    act(() => {
      for (let i = 0; i < MAX_EVENTS_PER_VEHICLE + 5; i++) {
        vehicleEventStore.record({ vehicleId: "v1", kind: "waypoint", at: i, label: `wp ${i}` });
      }
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(MAX_EVENTS_PER_VEHICLE);
    expect(screen.queryByText("wp 0")).not.toBeInTheDocument();
    expect(screen.getByText(`wp ${MAX_EVENTS_PER_VEHICLE + 4}`)).toBeInTheDocument();
  });
});
