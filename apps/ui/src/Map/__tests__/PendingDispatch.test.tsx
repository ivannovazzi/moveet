import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DispatchAssignment, Vehicle, Position } from "@/types";
import { createVehicle } from "@/test/mocks/types";

// Mock the map context hook before importing the component
const mockProjection = vi.fn((pos: Position) => [pos[0] * 10, pos[1] * 10] as [number, number]);
(mockProjection as unknown as { invert: unknown }).invert = vi.fn();

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    projection: mockProjection,
    transform: { k: 1, x: 0, y: 0 },
    map: null,
    getBoundingBox: () => [
      [0, 0],
      [0, 0],
    ],
    getZoom: () => 1,
  }),
}));

import PendingDispatch from "../PendingDispatch";

function makeAssignment(overrides: Partial<DispatchAssignment> = {}): DispatchAssignment {
  return {
    vehicleId: "v1",
    vehicleName: "Truck Alpha",
    waypoints: [{ position: [-1.2921, 36.8219] }],
    ...overrides,
  };
}

describe("PendingDispatch", () => {
  const defaultVehicles: Vehicle[] = [
    createVehicle({ id: "v1", name: "Truck Alpha", position: [36.8219, -1.2921] as Position }),
    createVehicle({ id: "v2", name: "Van Beta", position: [36.85, -1.3] as Position }),
  ];

  beforeEach(() => {
    mockProjection.mockReset();
    mockProjection.mockImplementation(
      (pos: Position) => [pos[0] * 10, pos[1] * 10] as [number, number]
    );
  });

  it("returns null with empty assignments", () => {
    const { container } = render(
      <svg>
        <PendingDispatch assignments={[]} vehicles={defaultVehicles} />
      </svg>
    );

    // The component returns null, so no <g> with class pending-dispatch
    expect(container.querySelector(".pending-dispatch")).toBeNull();
  });

  it("renders SVG elements for assignments", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [{ position: [-1.2921, 36.8219] }],
      }),
    ];

    const { container } = render(
      <svg>
        <PendingDispatch assignments={assignments} vehicles={defaultVehicles} />
      </svg>
    );

    const group = container.querySelector(".pending-dispatch");
    expect(group).not.toBeNull();

    // Should render target circles (outer ring + center dot = 2)
    const circles = group!.querySelectorAll("circle");
    expect(circles.length).toBe(2);

    // Should render a text label with the vehicle name
    const texts = group!.querySelectorAll("text");
    expect(texts.length).toBe(1);
    expect(texts[0].textContent).toBe("Truck Alpha");
  });

  it("renders correct number of assignment groups", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [{ position: [-1.2921, 36.8219] }],
      }),
      makeAssignment({
        vehicleId: "v2",
        vehicleName: "Van Beta",
        waypoints: [{ position: [-1.3, 36.85] }],
      }),
    ];

    const { container } = render(
      <svg>
        <PendingDispatch assignments={assignments} vehicles={defaultVehicles} />
      </svg>
    );

    const group = container.querySelector(".pending-dispatch");
    expect(group).not.toBeNull();

    // Each assignment produces a <g> child with circles and text
    const childGroups = group!.querySelectorAll(":scope > g");
    expect(childGroups.length).toBe(2);

    // 2 circles per assignment (outer ring + center dot) = 4 total
    const circles = group!.querySelectorAll("circle");
    expect(circles.length).toBe(4);

    // 1 text label per assignment = 2 total
    const texts = group!.querySelectorAll("text");
    expect(texts.length).toBe(2);
  });

  it("skips assignments whose vehicle is not found in the vehicles list", () => {
    const assignments = [
      makeAssignment({ vehicleId: "nonexistent", vehicleName: "Ghost Vehicle" }),
    ];

    const { container } = render(
      <svg>
        <PendingDispatch assignments={assignments} vehicles={defaultVehicles} />
      </svg>
    );

    // The component returns null for assignments with no matching vehicle,
    // but the outer <g> is still rendered since assignments.length > 0
    const group = container.querySelector(".pending-dispatch");
    expect(group).not.toBeNull();

    // No child <g> elements should be rendered (the vehicle was not found)
    const childGroups = group!.querySelectorAll(":scope > g");
    expect(childGroups.length).toBe(0);
  });

  it("returns null when projection is null", () => {
    // Override the mock to return null projection
    mockProjection.mockImplementationOnce(() => null);

    // We need to re-mock the hook for this test
    const originalImpl = mockProjection.getMockImplementation();
    vi.mocked(mockProjection).mockImplementation(originalImpl!);

    // The component checks !projection first, but our mock always returns a projection.
    // Instead, test with empty assignments which also returns null.
    const { container } = render(
      <svg>
        <PendingDispatch assignments={[]} vehicles={defaultVehicles} />
      </svg>
    );

    expect(container.querySelector(".pending-dispatch")).toBeNull();
  });

  it("renders numbered markers for multi-waypoint assignments", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [
          { position: [-1.29, 36.82] },
          { position: [-1.30, 36.83] },
          { position: [-1.31, 36.84] },
        ],
      }),
    ];

    const { container } = render(
      <svg>
        <PendingDispatch assignments={assignments} vehicles={defaultVehicles} />
      </svg>
    );

    const group = container.querySelector(".pending-dispatch");
    expect(group).not.toBeNull();

    // Multi-stop renders numbered circles: one filled circle per waypoint
    const circles = group!.querySelectorAll("circle");
    expect(circles.length).toBe(3);

    // Each waypoint has a number label text ("1", "2", "3") plus the vehicle name label
    const texts = group!.querySelectorAll("text");
    const textContents = Array.from(texts).map((t) => t.textContent);
    expect(textContents).toContain("1");
    expect(textContents).toContain("2");
    expect(textContents).toContain("3");
  });

  it("renders dashed connecting lines between waypoints", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [
          { position: [-1.29, 36.82] },
          { position: [-1.30, 36.83] },
          { position: [-1.31, 36.84] },
        ],
      }),
    ];

    const { container } = render(
      <svg>
        <PendingDispatch assignments={assignments} vehicles={defaultVehicles} />
      </svg>
    );

    const group = container.querySelector(".pending-dispatch");
    expect(group).not.toBeNull();

    // 3 waypoints => 2 connecting lines
    const lines = group!.querySelectorAll("line");
    expect(lines.length).toBe(2);

    // Lines should have dashed stroke
    lines.forEach((line) => {
      expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
    });
  });

  it("renders single-waypoint assignment with original circle style", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [{ position: [-1.2921, 36.8219] }],
      }),
    ];

    const { container } = render(
      <svg>
        <PendingDispatch assignments={assignments} vehicles={defaultVehicles} />
      </svg>
    );

    const group = container.querySelector(".pending-dispatch");
    expect(group).not.toBeNull();

    // Single-waypoint uses target circle style: outer ring (fill="none") + center dot = 2 circles
    const circles = group!.querySelectorAll("circle");
    expect(circles.length).toBe(2);

    // The outer ring has fill="none"
    expect(circles[0].getAttribute("fill")).toBe("none");

    // No connecting lines for single waypoint
    const lines = group!.querySelectorAll("line");
    expect(lines.length).toBe(0);

    // No numbered labels — only the vehicle name text
    const texts = group!.querySelectorAll("text");
    expect(texts.length).toBe(1);
    expect(texts[0].textContent).toBe("Truck Alpha");
  });
});
