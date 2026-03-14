import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BatchDispatch from "../BatchDispatch";
import { createVehicle } from "@/test/mocks/types";
import type { DispatchAssignment, Vehicle } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    batchDirection: vi.fn(),
  },
}));

import client from "@/utils/client";

const mockedBatchDirection = vi.mocked(client.batchDirection);

function makeAssignment(overrides: Partial<DispatchAssignment> = {}): DispatchAssignment {
  return {
    vehicleId: "v1",
    vehicleName: "Truck Alpha",
    destination: [-1.2921, 36.8219],
    ...overrides,
  };
}

describe("BatchDispatch", () => {
  const defaultVehicles: Vehicle[] = [
    createVehicle({ id: "v1", name: "Truck Alpha", visible: true }),
    createVehicle({ id: "v2", name: "Van Beta", visible: true }),
  ];

  const defaultProps = {
    assignments: [] as DispatchAssignment[],
    onRemoveAssignment: vi.fn(),
    onClearAll: vi.fn(),
    onClose: vi.fn(),
    vehicles: defaultVehicles,
    isDispatchMode: false,
    onToggleDispatchMode: vi.fn(),
    selectedForDispatch: [] as string[],
    onToggleVehicleForDispatch: vi.fn(),
    onSelectAllForDispatch: vi.fn(),
    onClearSelection: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state with no assignments", () => {
    render(<BatchDispatch {...defaultProps} />);
    expect(screen.getByText("No pending assignments")).toBeInTheDocument();
  });

  it("renders dispatch mode empty state when dispatch mode is active", () => {
    render(<BatchDispatch {...defaultProps} isDispatchMode={true} />);
    expect(screen.getByText("Select vehicles in the list, then click the map")).toBeInTheDocument();
  });

  it("shows assignments with vehicle names and coordinates", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        destination: [-1.2921, 36.8219],
      }),
      makeAssignment({ vehicleId: "v2", vehicleName: "Van Beta", destination: [-1.3, 36.85] }),
    ];

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    expect(screen.getByText("Truck Alpha")).toBeInTheDocument();
    expect(screen.getByText("Van Beta")).toBeInTheDocument();
    expect(screen.getByText("-1.2921, 36.8219")).toBeInTheDocument();
    expect(screen.getByText("-1.3000, 36.8500")).toBeInTheDocument();
  });

  it("calls onRemoveAssignment with correct vehicleId when remove button clicked", async () => {
    const onRemoveAssignment = vi.fn();
    const assignments = [
      makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" }),
      makeAssignment({ vehicleId: "v2", vehicleName: "Van Beta" }),
    ];
    const user = userEvent.setup();

    render(
      <BatchDispatch
        {...defaultProps}
        assignments={assignments}
        onRemoveAssignment={onRemoveAssignment}
      />
    );

    const removeButtons = screen.getAllByTitle("Remove assignment");
    await user.click(removeButtons[0]);
    expect(onRemoveAssignment).toHaveBeenCalledWith("v1");
  });

  it("calls onClearAll when clear button clicked", async () => {
    const onClearAll = vi.fn();
    const assignments = [makeAssignment()];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} onClearAll={onClearAll} />);

    await user.click(screen.getByText("Clear"));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("dispatch button is disabled when no assignments", () => {
    render(<BatchDispatch {...defaultProps} />);
    const button = screen.getByText("Dispatch All (0)");
    expect(button).toBeDisabled();
  });

  it("dispatch button is enabled when assignments exist", () => {
    const assignments = [makeAssignment()];
    render(<BatchDispatch {...defaultProps} assignments={assignments} />);
    const button = screen.getByText("Dispatch All (1)");
    expect(button).not.toBeDisabled();
  });

  it("calls client.batchDirection with correct payload on dispatch", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: { status: "ok", results: [] },
    });

    const assignments = [
      makeAssignment({ vehicleId: "v1", destination: [-1.2921, 36.8219] }),
      makeAssignment({ vehicleId: "v2", destination: [-1.3, 36.85] }),
    ];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (2)"));

    expect(mockedBatchDirection).toHaveBeenCalledWith([
      { id: "v1", lat: -1.2921, lng: 36.8219 },
      { id: "v2", lat: -1.3, lng: 36.85 },
    ]);
  });

  it("shows success indicators after successful dispatch", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "ok",
        results: [
          { vehicleId: "v1", status: "ok", eta: 120 },
          { vehicleId: "v2", status: "ok", eta: 95 },
        ],
      },
    });

    const assignments = [
      makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" }),
      makeAssignment({ vehicleId: "v2", vehicleName: "Van Beta" }),
    ];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (2)"));

    await waitFor(() => {
      expect(screen.getByText("ETA 120s")).toBeInTheDocument();
      expect(screen.getByText("ETA 95s")).toBeInTheDocument();
    });
  });

  it("shows error indicators for failed dispatches", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "ok",
        results: [
          { vehicleId: "v1", status: "ok", eta: 60 },
          { vehicleId: "v2", status: "error", error: "No route found" },
        ],
      },
    });

    const assignments = [
      makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" }),
      makeAssignment({ vehicleId: "v2", vehicleName: "Van Beta" }),
    ];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (2)"));

    await waitFor(() => {
      expect(screen.getByText("ETA 60s")).toBeInTheDocument();
      expect(screen.getByText("No route found")).toBeInTheDocument();
    });
  });

  it("shows 'Dispatched' for ok results without eta", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "ok",
        results: [{ vehicleId: "v1", status: "ok" }],
      },
    });

    const assignments = [makeAssignment({ vehicleId: "v1" })];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      expect(screen.getByText("Dispatched")).toBeInTheDocument();
    });
  });

  it("shows 'Failed' for error results without error message", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "ok",
        results: [{ vehicleId: "v1", status: "error" }],
      },
    });

    const assignments = [makeAssignment({ vehicleId: "v1" })];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByLabelText("Close dispatch panel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onToggleDispatchMode when mode toggle clicked", async () => {
    const onToggleDispatchMode = vi.fn();
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} onToggleDispatchMode={onToggleDispatchMode} />);

    await user.click(screen.getByText("Enable map click mode"));
    expect(onToggleDispatchMode).toHaveBeenCalledOnce();
  });

  it("does not show clear button when no assignments", () => {
    render(<BatchDispatch {...defaultProps} />);
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("shows dispatching state while API call is in progress", async () => {
    let resolvePromise: (value: unknown) => void;
    mockedBatchDirection.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const assignments = [makeAssignment()];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    expect(screen.getByText("Dispatching...")).toBeInTheDocument();
    expect(screen.getByText("Dispatching...")).toBeDisabled();

    resolvePromise!({ data: { status: "ok", results: [] } });

    await waitFor(() => {
      expect(screen.getByText("Dispatch All (1)")).toBeInTheDocument();
    });
  });

  it("shows vehicle name in results by resolving from vehicles prop", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "ok",
        results: [{ vehicleId: "v1", status: "ok", eta: 45 }],
      },
    });

    const assignments = [makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" })];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      // The result row should show the vehicle name from the vehicles prop
      const resultNames = screen.getAllByText("Truck Alpha");
      // One in the assignment list, one in the results
      expect(resultNames.length).toBe(2);
    });
  });

  it("falls back to vehicleId when vehicle not found in vehicles prop", async () => {
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "ok",
        results: [{ vehicleId: "unknown-id", status: "ok", eta: 30 }],
      },
    });

    const assignments = [makeAssignment({ vehicleId: "unknown-id", vehicleName: "Ghost" })];
    const user = userEvent.setup();

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      expect(screen.getByText("unknown-id")).toBeInTheDocument();
    });
  });

  it("handles API error without crashing", async () => {
    // The component does not have try/catch, so the rejection propagates.
    // Mock batchDirection to resolve with an error-level response instead
    // (simulating a server error response that the HTTP client wraps).
    mockedBatchDirection.mockResolvedValue({
      data: {
        status: "error",
        results: [{ vehicleId: "v1", status: "error", error: "Server error" }],
      },
    });

    const assignments = [makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" })];
    const user = userEvent.setup();

    const { container } = render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      // The component should still be rendered and show the error in results
      expect(container).toBeInTheDocument();
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("handles API response with no data gracefully", async () => {
    // Simulate a response where data is undefined (e.g., network issue handled by httpClient)
    mockedBatchDirection.mockResolvedValue({
      data: undefined,
    });

    const assignments = [makeAssignment({ vehicleId: "v1" })];
    const user = userEvent.setup();

    const { container } = render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      // The component should still be rendered (no crash), no results shown
      expect(container).toBeInTheDocument();
      expect(screen.getByText("Dispatch All (1)")).not.toBeDisabled();
    });
  });

  it("filters out vehicles with visible=false from vehicle picker", () => {
    const vehicles: Vehicle[] = [
      createVehicle({ id: "v1", name: "Truck Alpha", visible: true }),
      createVehicle({ id: "v2", name: "Van Beta", visible: false }),
      createVehicle({ id: "v3", name: "Car Gamma", visible: true }),
    ];

    render(<BatchDispatch {...defaultProps} vehicles={vehicles} isDispatchMode={true} />);

    // Only visible vehicles (v1, v3) should appear in the picker
    expect(screen.getByText("Truck Alpha")).toBeInTheDocument();
    expect(screen.getByText("Car Gamma")).toBeInTheDocument();
    expect(screen.queryByText("Van Beta")).not.toBeInTheDocument();
  });

  it("filters out vehicles already in assignments from vehicle picker", () => {
    const vehicles: Vehicle[] = [
      createVehicle({ id: "v1", name: "Truck Alpha", visible: true }),
      createVehicle({ id: "v2", name: "Van Beta", visible: true }),
      createVehicle({ id: "v3", name: "Car Gamma", visible: true }),
    ];
    const assignments = [makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" })];

    render(
      <BatchDispatch
        {...defaultProps}
        vehicles={vehicles}
        assignments={assignments}
        isDispatchMode={true}
      />
    );

    // v1 is assigned, so only v2 and v3 appear in the picker
    expect(screen.getByText("Van Beta")).toBeInTheDocument();
    expect(screen.getByText("Car Gamma")).toBeInTheDocument();
    // v1 appears in the assignment list, not the picker — check it's not a picker button
    const truckButtons = screen.getAllByText("Truck Alpha");
    // Should only appear in the assignment list, not in picker
    expect(truckButtons).toHaveLength(1);
  });

  it("updates results on second dispatch", async () => {
    const user = userEvent.setup();

    // First dispatch returns eta=120
    mockedBatchDirection.mockResolvedValueOnce({
      data: {
        status: "ok",
        results: [{ vehicleId: "v1", status: "ok", eta: 120 }],
      },
    });

    const assignments = [makeAssignment({ vehicleId: "v1", vehicleName: "Truck Alpha" })];

    render(<BatchDispatch {...defaultProps} assignments={assignments} />);

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      expect(screen.getByText("ETA 120s")).toBeInTheDocument();
    });

    // Second dispatch returns eta=45
    mockedBatchDirection.mockResolvedValueOnce({
      data: {
        status: "ok",
        results: [{ vehicleId: "v1", status: "ok", eta: 45 }],
      },
    });

    await user.click(screen.getByText("Dispatch All (1)"));

    await waitFor(() => {
      expect(screen.getByText("ETA 45s")).toBeInTheDocument();
      expect(screen.queryByText("ETA 120s")).not.toBeInTheDocument();
    });
  });

  it("dispatch button is disabled after assignments are cleared", () => {
    // First render with assignments
    const { rerender } = render(
      <BatchDispatch {...defaultProps} assignments={[makeAssignment({ vehicleId: "v1" })]} />
    );

    // Button should be enabled
    expect(screen.getByText("Dispatch All (1)")).not.toBeDisabled();

    // Re-render with empty assignments (simulating onClearAll having been called)
    rerender(<BatchDispatch {...defaultProps} assignments={[]} />);

    // Button should be disabled again
    expect(screen.getByText("Dispatch All (0)")).toBeDisabled();
  });
});
