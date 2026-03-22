import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Fleet, Position } from "@/types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetTrail, mockGetAllTrails, mockGetVersion, registeredLayers } = vi.hoisted(() => ({
  mockGetTrail: vi.fn((_id: string) => [] as Position[]),
  mockGetAllTrails: vi.fn(() => new Map<string, Position[]>()),
  mockGetVersion: vi.fn(() => 1),
  registeredLayers: new Map<string, unknown[]>(),
}));

// ---------------------------------------------------------------------------
// Mock vehicleStore
// ---------------------------------------------------------------------------
vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: {
    getTrail: mockGetTrail,
    getAllTrails: mockGetAllTrails,
    getVersion: mockGetVersion,
    getAll: vi.fn(() => new Map()),
  },
}));

// ---------------------------------------------------------------------------
// Mock useRegisterLayers to capture layers
// ---------------------------------------------------------------------------
vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
  useDeckLayersContext: () => ({
    registerLayers: () => {},
    unregisterLayers: () => {},
  }),
}));

// Import AFTER mocks
import BreadcrumbLayer from "@/Map/Breadcrumb/BreadcrumbLayer";

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
  showAll: false,
  vehicleFleetMap: new Map<string, Fleet>(),
  hiddenFleetIds: new Set<string>(),
};

/** Get the PathLayer data from registered breadcrumbs layers. */
function getTrailData(): Array<{ vehicleId: string; path: [number, number][] }> {
  const layers = registeredLayers.get("breadcrumbs") ?? [];
  if (layers.length === 0) return [];
  const layer = layers[0] as {
    props: { data: Array<{ vehicleId: string; path: [number, number][] }> };
  };
  return layer.props.data ?? [];
}

// ---------------------------------------------------------------------------
// Setup: use fake timers so RAF callbacks can be flushed via act()
// ---------------------------------------------------------------------------

function flushRAF() {
  // Trigger the initial useEffect, then advance past the RAF callback AND
  // the 100ms STATE_UPDATE_INTERVAL throttle so setState fires.
  act(() => {
    vi.advanceTimersByTime(0); // flush microtasks / effects
  });
  act(() => {
    vi.advanceTimersByTime(150); // trigger RAF + exceed throttle interval → setState
  });
  act(() => {
    vi.advanceTimersByTime(16); // process re-render and subsequent RAF
  });
}

beforeEach(() => {
  vi.useFakeTimers();

  mockGetTrail.mockReset();
  mockGetTrail.mockReturnValue([]);
  mockGetAllTrails.mockReset();
  mockGetAllTrails.mockReturnValue(new Map());
  mockGetVersion.mockReturnValue(1);
  registeredLayers.clear();

  // Mock RAF with timer-based version so vi.advanceTimersByTime triggers it
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    return setTimeout(cb, 16) as unknown as number;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    clearTimeout(id);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BreadcrumbLayer", () => {
  it("renders nothing when no vehicle is selected and showAll is false", () => {
    render(<BreadcrumbLayer {...defaultProps} />);
    flushRAF();

    const data = getTrailData();
    expect(data).toHaveLength(0);
  });

  it("renders trail segments for selected vehicle", () => {
    const trails = new Map<string, Position[]>([
      [
        "v1",
        [
          [36.82, -1.29],
          [36.83, -1.3],
          [36.84, -1.31],
        ],
      ],
    ]);
    mockGetAllTrails.mockReturnValue(trails);

    render(<BreadcrumbLayer {...defaultProps} selectedId="v1" />);
    flushRAF();

    const data = getTrailData();
    expect(data.length).toBe(1);
    expect(data[0].vehicleId).toBe("v1");
    // 3 positions → path with 3 points
    expect(data[0].path.length).toBe(3);
  });

  it("renders trails for all vehicles when showAll is true", () => {
    const trails = new Map<string, Position[]>([
      [
        "v1",
        [
          [36.82, -1.29],
          [36.83, -1.3],
        ],
      ],
      [
        "v2",
        [
          [36.84, -1.31],
          [36.85, -1.32],
        ],
      ],
    ]);
    mockGetAllTrails.mockReturnValue(trails);

    render(<BreadcrumbLayer {...defaultProps} showAll />);
    flushRAF();

    const data = getTrailData();
    expect(data.length).toBe(2);
  });

  it("does not render trail for vehicles in hidden fleets", () => {
    const trails = new Map<string, Position[]>([
      [
        "v1",
        [
          [36.82, -1.29],
          [36.83, -1.3],
          [36.84, -1.31],
        ],
      ],
    ]);
    mockGetAllTrails.mockReturnValue(trails);

    const fleetMap = makeFleetMap(["v1", { id: "fleet-1", color: "#ff0000" }]);
    const hiddenFleetIds = new Set(["fleet-1"]);

    render(<BreadcrumbLayer showAll vehicleFleetMap={fleetMap} hiddenFleetIds={hiddenFleetIds} />);
    flushRAF();

    const data = getTrailData();
    expect(data).toHaveLength(0);
  });

  it("renders nothing when trail is empty", () => {
    mockGetAllTrails.mockReturnValue(new Map([["v1", []]]));

    render(<BreadcrumbLayer {...defaultProps} selectedId="v1" />);
    flushRAF();

    const data = getTrailData();
    expect(data).toHaveLength(0);
  });
});
