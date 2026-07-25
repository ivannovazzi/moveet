import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { HeatZoneManager } from "../modules/HeatZoneManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { HEAT_ZONE_TIME } from "../constants";
import { DEFAULT_TRAFFIC_PROFILE, type TrafficProfile } from "../utils/trafficProfiles";
import type { Edge, HeatZoneFeature, Node } from "../types";

/**
 * Hours picked straight out of DEFAULT_TRAFFIC_PROFILE so the tests assert
 * against the SAME curve TrafficManager uses rather than a private copy.
 */
const MORNING_RUSH_HOUR = 8; // 07-09, demand 2.0 on trunk/primary
const EVENING_RUSH_HOUR = 18; // 17-19, demand 2.5 on trunk/primary
const MIDDAY_HOUR = 13; // no range matches, demand 1.0
const NIGHT_HOUR = 2; // 00-05, demand 0.3 on all roads

/** Minimal 4-node network with one 3-way intersection zones can be placed on. */
function buildFixture(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "n1", coordinates: [45.5017, -73.5673], connections: [] },
    { id: "n2", coordinates: [45.502, -73.567], connections: [] },
    { id: "n3", coordinates: [45.5023, -73.5667], connections: [] },
    { id: "hub", coordinates: [45.5026, -73.5664], connections: [] },
  ];
  const edge = (id: string, start: Node, end: Node): Edge => ({
    id,
    streetId: "s1",
    start,
    end,
    distance: 0.5,
    bearing: 45,
    highway: "residential",
    maxSpeed: 30,
    surface: "unknown",
    oneway: false,
  });
  const edges: Edge[] = [
    edge("e1", nodes[0], nodes[1]),
    edge("e2", nodes[1], nodes[2]),
    edge("e3", nodes[2], nodes[3]),
  ];
  nodes[0].connections = [edges[0]];
  nodes[1].connections = [edges[1]];
  nodes[2].connections = [edges[2]];
  nodes[3].connections = [edges[0], edges[1], edges[2]];
  return { nodes, edges };
}

const SQUARE: number[][] = [
  [-73.5673, 45.5017],
  [-73.5663, 45.5017],
  [-73.5663, 45.5027],
  [-73.5673, 45.5027],
  [-73.5673, 45.5017],
];

describe("heat-zone time-of-day intensity", () => {
  let manager: HeatZoneManager;
  let fixture: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    manager = new HeatZoneManager();
    fixture = buildFixture();
  });

  /** Seeds `count` generated zones with a deterministic base intensity. */
  function seedGenerated(count = 3, intensity = 0.4): void {
    manager.generateHeatedZones(fixture.edges, fixture.nodes, {
      count,
      minIntensity: intensity,
      maxIntensity: intensity,
    });
  }

  describe("generated zones", () => {
    it("blooms at rush hour and fades overnight", () => {
      seedGenerated();

      manager.applyTimeOfDay(NIGHT_HOUR);
      const night = manager.getZones().map((z) => z.intensity);

      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      const rush = manager.getZones().map((z) => z.intensity);

      expect(night.length).toBeGreaterThan(0);
      for (let i = 0; i < night.length; i++) {
        expect(rush[i]).toBeGreaterThan(night[i]);
      }
    });

    it("scales by the shared traffic demand curve, not a private one", () => {
      const base = 0.3;
      seedGenerated(2, base);

      const expectAll = (expected: number) => {
        for (const zone of manager.getZones()) expect(zone.intensity).toBeCloseTo(expected, 6);
      };

      manager.applyTimeOfDay(MIDDAY_HOUR);
      expectAll(base * 1.0);

      manager.applyTimeOfDay(MORNING_RUSH_HOUR);
      expectAll(base * 2.0);

      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      expectAll(base * 2.5);

      manager.applyTimeOfDay(NIGHT_HOUR);
      expectAll(base * 0.3);
    });

    it("follows a custom traffic profile instead of the default", () => {
      const custom: TrafficProfile = {
        name: "custom",
        timeRanges: [{ start: 13, end: 14, demandMultiplier: 2.0, affectedHighways: ["primary"] }],
      };
      seedGenerated(1, 0.25);

      manager.applyTimeOfDay(MIDDAY_HOUR, custom);
      expect(manager.getZones()[0].intensity).toBeCloseTo(0.5, 6);

      // Default profile has no rush hour at 13:00.
      manager.applyTimeOfDay(MIDDAY_HOUR, DEFAULT_TRAFFIC_PROFILE);
      expect(manager.getZones()[0].intensity).toBeCloseTo(0.25, 6);
    });

    it("always rescales from the base intensity, so repeated calls are idempotent", () => {
      seedGenerated(2, 0.4);

      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      const once = manager.getZones().map((z) => z.intensity);
      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      const thrice = manager.getZones().map((z) => z.intensity);

      expect(thrice).toEqual(once);
      // Round-tripping through night and back restores the rush-hour value
      // exactly (no compounding).
      manager.applyTimeOfDay(NIGHT_HOUR);
      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      expect(manager.getZones().map((z) => z.intensity)).toEqual(once);
    });

    it("clamps to [MIN_INTENSITY, 1]", () => {
      seedGenerated(2, 1);
      manager.applyTimeOfDay(EVENING_RUSH_HOUR);
      for (const zone of manager.getZones()) expect(zone.intensity).toBe(1);

      const dim = new HeatZoneManager();
      const f = buildFixture();
      dim.generateHeatedZones(f.edges, f.nodes, {
        count: 1,
        minIntensity: 0.01,
        maxIntensity: 0.01,
      });
      dim.applyTimeOfDay(NIGHT_HOUR);
      expect(dim.getZones()[0].intensity).toBe(HEAT_ZONE_TIME.MIN_INTENSITY);
    });

    it("scales zones generated after the hour was applied", () => {
      manager.applyTimeOfDay(NIGHT_HOUR);
      seedGenerated(1, 0.4);
      expect(manager.getZones()[0].intensity).toBeCloseTo(0.4 * 0.3, 6);
      expect(manager.getZones()[0].baseIntensity).toBe(0.4);
    });

    it("leaves intensity untouched until a time of day is applied", () => {
      seedGenerated(3, 0.4);
      for (const zone of manager.getZones()) expect(zone.intensity).toBe(0.4);
      expect(manager.getTimeOfDayMultiplier()).toBe(1);
    });
  });

  describe("manually-drawn zones", () => {
    it("keeps the operator's intensity at every hour", () => {
      manager.addZone({ polygon: SQUARE, intensity: 0.8 });

      for (const hour of [NIGHT_HOUR, MORNING_RUSH_HOUR, MIDDAY_HOUR, EVENING_RUSH_HOUR]) {
        manager.applyTimeOfDay(hour);
        expect(manager.getZones()[0].intensity).toBe(0.8);
        expect(manager.getZones()[0].origin).toBe("manual");
      }
    });

    it("does not make applyTimeOfDay report a change on its own", () => {
      manager.addZone({ polygon: SQUARE, intensity: 0.8 });
      expect(manager.applyTimeOfDay(EVENING_RUSH_HOUR)).toBe(false);
      expect(manager.applyTimeOfDay(NIGHT_HOUR)).toBe(false);
    });

    it("promotes a generated zone to manual when an operator patches intensity", () => {
      seedGenerated(1, 0.4);
      const id = manager.getZones()[0].id as string;

      manager.applyTimeOfDay(MIDDAY_HOUR);
      manager.updateZone(id, { intensity: 0.9 });
      manager.applyTimeOfDay(NIGHT_HOUR);

      expect(manager.getZones()[0].intensity).toBe(0.9);
      expect(manager.getZones()[0].origin).toBe("manual");
    });

    it("keeps scaling a generated zone whose geometry (only) was edited", () => {
      seedGenerated(1, 0.4);
      const id = manager.getZones()[0].id as string;

      manager.updateZone(id, { polygon: SQUARE });
      manager.applyTimeOfDay(NIGHT_HOUR);

      expect(manager.getZones()[0].origin).toBe("generated");
      expect(manager.getZones()[0].intensity).toBeCloseTo(0.4 * 0.3, 6);
    });
  });

  describe("legacy / injected zones", () => {
    it("never rescales a zone that carries no base intensity", () => {
      // Mimics a zone injected straight into the array (restore, tests, older
      // snapshots) with neither `origin` nor `baseIntensity`.
      manager.getZones().push({
        id: "legacy",
        polygon: SQUARE,
        intensity: 0.55,
        timestamp: new Date().toISOString(),
      });

      expect(manager.applyTimeOfDay(EVENING_RUSH_HOUR)).toBe(false);
      expect(manager.getZones()[0].intensity).toBe(0.55);
    });
  });

  describe("change reporting", () => {
    it("reports true only when an intensity actually moves", () => {
      seedGenerated(2, 0.4);

      expect(manager.applyTimeOfDay(MIDDAY_HOUR)).toBe(false); // 1.0x == unscaled
      expect(manager.applyTimeOfDay(EVENING_RUSH_HOUR)).toBe(true);
      expect(manager.applyTimeOfDay(EVENING_RUSH_HOUR)).toBe(false); // same range
      expect(manager.applyTimeOfDay(18)).toBe(false); // still 17-19
      expect(manager.applyTimeOfDay(NIGHT_HOUR)).toBe(true);
    });

    it("reports false when there are no zones at all", () => {
      expect(manager.applyTimeOfDay(EVENING_RUSH_HOUR)).toBe(false);
    });
  });
});

describe("RoadNetwork.applyHeatZoneTimeOfDay", () => {
  const testGeojsonPath = path.join(__dirname, "fixtures", "test-network.geojson");
  let network: RoadNetwork;

  beforeEach(() => {
    network = new RoadNetwork(testGeojsonPath);
  });

  it("broadcasts the full zone list only when an intensity changed", () => {
    const emitted: HeatZoneFeature[][] = [];
    network.seedHeatZones(3);
    network.on("heatzones", (zones: HeatZoneFeature[]) => emitted.push(zones));

    expect(network.applyHeatZoneTimeOfDay(MIDDAY_HOUR)).toBe(false);
    expect(emitted).toHaveLength(0);

    expect(network.applyHeatZoneTimeOfDay(EVENING_RUSH_HOUR)).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].length).toBe(network.exportHeatZones().length);

    // Same demand range → no second broadcast.
    expect(network.applyHeatZoneTimeOfDay(17)).toBe(false);
    expect(emitted).toHaveLength(1);

    expect(network.applyHeatZoneTimeOfDay(NIGHT_HOUR)).toBe(true);
    expect(emitted).toHaveLength(2);

    const rushMax = Math.max(...emitted[0].map((f) => f.properties.intensity));
    const nightMax = Math.max(...emitted[1].map((f) => f.properties.intensity));
    expect(nightMax).toBeLessThan(rushMax);
  });

  it("leaves a manually-added zone out of the rescale", () => {
    const manual = network.addHeatZone({ polygon: SQUARE, intensity: 0.7 });
    network.applyHeatZoneTimeOfDay(NIGHT_HOUR);
    const after = network.exportHeatZones().find((f) => f.properties.id === manual.properties.id);
    expect(after?.properties.intensity).toBe(0.7);
  });
});
