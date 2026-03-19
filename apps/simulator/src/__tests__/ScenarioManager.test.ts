import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ScenarioManager } from "../modules/scenario/ScenarioManager";
import type { Scenario } from "../modules/scenario/types";
import type { VehicleManager } from "../modules/VehicleManager";
import type { IncidentManager } from "../modules/IncidentManager";
import type { SimulationController } from "../modules/SimulationController";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "test-scenario",
    duration: 60,
    version: 1,
    events: [],
    ...overrides,
  };
}

function makeEvent(at: number, action: Scenario["events"][number]["action"]) {
  return { at, action };
}

function createMocks() {
  const vehicleManager = {
    getVehicles: vi.fn().mockReturnValue([]),
    getOptions: vi.fn().mockReturnValue({ updateInterval: 100 }),
    setOptions: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
    startVehicleMovement: vi.fn(),
    getNetwork: vi.fn().mockReturnValue({
      findNearestNode: vi.fn().mockReturnValue({
        id: "node-1",
        connections: [{ id: "edge-1" }, { id: "edge-2" }],
      }),
    }),
    registry: {
      addVehicle: vi.fn(),
    },
  } as unknown as VehicleManager;

  const incidentManager = {
    createIncident: vi.fn(),
    removeIncident: vi.fn(),
    clearAll: vi.fn(),
  } as unknown as IncidentManager;

  const simulationController = {
    setDirections: vi.fn().mockResolvedValue([]),
    setTrafficProfile: vi.fn(),
  } as unknown as SimulationController;

  return { vehicleManager, incidentManager, simulationController };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("ScenarioManager", () => {
  let manager: ScenarioManager;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks = createMocks();
    manager = new ScenarioManager(
      mocks.vehicleManager,
      mocks.incidentManager,
      mocks.simulationController
    );
  });

  afterEach(() => {
    try {
      manager.stop();
    } catch {
      // Ignore — may already be idle
    }
    vi.useRealTimers();
  });

  // ─── Loading ─────────────────────────────────────────────────────

  describe("loading", () => {
    it("should load a valid scenario", () => {
      const scenario = makeScenario({ name: "my-scenario" });
      manager.loadScenario(scenario);

      const status = manager.getStatus();
      expect(status.scenario?.name).toBe("my-scenario");
      expect(status.state).toBe("idle");
    });

    it("should load from raw JSON via loadScenarioFromJSON", () => {
      const json = {
        name: "json-scenario",
        duration: 120,
        version: 1,
        events: [],
      };
      const parsed = manager.loadScenarioFromJSON(json);
      expect(parsed.name).toBe("json-scenario");
      expect(parsed.duration).toBe(120);

      const status = manager.getStatus();
      expect(status.scenario?.name).toBe("json-scenario");
    });

    it("should reject invalid JSON", () => {
      expect(() => manager.loadScenarioFromJSON(null)).toThrow();
      expect(() => manager.loadScenarioFromJSON("not an object")).toThrow();
      expect(() => manager.loadScenarioFromJSON({})).toThrow();
    });

    it("should reject scenario with missing required fields", () => {
      expect(() => manager.loadScenarioFromJSON({ name: "no-duration", events: [] })).toThrow();
      expect(() => manager.loadScenarioFromJSON({ duration: 60, events: [] })).toThrow();
    });

    it("should reject scenario with invalid event actions", () => {
      expect(() =>
        manager.loadScenarioFromJSON({
          name: "bad-events",
          duration: 60,
          events: [{ at: 0, action: { type: "unknown_action" } }],
        })
      ).toThrow();
    });
  });

  // ─── Lifecycle ───────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("should throw when starting without a loaded scenario", () => {
      expect(() => manager.start()).toThrow("No scenario loaded");
    });

    it("should throw when starting while already running", () => {
      manager.loadScenario(makeScenario());
      manager.start();
      expect(() => manager.start()).toThrow("already running");
    });

    it("should transition from idle to running on start", () => {
      manager.loadScenario(makeScenario());
      manager.start();
      expect(manager.getStatus().state).toBe("running");
    });

    it("should emit scenario:started on start", () => {
      const listener = vi.fn();
      manager.on("scenario:started", listener);

      const scenario = makeScenario({
        name: "start-test",
        events: [makeEvent(5, { type: "clear_incidents" })],
      });
      manager.loadScenario(scenario);
      manager.start();

      expect(listener).toHaveBeenCalledWith({
        name: "start-test",
        eventCount: 1,
      });
    });

    it("should emit scenario:completed after all events and duration elapses", () => {
      const completed = vi.fn();
      manager.on("scenario:completed", completed);

      manager.loadScenario(
        makeScenario({
          name: "complete-test",
          duration: 10,
          events: [makeEvent(2, { type: "clear_incidents" })],
        })
      );
      manager.start();

      // Advance past event at 2s
      vi.advanceTimersByTime(2000);
      expect(completed).not.toHaveBeenCalled();

      // Advance to duration 10s
      vi.advanceTimersByTime(8000);
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "complete-test",
          eventsExecuted: 1,
        })
      );
    });

    it("should emit scenario:completed immediately if duration already elapsed", () => {
      const completed = vi.fn();
      manager.on("scenario:completed", completed);

      // duration = 2, event at 5 — but duration is less than last event
      // Actually set duration to be same as event time
      manager.loadScenario(
        makeScenario({
          duration: 2,
          events: [makeEvent(1, { type: "clear_incidents" })],
        })
      );
      manager.start();

      vi.advanceTimersByTime(1000); // execute event
      vi.advanceTimersByTime(1000); // hit duration
      expect(completed).toHaveBeenCalled();
    });
  });

  // ─── Timing ──────────────────────────────────────────────────────

  describe("timing", () => {
    it("should execute events at correct time offsets", () => {
      const eventSpy = vi.fn();
      manager.on("scenario:event", eventSpy);

      manager.loadScenario(
        makeScenario({
          duration: 30,
          events: [
            makeEvent(2, { type: "clear_incidents" }),
            makeEvent(5, { type: "clear_incidents" }),
            makeEvent(10, { type: "clear_incidents" }),
          ],
        })
      );
      manager.start();

      // At t=0, no events yet
      expect(eventSpy).not.toHaveBeenCalled();

      // At t=2s, first event fires
      vi.advanceTimersByTime(2000);
      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 0, at: 2 }));

      // At t=5s, second event fires
      vi.advanceTimersByTime(3000);
      expect(eventSpy).toHaveBeenCalledTimes(2);
      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 1, at: 5 }));

      // At t=10s, third event fires
      vi.advanceTimersByTime(5000);
      expect(eventSpy).toHaveBeenCalledTimes(3);
      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 2, at: 10 }));
    });

    it("should execute events at t=0 immediately", () => {
      const eventSpy = vi.fn();
      manager.on("scenario:event", eventSpy);

      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [makeEvent(0, { type: "clear_incidents" })],
        })
      );
      manager.start();

      // t=0 events fire immediately (setTimeout(fn, 0))
      vi.advanceTimersByTime(0);
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Pause / Resume ──────────────────────────────────────────────

  describe("pause/resume", () => {
    it("should pause execution and prevent further events", () => {
      const eventSpy = vi.fn();
      manager.on("scenario:event", eventSpy);

      manager.loadScenario(
        makeScenario({
          duration: 30,
          events: [
            makeEvent(2, { type: "clear_incidents" }),
            makeEvent(5, { type: "clear_incidents" }),
          ],
        })
      );
      manager.start();

      // Execute first event
      vi.advanceTimersByTime(2000);
      expect(eventSpy).toHaveBeenCalledTimes(1);

      // Pause
      manager.pause();
      expect(manager.getStatus().state).toBe("paused");

      // Advance time — second event should NOT fire
      vi.advanceTimersByTime(10000);
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

    it("should resume and continue from correct position", () => {
      const eventSpy = vi.fn();
      manager.on("scenario:event", eventSpy);

      manager.loadScenario(
        makeScenario({
          duration: 30,
          events: [
            makeEvent(2, { type: "clear_incidents" }),
            makeEvent(5, { type: "clear_incidents" }),
          ],
        })
      );
      manager.start();

      // Execute first event at t=2
      vi.advanceTimersByTime(2000);
      expect(eventSpy).toHaveBeenCalledTimes(1);

      // Pause at t=3
      vi.advanceTimersByTime(1000);
      manager.pause();

      // Wait a while in wall-clock time
      vi.advanceTimersByTime(5000);

      // Resume — should schedule second event 2s from now (was at 5s, paused at 3s)
      manager.resume();
      expect(manager.getStatus().state).toBe("running");

      vi.advanceTimersByTime(1999);
      expect(eventSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      expect(eventSpy).toHaveBeenCalledTimes(2);
    });

    it("should emit pause and resume events", () => {
      const pauseSpy = vi.fn();
      const resumeSpy = vi.fn();
      manager.on("scenario:paused", pauseSpy);
      manager.on("scenario:resumed", resumeSpy);

      manager.loadScenario(makeScenario({ duration: 30 }));
      manager.start();

      vi.advanceTimersByTime(3000);
      manager.pause();
      expect(pauseSpy).toHaveBeenCalledWith(expect.objectContaining({ nextEventIndex: 0 }));

      manager.resume();
      expect(resumeSpy).toHaveBeenCalledWith(expect.objectContaining({ nextEventIndex: 0 }));
    });

    it("should throw when pausing while not running", () => {
      manager.loadScenario(makeScenario());
      expect(() => manager.pause()).toThrow("No scenario is running");
    });

    it("should throw when pausing while paused", () => {
      manager.loadScenario(makeScenario({ duration: 30 }));
      manager.start();
      manager.pause();
      expect(() => manager.pause()).toThrow("No scenario is running");
    });

    it("should be a no-op to resume when not paused", () => {
      const resumeSpy = vi.fn();
      manager.on("scenario:resumed", resumeSpy);

      manager.loadScenario(makeScenario());
      manager.start();
      manager.resume(); // running — should not emit
      expect(resumeSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Stop ────────────────────────────────────────────────────────

  describe("stop", () => {
    it("should stop execution and reset state", () => {
      manager.loadScenario(
        makeScenario({
          duration: 30,
          events: [makeEvent(5, { type: "clear_incidents" })],
        })
      );
      manager.start();
      vi.advanceTimersByTime(1000);

      manager.stop();
      expect(manager.getStatus().state).toBe("idle");
      expect(manager.getStatus().eventsExecuted).toBe(0);
    });

    it("should prevent pending events from firing after stop", () => {
      const eventSpy = vi.fn();
      manager.on("scenario:event", eventSpy);

      manager.loadScenario(
        makeScenario({
          duration: 30,
          events: [makeEvent(5, { type: "clear_incidents" })],
        })
      );
      manager.start();

      manager.stop();
      vi.advanceTimersByTime(10000);
      expect(eventSpy).not.toHaveBeenCalled();
    });

    it("should emit scenario:stopped", () => {
      const stopSpy = vi.fn();
      manager.on("scenario:stopped", stopSpy);

      manager.loadScenario(makeScenario({ name: "stop-test" }));
      manager.start();
      manager.stop();

      expect(stopSpy).toHaveBeenCalledWith({
        name: "stop-test",
        eventsExecuted: 0,
      });
    });

    it("should throw when stopping while already idle", () => {
      manager.loadScenario(makeScenario());
      expect(() => manager.stop()).toThrow("No scenario is running");
    });
  });

  // ─── Action handlers ──────────────────────────────────────────────

  describe("action handlers", () => {
    it("should call vehicleManager.registry.addVehicle for spawn_vehicles", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [makeEvent(0, { type: "spawn_vehicles", count: 3 })],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.vehicleManager.registry.addVehicle).toHaveBeenCalledTimes(3);
    });

    it("should spawn vehicles with specific types", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "spawn_vehicles",
              count: 3,
              vehicleTypes: { truck: 2, bus: 1 },
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      // 2 trucks + 1 bus = 3 calls
      expect(mocks.vehicleManager.registry.addVehicle).toHaveBeenCalledTimes(3);
      // Check type arguments
      const calls = (mocks.vehicleManager.registry.addVehicle as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(calls[0][3]).toBe("truck"); // first call: type = truck
      expect(calls[1][3]).toBe("truck"); // second call: type = truck
      expect(calls[2][3]).toBe("bus"); // third call: type = bus
    });

    it("should call incidentManager.createIncident for create_incident with edgeIds", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "create_incident",
              edgeIds: ["e1", "e2"],
              incidentType: "accident",
              duration: 300,
              severity: 0.8,
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.incidentManager.createIncident).toHaveBeenCalledWith(
        ["e1", "e2"],
        "accident",
        300000, // duration * 1000
        0.8,
        undefined
      );
    });

    it("should resolve position to edgeIds for create_incident with position", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "create_incident",
              position: { lat: 1.0, lng: 2.0 },
              incidentType: "closure",
              duration: 60,
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      const network = mocks.vehicleManager.getNetwork();
      expect(network.findNearestNode).toHaveBeenCalledWith([1.0, 2.0]);
      expect(mocks.incidentManager.createIncident).toHaveBeenCalledWith(
        ["edge-1", "edge-2"],
        "closure",
        60000,
        0.5, // default severity
        [1.0, 2.0]
      );
    });

    it("should call simulationController.setDirections for dispatch", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "dispatch",
              vehicleId: "v1",
              waypoints: [{ lat: 1.0, lng: 2.0 }],
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.simulationController.setDirections).toHaveBeenCalledWith([
        {
          id: "v1",
          lat: 1.0,
          lng: 2.0,
          waypoints: [{ lat: 1.0, lng: 2.0 }],
        },
      ]);
    });

    it("should call simulationController.setTrafficProfile for set_traffic_profile", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "set_traffic_profile",
              name: "rush-hour",
              timeRanges: [
                {
                  start: 7,
                  end: 9,
                  demandMultiplier: 2.0,
                  affectedHighways: ["primary"],
                },
              ],
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.simulationController.setTrafficProfile).toHaveBeenCalledWith({
        name: "rush-hour",
        timeRanges: [
          {
            start: 7,
            end: 9,
            demandMultiplier: 2.0,
            affectedHighways: ["primary"],
          },
        ],
      });
    });

    it("should call incidentManager.clearAll for clear_incidents without ids", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [makeEvent(0, { type: "clear_incidents" })],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.incidentManager.clearAll).toHaveBeenCalled();
    });

    it("should call incidentManager.removeIncident for clear_incidents with ids", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "clear_incidents",
              incidentIds: ["i1", "i2"],
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.incidentManager.removeIncident).toHaveBeenCalledWith("i1");
      expect(mocks.incidentManager.removeIncident).toHaveBeenCalledWith("i2");
      expect(mocks.incidentManager.clearAll).not.toHaveBeenCalled();
    });

    it("should call vehicleManager.setOptions for set_options", () => {
      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(0, {
              type: "set_options",
              options: { maxSpeed: 100, minSpeed: 20 },
            }),
          ],
        })
      );
      manager.start();
      vi.advanceTimersByTime(0);

      expect(mocks.vehicleManager.setOptions).toHaveBeenCalledWith({
        maxSpeed: 100,
        minSpeed: 20,
      });
    });
  });

  // ─── Events emitted ──────────────────────────────────────────────

  describe("events emitted", () => {
    it("should emit scenario:event for each executed step", () => {
      const eventSpy = vi.fn();
      manager.on("scenario:event", eventSpy);

      manager.loadScenario(
        makeScenario({
          duration: 10,
          events: [
            makeEvent(1, { type: "clear_incidents" }),
            makeEvent(2, { type: "clear_incidents" }),
          ],
        })
      );
      manager.start();

      vi.advanceTimersByTime(1000);
      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith({
        index: 0,
        at: 1,
        action: { type: "clear_incidents" },
      });

      vi.advanceTimersByTime(1000);
      expect(eventSpy).toHaveBeenCalledTimes(2);
      expect(eventSpy).toHaveBeenCalledWith({
        index: 1,
        at: 2,
        action: { type: "clear_incidents" },
      });
    });

    it("should emit complete lifecycle events", () => {
      const started = vi.fn();
      const event = vi.fn();
      const completed = vi.fn();
      manager.on("scenario:started", started);
      manager.on("scenario:event", event);
      manager.on("scenario:completed", completed);

      manager.loadScenario(
        makeScenario({
          name: "lifecycle-test",
          duration: 5,
          events: [makeEvent(1, { type: "clear_incidents" })],
        })
      );
      manager.start();

      expect(started).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(event).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(4000);
      expect(completed).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Status ──────────────────────────────────────────────────────

  describe("status", () => {
    it("should return idle state when no scenario loaded", () => {
      const status = manager.getStatus();
      expect(status.state).toBe("idle");
      expect(status.scenario).toBeNull();
      expect(status.elapsed).toBe(0);
      expect(status.eventIndex).toBe(0);
      expect(status.eventsExecuted).toBe(0);
      expect(status.upcomingEvents).toEqual([]);
    });

    it("should return correct state while running", () => {
      manager.loadScenario(
        makeScenario({
          name: "status-test",
          duration: 30,
          events: [
            makeEvent(2, { type: "clear_incidents" }),
            makeEvent(5, { type: "spawn_vehicles", count: 1 }),
            makeEvent(10, { type: "clear_incidents" }),
          ],
        })
      );
      manager.start();

      vi.advanceTimersByTime(2000);

      const status = manager.getStatus();
      expect(status.state).toBe("running");
      expect(status.scenario?.name).toBe("status-test");
      expect(status.eventIndex).toBe(1);
      expect(status.eventsExecuted).toBe(1);
      expect(status.upcomingEvents).toHaveLength(2);
      expect(status.upcomingEvents[0]).toEqual({
        at: 5,
        type: "spawn_vehicles",
      });
    });

    it("should show up to 5 upcoming events", () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        makeEvent(i + 1, { type: "clear_incidents" })
      );
      manager.loadScenario(makeScenario({ duration: 60, events }));
      manager.start();

      const status = manager.getStatus();
      expect(status.upcomingEvents).toHaveLength(5);
    });

    it("should return paused state with frozen elapsed time", () => {
      manager.loadScenario(makeScenario({ duration: 30 }));
      manager.start();

      vi.advanceTimersByTime(5000);
      manager.pause();

      const s1 = manager.getStatus();
      expect(s1.state).toBe("paused");
      const elapsed1 = s1.elapsed;

      vi.advanceTimersByTime(10000);
      const s2 = manager.getStatus();
      expect(s2.elapsed).toBe(elapsed1); // should not advance while paused
    });
  });
});
