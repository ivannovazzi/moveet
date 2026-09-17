import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseMaxSpeed,
  resolveMaxSpeed,
  parseFreeFlowFactors,
  DEFAULT_FREE_FLOW_FACTORS,
} from "../modules/roadnetwork/types";
import { GraphBuilder } from "../modules/roadnetwork/GraphBuilder";
import { computeBaseTravelTime } from "../modules/pathfinding/cost";
import { buildGraph } from "../workers/pathfinding-worker";
import type { FeatureCollection } from "geojson";

const MPH = 1.609344;
const KNOT = 1.852;

// ─── parseMaxSpeed ───────────────────────────────────────────────────

describe("parseMaxSpeed", () => {
  it("keeps plain numbers as km/h and falls back to the class default when absent", () => {
    expect(parseMaxSpeed("50", "primary")).toBe(50);
    expect(parseMaxSpeed(undefined, "secondary")).toBe(50);
    expect(parseMaxSpeed("", "residential")).toBe(30);
  });

  it("converts mph (with or without a space, any case) to km/h", () => {
    expect(parseMaxSpeed("25 mph", "residential")).toBeCloseTo(25 * MPH, 9);
    expect(parseMaxSpeed("30mph", "residential")).toBeCloseTo(30 * MPH, 9);
    expect(parseMaxSpeed("45 MPH", "primary")).toBeCloseTo(45 * MPH, 9);
  });

  it("converts knots and accepts explicit km/h suffixes", () => {
    expect(parseMaxSpeed("10 knots", "residential")).toBeCloseTo(10 * KNOT, 9);
    expect(parseMaxSpeed("60 km/h", "primary")).toBe(60);
    expect(parseMaxSpeed("60 kmh", "primary")).toBe(60);
    expect(parseMaxSpeed("60 kph", "primary")).toBe(60);
  });

  it("averages ranges, including ranges with a unit", () => {
    expect(parseMaxSpeed("80-110", "motorway")).toBe(95);
    expect(parseMaxSpeed("20-30 mph", "residential")).toBeCloseTo(25 * MPH, 9);
  });

  it("takes the lowest of semicolon-separated values", () => {
    expect(parseMaxSpeed("50;30", "primary")).toBe(30);
  });

  it("handles special values", () => {
    expect(parseMaxSpeed("walk", "living_street")).toBe(7);
    expect(parseMaxSpeed("none", "motorway")).toBe(130);
    // No numeric information → class default
    expect(parseMaxSpeed("signals", "primary")).toBe(60);
    expect(parseMaxSpeed("variable", "motorway")).toBe(110);
    expect(parseMaxSpeed("implicit", "tertiary")).toBe(40);
  });

  it("resolves country-coded implicit limits", () => {
    expect(parseMaxSpeed("DE:urban", "primary")).toBe(50);
    expect(parseMaxSpeed("DE:rural", "primary")).toBe(100);
    expect(parseMaxSpeed("US:urban", "primary")).toBeCloseTo(25 * MPH, 9);
    expect(parseMaxSpeed("GB:nsl_single", "primary")).toBeCloseTo(60 * MPH, 9);
    expect(parseMaxSpeed("DE:zone30", "residential")).toBe(30);
    expect(parseMaxSpeed("DE:zone:30", "residential")).toBe(30);
  });

  it("falls back from a subdivision to its country, then to the generic zone", () => {
    expect(parseMaxSpeed("US-NY:urban", "primary")).toBeCloseTo(25 * MPH, 9);
    // Unknown country, known zone → generic urban limit
    expect(parseMaxSpeed("XX:urban", "primary")).toBe(50);
    // Unknown zone → class default
    expect(parseMaxSpeed("XX:moon", "primary")).toBe(60);
  });

  it("rejects garbage and non-positive values", () => {
    expect(parseMaxSpeed("fast", "primary")).toBe(60);
    expect(parseMaxSpeed("0", "primary")).toBe(60);
    expect(parseMaxSpeed("-20", "primary")).toBe(60);
  });
});

// ─── resolveMaxSpeed ─────────────────────────────────────────────────

describe("resolveMaxSpeed", () => {
  it("prefers maxspeed:forward / maxspeed:backward per direction", () => {
    const props = { maxspeed: "30 mph", "maxspeed:forward": "15 mph" };
    expect(resolveMaxSpeed(props, "primary", "forward")).toBeCloseTo(15 * MPH, 9);
    expect(resolveMaxSpeed(props, "primary", "backward")).toBeCloseTo(30 * MPH, 9);
  });

  it("uses maxspeed:type / source:maxspeed / zone:maxspeed codes when maxspeed is absent", () => {
    expect(resolveMaxSpeed({ "maxspeed:type": "US:urban" }, "primary", "forward")).toBeCloseTo(
      25 * MPH,
      9
    );
    expect(resolveMaxSpeed({ "source:maxspeed": "DE:rural" }, "primary", "forward")).toBe(100);
    expect(resolveMaxSpeed({ "zone:maxspeed": "DE:30" }, "residential", "forward")).toBe(30);
  });

  it("an explicit maxspeed wins over the implicit type code", () => {
    expect(
      resolveMaxSpeed({ maxspeed: "40", "maxspeed:type": "DE:urban" }, "primary", "forward")
    ).toBe(40);
  });

  it("ignores non-code source values like 'sign' and falls back to the class default", () => {
    expect(resolveMaxSpeed({ "maxspeed:type": "sign" }, "tertiary", "forward")).toBe(40);
    expect(resolveMaxSpeed(null, "tertiary", "backward")).toBe(40);
  });
});

// ─── Free-flow factors ───────────────────────────────────────────────

describe("parseFreeFlowFactors", () => {
  it("returns the defaults for an empty value", () => {
    expect(parseFreeFlowFactors(undefined)).toEqual(DEFAULT_FREE_FLOW_FACTORS);
    expect(parseFreeFlowFactors("")).toEqual(DEFAULT_FREE_FLOW_FACTORS);
  });

  it("every default factor is in (0, 1] and motorways flow faster than residential", () => {
    for (const f of Object.values(DEFAULT_FREE_FLOW_FACTORS)) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(DEFAULT_FREE_FLOW_FACTORS.motorway).toBeGreaterThan(
      DEFAULT_FREE_FLOW_FACTORS.residential
    );
  });

  it("merges class=factor overrides over the defaults", () => {
    const f = parseFreeFlowFactors("residential=0.5, motorway=1");
    expect(f.residential).toBe(0.5);
    expect(f.motorway).toBe(1);
    expect(f.primary).toBe(DEFAULT_FREE_FLOW_FACTORS.primary);
  });

  it("throws on unknown classes or out-of-range factors", () => {
    expect(() => parseFreeFlowFactors("footway=0.5")).toThrow();
    expect(() => parseFreeFlowFactors("primary=0")).toThrow();
    expect(() => parseFreeFlowFactors("primary=1.5")).toThrow();
    expect(() => parseFreeFlowFactors("primary")).toThrow();
  });
});

// ─── Graph integration (main thread + worker) ────────────────────────

describe("graph builders apply parsed limits and free-flow speeds", () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
  });

  const collection: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          id: "avenue",
          name: "Avenue",
          highway: "primary",
          maxspeed: "25 mph",
          "maxspeed:forward": "15 mph",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [-73.99, 40.75],
            [-73.989, 40.751],
          ],
        },
      },
      {
        type: "Feature",
        properties: { id: "street", name: "Street", highway: "residential" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-73.989, 40.751],
            [-73.988, 40.752],
          ],
        },
      },
    ],
  };

  function writeTmp(): string {
    const p = path.join(os.tmpdir(), `speed-parse-${process.pid}-${Date.now()}.geojson`);
    fs.writeFileSync(p, JSON.stringify(collection));
    tmpFiles.push(p);
    return p;
  }

  it("GraphBuilder sets per-direction posted maxSpeed and freeFlowSpeed = maxSpeed x factor", () => {
    const built = new GraphBuilder({ landmarkCount: 0 }).build(structuredClone(collection));
    const avenue = [...built.edges.values()].filter((e) => e.streetId === "avenue");
    expect(avenue).toHaveLength(2);
    const [fwd, bwd] = avenue.sort((a, b) => a.maxSpeed - b.maxSpeed);
    expect(fwd.maxSpeed).toBeCloseTo(15 * MPH, 9);
    expect(bwd.maxSpeed).toBeCloseTo(25 * MPH, 9);
    for (const e of built.edges.values()) {
      expect(e.freeFlowSpeed).toBeCloseTo(e.maxSpeed * DEFAULT_FREE_FLOW_FACTORS[e.highway], 9);
    }
  });

  it("GraphBuilder honours custom free-flow factors", () => {
    const factors = parseFreeFlowFactors("residential=0.25");
    const built = new GraphBuilder({ landmarkCount: 0, freeFlowFactors: factors }).build(
      structuredClone(collection)
    );
    const street = [...built.edges.values()].find((e) => e.streetId === "street")!;
    expect(street.freeFlowSpeed).toBeCloseTo(30 * 0.25, 9);
  });

  it("maxNetworkSpeed bounds every edge's cost speed (ALT/haversine admissibility)", () => {
    const built = new GraphBuilder({ landmarkCount: 0 }).build(structuredClone(collection));
    for (const e of built.edges.values()) {
      expect(built.maxNetworkSpeed).toBeGreaterThanOrEqual(e.freeFlowSpeed!);
      // cost ≥ distance / maxNetworkSpeed
      const cost = built.edgeBaseCost.get(e.id)!;
      expect(cost).toBeGreaterThanOrEqual(e.distance / built.maxNetworkSpeed - 1e-12);
    }
  });

  it("the edge cost is priced at the free-flow speed, not the posted limit", () => {
    const edge = { distance: 1, maxSpeed: 60, freeFlowSpeed: 30, surface: "asphalt" };
    expect(computeBaseTravelTime(edge, 0)).toBeCloseTo(1 / 30, 12);
    // Plain objects without freeFlowSpeed keep the legacy posted-limit pricing
    expect(computeBaseTravelTime({ distance: 1, maxSpeed: 60, surface: "asphalt" }, 0)).toBeCloseTo(
      1 / 60,
      12
    );
  });

  it("worker graph agrees with the main-thread graph on speeds and base costs", () => {
    const file = writeTmp();
    const factors = parseFreeFlowFactors("primary=0.8");
    const built = new GraphBuilder({ landmarkCount: 0, freeFlowFactors: factors }).build(
      JSON.parse(fs.readFileSync(file, "utf8"))
    );
    const workerNodes = buildGraph(file, 0, factors);
    let compared = 0;
    for (const node of workerNodes.values()) {
      for (const we of node.edges) {
        const me = built.edges.get(we.id)!;
        expect(me).toBeDefined();
        expect(we.maxSpeed).toBe(me.maxSpeed);
        expect(we.freeFlowSpeed).toBe(me.freeFlowSpeed);
        expect(we.baseTravelTime).toBe(built.edgeBaseCost.get(me.id));
        compared++;
      }
    }
    expect(compared).toBe(built.edges.size);
  });
});
