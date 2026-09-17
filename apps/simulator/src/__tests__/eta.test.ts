import { describe, it, expect } from "vitest";
import type { Edge, Node } from "../types";
import {
  priceRoute,
  remainingDistanceKm,
  remainingEtaSeconds,
  type EtaPricingInputs,
} from "../modules/eta";

/**
 * fleetsim-all-1ajn.11: route ETAs priced by the cost model instead of
 * `distance / vehicle.speed`.
 *
 * The property that matters, and the reason this module exists: an ETA is a
 * function of the ROUTE and the network's state, never of how fast the vehicle
 * happens to be going this tick.
 */

function node(id: string): Node {
  return { id, coordinates: [0, 0], connections: [] };
}

function edge(id: string, distanceKm: number, maxSpeed: number, extra: Partial<Edge> = {}): Edge {
  return {
    id,
    streetId: `street-${id}`,
    start: node(`${id}-start`),
    end: node(`${id}-end`),
    distance: distanceKm,
    bearing: 0,
    highway: "primary",
    maxSpeed,
    surface: "asphalt",
    oneway: false,
    ...extra,
  };
}

/** Pricing inputs with every optional term switched off, so a test can add one at a time. */
function inputs(overrides: Partial<EtaPricingInputs> = {}): EtaPricingInputs {
  return {
    learnedSpeedKmh: () => undefined,
    turnCostHours: () => 0,
    weatherFactor: 1,
    profileMaxSpeed: 200,
    ...overrides,
  };
}

describe("priceRoute", () => {
  it("returns an empty pricing for an empty route", () => {
    const pricing = priceRoute([], inputs());
    expect(pricing.totalSeconds).toBe(0);
    expect(pricing.perEdgeSeconds).toEqual([]);
    expect(pricing.suffixSeconds).toEqual([0]);
  });

  it("prices an edge at its free-flow speed, not its posted limit", () => {
    // 1 km at a 60 km/h limit but a 30 km/h free-flow speed = 120 s, not 60 s.
    const pricing = priceRoute([edge("a", 1, 60, { freeFlowSpeed: 30 })], inputs());
    expect(pricing.totalSeconds).toBeCloseTo(120, 6);
  });

  it("falls back to the posted limit when there is no free-flow speed", () => {
    const pricing = priceRoute([edge("a", 1, 60)], inputs());
    expect(pricing.totalSeconds).toBeCloseTo(60, 6);
  });

  it("prefers a learned speed over free-flow, and reports the learned share", () => {
    const edges = [
      edge("a", 1, 60, { freeFlowSpeed: 60 }),
      edge("b", 1, 60, { freeFlowSpeed: 60 }),
    ];
    const pricing = priceRoute(
      edges,
      inputs({ learnedSpeedKmh: (e) => (e.id === "a" ? 30 : undefined) })
    );
    // a: 1 km at 30 = 120 s (learned). b: 1 km at 60 = 60 s (free-flow).
    expect(pricing.perEdgeSeconds[0]).toBeCloseTo(120, 6);
    expect(pricing.perEdgeSeconds[1]).toBeCloseTo(60, 6);
    expect(pricing.breakdown.learnedDistanceShare).toBeCloseTo(0.5, 6);
  });

  it("caps edge speed at the vehicle profile's top speed", () => {
    // A 120 km/h motorway edge driven by a 60 km/h profile is priced at 60.
    const pricing = priceRoute(
      [edge("a", 1, 120, { freeFlowSpeed: 120 })],
      inputs({ profileMaxSpeed: 60 })
    );
    expect(pricing.totalSeconds).toBeCloseTo(60, 6);
  });

  it("adds node delay without scaling it by weather", () => {
    // 1 km at 60 km/h = 60 s driving, plus 0.01 h (36 s) of node delay.
    const edges = [edge("a", 1, 60, { nodeDelayH: 0.01 })];
    const dry = priceRoute(edges, inputs());
    const wet = priceRoute(edges, inputs({ weatherFactor: 0.5 }));

    expect(dry.breakdown.drivingSeconds).toBeCloseTo(60, 6);
    expect(dry.breakdown.nodeDelaySeconds).toBeCloseTo(36, 6);
    // Halving the weather factor doubles the DRIVING time only; the wait at
    // the control is unchanged.
    expect(wet.breakdown.drivingSeconds).toBeCloseTo(120, 6);
    expect(wet.breakdown.nodeDelaySeconds).toBeCloseTo(36, 6);
  });

  it("charges a turn onto every edge but the first, when there is no arrival edge", () => {
    const edges = [edge("a", 1, 60), edge("b", 1, 60)];
    const pricing = priceRoute(edges, inputs({ turnCostHours: () => 0.005 })); // 18 s
    expect(pricing.breakdown.turnSeconds).toBeCloseTo(18, 6);
    expect(pricing.perEdgeSeconds[0]).toBeCloseTo(60, 6);
    expect(pricing.perEdgeSeconds[1]).toBeCloseTo(78, 6);
  });

  it("charges the first turn too when the vehicle arrives on a known edge", () => {
    const arrival = edge("arrival", 1, 60);
    const edges = [edge("a", 1, 60), edge("b", 1, 60)];
    const pricing = priceRoute(edges, inputs({ turnCostHours: () => 0.005 }), arrival);
    expect(pricing.breakdown.turnSeconds).toBeCloseTo(36, 6);
  });

  it("splits the total into driving, node delay and turns that sum back to it", () => {
    const edges = [
      edge("a", 1, 60, { nodeDelayH: 0.01 }),
      edge("b", 2, 60, { nodeDelayH: 0.005 }),
      edge("c", 1, 60),
    ];
    const pricing = priceRoute(edges, inputs({ turnCostHours: () => 0.002 }));
    const { drivingSeconds, nodeDelaySeconds, turnSeconds } = pricing.breakdown;
    expect(drivingSeconds + nodeDelaySeconds + turnSeconds).toBeCloseTo(pricing.totalSeconds, 6);
  });

  it("builds suffix sums that run back to zero at the end of the route", () => {
    const edges = [edge("a", 1, 60), edge("b", 2, 60), edge("c", 3, 60)];
    const pricing = priceRoute(edges, inputs());
    expect(pricing.suffixSeconds).toHaveLength(4);
    expect(pricing.suffixSeconds[3]).toBe(0);
    expect(pricing.suffixSeconds[0]).toBeCloseTo(pricing.totalSeconds, 6);
    expect(pricing.suffixSeconds[1]).toBeCloseTo(300, 6); // 2 km + 3 km at 60 km/h
    expect(pricing.suffixKm[1]).toBeCloseTo(5, 6);
  });

  it("records the weather factor it priced at, so a caller can detect staleness", () => {
    const pricing = priceRoute([edge("a", 1, 60)], inputs({ weatherFactor: 0.8 }));
    expect(pricing.pricedAtWeatherFactor).toBe(0.8);
    expect(pricing.breakdown.weatherFactor).toBe(0.8);
  });

  it("floors the priced speed so a pathological edge cannot divide by ~0", () => {
    const pricing = priceRoute([edge("a", 1, 0, { freeFlowSpeed: 0 })], inputs());
    expect(Number.isFinite(pricing.totalSeconds)).toBe(true);
    expect(pricing.totalSeconds).toBeCloseTo(3600, 6); // 1 km at the 1 km/h floor
  });
});

describe("remainingEtaSeconds", () => {
  const edges = [edge("a", 1, 60), edge("b", 1, 60), edge("c", 1, 60)];

  it("returns the whole route at the start of the first edge", () => {
    const pricing = priceRoute(edges, inputs());
    expect(remainingEtaSeconds(pricing, 0, 0)).toBeCloseTo(180, 6);
  });

  it("discounts the part of the current edge already driven", () => {
    const pricing = priceRoute(edges, inputs());
    // Half of edge 0 (30 s) done, so 150 s left.
    expect(remainingEtaSeconds(pricing, 0, 0.5)).toBeCloseTo(150, 6);
  });

  it("falls monotonically as a vehicle advances at constant conditions", () => {
    const pricing = priceRoute(edges, inputs());
    const samples = [
      remainingEtaSeconds(pricing, 0, 0.2),
      remainingEtaSeconds(pricing, 0, 0.9),
      remainingEtaSeconds(pricing, 1, 0.3),
      remainingEtaSeconds(pricing, 2, 0.8),
    ] as number[];
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
  });

  it("does not pro-rate a node delay the vehicle has not reached yet", () => {
    // Edge 0 is 60 s of driving plus a 36 s wait at its end node. Halfway
    // along, 30 s of DRIVING is done — the wait is still entirely ahead.
    const withDelay = [edge("a", 1, 60, { nodeDelayH: 0.01 }), edge("b", 1, 60)];
    const pricing = priceRoute(withDelay, inputs());
    expect(pricing.totalSeconds).toBeCloseTo(156, 6);
    expect(remainingEtaSeconds(pricing, 0, 0.5)).toBeCloseTo(126, 6);
  });

  it("returns undefined when the vehicle is not on a priced edge", () => {
    const pricing = priceRoute(edges, inputs());
    expect(remainingEtaSeconds(pricing, -1, 0)).toBeUndefined();
    expect(remainingEtaSeconds(pricing, 3, 0)).toBeUndefined();
  });

  it("clamps out-of-range progress instead of returning a negative ETA", () => {
    const pricing = priceRoute(edges, inputs());
    expect(remainingEtaSeconds(pricing, 2, 5)).toBeCloseTo(0, 6);
    expect(remainingEtaSeconds(pricing, 0, -3)).toBeCloseTo(180, 6);
  });

  it("is independent of the vehicle's instantaneous speed", () => {
    // The regression this whole module exists for: nothing about the caller's
    // speed enters the calculation, so a crawling vehicle and a speeding one on
    // the same spot of the same route read the same ETA.
    const pricing = priceRoute(edges, inputs());
    expect(remainingEtaSeconds(pricing, 1, 0.5)).toBeCloseTo(
      remainingEtaSeconds(pricing, 1, 0.5)!,
      6
    );
    expect(remainingEtaSeconds(pricing, 1, 0.5)).toBeCloseTo(90, 6);
  });
});

describe("remainingDistanceKm", () => {
  const edges = [edge("a", 1, 60), edge("b", 2, 60), edge("c", 3, 60)];

  it("counts the unfinished part of the current edge plus everything after it", () => {
    const pricing = priceRoute(edges, inputs());
    expect(remainingDistanceKm(pricing, 0, 0)).toBeCloseTo(6, 6);
    expect(remainingDistanceKm(pricing, 1, 0.5)).toBeCloseTo(4, 6);
    expect(remainingDistanceKm(pricing, 2, 1)).toBeCloseTo(0, 6);
  });

  it("returns undefined off-route", () => {
    const pricing = priceRoute(edges, inputs());
    expect(remainingDistanceKm(pricing, -1, 0)).toBeUndefined();
  });
});
