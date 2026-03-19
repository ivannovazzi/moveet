import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Fleet, Position } from "@/types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetTrail, mockGetAllTrails, mockGetVersion } = vi.hoisted(() => ({
  mockGetTrail: vi.fn((_id: string) => [] as Position[]),
  mockGetAllTrails: vi.fn(() => new Map<string, Position[]>()),
  mockGetVersion: vi.fn(() => 1),
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
// Mock map element — BreadcrumbLayer appends SVG to this
// ---------------------------------------------------------------------------
let mockMapEl: SVGSVGElement;

const mockProjection = vi.fn((pos: Position) => [pos[0] * 10, pos[1] * 10] as [number, number]);
(mockProjection as unknown as { invert: unknown }).invert = vi.fn();

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    projection: mockProjection,
    transform: { k: 1, x: 0, y: 0 },
    map: mockMapEl,
    getBoundingBox: () => [
      [0, 0],
      [0, 0],
    ],
    getZoom: () => 1,
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

// ---------------------------------------------------------------------------
// Setup: mock RAF to execute synchronously
// ---------------------------------------------------------------------------
let rafCallbacks: FrameRequestCallback[] = [];
let rafId = 0;

function flushRAF() {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  for (const cb of cbs) cb(performance.now());
}

beforeEach(() => {
  mockGetTrail.mockReset();
  mockGetTrail.mockReturnValue([]);
  mockGetAllTrails.mockReset();
  mockGetAllTrails.mockReturnValue(new Map());
  mockGetVersion.mockReturnValue(1);
  mockProjection.mockClear();
  mockProjection.mockImplementation(
    (pos: Position) => [pos[0] * 10, pos[1] * 10] as [number, number]
  );

  // Create a fresh SVG element for the map with a markers group inside
  mockMapEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const markersGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  markersGroup.setAttribute("class", "markers");
  mockMapEl.appendChild(markersGroup);

  // Mock RAF to capture callbacks
  rafCallbacks = [];
  rafId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return ++rafId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BreadcrumbLayer", () => {
  it("renders nothing when no vehicle is selected and showAll is false", () => {
    render(
      <svg>
        <BreadcrumbLayer {...defaultProps} />
      </svg>
    );
    flushRAF();

    const lines = mockMapEl.querySelectorAll("line");
    expect(lines).toHaveLength(0);
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

    render(
      <svg>
        <BreadcrumbLayer {...defaultProps} selectedId="v1" />
      </svg>
    );
    flushRAF();

    // 3 positions → 2 line segments
    const lines = mockMapEl.querySelectorAll("line");
    expect(lines.length).toBe(2);
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

    render(
      <svg>
        <BreadcrumbLayer {...defaultProps} showAll />
      </svg>
    );
    flushRAF();

    // v1: 1 segment, v2: 1 segment = 2 total
    const lines = mockMapEl.querySelectorAll("line");
    expect(lines.length).toBe(2);
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

    render(
      <svg>
        <BreadcrumbLayer showAll vehicleFleetMap={fleetMap} hiddenFleetIds={hiddenFleetIds} />
      </svg>
    );
    flushRAF();

    const lines = mockMapEl.querySelectorAll("line");
    expect(lines).toHaveLength(0);
  });

  it("renders nothing when trail is empty", () => {
    mockGetAllTrails.mockReturnValue(new Map([["v1", []]]));

    render(
      <svg>
        <BreadcrumbLayer {...defaultProps} selectedId="v1" />
      </svg>
    );
    flushRAF();

    const lines = mockMapEl.querySelectorAll("line");
    expect(lines).toHaveLength(0);
  });
});
