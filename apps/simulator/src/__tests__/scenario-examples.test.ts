import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scenarioSchema } from "../modules/scenario/types";

// ─── Load all scenario JSON files from data/scenarios/ ──────────────────

const SCENARIOS_DIR = join(__dirname, "../../data/scenarios");

const scenarioFiles = readdirSync(SCENARIOS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

const scenarios = scenarioFiles.map((file) => {
  const raw = readFileSync(join(SCENARIOS_DIR, file), "utf-8");
  return { file, data: JSON.parse(raw) };
});

// ─── Expected properties for each known scenario ────────────────────────

const expectedScenarios: Record<
  string,
  { name: string; duration: number; minEvents: number; city: string }
> = {
  "rush-hour.json": {
    name: "Rush Hour Stress Test",
    duration: 600,
    minEvents: 9,
    city: "nairobi",
  },
  "delivery-routes.json": {
    name: "Delivery Route Optimization",
    duration: 480,
    minEvents: 13,
    city: "nairobi",
  },
  "emergency-response.json": {
    name: "Emergency Response",
    duration: 300,
    minEvents: 7,
    city: "nairobi",
  },
  "fleet-rebalancing.json": {
    name: "Fleet Rebalancing",
    duration: 360,
    minEvents: 30,
    city: "nairobi",
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────

describe("built-in example scenarios", () => {
  it("should have at least 4 scenario files", () => {
    expect(scenarioFiles.length).toBeGreaterThanOrEqual(4);
  });

  describe.each(scenarios)("$file", ({ file, data }) => {
    it("should validate against scenarioSchema", () => {
      const result = scenarioSchema.safeParse(data);
      if (!result.success) {
        // Show detailed error for debugging
        const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        expect.fail(`Schema validation failed for ${file}:\n${issues.join("\n")}`);
      }
      expect(result.success).toBe(true);
    });

    it("should have version 1", () => {
      expect(data.version).toBe(1);
    });

    it("should have a non-empty name", () => {
      expect(data.name).toBeTruthy();
      expect(typeof data.name).toBe("string");
    });

    it("should have a positive duration", () => {
      expect(data.duration).toBeGreaterThan(0);
    });

    it("should have a non-empty events array", () => {
      expect(Array.isArray(data.events)).toBe(true);
      expect(data.events.length).toBeGreaterThan(0);
    });

    it("should have city set to nairobi", () => {
      expect(data.city).toBe("nairobi");
    });

    it("should have a description", () => {
      expect(data.description).toBeTruthy();
      expect(typeof data.description).toBe("string");
    });

    it("should have events in chronological order", () => {
      for (let i = 1; i < data.events.length; i++) {
        expect(data.events[i].at).toBeGreaterThanOrEqual(data.events[i - 1].at);
      }
    });

    it("should not have events beyond the scenario duration", () => {
      for (const event of data.events) {
        expect(event.at).toBeLessThanOrEqual(data.duration);
      }
    });

    // Check expected properties for known scenarios
    if (expectedScenarios[file]) {
      const expected = expectedScenarios[file];

      it(`should have name "${expected.name}"`, () => {
        expect(data.name).toBe(expected.name);
      });

      it(`should have duration ${expected.duration}s`, () => {
        expect(data.duration).toBe(expected.duration);
      });

      it(`should have at least ${expected.minEvents} events`, () => {
        expect(data.events.length).toBeGreaterThanOrEqual(expected.minEvents);
      });
    }
  });
});

// ─── Cross-scenario checks ──────────────────────────────────────────────

describe("scenario cross-checks", () => {
  it("rush-hour.json should contain spawn_vehicles events totaling 100 vehicles", () => {
    const rushHour = scenarios.find((s) => s.file === "rush-hour.json");
    expect(rushHour).toBeDefined();

    const spawnEvents = rushHour!.data.events.filter(
      (e: { action: { type: string; count?: number } }) => e.action.type === "spawn_vehicles"
    );
    const totalVehicles = spawnEvents.reduce(
      (sum: number, e: { action: { count: number } }) => sum + e.action.count,
      0
    );
    expect(totalVehicles).toBe(100);
  });

  it("delivery-routes.json should dispatch all 10 vehicles", () => {
    const delivery = scenarios.find((s) => s.file === "delivery-routes.json");
    expect(delivery).toBeDefined();

    const dispatchEvents = delivery!.data.events.filter(
      (e: { action: { type: string } }) => e.action.type === "dispatch"
    );
    const vehicleIds = new Set(
      dispatchEvents.map((e: { action: { vehicleId: string } }) => e.action.vehicleId)
    );
    expect(vehicleIds.size).toBe(10);
  });

  it("emergency-response.json should spawn ambulances", () => {
    const emergency = scenarios.find((s) => s.file === "emergency-response.json");
    expect(emergency).toBeDefined();

    const spawnEvents = emergency!.data.events.filter(
      (e: { action: { type: string } }) => e.action.type === "spawn_vehicles"
    );
    const hasAmbulance = spawnEvents.some(
      (e: { action: { vehicleTypes?: Record<string, number> } }) =>
        e.action.vehicleTypes && "ambulance" in e.action.vehicleTypes
    );
    expect(hasAmbulance).toBe(true);
  });

  it("fleet-rebalancing.json should dispatch all 20 vehicles to central zone", () => {
    const rebalancing = scenarios.find((s) => s.file === "fleet-rebalancing.json");
    expect(rebalancing).toBeDefined();

    const dispatchEvents = rebalancing!.data.events.filter(
      (e: { action: { type: string }; at: number }) =>
        e.action.type === "dispatch" && e.at >= 60 && e.at < 180
    );
    const vehicleIds = new Set(
      dispatchEvents.map((e: { action: { vehicleId: string } }) => e.action.vehicleId)
    );
    expect(vehicleIds.size).toBe(20);
  });
});
