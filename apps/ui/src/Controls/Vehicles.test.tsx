import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleList from "./Vehicles";
import { createVehicle } from "@/test/mocks/types";
import { ClientDataContext } from "@/data/context";
import type { Route } from "@/types";

describe("VehicleList", () => {
  const defaultProps = {
    filter: "",
    vehicles: [
      createVehicle({ id: "v1", name: "Truck Alpha", visible: true }),
      createVehicle({ id: "v2", name: "Van Beta", visible: true }),
    ],
    maxSpeed: 100,
    fleets: [],
    onFilterChange: vi.fn(),
    onSelectVehicle: vi.fn(),
    onHoverVehicle: vi.fn(),
    onUnhoverVehicle: vi.fn(),
    onAssignVehicle: vi.fn(),
    onUnassignVehicle: vi.fn(),
  };

  it("renders vehicle names", () => {
    render(<VehicleList {...defaultProps} />);
    expect(screen.getByText("Truck Alpha")).toBeInTheDocument();
    expect(screen.getByText("Van Beta")).toBeInTheDocument();
  });

  it("calls onSelectVehicle when vehicle clicked", async () => {
    const onSelectVehicle = vi.fn();
    const user = userEvent.setup();
    render(<VehicleList {...defaultProps} onSelectVehicle={onSelectVehicle} />);
    await user.click(screen.getByText("Truck Alpha"));
    expect(onSelectVehicle).toHaveBeenCalledWith("v1");
  });

  it("calls onHoverVehicle on mouse enter", async () => {
    const onHoverVehicle = vi.fn();
    const user = userEvent.setup();
    render(<VehicleList {...defaultProps} onHoverVehicle={onHoverVehicle} />);
    await user.hover(screen.getByText("Truck Alpha"));
    expect(onHoverVehicle).toHaveBeenCalledWith("v1");
  });

  it("calls onUnhoverVehicle on mouse leave", async () => {
    const onUnhoverVehicle = vi.fn();
    const user = userEvent.setup();
    render(<VehicleList {...defaultProps} onUnhoverVehicle={onUnhoverVehicle} />);
    await user.hover(screen.getByText("Truck Alpha"));
    await user.unhover(screen.getByText("Truck Alpha"));
    expect(onUnhoverVehicle).toHaveBeenCalled();
  });

  it("filters out non-visible vehicles", () => {
    const vehicles = [
      createVehicle({ id: "v1", name: "Visible", visible: true }),
      createVehicle({ id: "v2", name: "Hidden", visible: false }),
    ];
    render(<VehicleList {...defaultProps} vehicles={vehicles} />);
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders all visible vehicles", () => {
    const vehicles = [
      createVehicle({ id: "v1", name: "Vehicle A", visible: true }),
      createVehicle({ id: "v2", name: "Vehicle B", visible: true }),
      createVehicle({ id: "v3", name: "Vehicle C", visible: true }),
    ];
    render(<VehicleList {...defaultProps} vehicles={vehicles} />);
    expect(screen.getByText("Vehicle A")).toBeInTheDocument();
    expect(screen.getByText("Vehicle B")).toBeInTheDocument();
    expect(screen.getByText("Vehicle C")).toBeInTheDocument();
  });

  it("renders summary stats and filter badge content", () => {
    const vehicles = [
      createVehicle({ id: "v1" }),
      createVehicle({ id: "v2" }),
      createVehicle({ id: "v3", visible: false }),
    ];

    render(<VehicleList {...defaultProps} filter="truck" vehicles={vehicles} />);

    expect(screen.getByText("Fleet overview")).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 3 matching "truck"')).toBeInTheDocument();
  });

  it("renders an empty state when no vehicles are visible", () => {
    const vehicles = [
      createVehicle({ id: "v1", visible: false }),
      createVehicle({ id: "v2", visible: false }),
    ];

    render(<VehicleList {...defaultProps} filter="ghost" vehicles={vehicles} />);

    expect(screen.getByText('No vehicles match "ghost"')).toBeInTheDocument();
  });

  it("renders route distance when a direction exists for the vehicle", () => {
    const route: Route = {
      distance: 12.4,
      edges: [],
    };

    render(
      <ClientDataContext.Provider
        value={{
          options: {
            minSpeed: 10,
            maxSpeed: 50,
            speedVariation: 0.1,
            acceleration: 5,
            deceleration: 7,
            turnThreshold: 30,
            updateInterval: 10000,
            heatZoneSpeedFactor: 0.5,
          },
          roads: [],
          pois: [],
          directions: new Map([["v1", { route }]]),
          heatzones: [],
          network: { type: "FeatureCollection", features: [] },
          setOptions: vi.fn(),
          setRoads: vi.fn(),
          setPOIs: vi.fn(),
          setDirections: vi.fn(),
          setHeatzones: vi.fn(),
          setNetwork: vi.fn(),
        }}
      >
        <VehicleList {...defaultProps} />
      </ClientDataContext.Provider>
    );

    expect(screen.getByText("Route 12.4 km")).toBeInTheDocument();
  });
});
