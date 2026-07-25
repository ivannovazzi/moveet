import { describe, it, expect } from "vitest";
import {
  RouteManager,
  heatZoneSpeedFactorFor,
  HEAT_ZONE_NEUTRAL_INTENSITY,
} from "../modules/RouteManager";
import type { RoadNetwork } from "../modules/RoadNetwork";
import type { VehicleRegistry } from "../modules/VehicleRegistry";
import type { TrafficManager } from "../modules/TrafficManager";
import { getProfile } from "../utils/vehicleProfiles";
import type { Edge, HeatZoneFeature, Node, StartOptions, Vehicle, VehicleType } from "../types";

/**
 * Heat-zone intensity → speed penalty.
 *
 * These tests pin the three things the change is allowed to do and the three
 * things it is NOT allowed to do:
 *   - hotter zone slows more than a cooler one            (the feature)
 *   - a zone AT the neutral intensity is unchanged        (no stealth slowdown)
 *   - a zone with no intensity is unchanged               (graceful degradation)
 *   - ambulances are untouched at every intensity         (existing invariant)
 *   - the heat term composes with the BPR congestion term
 *     as a MIN, never as a product                        (no double counting)
 */

const BASE_HEAT_FACTOR = 0.5;
const EDGE_MAX_SPEED = 60;

const OPTIONS: StartOptions = {
  updateInterval: 500,
  minSpeed: 20,
  maxSpeed: 60,
  speedVariation: 0,
  acceleration: 5,
  deceleration: 7,
  turnThreshold: 45,
  heatZoneSpeedFactor: BASE_HEAT_FACTOR,
  adapterSyncInterval: 1000,
};

/** Position inside every zone built by {@link squareZone} below. */
const INSIDE: [number, number] = [-1.25, 36.85]; // [lat, lon]

function node(coordinates: [number, number]): Node {
  return { id: `${coordinates[0]},${coordinates[1]}`, coordinates, connections: [] } as Node;
}

function edge(id: string): Edge {
  return {
    id,
    start: node([-1.26, 36.84]),
    end: node([-1.24, 36.86]),
    distance: 1,
    bearing: 45,
    maxSpeed: EDGE_MAX_SPEED,
    highway: "primary",
    streetId: "street-1",
  } as Edge;
}

/**
 * An axis-aligned square zone covering lon 36.8..36.9 / lat -1.3..-1.2, i.e.
 * containing {@link INSIDE}. `intensity: null` produces a feature whose
 * intensity property is absent, standing in for a legacy/injected zone.
 */
function squareZone(intensity: number | null, offsetLon = 0): HeatZoneFeature {
  const properties: Record<string, unknown> = {
    id: `zone-${intensity}-${offsetLon}`,
    timestamp: "2026-07-25T00:00:00.000Z",
    radius: 1,
  };
  if (intensity !== null) properties.intensity = intensity;
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [36.8 + offsetLon, -1.3],
        [36.9 + offsetLon, -1.3],
        [36.9 + offsetLon, -1.2],
        [36.8 + offsetLon, -1.2],
        [36.8 + offsetLon, -1.3],
      ],
    },
  } as unknown as HeatZoneFeature;
}

/** Even-odd ray cast over a zone feature's `[lon, lat]` ring. */
function containsPoint(zone: HeatZoneFeature, position: [number, number]): boolean {
  const polygon = zone?.geometry?.coordinates as unknown as number[][];
  if (!polygon || polygon.length === 0) return false;
  const px = position[1]; // longitude
  const py = position[0]; // latitude
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface Harness {
  routeManager: RouteManager;
  vehicle: Vehicle;
  intensityCalls: () => number;
}

function makeHarness(opts: {
  zones?: HeatZoneFeature[] | null; // null => network cannot export zones at all
  inHeatZone?: boolean;
  congestion?: number;
  type?: VehicleType;
  position?: [number, number];
}): Harness {
  const { zones = [], inHeatZone = true, congestion = 1, type = "car", position = INSIDE } = opts;

  let intensityCalls = 0;
  const currentEdge = edge("edge-1");
  const nextEdge = edge("edge-2");

  const network = {
    isPositionInHeatZone: () => inHeatZone,
    getConnectedEdges: () => [nextEdge],
    getFallbackEdge: () => nextEdge,
    // `zones: null` models a network that cannot answer an intensity query at
    // all (test doubles, future transports) — the legacy flat-penalty path.
    ...(zones === null
      ? {}
      : {
          getHeatZoneIntensityAt: (pos: [number, number]) => {
            intensityCalls++;
            // Mirrors HeatZoneManager.getIntensityAt: hottest containing zone,
            // skipping zones with no usable intensity.
            let hottest: number | null = null;
            for (const zone of zones) {
              const intensity = zone?.properties?.intensity;
              if (typeof intensity !== "number" || !Number.isFinite(intensity)) continue;
              if (!containsPoint(zone, pos)) continue;
              if (hottest === null || intensity > hottest) hottest = intensity;
            }
            return hottest;
          },
        }),
  } as unknown as RoadNetwork;

  const registry = {
    findVehicleAhead: () => undefined,
    get: () => undefined,
    has: () => false,
  } as unknown as VehicleRegistry;

  const traffic = {
    getCongestionFactor: () => congestion,
    enter: () => {},
    leave: () => {},
  } as unknown as TrafficManager;

  const routeManager = new RouteManager(network, registry, traffic);
  routeManager.getClockHour = () => 12; // midday: no night-time highway bonus

  const profile = getProfile(type);
  const vehicle: Vehicle = {
    id: `veh-${type}`,
    name: type,
    type,
    currentEdge,
    position,
    speed: profile.maxSpeed,
    targetSpeed: profile.maxSpeed,
    bearing: 45,
    progress: 0.1,
  } as Vehicle;

  return { routeManager, vehicle, intensityCalls: () => intensityCalls };
}

/**
 * Runs one 1000 ms tick from full speed. The final clamp in `updateSpeed` is
 * `min(effectiveMax, ...)`, and one tick of deceleration cannot fall below the
 * effective maxima used here, so the returned speed IS `effectiveMax` exactly.
 */
function speedAfterTick(h: Harness): number {
  h.routeManager.updateSpeed(h.vehicle, 1000, OPTIONS);
  return h.vehicle.speed;
}

describe("heatZoneSpeedFactorFor", () => {
  it("reproduces the configured factor exactly at the neutral intensity", () => {
    expect(heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, HEAT_ZONE_NEUTRAL_INTENSITY)).toBeCloseTo(
      BASE_HEAT_FACTOR,
      12
    );
  });

  it("returns the configured factor unchanged when intensity is unknown", () => {
    expect(heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, null)).toBe(BASE_HEAT_FACTOR);
    expect(heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, Number.NaN)).toBe(BASE_HEAT_FACTOR);
  });

  it("is strictly monotonic: hotter intensity means a lower factor", () => {
    const factors = [0, 0.2, 0.4, 0.6, 0.8, 1].map((i) =>
      heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, i)
    );
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeLessThan(factors[i - 1]);
    }
  });

  it("treats a zero-intensity zone as no penalty", () => {
    expect(heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, 0)).toBe(1);
  });

  it("stays within (0, 1] and clamps out-of-range intensities", () => {
    expect(heatZoneSpeedFactorFor(0.05, 1)).toBeGreaterThan(0);
    expect(heatZoneSpeedFactorFor(0.05, 1)).toBeLessThan(1);
    // Above/below the documented 0-1 range clamps rather than extrapolating.
    expect(heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, 4)).toBe(
      heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, 1)
    );
    expect(heatZoneSpeedFactorFor(BASE_HEAT_FACTOR, -2)).toBe(1);
  });
});

describe("RouteManager heat-zone intensity → speed", () => {
  it("slows a vehicle more in a high-intensity zone than in a low-intensity one", () => {
    const hot = speedAfterTick(makeHarness({ zones: [squareZone(0.9)] }));
    const mild = speedAfterTick(makeHarness({ zones: [squareZone(0.3)] }));

    expect(hot).toBeLessThan(mild);
    expect(hot).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR ** (0.9 / 0.6), 6);
    expect(mild).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR ** (0.3 / 0.6), 6);
  });

  it("applies exactly the legacy flat penalty at the neutral intensity", () => {
    const neutral = speedAfterTick(
      makeHarness({ zones: [squareZone(HEAT_ZONE_NEUTRAL_INTENSITY)] })
    );
    expect(neutral).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR, 6);
  });

  it("falls back to the legacy flat penalty for a zone carrying no intensity", () => {
    const legacyZone = speedAfterTick(makeHarness({ zones: [squareZone(null)] }));
    expect(legacyZone).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR, 6);
  });

  it("falls back to the legacy flat penalty when the position matches no exported zone", () => {
    // Network says "in a zone" but the only exported zone is elsewhere: not a
    // reason to invent a penalty of zero or of maximum.
    const orphan = speedAfterTick(makeHarness({ zones: [squareZone(0.9, 10)] }));
    expect(orphan).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR, 6);
  });

  it("falls back to the legacy flat penalty when the network cannot export zones", () => {
    const noExport = speedAfterTick(makeHarness({ zones: null }));
    expect(noExport).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR, 6);
  });

  it("applies no heat penalty at all outside a zone", () => {
    const outside = speedAfterTick(makeHarness({ zones: [squareZone(0.9)], inHeatZone: false }));
    expect(outside).toBeCloseTo(EDGE_MAX_SPEED, 6);
  });

  it("uses the hottest zone when zones overlap", () => {
    const overlapping = speedAfterTick(makeHarness({ zones: [squareZone(0.3), squareZone(0.9)] }));
    expect(overlapping).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR ** (0.9 / 0.6), 6);
  });

  // The intensity lookup is delegated to the network (which owns the spatial
  // grid) rather than cached locally, so it is queried once per in-zone tick
  // and always reflects the current intensity — no staleness window.
  it("queries the network once per in-zone tick", () => {
    const h = makeHarness({ zones: [squareZone(0.9)] });
    speedAfterTick(h);
    speedAfterTick(h);
    speedAfterTick(h);
    expect(h.intensityCalls()).toBe(3);
  });

  it("picks up an intensity change immediately, with no cache to invalidate", () => {
    const zone = squareZone(0.3);
    const h = makeHarness({ zones: [zone] });
    const faded = speedAfterTick(h);

    // Simulate the zone blooming at rush hour, as applyTimeOfDay would.
    (zone.properties as Record<string, unknown>).intensity = 0.9;
    const bloomed = speedAfterTick(makeHarness({ zones: [zone] }));

    expect(bloomed).toBeLessThan(faded);
    expect(bloomed).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR ** (0.9 / 0.6), 6);
  });
});

describe("RouteManager heat zones and ambulances", () => {
  const ambulanceMax = getProfile("ambulance").maxSpeed; // 80, above the edge max

  it("ignores heat-zone intensity entirely, at every intensity", () => {
    const speeds = [0.1, 0.3, HEAT_ZONE_NEUTRAL_INTENSITY, 0.9, 1].map((intensity) =>
      speedAfterTick(makeHarness({ zones: [squareZone(intensity)], type: "ambulance" }))
    );
    const outside = speedAfterTick(
      makeHarness({ zones: [squareZone(1)], type: "ambulance", inHeatZone: false })
    );

    // Edge max (60) binds before the ambulance profile max (80).
    expect(ambulanceMax).toBeGreaterThan(EDGE_MAX_SPEED);
    for (const speed of speeds) {
      expect(speed).toBeCloseTo(EDGE_MAX_SPEED, 6);
      expect(speed).toBeCloseTo(outside, 6);
    }
  });

  it("never consults the zone index for an ambulance", () => {
    const h = makeHarness({ zones: [squareZone(0.9)], type: "ambulance" });
    speedAfterTick(h);
    expect(h.intensityCalls()).toBe(0);
  });

  it("still applies BPR congestion to an ambulance", () => {
    const congested = speedAfterTick(
      makeHarness({ zones: [squareZone(0.9)], type: "ambulance", congestion: 0.4 })
    );
    expect(congested).toBeCloseTo(EDGE_MAX_SPEED * 0.4, 6);
  });
});

describe("RouteManager heat zone / BPR congestion composition", () => {
  // The decision under test: the heat-zone factor and the BPR congestion factor
  // are two views of the same time-of-day demand curve, so they compose as
  // min(), NOT as a product. Asserting it here means a future change back to a
  // product (double counting rush hour) fails rather than silently ships.

  it("takes the heat factor when it is the stronger constraint", () => {
    const heat = BASE_HEAT_FACTOR ** (0.9 / 0.6); // ~0.354
    const congestion = 0.8;
    const speed = speedAfterTick(makeHarness({ zones: [squareZone(0.9)], congestion }));

    expect(heat).toBeLessThan(congestion);
    expect(speed).toBeCloseTo(EDGE_MAX_SPEED * heat, 6);
    expect(speed).not.toBeCloseTo(EDGE_MAX_SPEED * heat * congestion, 6);
  });

  it("takes the congestion factor when it is the stronger constraint", () => {
    const heat = BASE_HEAT_FACTOR ** (0.3 / 0.6); // ~0.707
    const congestion = 0.3;
    const speed = speedAfterTick(makeHarness({ zones: [squareZone(0.3)], congestion }));

    expect(congestion).toBeLessThan(heat);
    expect(speed).toBeCloseTo(EDGE_MAX_SPEED * congestion, 6);
    expect(speed).not.toBeCloseTo(EDGE_MAX_SPEED * heat * congestion, 6);
  });

  it("leaves each term's solo behaviour untouched", () => {
    // Congestion alone (no heat zone) is unchanged by the composition rule.
    const congestionOnly = speedAfterTick(
      makeHarness({ zones: [squareZone(0.9)], inHeatZone: false, congestion: 0.5 })
    );
    expect(congestionOnly).toBeCloseTo(EDGE_MAX_SPEED * 0.5, 6);

    // Heat zone alone (free-flowing edge) is unchanged too.
    const heatOnly = speedAfterTick(
      makeHarness({ zones: [squareZone(HEAT_ZONE_NEUTRAL_INTENSITY)], congestion: 1 })
    );
    expect(heatOnly).toBeCloseTo(EDGE_MAX_SPEED * BASE_HEAT_FACTOR, 6);
  });

  it("is never weaker than either term alone", () => {
    for (const congestion of [0.25, 0.5, 0.75, 1]) {
      for (const intensity of [0.1, 0.5, 0.9]) {
        const speed = speedAfterTick(makeHarness({ zones: [squareZone(intensity)], congestion }));
        const heat = BASE_HEAT_FACTOR ** (intensity / 0.6);
        expect(speed).toBeLessThanOrEqual(EDGE_MAX_SPEED * heat + 1e-9);
        expect(speed).toBeLessThanOrEqual(EDGE_MAX_SPEED * congestion + 1e-9);
      }
    }
  });
});
