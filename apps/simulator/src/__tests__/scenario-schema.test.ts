import { describe, it, expect } from "vitest";
import {
  scenarioSchema,
  scenarioEventSchema,
  scenarioActionSchema,
  scenarioVariablesSchema,
  spawnVehiclesActionSchema,
  createIncidentActionSchema,
  dispatchActionSchema,
  setTrafficProfileActionSchema,
  clearIncidentsActionSchema,
  setOptionsActionSchema,
  type Scenario,
} from "../modules/scenario/types";

// ─── Helper: minimal valid scenario ─────────────────────────────────

function validScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Test Scenario",
    duration: 300,
    events: [],
    ...overrides,
  };
}

// ─── Top-level scenario schema ──────────────────────────────────────

describe("scenarioSchema", () => {
  it("accepts a minimal valid scenario", () => {
    const result = scenarioSchema.safeParse(validScenario());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Test Scenario");
      expect(result.data.duration).toBe(300);
      expect(result.data.events).toEqual([]);
      expect(result.data.version).toBe(1);
    }
  });

  it("accepts a full scenario with all optional fields", () => {
    const result = scenarioSchema.safeParse(
      validScenario({
        description: "A comprehensive test",
        city: "Nairobi",
        version: 1,
        variables: { vehicleCount: 20, speedRange: "fast" },
        events: [
          {
            at: 0,
            action: { type: "spawn_vehicles", count: 10 },
          },
          {
            at: 60,
            action: {
              type: "create_incident",
              edgeIds: ["e1"],
              incidentType: "accident",
              duration: 120,
              severity: 0.7,
            },
          },
        ],
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("A comprehensive test");
      expect(result.data.city).toBe("Nairobi");
      expect(result.data.variables).toEqual({ vehicleCount: 20, speedRange: "fast" });
      expect(result.data.events).toHaveLength(2);
    }
  });

  it("defaults version to 1 when omitted", () => {
    const result = scenarioSchema.safeParse(validScenario());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });

  it("rejects version other than 1", () => {
    const result = scenarioSchema.safeParse(validScenario({ version: 2 }));
    expect(result.success).toBe(false);
  });

  it("accepts empty events array", () => {
    const result = scenarioSchema.safeParse(validScenario({ events: [] }));
    expect(result.success).toBe(true);
  });

  // ─── Required fields ───────────────────────────────────────────────

  it("rejects missing name", () => {
    const { name, ...rest } = validScenario();
    const result = scenarioSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = scenarioSchema.safeParse(validScenario({ name: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing duration", () => {
    const { duration, ...rest } = validScenario();
    const result = scenarioSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects zero duration", () => {
    const result = scenarioSchema.safeParse(validScenario({ duration: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejects negative duration", () => {
    const result = scenarioSchema.safeParse(validScenario({ duration: -10 }));
    expect(result.success).toBe(false);
  });

  it("rejects missing events", () => {
    const { events, ...rest } = validScenario();
    const result = scenarioSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-array events", () => {
    const result = scenarioSchema.safeParse(validScenario({ events: "not-array" }));
    expect(result.success).toBe(false);
  });
});

// ─── Timeline events ────────────────────────────────────────────────

describe("scenarioEventSchema", () => {
  it("accepts event at time 0", () => {
    const result = scenarioEventSchema.safeParse({
      at: 0,
      action: { type: "spawn_vehicles", count: 5 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts event at positive time offset", () => {
    const result = scenarioEventSchema.safeParse({
      at: 120,
      action: { type: "clear_incidents" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative time offset", () => {
    const result = scenarioEventSchema.safeParse({
      at: -1,
      action: { type: "clear_incidents" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing at field", () => {
    const result = scenarioEventSchema.safeParse({
      action: { type: "clear_incidents" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing action field", () => {
    const result = scenarioEventSchema.safeParse({ at: 10 });
    expect(result.success).toBe(false);
  });
});

// ─── Action: spawn_vehicles ─────────────────────────────────────────

describe("spawnVehiclesActionSchema", () => {
  it("accepts spawn with count only", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
      count: 10,
    });
    expect(result.success).toBe(true);
  });

  it("accepts spawn with vehicleTypes", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
      count: 10,
      vehicleTypes: { car: 7, truck: 3 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vehicleTypes).toEqual({ car: 7, truck: 3 });
    }
  });

  it("rejects zero count", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
      count: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative count", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
      count: -5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer count", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
      count: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing count", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative vehicleType counts", () => {
    const result = spawnVehiclesActionSchema.safeParse({
      type: "spawn_vehicles",
      count: 5,
      vehicleTypes: { car: -1 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Action: create_incident ────────────────────────────────────────

describe("createIncidentActionSchema", () => {
  it("accepts incident with edgeIds", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1", "e2"],
      incidentType: "accident",
      duration: 120,
    });
    expect(result.success).toBe(true);
  });

  it("accepts incident with position", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      position: { lat: -1.286, lng: 36.817 },
      incidentType: "closure",
      duration: 60,
      severity: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all three incident types", () => {
    for (const incidentType of ["accident", "closure", "construction"] as const) {
      const result = createIncidentActionSchema.safeParse({
        type: "create_incident",
        edgeIds: ["e1"],
        incidentType,
        duration: 30,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid incident type", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      incidentType: "fire",
      duration: 30,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero duration", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      incidentType: "accident",
      duration: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative duration", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      incidentType: "accident",
      duration: -10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects severity above 1", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      incidentType: "accident",
      duration: 30,
      severity: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects severity below 0", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      incidentType: "accident",
      duration: 30,
      severity: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing incidentType", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      duration: 30,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing duration", () => {
    const result = createIncidentActionSchema.safeParse({
      type: "create_incident",
      edgeIds: ["e1"],
      incidentType: "accident",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Action: dispatch ───────────────────────────────────────────────

describe("dispatchActionSchema", () => {
  it("accepts dispatch with single waypoint", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "v-001",
      waypoints: [{ lat: -1.286, lng: 36.817 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts dispatch with multiple waypoints and optional fields", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "random",
      waypoints: [
        { lat: -1.286, lng: 36.817, label: "Pickup" },
        { lat: -1.29, lng: 36.82, dwellTime: 30, label: "Dropoff" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty vehicleId", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "",
      waypoints: [{ lat: -1.286, lng: 36.817 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing vehicleId", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      waypoints: [{ lat: -1.286, lng: 36.817 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty waypoints array", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "v-001",
      waypoints: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing waypoints", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "v-001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects waypoint with non-numeric lat", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "v-001",
      waypoints: [{ lat: "bad", lng: 36.817 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive dwellTime", () => {
    const result = dispatchActionSchema.safeParse({
      type: "dispatch",
      vehicleId: "v-001",
      waypoints: [{ lat: -1.286, lng: 36.817, dwellTime: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Action: set_traffic_profile ────────────────────────────────────

describe("setTrafficProfileActionSchema", () => {
  it("accepts valid traffic profile", () => {
    const result = setTrafficProfileActionSchema.safeParse({
      type: "set_traffic_profile",
      name: "rush-hour",
      timeRanges: [
        {
          start: 7,
          end: 9,
          demandMultiplier: 1.5,
          affectedHighways: ["primary", "secondary"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty timeRanges", () => {
    const result = setTrafficProfileActionSchema.safeParse({
      type: "set_traffic_profile",
      name: "flat",
      timeRanges: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = setTrafficProfileActionSchema.safeParse({
      type: "set_traffic_profile",
      timeRanges: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = setTrafficProfileActionSchema.safeParse({
      type: "set_traffic_profile",
      name: "",
      timeRanges: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing timeRanges", () => {
    const result = setTrafficProfileActionSchema.safeParse({
      type: "set_traffic_profile",
      name: "rush-hour",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Action: clear_incidents ────────────────────────────────────────

describe("clearIncidentsActionSchema", () => {
  it("accepts clear all incidents (no incidentIds)", () => {
    const result = clearIncidentsActionSchema.safeParse({
      type: "clear_incidents",
    });
    expect(result.success).toBe(true);
  });

  it("accepts clear specific incidents", () => {
    const result = clearIncidentsActionSchema.safeParse({
      type: "clear_incidents",
      incidentIds: ["inc-1", "inc-2"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.incidentIds).toEqual(["inc-1", "inc-2"]);
    }
  });

  it("accepts empty incidentIds (clears nothing specific)", () => {
    const result = clearIncidentsActionSchema.safeParse({
      type: "clear_incidents",
      incidentIds: [],
    });
    expect(result.success).toBe(true);
  });
});

// ─── Action: set_options ────────────────────────────────────────────

describe("setOptionsActionSchema", () => {
  it("accepts partial options", () => {
    const result = setOptionsActionSchema.safeParse({
      type: "set_options",
      options: { minSpeed: 10, maxSpeed: 80 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty options object", () => {
    const result = setOptionsActionSchema.safeParse({
      type: "set_options",
      options: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing options field", () => {
    const result = setOptionsActionSchema.safeParse({
      type: "set_options",
    });
    expect(result.success).toBe(false);
  });

  it("rejects speedVariation above 1", () => {
    const result = setOptionsActionSchema.safeParse({
      type: "set_options",
      options: { speedVariation: 2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive updateInterval", () => {
    const result = setOptionsActionSchema.safeParse({
      type: "set_options",
      options: { updateInterval: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects heatZoneSpeedFactor above 1", () => {
    const result = setOptionsActionSchema.safeParse({
      type: "set_options",
      options: { heatZoneSpeedFactor: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Discriminated union (scenarioActionSchema) ─────────────────────

describe("scenarioActionSchema", () => {
  it("rejects unknown action type", () => {
    const result = scenarioActionSchema.safeParse({
      type: "explode_everything",
      target: "all",
    });
    expect(result.success).toBe(false);
  });

  it("rejects action without type field", () => {
    const result = scenarioActionSchema.safeParse({
      count: 5,
    });
    expect(result.success).toBe(false);
  });

  it("parses each valid action type correctly", () => {
    const actions = [
      { type: "spawn_vehicles", count: 5 },
      { type: "create_incident", edgeIds: ["e1"], incidentType: "accident", duration: 60 },
      { type: "dispatch", vehicleId: "v1", waypoints: [{ lat: 0, lng: 0 }] },
      { type: "set_traffic_profile", name: "peak", timeRanges: [] },
      { type: "clear_incidents" },
      { type: "set_options", options: { minSpeed: 10 } },
    ];

    for (const action of actions) {
      const result = scenarioActionSchema.safeParse(action);
      expect(result.success).toBe(true);
    }
  });
});

// ─── Variables schema ───────────────────────────────────────────────

describe("scenarioVariablesSchema", () => {
  it("accepts string values", () => {
    const result = scenarioVariablesSchema.safeParse({ mode: "fast" });
    expect(result.success).toBe(true);
  });

  it("accepts number values", () => {
    const result = scenarioVariablesSchema.safeParse({ vehicleCount: 50 });
    expect(result.success).toBe(true);
  });

  it("accepts mixed string and number values", () => {
    const result = scenarioVariablesSchema.safeParse({
      vehicleCount: 20,
      speedRange: "fast",
      severity: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = scenarioVariablesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects boolean values", () => {
    const result = scenarioVariablesSchema.safeParse({ debug: true });
    expect(result.success).toBe(false);
  });

  it("rejects object values", () => {
    const result = scenarioVariablesSchema.safeParse({ nested: { a: 1 } });
    expect(result.success).toBe(false);
  });

  it("rejects array values", () => {
    const result = scenarioVariablesSchema.safeParse({ list: [1, 2, 3] });
    expect(result.success).toBe(false);
  });
});

// ─── Full scenario integration tests ────────────────────────────────

describe("full scenario integration", () => {
  it("parses a realistic multi-event scenario", () => {
    const scenario = {
      name: "Rush Hour Nairobi",
      description: "Simulates morning rush hour traffic in Nairobi CBD",
      city: "Nairobi",
      duration: 600,
      variables: {
        vehicleCount: 50,
        incidentSeverity: 0.7,
      },
      events: [
        {
          at: 0,
          action: {
            type: "spawn_vehicles",
            count: 50,
            vehicleTypes: { car: 35, truck: 10, bus: 5 },
          },
        },
        {
          at: 0,
          action: {
            type: "set_traffic_profile",
            name: "morning-rush",
            timeRanges: [
              {
                start: 7,
                end: 9,
                demandMultiplier: 2.0,
                affectedHighways: ["primary", "secondary"],
              },
            ],
          },
        },
        {
          at: 120,
          action: {
            type: "create_incident",
            edgeIds: ["edge-cbd-1", "edge-cbd-2"],
            incidentType: "accident",
            duration: 300,
            severity: 0.7,
          },
        },
        {
          at: 180,
          action: {
            type: "dispatch",
            vehicleId: "random",
            waypoints: [
              { lat: -1.286, lng: 36.817, label: "CBD" },
              { lat: -1.29, lng: 36.82, dwellTime: 60, label: "Westlands" },
            ],
          },
        },
        {
          at: 300,
          action: {
            type: "set_options",
            options: { minSpeed: 5, maxSpeed: 30 },
          },
        },
        {
          at: 450,
          action: {
            type: "clear_incidents",
          },
        },
      ],
    };

    const result = scenarioSchema.safeParse(scenario);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.events).toHaveLength(6);
      expect(result.data.events[0].action.type).toBe("spawn_vehicles");
      expect(result.data.events[2].action.type).toBe("create_incident");
      expect(result.data.events[5].action.type).toBe("clear_incidents");
    }
  });

  it("preserves typed data through parse", () => {
    const result = scenarioSchema.safeParse(
      validScenario({
        events: [
          {
            at: 10,
            action: {
              type: "spawn_vehicles",
              count: 3,
              vehicleTypes: { ambulance: 1, car: 2 },
            },
          },
        ],
      })
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data.events[0].action;
      expect(action.type).toBe("spawn_vehicles");
      if (action.type === "spawn_vehicles") {
        expect(action.count).toBe(3);
        expect(action.vehicleTypes).toEqual({ ambulance: 1, car: 2 });
      }
    }
  });

  it("rejects scenario with invalid event in the middle", () => {
    const result = scenarioSchema.safeParse(
      validScenario({
        events: [
          { at: 0, action: { type: "spawn_vehicles", count: 5 } },
          { at: 10, action: { type: "unknown_action" } },
          { at: 20, action: { type: "clear_incidents" } },
        ],
      })
    );
    expect(result.success).toBe(false);
  });

  it("type inference works correctly", () => {
    const scenario: Scenario = {
      name: "Type Check",
      duration: 60,
      version: 1,
      events: [
        {
          at: 0,
          action: { type: "spawn_vehicles", count: 1 },
        },
      ],
    };
    const result = scenarioSchema.safeParse(scenario);
    expect(result.success).toBe(true);
  });
});
