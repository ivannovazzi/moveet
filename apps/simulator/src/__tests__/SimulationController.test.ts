import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { SimulationController } from "../modules/SimulationController";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { RecordingHeader, RecordingEvent, StartOptions } from "../types";

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

// ─── Helpers ────────────────────────────────────────────────────────

let tmpDir: string;

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

function writeTestRecording(filePath: string, events: RecordingEvent[] = []): void {
  const header: RecordingHeader = {
    format: "moveet-recording",
    version: 1,
    startTime: new Date().toISOString(),
    vehicleCount: 2,
    options: {
      minSpeed: 20,
      maxSpeed: 60,
      speedVariation: 0.1,
      acceleration: 5,
      deceleration: 7,
      turnThreshold: 30,
      heatZoneSpeedFactor: 0.5,
      updateInterval: 500,
    },
  };
  // Ensure there is at least one event — loadRecording requires non-empty events
  const allEvents: RecordingEvent[] = events.length
    ? events
    : [{ timestamp: 0, type: "vehicle", data: { vehicles: [] } }];

  const lines = [JSON.stringify(header), ...allEvents.map((e) => JSON.stringify(e))];
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

// ─── Test Setup ─────────────────────────────────────────────────────

describe("SimulationController lifecycle", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let controller: SimulationController;
  let origAdapterURL: string;
  let origVehicleCount: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-sc-test-"));

    origAdapterURL = config.adapterURL;
    origVehicleCount = config.vehicleCount;
    (config as Record<string, unknown>).adapterURL = "";
    (config as Record<string, unknown>).vehicleCount = 3;

    network = new RoadNetwork(FIXTURE_PATH);

    // Stub setRandomDestination to avoid pathfinding on the tiny test network
    const proto = VehicleManager.prototype as unknown as Record<string, unknown>;
    const orig = proto.setRandomDestination as () => void;
    proto.setRandomDestination = function () {};
    manager = new VehicleManager(network, new FleetManager());
    proto.setRandomDestination = orig;

    controller = new SimulationController(manager);
  });

  afterEach(async () => {
    controller.stop();
    const vehicles = manager.getVehicles();
    for (const v of vehicles) manager.stopVehicleMovement(v.id);
    manager.stopLocationUpdates();
    await network.shutdownWorkers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    (config as Record<string, unknown>).adapterURL = origAdapterURL;
    (config as Record<string, unknown>).vehicleCount = origVehicleCount;
    vi.restoreAllMocks();
  });

  // ─── getStatus ────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("reports ready=true and running=false before start", () => {
      const status = controller.getStatus();
      expect(status.ready).toBe(true);
      expect(status.running).toBe(false);
    });

    it("emits updateStatus event when state changes", async () => {
      const handler = vi.fn();
      controller.on("updateStatus", handler);
      await controller.start({});
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── start / stop ─────────────────────────────────────────────────

  describe("start", () => {
    it("transitions running to true", async () => {
      await controller.start({});
      expect(manager.isRunning()).toBe(true);
    });

    it("applies partial options override", async () => {
      await controller.start({ maxSpeed: 80, minSpeed: 30 });
      const opts = controller.getOptions();
      expect(opts.maxSpeed).toBe(80);
      expect(opts.minSpeed).toBe(30);
    });

    it("emits updateStatus with running=true", async () => {
      const statusValues: boolean[] = [];
      controller.on("updateStatus", (s) => statusValues.push(s.running));
      await controller.start({});
      expect(statusValues).toContain(true);
    });

    it("does not contact adapter when ADAPTER_URL is empty", async () => {
      const spy = vi.spyOn(manager, "startLocationUpdates");
      await controller.start({});
      expect(spy).not.toHaveBeenCalled();
    });

    it("does not accumulate clock listeners when called twice without stop", async () => {
      const clock = manager.clock;
      const before = clock.listenerCount("hour:changed");
      await controller.start({});
      const afterFirst = clock.listenerCount("hour:changed");
      await controller.start({});
      const afterSecond = clock.listenerCount("hour:changed");
      // Each start() should add exactly one listener, but the second start()
      // should clean up the first, so the count stays the same.
      expect(afterFirst).toBe(before + 1);
      expect(afterSecond).toBe(before + 1);
    });
  });

  describe("stop", () => {
    it("transitions running to false after start", async () => {
      await controller.start({});
      expect(manager.isRunning()).toBe(true);
      controller.stop();
      expect(manager.isRunning()).toBe(false);
    });

    it("emits updateStatus with running=false", async () => {
      await controller.start({});
      const statusValues: boolean[] = [];
      controller.on("updateStatus", (s) => statusValues.push(s.running));
      controller.stop();
      expect(statusValues).toContain(false);
    });

    it("is idempotent — calling stop twice does not throw", async () => {
      await controller.start({});
      expect(() => {
        controller.stop();
        controller.stop();
      }).not.toThrow();
    });

    it("can be called before start without throwing", () => {
      expect(() => controller.stop()).not.toThrow();
    });
  });

  // ─── getOptions / setOptions ──────────────────────────────────────

  describe("getOptions", () => {
    it("returns an object with speed fields", () => {
      const opts = controller.getOptions();
      expect(typeof opts.minSpeed).toBe("number");
      expect(typeof opts.maxSpeed).toBe("number");
      expect(typeof opts.updateInterval).toBe("number");
    });
  });

  describe("setOptions", () => {
    it("updates options and emits updateStatus", async () => {
      const handler = vi.fn();
      controller.on("updateStatus", handler);
      const newOpts: StartOptions = {
        ...controller.getOptions(),
        updateInterval: 250,
      };
      await controller.setOptions(newOpts);
      expect(controller.getInterval()).toBe(250);
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── getVehicles / getInterval ────────────────────────────────────

  describe("getVehicles", () => {
    it("returns an array of length vehicleCount", () => {
      expect(controller.getVehicles()).toHaveLength(3);
    });

    it("returns VehicleDTOs with id, position, speed, heading", () => {
      for (const v of controller.getVehicles()) {
        expect(v).toHaveProperty("id");
        expect(v).toHaveProperty("position");
        expect(v).toHaveProperty("speed");
        expect(v).toHaveProperty("heading");
      }
    });
  });

  describe("getInterval", () => {
    it("matches the updateInterval option", () => {
      const opts = controller.getOptions();
      expect(controller.getInterval()).toBe(opts.updateInterval);
    });
  });

  // ─── mode ─────────────────────────────────────────────────────────

  describe("mode", () => {
    it("starts in live mode", () => {
      expect(controller.mode).toBe("live");
    });
  });

  // ─── markReady (tested alongside getStatus) ───────────────────────

  describe("markReady", () => {
    it("sets ready=true and emits updateStatus", () => {
      // Simulate a controller that starts not-ready
      (controller as unknown as Record<string, unknown>)._ready = false;
      const handler = vi.fn();
      controller.on("updateStatus", handler);
      controller.markReady();
      expect(controller.getStatus().ready).toBe(true);
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── getReplayStatus ──────────────────────────────────────────────

  describe("getReplayStatus", () => {
    it("returns live mode when no replay is loaded", () => {
      expect(controller.getReplayStatus()).toEqual({ mode: "live" });
    });
  });

  // ─── stopReplay without an active replay ──────────────────────────

  describe("stopReplay without active replay", () => {
    it("transitions mode back to live and emits replayStatus", () => {
      (controller as unknown as Record<string, unknown>)._mode = "replay";
      const handler = vi.fn();
      controller.on("replayStatus", handler);
      controller.stopReplay();
      expect(controller.mode).toBe("live");
      expect(handler).toHaveBeenCalledWith({ mode: "live" });
    });
  });

  // ─── Replay delegation ───────────────────────────────────────────

  describe("replay lifecycle", () => {
    it("startReplay loads the file and transitions to replay mode", async () => {
      const filePath = tmpFile("test.ndjson");
      writeTestRecording(filePath);

      const header = await controller.startReplay(filePath);

      expect(header.format).toBe("moveet-recording");
      expect(controller.mode).toBe("replay");
    });

    it("startReplay stops the live simulation if running", async () => {
      await controller.start({});
      expect(manager.isRunning()).toBe(true);

      const filePath = tmpFile("test2.ndjson");
      writeTestRecording(filePath);
      await controller.startReplay(filePath);

      expect(manager.isRunning()).toBe(false);
    });

    it("pauseReplay and resumeReplay delegate to the ReplayManager", async () => {
      const filePath = tmpFile("test3.ndjson");
      writeTestRecording(filePath, [
        { timestamp: 0, type: "vehicle", data: { vehicles: [] } },
        { timestamp: 5000, type: "vehicle", data: { vehicles: [] } },
      ]);
      await controller.startReplay(filePath);

      // Pause — status should report paused
      controller.pauseReplay();
      let status = controller.getReplayStatus();
      expect(status.paused).toBe(true);

      // Resume — status should report not paused
      controller.resumeReplay();
      status = controller.getReplayStatus();
      expect(status.paused).toBe(false);
    });

    it("seekReplay delegates to ReplayManager without throwing", async () => {
      const filePath = tmpFile("test4.ndjson");
      writeTestRecording(filePath, [
        { timestamp: 0, type: "vehicle", data: { vehicles: [] } },
        { timestamp: 2000, type: "vehicle", data: { vehicles: [] } },
        { timestamp: 4000, type: "vehicle", data: { vehicles: [] } },
      ]);
      await controller.startReplay(filePath);
      expect(() => controller.seekReplay(1000)).not.toThrow();
    });

    it("setReplaySpeed delegates to ReplayManager without throwing", async () => {
      const filePath = tmpFile("test5.ndjson");
      writeTestRecording(filePath);
      await controller.startReplay(filePath);
      expect(() => controller.setReplaySpeed(2)).not.toThrow();
    });

    it("stopReplay returns to live mode", async () => {
      const filePath = tmpFile("test6.ndjson");
      writeTestRecording(filePath);
      await controller.startReplay(filePath);
      expect(controller.mode).toBe("replay");

      controller.stopReplay();
      expect(controller.mode).toBe("live");
      expect(controller.getReplayStatus()).toEqual({ mode: "live" });
    });

    it("startReplay throws on a missing file", async () => {
      await expect(controller.startReplay("/nonexistent/path.ndjson")).rejects.toThrow();
    });

    it("replay methods no-op when not in replay mode", () => {
      expect(() => {
        controller.pauseReplay();
        controller.resumeReplay();
        controller.seekReplay(0);
        controller.setReplaySpeed(2);
      }).not.toThrow();
    });
  });

  // ─── Event forwarding from ReplayManager ─────────────────────────

  describe("replay event forwarding", () => {
    it("forwards replayStatus events to listeners", async () => {
      const filePath = tmpFile("test7.ndjson");
      writeTestRecording(filePath);
      const handler = vi.fn();
      controller.on("replayStatus", handler);
      await controller.startReplay(filePath);
      // startReplay calls replay.startReplay which emits replayStatus
      expect(handler).toHaveBeenCalled();
    });
  });
});
