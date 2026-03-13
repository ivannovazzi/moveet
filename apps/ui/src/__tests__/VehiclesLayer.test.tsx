import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import type { Fleet, Position } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";

// ---------------------------------------------------------------------------
// Mock canvas context — jsdom does not implement CanvasRenderingContext2D
// ---------------------------------------------------------------------------
function createMockContext(): CanvasRenderingContext2D {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === "__calls") return calls;
      if (prop === "canvas") return { width: 800, height: 600 };
      // Return a function spy for any method access
      if (typeof prop === "string" && !["fillStyle", "strokeStyle", "lineWidth", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY"].includes(prop)) {
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      }
      return undefined;
    },
    set(_target, prop: string, value: unknown) {
      calls.push({ method: `set:${prop}`, args: [value] });
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

let mockCtx: CanvasRenderingContext2D;
let ctxCalls: Array<{ method: string; args: unknown[] }>;

// Patch HTMLCanvasElement.prototype.getContext to return our mock
const originalGetContext = HTMLCanvasElement.prototype.getContext;

// ---------------------------------------------------------------------------
// Mock the map context
// ---------------------------------------------------------------------------
const mockProjection = vi.fn((pos: Position) => [pos[0] * 10, pos[1] * 10] as [number, number]);
(mockProjection as unknown as { invert: unknown }).invert = vi.fn();

const mockTransform = { k: 1, x: 0, y: 0 };

const mockMapElement = document.createElement("svg");
const mockContainer = document.createElement("div");
mockContainer.style.position = "relative";
mockContainer.appendChild(mockMapElement);
document.body.appendChild(mockContainer);

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    projection: mockProjection,
    transform: mockTransform,
    map: mockMapElement,
    getBoundingBox: () => [
      [0, 0],
      [0, 0],
    ],
    getZoom: () => 1,
  }),
}));

// Import AFTER mocks
import VehiclesLayer from "@/Map/Vehicle/VehiclesLayer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFleetMap(...entries: Array<[string, Partial<Fleet>]>): Map<string, Fleet> {
  const map = new Map<string, Fleet>();
  for (const [vehicleId, partial] of entries) {
    map.set(vehicleId, {
      id: partial.id ?? "fleet-1",
      name: partial.name ?? "Fleet 1",
      color: partial.color ?? "#ff0000",
      source: partial.source ?? "local",
      vehicleIds: partial.vehicleIds ?? [vehicleId],
    });
  }
  return map;
}

const defaultProps = {
  scale: 1.5,
  vehicleFleetMap: new Map<string, Fleet>(),
  hiddenFleetIds: new Set<string>(),
  onClick: vi.fn(),
};

/**
 * Render VehiclesLayer then run one animation frame to trigger the render loop.
 */
function renderAndTick(props: Partial<typeof defaultProps> = {}) {
  const merged = { ...defaultProps, ...props };
  const result = render(<VehiclesLayer {...merged} />);

  // Run pending effects and one animation frame
  act(() => {
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(16); // one frame ~16ms
  });

  return result;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  vehicleStore.replace([]);
  defaultProps.onClick.mockClear();
  mockProjection.mockClear();

  // Create fresh mock context
  mockCtx = createMockContext();
  ctxCalls = (mockCtx as unknown as { __calls: typeof ctxCalls }).__calls;

  HTMLCanvasElement.prototype.getContext = function () {
    return mockCtx;
  } as typeof HTMLCanvasElement.prototype.getContext;

  // Stub requestAnimationFrame/cancelAnimationFrame with timer-based versions
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    return setTimeout(cb, 16) as unknown as number;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    clearTimeout(id);
  });

  // Mock ResizeObserver
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  HTMLCanvasElement.prototype.getContext = originalGetContext;

  // Clean up any canvases added to the container
  for (const c of mockContainer.querySelectorAll("canvas")) {
    c.remove();
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("VehiclesLayer (Canvas)", () => {
  it("creates a canvas element in the map container", () => {
    render(<VehiclesLayer {...defaultProps} />);

    act(() => {
      vi.advanceTimersByTime(0);
    });

    const canvas = mockContainer.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(canvas!.style.position).toBe("absolute");
    expect(canvas!.style.pointerEvents).toBe("none");
  });

  it("removes the canvas element on unmount", () => {
    const { unmount } = render(<VehiclesLayer {...defaultProps} />);

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(mockContainer.querySelector("canvas")).toBeTruthy();

    unmount();
    expect(mockContainer.querySelector("canvas")).toBeNull();
  });

  it("returns null (no SVG elements)", () => {
    const { container } = render(<VehiclesLayer {...defaultProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("clears the canvas on each render frame", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
    ]);

    renderAndTick();

    const clearCalls = ctxCalls.filter((c) => c.method === "clearRect");
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("calls canvas drawing methods for each vehicle", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
      { id: "v2", name: "V2", position: [36.83, -1.30], speed: 40, heading: 180 },
    ]);

    renderAndTick();

    // Check for beginPath calls (one per vehicle)
    const beginPathCalls = ctxCalls.filter((c) => c.method === "beginPath");
    expect(beginPathCalls.length).toBeGreaterThanOrEqual(2);

    // Check for fill calls
    const fillCalls = ctxCalls.filter((c) => c.method === "fill");
    expect(fillCalls.length).toBeGreaterThanOrEqual(2);

    // Check for moveTo/lineTo calls (4 vertices per arrow)
    const moveToCalls = ctxCalls.filter((c) => c.method === "moveTo");
    expect(moveToCalls.length).toBeGreaterThanOrEqual(2);

    const lineToCalls = ctxCalls.filter((c) => c.method === "lineTo");
    expect(lineToCalls.length).toBeGreaterThanOrEqual(6); // 3 lineTo per vehicle * 2 vehicles
  });

  it("applies fleet colors for vehicle fill", () => {
    const fleetMap = makeFleetMap(["v1", { color: "#ff0000" }], ["v2", { color: "#00ff00" }]);

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
      { id: "v2", name: "V2", position: [36.83, -1.30], speed: 40, heading: 0 },
    ]);

    renderAndTick({ vehicleFleetMap: fleetMap });

    // Check that fillStyle was set to the fleet colors
    const fillStyleSets = ctxCalls.filter((c) => c.method === "set:fillStyle");
    const fillColors = fillStyleSets.map((c) => c.args[0]);
    expect(fillColors).toContain("#ff0000");
    expect(fillColors).toContain("#00ff00");
  });

  it("uses default fill color when vehicle has no fleet", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const fillStyleSets = ctxCalls.filter((c) => c.method === "set:fillStyle");
    const fillColors = fillStyleSets.map((c) => c.args[0]);
    expect(fillColors).toContain("#dcdcdc"); // DEFAULT_FILL
  });

  it("skips vehicles at origin (0, 0)", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [0, 0], speed: 30, heading: 90 },
    ]);

    renderAndTick();

    // No moveTo calls should happen (no arrows drawn)
    const moveToCalls = ctxCalls.filter((c) => c.method === "moveTo");
    expect(moveToCalls.length).toBe(0);
  });

  it("skips vehicles in hidden fleets", () => {
    const fleetMap = makeFleetMap(["v1", { id: "fleet-1", color: "#ff0000" }]);
    const hiddenFleetIds = new Set(["fleet-1"]);

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
    ]);

    renderAndTick({ vehicleFleetMap: fleetMap, hiddenFleetIds });

    const moveToCalls = ctxCalls.filter((c) => c.method === "moveTo");
    expect(moveToCalls.length).toBe(0);
  });

  it("renders selection ring for selected vehicle", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ selectedId: "v1" });

    // Selection ring uses arc() for the circle
    const arcCalls = ctxCalls.filter((c) => c.method === "arc");
    expect(arcCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("renders glow shadow for selected vehicle", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ selectedId: "v1" });

    // Check that shadowBlur was set (glow effect)
    const shadowBlurSets = ctxCalls.filter((c) => c.method === "set:shadowBlur");
    expect(shadowBlurSets.length).toBeGreaterThanOrEqual(1);
    expect(shadowBlurSets.some((c) => (c.args[0] as number) > 0)).toBe(true);
  });

  it("renders glow shadow for hovered vehicle", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ hoveredId: "v1" });

    const shadowBlurSets = ctxCalls.filter((c) => c.method === "set:shadowBlur");
    expect(shadowBlurSets.length).toBeGreaterThanOrEqual(1);
    expect(shadowBlurSets.some((c) => (c.args[0] as number) > 0)).toBe(true);
  });

  it("applies the D3 zoom transform to the canvas context", () => {
    mockTransform.k = 2;
    mockTransform.x = 100;
    mockTransform.y = 50;

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    // setTransform should be called with DPR-scaled zoom parameters
    const setTransformCalls = ctxCalls.filter((c) => c.method === "setTransform");
    // First call resets, second applies zoom
    expect(setTransformCalls.length).toBeGreaterThanOrEqual(2);

    // Reset transform to defaults for other tests
    mockTransform.k = 1;
    mockTransform.x = 0;
    mockTransform.y = 0;
  });

  it("does not draw when no vehicles are in the store", () => {
    vehicleStore.replace([]);
    renderAndTick();

    const moveToCalls = ctxCalls.filter((c) => c.method === "moveTo");
    expect(moveToCalls.length).toBe(0);
  });
});

describe("VehiclesLayer hit testing", () => {
  it("calls onClick with vehicle id when clicking near a vehicle", () => {
    const onClick = vi.fn();

    // Position [36.82, -1.29] -> projection returns [lng*10, lat*10] = [-1.29*10, 36.82*10]
    // Wait, the DTO has position [lat, lng] = [36.82, -1.29]
    // The code does: projectPosition([v.position[1], v.position[0]]) = projectPosition([-1.29, 36.82])
    // mockProjection([-1.29, 36.82]) => [-1.29*10, 36.82*10] = [-12.9, 368.2]
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ onClick });

    // Simulate a click on the SVG element
    // With transform k=1, x=0, y=0: projX = clientX, projY = clientY
    // Vehicle is projected at [-12.9, 368.2]
    // We need to click near that in screen coords
    // getBoundingClientRect will return 0,0 for the canvas mock
    const clickEvent = new MouseEvent("click", {
      clientX: -12.9,
      clientY: 368.2,
      bubbles: true,
    });

    // The canvas getBoundingClientRect needs to return proper values
    const canvas = mockContainer.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    act(() => {
      mockMapElement.dispatchEvent(clickEvent);
    });

    expect(onClick).toHaveBeenCalledWith("v1");
  });

  it("does not call onClick when clicking far from any vehicle", () => {
    const onClick = vi.fn();

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ onClick });

    const canvas = mockContainer.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Click far away from the vehicle
    const clickEvent = new MouseEvent("click", {
      clientX: 500,
      clientY: 500,
      bubbles: true,
    });

    act(() => {
      mockMapElement.dispatchEvent(clickEvent);
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it("selects the closest vehicle when multiple are nearby", () => {
    const onClick = vi.fn();

    // Two vehicles close together
    // v1 at position [1, 1] -> project([1, 1]) = [10, 10]
    // v2 at position [1.1, 1.1] -> project([1.1, 1.1]) = [11, 11]
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [1, 1], speed: 30, heading: 0 },
      { id: "v2", name: "V2", position: [1.1, 1.1], speed: 40, heading: 0 },
    ]);

    renderAndTick({ onClick });

    const canvas = mockContainer.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Click closer to v2 (at [11, 11])
    const clickEvent = new MouseEvent("click", {
      clientX: 10.8,
      clientY: 10.8,
      bubbles: true,
    });

    act(() => {
      mockMapElement.dispatchEvent(clickEvent);
    });

    expect(onClick).toHaveBeenCalledWith("v2");
  });
});
