import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleList from "../Vehicles";
import { createVehicle } from "@/test/mocks/types";
import { createDispatchFlow } from "@/test/mocks/dispatchFlow";
import { DirectionContext } from "@/data/context";
import { DispatchContext, type DispatchFlow } from "@/hooks/useDispatchFlow";
import { DispatchState } from "@/hooks/useDispatchState";
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

  // VehicleList reads the dispatch flow (mode toggle, per-row dispatch state)
  // from DispatchContext, so every render needs a provider.
  function renderList(
    props: Partial<React.ComponentProps<typeof VehicleList>> = {},
    flow: DispatchFlow = createDispatchFlow()
  ): RenderResult & {
    rerenderList: (next: Partial<React.ComponentProps<typeof VehicleList>>) => void;
  } {
    const result = render(
      <DispatchContext.Provider value={flow}>
        <VehicleList {...defaultProps} {...props} />
      </DispatchContext.Provider>
    );
    return {
      ...result,
      rerenderList: (next) =>
        result.rerender(
          <DispatchContext.Provider value={flow}>
            <VehicleList {...defaultProps} {...next} />
          </DispatchContext.Provider>
        ),
    };
  }

  it("renders vehicle names", () => {
    renderList();
    expect(screen.getByText("Truck Alpha")).toBeInTheDocument();
    expect(screen.getByText("Van Beta")).toBeInTheDocument();
  });

  it("calls onSelectVehicle when vehicle clicked", async () => {
    const onSelectVehicle = vi.fn();
    const user = userEvent.setup();
    renderList({ onSelectVehicle });
    await user.click(screen.getByText("Truck Alpha"));
    expect(onSelectVehicle).toHaveBeenCalledWith("v1");
  });

  it("calls onHoverVehicle on mouse enter", async () => {
    const onHoverVehicle = vi.fn();
    const user = userEvent.setup();
    renderList({ onHoverVehicle });
    await user.hover(screen.getByText("Truck Alpha"));
    expect(onHoverVehicle).toHaveBeenCalledWith("v1");
  });

  it("calls onUnhoverVehicle on mouse leave", async () => {
    const onUnhoverVehicle = vi.fn();
    const user = userEvent.setup();
    renderList({ onUnhoverVehicle });
    await user.hover(screen.getByText("Truck Alpha"));
    await user.unhover(screen.getByText("Truck Alpha"));
    expect(onUnhoverVehicle).toHaveBeenCalled();
  });

  it("filters out non-visible vehicles", () => {
    const vehicles = [
      createVehicle({ id: "v1", name: "Visible", visible: true }),
      createVehicle({ id: "v2", name: "Hidden", visible: false }),
    ];
    renderList({ vehicles });
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders all visible vehicles", () => {
    const vehicles = [
      createVehicle({ id: "v1", name: "Vehicle A", visible: true }),
      createVehicle({ id: "v2", name: "Vehicle B", visible: true }),
      createVehicle({ id: "v3", name: "Vehicle C", visible: true }),
    ];
    renderList({ vehicles });
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

    renderList({ filter: "truck", vehicles });

    expect(screen.getByText('Showing 2 of 3 matching "truck"')).toBeInTheDocument();
  });

  it("renders an empty state when no vehicles are visible", () => {
    const vehicles = [
      createVehicle({ id: "v1", visible: false }),
      createVehicle({ id: "v2", visible: false }),
    ];

    renderList({ filter: "ghost", vehicles });

    expect(screen.getByText('No vehicles match "ghost"')).toBeInTheDocument();
  });

  it("renders route distance when a direction exists for the vehicle", () => {
    const route: Route = {
      distance: 12.4,
      edges: [],
    };

    render(
      <DispatchContext.Provider value={createDispatchFlow()}>
        <DirectionContext.Provider
          value={{
            directions: new Map([["v1", { route }]]),
            setDirections: vi.fn(),
          }}
        >
          <VehicleList {...defaultProps} />
        </DirectionContext.Provider>
      </DispatchContext.Provider>
    );

    expect(screen.getByText("Route 12.4 km")).toBeInTheDocument();
  });

  it("renders a row with tabular-nums on both speed and route distance", () => {
    renderList({
      vehicles: [createVehicle({ id: "v1", name: "Test Vehicle 1", speed: 42, visible: true })],
    });
    const row = screen.getByRole("button", { name: /Test Vehicle 1/ });
    const routeText = screen.getByText("No route");
    expect(routeText.className).toContain("tabular-nums");
    expect(row.className).not.toContain("bg-white/[0.03]"); // old card treatment removed
  });

  describe("dispatch mode", () => {
    it("shows the Dispatch toggle in browse mode and calls toggleDispatchMode", async () => {
      const flow = createDispatchFlow();
      const user = userEvent.setup();
      renderList({}, flow);
      const toggle = screen.getByRole("button", { name: "Dispatch" });
      await user.click(toggle);
      expect(flow.toggleDispatchMode).toHaveBeenCalledTimes(1);
    });

    it("shows Exit Dispatch while dispatch mode is active", () => {
      renderList(
        {},
        createDispatchFlow({ dispatchMode: true, dispatchState: DispatchState.SELECT })
      );
      expect(screen.getByRole("button", { name: "Exit Dispatch" })).toBeInTheDocument();
    });

    it("toggles vehicles for dispatch (instead of selecting) in SELECT state", async () => {
      const flow = createDispatchFlow({
        dispatchMode: true,
        dispatchState: DispatchState.SELECT,
      });
      const onSelectVehicle = vi.fn();
      const user = userEvent.setup();
      renderList({ onSelectVehicle }, flow);
      await user.click(screen.getByText("Truck Alpha"));
      expect(flow.onToggleVehicleForDispatch).toHaveBeenCalledWith("v1");
      expect(onSelectVehicle).not.toHaveBeenCalled();
    });

    it("marks dispatch-selected rows with aria-pressed and the checkbox state", () => {
      renderList(
        {},
        createDispatchFlow({
          dispatchMode: true,
          dispatchState: DispatchState.ROUTE,
          selectedForDispatch: ["v1"],
        })
      );
      const row = screen.getByRole("button", { name: /Truck Alpha/ });
      expect(row).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("checkbox", { name: "Select Truck Alpha" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });
  });

  describe("virtualization", () => {
    function makeVehicles(count: number) {
      return Array.from({ length: count }, (_, i) =>
        createVehicle({ id: `v${i}`, name: `Vehicle ${i}`, visible: true })
      );
    }

    it("renders only the first 50 vehicles when given 100+", () => {
      const vehicles = makeVehicles(120);
      renderList({ vehicles });

      // First 50 should be rendered
      expect(screen.getByText("Vehicle 0")).toBeInTheDocument();
      expect(screen.getByText("Vehicle 49")).toBeInTheDocument();

      // Vehicle 50 onward should NOT be rendered
      expect(screen.queryByText("Vehicle 50")).not.toBeInTheDocument();
      expect(screen.queryByText("Vehicle 119")).not.toBeInTheDocument();
    });

    it("shows 'Show more' button when more than 50 vehicles", () => {
      const vehicles = makeVehicles(80);
      renderList({ vehicles });

      const showMoreButton = screen.getByText(/Show more/);
      expect(showMoreButton).toBeInTheDocument();
      expect(showMoreButton).toHaveTextContent("Show more (30 remaining)");
    });

    it("does not show 'Show more' button when 50 or fewer vehicles", () => {
      const vehicles = makeVehicles(50);
      renderList({ vehicles });

      expect(screen.queryByText(/Show more/)).not.toBeInTheDocument();
    });

    it("clicking 'Show more' renders 50 more vehicles", async () => {
      const vehicles = makeVehicles(120);
      const user = userEvent.setup();
      renderList({ vehicles });

      expect(screen.queryByText("Vehicle 50")).not.toBeInTheDocument();

      await user.click(screen.getByText(/Show more/));

      // Now vehicles 0–99 should be visible
      expect(screen.getByText("Vehicle 50")).toBeInTheDocument();
      expect(screen.getByText("Vehicle 99")).toBeInTheDocument();

      // Vehicle 100+ still hidden
      expect(screen.queryByText("Vehicle 100")).not.toBeInTheDocument();
    });

    it("'Show more' button shows remaining count", async () => {
      const vehicles = makeVehicles(130);
      const user = userEvent.setup();
      renderList({ vehicles });

      expect(screen.getByText(/Show more/)).toHaveTextContent("Show more (80 remaining)");

      await user.click(screen.getByText(/Show more/));

      expect(screen.getByText(/Show more/)).toHaveTextContent("Show more (30 remaining)");
    });

    it("resets visible count to 50 when filter changes", () => {
      const vehicles = makeVehicles(120);
      const { rerenderList } = renderList({ vehicles, filter: "" });

      // Initially 50 visible, show more exists
      expect(screen.queryByText("Vehicle 50")).not.toBeInTheDocument();

      // Change filter — visible count resets to INITIAL_VISIBLE (50)
      rerenderList({ vehicles, filter: "Vehicle" });

      // Still only the first 50 are shown
      expect(screen.getByText("Vehicle 0")).toBeInTheDocument();
      expect(screen.getByText("Vehicle 49")).toBeInTheDocument();
      expect(screen.queryByText("Vehicle 50")).not.toBeInTheDocument();
    });

    it("hides 'Show more' button after all vehicles are loaded", async () => {
      const vehicles = makeVehicles(60);
      const user = userEvent.setup();
      renderList({ vehicles });

      expect(screen.getByText(/Show more/)).toBeInTheDocument();

      await user.click(screen.getByText(/Show more/));

      // All 60 now visible, button should disappear
      expect(screen.queryByText(/Show more/)).not.toBeInTheDocument();
      expect(screen.getByText("Vehicle 59")).toBeInTheDocument();
    });
  });
});
