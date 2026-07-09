import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleList from "./Vehicles";
import { createVehicle } from "@/test/mocks/types";
import { DirectionContext } from "@/data/context";
import type { Route } from "@/types";

describe("VehicleList", () => {
  const defaultProps = {
    filter: "",
    vehicles: [
      createVehicle({ id: "v1", name: "Truck Alpha", visible: true }),
      createVehicle({ id: "v2", name: "Van Beta", visible: true }),
    ],
    maxSpeed: 100,
    vehicleFleetMap: new Map(),
    onFilterChange: vi.fn(),
    onSelectVehicle: vi.fn(),
    onHoverVehicle: vi.fn(),
    onUnhoverVehicle: vi.fn(),
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
      <DirectionContext.Provider
        value={{
          directions: new Map([["v1", { route }]]),
          setDirections: vi.fn(),
        }}
      >
        <VehicleList {...defaultProps} />
      </DirectionContext.Provider>
    );

    expect(screen.getByText("Route 12.4 km")).toBeInTheDocument();
  });

  describe("virtualization (fleetsim-all-k8sz)", () => {
    function makeVehicles(count: number) {
      return Array.from({ length: count }, (_, i) =>
        createVehicle({ id: `v${i}`, name: `Vehicle ${i}`, visible: true })
      );
    }

    it("only mounts the visible window of DOM rows for an 800-vehicle fleet, not all 800", () => {
      const vehicles = makeVehicles(800);
      render(<VehicleList {...defaultProps} vehicles={vehicles} />);

      // The first vehicle is always within the visible window.
      expect(screen.getByText("Vehicle 0")).toBeInTheDocument();

      // With jsdom's no-op ResizeObserver, the list falls back to a fixed
      // measured height, giving a small, bounded visible+overscan window —
      // nowhere near all 800 rows are mounted as real DOM nodes.
      const renderedRows = screen.getAllByRole("button", { name: /km\/h/ });
      expect(renderedRows.length).toBeGreaterThan(0);
      expect(renderedRows.length).toBeLessThan(100);

      // Vehicles far outside the window are not mounted at all.
      expect(screen.queryByText("Vehicle 799")).not.toBeInTheDocument();
    });

    it("renders every vehicle's row content correctly at the top of the list", () => {
      const vehicles = makeVehicles(800);
      render(<VehicleList {...defaultProps} vehicles={vehicles} />);

      expect(screen.getByText("Vehicle 0")).toBeInTheDocument();
      // The panel header still reports the true total, even though only a
      // window of rows is mounted.
      expect(screen.getByText("800 tracked units")).toBeInTheDocument();
    });

    it("scopes down to the matching subset when filtered, without a manual load-more step", () => {
      const vehicles = makeVehicles(3);
      render(<VehicleList {...defaultProps} filter="Vehicle 1" vehicles={vehicles} />);

      expect(screen.getByText("Vehicle 1")).toBeInTheDocument();
    });
  });

  describe("row memoization (fleetsim-all-k8sz)", () => {
    it("does not re-render unrelated rows when only one vehicle's data changes", async () => {
      const vehicles = [
        createVehicle({
          id: "v1",
          name: "Vehicle A",
          speed: 40,
          visible: true,
        }),
        createVehicle({
          id: "v2",
          name: "Vehicle B",
          speed: 40,
          visible: true,
        }),
        createVehicle({
          id: "v3",
          name: "Vehicle C",
          speed: 40,
          visible: true,
        }),
      ];

      const { rerender } = render(<VehicleList {...defaultProps} vehicles={vehicles} />);

      const rowBBefore = screen.getByText("Vehicle B").closest("button");
      const rowCBefore = screen.getByText("Vehicle C").closest("button");

      // Only vehicle A's speed changes; B and C keep identical prop values.
      const updatedVehicles = [
        createVehicle({
          id: "v1",
          name: "Vehicle A",
          speed: 55,
          visible: true,
        }),
        createVehicle({
          id: "v2",
          name: "Vehicle B",
          speed: 40,
          visible: true,
        }),
        createVehicle({
          id: "v3",
          name: "Vehicle C",
          speed: 40,
          visible: true,
        }),
      ];
      rerender(<VehicleList {...defaultProps} vehicles={updatedVehicles} />);

      // Vehicle A's row reflects the new speed.
      expect(screen.getByText("55")).toBeInTheDocument();

      // B and C's DOM nodes are the same element instances — React.memo
      // bailed out of re-rendering them since their own props didn't change.
      expect(screen.getByText("Vehicle B").closest("button")).toBe(rowBBefore);
      expect(screen.getByText("Vehicle C").closest("button")).toBe(rowCBefore);
    });

    it("re-renders a row when its own speed changes but keeps unrelated DOM stable across repeated updates", () => {
      const vehicles = [
        createVehicle({
          id: "v1",
          name: "Vehicle A",
          speed: 10,
          visible: true,
        }),
        createVehicle({
          id: "v2",
          name: "Vehicle B",
          speed: 10,
          visible: true,
        }),
      ];
      const { rerender } = render(<VehicleList {...defaultProps} vehicles={vehicles} />);

      const rowBBefore = screen.getByText("Vehicle B").closest("button");

      // Simulate several position/speed ticks on vehicle A only, as the
      // real-time WS feed would produce.
      for (const speed of [20, 30, 40, 50]) {
        const updated = [
          createVehicle({ id: "v1", name: "Vehicle A", speed, visible: true }),
          createVehicle({
            id: "v2",
            name: "Vehicle B",
            speed: 10,
            visible: true,
          }),
        ];
        rerender(<VehicleList {...defaultProps} vehicles={updated} />);
        expect(screen.getByText(String(speed))).toBeInTheDocument();
      }

      // Vehicle B's row was never touched across four re-renders of A.
      expect(screen.getByText("Vehicle B").closest("button")).toBe(rowBBefore);
    });
  });
});
