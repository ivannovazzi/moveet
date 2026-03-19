import { describe, it, expect } from "vitest";
import { convertRecordingToScenario, parseRecording } from "../modules/scenario/convertRecording";
import type { RecordingHeader, RecordingEvent } from "../types";

// ─── Helpers ───────────────────────────────────────────────────────

function makeHeader(overrides: Partial<RecordingHeader> = {}): RecordingHeader {
  return {
    format: "moveet-recording",
    version: 1,
    startTime: "2026-01-15T10:00:00.000Z",
    vehicleCount: 10,
    options: {
      minSpeed: 20,
      maxSpeed: 80,
      speedVariation: 0.2,
      acceleration: 2,
      deceleration: 4,
      turnThreshold: 45,
      heatZoneSpeedFactor: 0.5,
      updateInterval: 100,
    },
    ...overrides,
  };
}

function makeEvent(
  timestamp: number,
  type: RecordingEvent["type"],
  data: Record<string, unknown> = {}
): RecordingEvent {
  return { timestamp, type, data };
}

// ─── parseRecording ────────────────────────────────────────────────

describe("parseRecording", () => {
  it("parses header and events from NDJSON string", () => {
    const header = makeHeader();
    const event1 = makeEvent(1000, "spawn", { vehicleType: "car" });
    const event2 = makeEvent(2000, "vehicle", { vehicles: [] });
    const ndjson = [JSON.stringify(header), JSON.stringify(event1), JSON.stringify(event2)].join(
      "\n"
    );

    const result = parseRecording(ndjson);
    expect(result.header).toEqual(header);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe("spawn");
    expect(result.events[1].type).toBe("vehicle");
  });

  it("handles trailing newlines and blank lines", () => {
    const header = makeHeader();
    const event = makeEvent(500, "spawn", {});
    const ndjson = JSON.stringify(header) + "\n" + JSON.stringify(event) + "\n\n\n";

    const result = parseRecording(ndjson);
    expect(result.header.format).toBe("moveet-recording");
    expect(result.events).toHaveLength(1);
  });

  it("throws on empty input", () => {
    expect(() => parseRecording("")).toThrow("Empty recording file");
    expect(() => parseRecording("  \n  \n  ")).toThrow("Empty recording file");
  });

  it("returns empty events array for header-only recording", () => {
    const header = makeHeader();
    const result = parseRecording(JSON.stringify(header));
    expect(result.events).toHaveLength(0);
  });
});

// ─── convertRecordingToScenario ────────────────────────────────────

describe("convertRecordingToScenario", () => {
  it("generates set_options at t=0 from header", () => {
    const header = makeHeader();
    const scenario = convertRecordingToScenario(header, []);

    const setOptionsEvent = scenario.events.find((e) => e.action.type === "set_options");
    expect(setOptionsEvent).toBeDefined();
    expect(setOptionsEvent!.at).toBe(0);
    expect(setOptionsEvent!.action.type).toBe("set_options");
    if (setOptionsEvent!.action.type === "set_options") {
      expect(setOptionsEvent!.action.options).toEqual(header.options);
    }
  });

  it("uses default name from header startTime", () => {
    const header = makeHeader();
    const scenario = convertRecordingToScenario(header, []);
    expect(scenario.name).toBe("Recording 2026-01-15T10:00:00.000Z");
  });

  it("allows name and description overrides", () => {
    const header = makeHeader();
    const scenario = convertRecordingToScenario(header, [], {
      name: "My Scenario",
      description: "Converted from recording",
    });
    expect(scenario.name).toBe("My Scenario");
    expect(scenario.description).toBe("Converted from recording");
  });

  it("sets version to 1", () => {
    const scenario = convertRecordingToScenario(makeHeader(), []);
    expect(scenario.version).toBe(1);
  });

  // ─── Spawn conversion ──────────────────────────────────────────

  describe("spawn events", () => {
    it("converts a single spawn to spawn_vehicles with count 1", () => {
      const events = [makeEvent(5000, "spawn", { vehicleType: "car" })];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const spawnEvents = scenario.events.filter((e) => e.action.type === "spawn_vehicles");
      expect(spawnEvents).toHaveLength(1);
      expect(spawnEvents[0].at).toBe(5); // 5000ms → 5s
      if (spawnEvents[0].action.type === "spawn_vehicles") {
        expect(spawnEvents[0].action.count).toBe(1);
        expect(spawnEvents[0].action.vehicleTypes).toEqual({ car: 1 });
      }
    });

    it("aggregates spawns within a 1-second window", () => {
      const events = [
        makeEvent(1000, "spawn", { vehicleType: "car" }),
        makeEvent(1200, "spawn", { vehicleType: "car" }),
        makeEvent(1800, "spawn", { vehicleType: "truck" }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const spawnEvents = scenario.events.filter((e) => e.action.type === "spawn_vehicles");
      expect(spawnEvents).toHaveLength(1);
      if (spawnEvents[0].action.type === "spawn_vehicles") {
        expect(spawnEvents[0].action.count).toBe(3);
        expect(spawnEvents[0].action.vehicleTypes).toEqual({ car: 2, truck: 1 });
      }
    });

    it("splits spawns across different 1-second windows", () => {
      const events = [
        makeEvent(1000, "spawn", { vehicleType: "car" }),
        makeEvent(1500, "spawn", { vehicleType: "car" }),
        makeEvent(3000, "spawn", { vehicleType: "bus" }),
        makeEvent(3200, "spawn", { vehicleType: "bus" }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const spawnEvents = scenario.events.filter((e) => e.action.type === "spawn_vehicles");
      expect(spawnEvents).toHaveLength(2);

      // First window: 2 cars at 1s
      expect(spawnEvents[0].at).toBe(1);
      if (spawnEvents[0].action.type === "spawn_vehicles") {
        expect(spawnEvents[0].action.count).toBe(2);
        expect(spawnEvents[0].action.vehicleTypes).toEqual({ car: 2 });
      }

      // Second window: 2 buses at 3s
      expect(spawnEvents[1].at).toBe(3);
      if (spawnEvents[1].action.type === "spawn_vehicles") {
        expect(spawnEvents[1].action.count).toBe(2);
        expect(spawnEvents[1].action.vehicleTypes).toEqual({ bus: 2 });
      }
    });

    it("handles spawns without vehicleType", () => {
      const events = [makeEvent(2000, "spawn", {})];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const spawnEvents = scenario.events.filter((e) => e.action.type === "spawn_vehicles");
      expect(spawnEvents).toHaveLength(1);
      if (spawnEvents[0].action.type === "spawn_vehicles") {
        expect(spawnEvents[0].action.count).toBe(1);
        // No vehicleTypes when none are specified
        expect(spawnEvents[0].action.vehicleTypes).toBeUndefined();
      }
    });
  });

  // ─── Incident conversion ──────────────────────────────────────

  describe("incident events", () => {
    it("converts incident created events to create_incident", () => {
      const events = [
        makeEvent(10000, "incident", {
          action: "created",
          type: "accident",
          duration: 300,
          severity: 0.8,
          edgeIds: ["edge-1", "edge-2"],
          position: { lat: -1.29, lng: 36.82 },
        }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const incidentEvents = scenario.events.filter((e) => e.action.type === "create_incident");
      expect(incidentEvents).toHaveLength(1);
      expect(incidentEvents[0].at).toBe(10); // 10000ms → 10s
      if (incidentEvents[0].action.type === "create_incident") {
        expect(incidentEvents[0].action.incidentType).toBe("accident");
        expect(incidentEvents[0].action.duration).toBe(300);
        expect(incidentEvents[0].action.severity).toBe(0.8);
        expect(incidentEvents[0].action.edgeIds).toEqual(["edge-1", "edge-2"]);
        expect(incidentEvents[0].action.position).toEqual({ lat: -1.29, lng: 36.82 });
      }
    });

    it("discards incident cleared events", () => {
      const events = [makeEvent(5000, "incident", { action: "cleared", incidentId: "inc-1" })];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const incidentEvents = scenario.events.filter((e) => e.action.type === "create_incident");
      expect(incidentEvents).toHaveLength(0);
    });

    it("handles incident with position only (no edgeIds)", () => {
      const events = [
        makeEvent(8000, "incident", {
          action: "created",
          type: "closure",
          duration: 600,
          position: { lat: -1.3, lng: 36.85 },
        }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const incidentEvents = scenario.events.filter((e) => e.action.type === "create_incident");
      expect(incidentEvents).toHaveLength(1);
      if (incidentEvents[0].action.type === "create_incident") {
        expect(incidentEvents[0].action.position).toEqual({ lat: -1.3, lng: 36.85 });
        expect(incidentEvents[0].action.edgeIds).toBeUndefined();
      }
    });

    it("skips incident with no position and no edgeIds", () => {
      const events = [
        makeEvent(8000, "incident", {
          action: "created",
          type: "accident",
          duration: 120,
        }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const incidentEvents = scenario.events.filter((e) => e.action.type === "create_incident");
      expect(incidentEvents).toHaveLength(0);
    });
  });

  // ─── Direction / dispatch conversion ───────────────────────────

  describe("direction events", () => {
    it("converts direction events to dispatch actions", () => {
      const events = [
        makeEvent(15000, "direction", {
          vehicleId: "v-1",
          waypoints: [
            { lat: -1.28, lng: 36.81 },
            { lat: -1.29, lng: 36.82, dwellTime: 30 },
          ],
        }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const dispatchEvents = scenario.events.filter((e) => e.action.type === "dispatch");
      expect(dispatchEvents).toHaveLength(1);
      expect(dispatchEvents[0].at).toBe(15);
      if (dispatchEvents[0].action.type === "dispatch") {
        expect(dispatchEvents[0].action.vehicleId).toBe("v-1");
        expect(dispatchEvents[0].action.waypoints).toHaveLength(2);
        expect(dispatchEvents[0].action.waypoints[0]).toEqual({ lat: -1.28, lng: 36.81 });
        expect(dispatchEvents[0].action.waypoints[1]).toEqual({
          lat: -1.29,
          lng: 36.82,
          dwellTime: 30,
        });
      }
    });

    it("skips direction events without vehicleId", () => {
      const events = [
        makeEvent(5000, "direction", {
          waypoints: [{ lat: -1.28, lng: 36.81 }],
        }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);
      const dispatchEvents = scenario.events.filter((e) => e.action.type === "dispatch");
      expect(dispatchEvents).toHaveLength(0);
    });

    it("skips direction events without waypoints", () => {
      const events = [makeEvent(5000, "direction", { vehicleId: "v-1" })];
      const scenario = convertRecordingToScenario(makeHeader(), events);
      const dispatchEvents = scenario.events.filter((e) => e.action.type === "dispatch");
      expect(dispatchEvents).toHaveLength(0);
    });
  });

  // ─── Discarded event types ─────────────────────────────────────

  describe("discarded events", () => {
    const discardedTypes: RecordingEvent["type"][] = [
      "vehicle",
      "heatzone",
      "waypoint",
      "route:completed",
      "vehicle:rerouted",
      "simulation:stop",
      "simulation:reset",
      "despawn",
    ];

    for (const type of discardedTypes) {
      it(`discards '${type}' events`, () => {
        const events = [makeEvent(1000, type, { someKey: "someValue" })];
        const scenario = convertRecordingToScenario(makeHeader(), events);
        // Should only have the initial set_options
        expect(scenario.events).toHaveLength(1);
        expect(scenario.events[0].action.type).toBe("set_options");
      });
    }
  });

  // ─── Timestamp conversion ──────────────────────────────────────

  describe("timestamp conversion", () => {
    it("converts ms to seconds with rounding", () => {
      const events = [
        makeEvent(1499, "spawn", { vehicleType: "car" }), // rounds to 1s
        makeEvent(1500, "spawn", { vehicleType: "car" }), // rounds to 2s (new window)
        makeEvent(10750, "incident", {
          action: "created",
          type: "accident",
          duration: 120,
          position: { lat: -1.29, lng: 36.82 },
        }), // rounds to 11s
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const incidentEvent = scenario.events.find((e) => e.action.type === "create_incident");
      expect(incidentEvent!.at).toBe(11);
    });
  });

  // ─── Duration calculation ──────────────────────────────────────

  describe("duration", () => {
    it("sets duration to last event time + 60s buffer", () => {
      const events = [makeEvent(120000, "spawn", { vehicleType: "car" })]; // 120s
      const scenario = convertRecordingToScenario(makeHeader(), events);
      expect(scenario.duration).toBe(180); // 120 + 60
    });

    it("sets minimum duration of 60s for empty recordings", () => {
      const scenario = convertRecordingToScenario(makeHeader(), []);
      // Only has set_options at t=0, so duration = 0 + 60
      expect(scenario.duration).toBe(60);
    });
  });

  // ─── Event ordering ────────────────────────────────────────────

  describe("event ordering", () => {
    it("sorts all events by timestamp", () => {
      const events = [
        makeEvent(30000, "direction", {
          vehicleId: "v-1",
          waypoints: [{ lat: -1.28, lng: 36.81 }],
        }),
        makeEvent(10000, "incident", {
          action: "created",
          type: "accident",
          duration: 120,
          position: { lat: -1.29, lng: 36.82 },
        }),
        makeEvent(5000, "spawn", { vehicleType: "car" }),
      ];
      const scenario = convertRecordingToScenario(makeHeader(), events);

      const times = scenario.events.map((e) => e.at);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });
  });

  // ─── Full integration test ─────────────────────────────────────

  describe("full conversion with realistic data", () => {
    it("converts a realistic recording to a scenario", () => {
      const header = makeHeader({ vehicleCount: 5 });
      const events: RecordingEvent[] = [
        // simulation start (discarded — we use header for set_options)
        makeEvent(0, "simulation:start", {}),

        // Initial spawns (within 1s window)
        makeEvent(100, "spawn", { vehicleType: "car" }),
        makeEvent(200, "spawn", { vehicleType: "car" }),
        makeEvent(300, "spawn", { vehicleType: "truck" }),

        // Vehicle position updates (discarded)
        makeEvent(500, "vehicle", { vehicles: [{ id: "v-1", position: [-1.29, 36.82] }] }),
        makeEvent(600, "vehicle", { vehicles: [{ id: "v-1", position: [-1.291, 36.821] }] }),

        // Heat zone (discarded)
        makeEvent(1000, "heatzone", { zones: [{ id: "hz-1", intensity: 0.5 }] }),

        // Second wave of spawns (new window)
        makeEvent(5000, "spawn", { vehicleType: "bus" }),
        makeEvent(5500, "spawn", { vehicleType: "motorcycle" }),

        // Dispatch a vehicle
        makeEvent(10000, "direction", {
          vehicleId: "v-1",
          waypoints: [
            { lat: -1.28, lng: 36.81 },
            { lat: -1.3, lng: 36.83, dwellTime: 20 },
          ],
        }),

        // Waypoint reached (discarded)
        makeEvent(15000, "waypoint", { vehicleId: "v-1", waypointIndex: 0 }),

        // Incident
        makeEvent(20000, "incident", {
          action: "created",
          type: "construction",
          duration: 300,
          severity: 0.6,
          edgeIds: ["e-10", "e-11"],
          position: { lat: -1.295, lng: 36.825 },
        }),

        // Route completed (discarded)
        makeEvent(25000, "route:completed", { vehicleId: "v-1" }),

        // Vehicle rerouted (discarded)
        makeEvent(26000, "vehicle:rerouted", { vehicleId: "v-2" }),

        // Incident cleared (discarded)
        makeEvent(30000, "incident", { action: "cleared", incidentId: "inc-1" }),

        // Despawn (discarded)
        makeEvent(35000, "despawn", { vehicleId: "v-1" }),

        // Simulation stop (discarded)
        makeEvent(40000, "simulation:stop", {}),
      ];

      const scenario = convertRecordingToScenario(header, events, {
        name: "Rush Hour Replay",
        description: "Converted from a 40-second recording session",
      });

      // Metadata
      expect(scenario.name).toBe("Rush Hour Replay");
      expect(scenario.description).toBe("Converted from a 40-second recording session");
      expect(scenario.version).toBe(1);

      // Duration: last relevant event at 20s (incident) + 60s buffer = 80s
      // Actually the dispatch at 10s and incident at 20s, spawns at 0s and 5s
      // Last event = 20s → duration = 80
      expect(scenario.duration).toBe(80);

      // Event breakdown:
      // 1. set_options at 0s (from header)
      // 2. spawn_vehicles at 0s (3 vehicles: 2 car, 1 truck)
      // 3. spawn_vehicles at 5s (2 vehicles: 1 bus, 1 motorcycle)
      // 4. dispatch at 10s
      // 5. create_incident at 20s
      expect(scenario.events).toHaveLength(5);

      // Verify order
      const types = scenario.events.map((e) => e.action.type);
      expect(types).toEqual([
        "set_options",
        "spawn_vehicles",
        "spawn_vehicles",
        "dispatch",
        "create_incident",
      ]);

      // Verify timestamps
      const times = scenario.events.map((e) => e.at);
      expect(times).toEqual([0, 0, 5, 10, 20]);

      // Verify first spawn batch
      const spawn1 = scenario.events[1];
      if (spawn1.action.type === "spawn_vehicles") {
        expect(spawn1.action.count).toBe(3);
        expect(spawn1.action.vehicleTypes).toEqual({ car: 2, truck: 1 });
      }

      // Verify second spawn batch
      const spawn2 = scenario.events[2];
      if (spawn2.action.type === "spawn_vehicles") {
        expect(spawn2.action.count).toBe(2);
        expect(spawn2.action.vehicleTypes).toEqual({ bus: 1, motorcycle: 1 });
      }

      // Verify dispatch
      const dispatch = scenario.events[3];
      if (dispatch.action.type === "dispatch") {
        expect(dispatch.action.vehicleId).toBe("v-1");
        expect(dispatch.action.waypoints).toHaveLength(2);
      }

      // Verify incident
      const incident = scenario.events[4];
      if (incident.action.type === "create_incident") {
        expect(incident.action.incidentType).toBe("construction");
        expect(incident.action.duration).toBe(300);
        expect(incident.action.severity).toBe(0.6);
      }
    });
  });
});
