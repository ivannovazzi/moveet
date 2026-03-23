import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ReplayManager } from "../../modules/ReplayManager";
import type { RecordingHeader, RecordingEvent } from "../../types";

function makeHeader(overrides: Partial<RecordingHeader> = {}): RecordingHeader {
  return {
    format: "moveet-recording",
    version: 1,
    startTime: new Date().toISOString(),
    vehicleCount: 2,
    options: {} as any,
    ...overrides,
  };
}

function makeEvent(
  timestamp: number,
  type: string,
  data: Record<string, unknown> = {}
): RecordingEvent {
  return { timestamp, type: type as any, data };
}

function writeRecording(filePath: string, header: RecordingHeader, events: RecordingEvent[]): void {
  const lines = [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))];
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

describe("ReplayManager", () => {
  let manager: ReplayManager;
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-test-"));
    manager = new ReplayManager();
  });

  afterEach(() => {
    manager.stopReplay();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadRecording", () => {
    it("should load a valid recording file", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const header = makeHeader();
      const events = [
        makeEvent(100, "vehicle", { vehicles: [{ id: "v1" }] }),
        makeEvent(200, "vehicle", { vehicles: [{ id: "v2" }] }),
      ];
      writeRecording(filePath, header, events);

      const result = await manager.loadRecording(filePath);
      expect(result.format).toBe("moveet-recording");
      expect(result.version).toBe(1);
    });

    it("should reject invalid format", async () => {
      const filePath = path.join(tmpDir, "bad.ndjson");
      const header = { format: "wrong-format", version: 1 };
      fs.writeFileSync(
        filePath,
        JSON.stringify(header) + "\n" + JSON.stringify(makeEvent(100, "vehicle")) + "\n"
      );

      await expect(manager.loadRecording(filePath)).rejects.toThrow("Invalid recording format");
    });

    it("should reject empty file", async () => {
      const filePath = path.join(tmpDir, "empty.ndjson");
      fs.writeFileSync(filePath, "");

      await expect(manager.loadRecording(filePath)).rejects.toThrow("empty or missing header");
    });

    it("should reject recording with no events", async () => {
      const filePath = path.join(tmpDir, "header-only.ndjson");
      fs.writeFileSync(filePath, JSON.stringify(makeHeader()) + "\n");

      await expect(manager.loadRecording(filePath)).rejects.toThrow("no events");
    });
  });

  describe("startReplay", () => {
    it("should throw when no recording is loaded", () => {
      expect(() => manager.startReplay()).toThrow("No recording loaded");
    });

    it("should start playback and emit events", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [
        makeEvent(0, "vehicle", { vehicles: [{ id: "v1" }] }),
        makeEvent(50, "direction", { vehicleId: "v1" }),
      ];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      const vehicleListener = vi.fn();
      const directionListener = vi.fn();
      manager.on("vehicle", vehicleListener);
      manager.on("direction", directionListener);

      manager.startReplay(1);

      // Advance past both events
      vi.advanceTimersByTime(100);

      expect(vehicleListener).toHaveBeenCalled();
      expect(directionListener).toHaveBeenCalled();
    });

    it("should emit replayEnd when all events are played", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [makeEvent(0, "vehicle", { vehicles: [] })];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      const endListener = vi.fn();
      manager.on("replayEnd", endListener);

      manager.startReplay(1);
      vi.advanceTimersByTime(100);

      expect(endListener).toHaveBeenCalled();
    });
  });

  describe("pauseReplay / resumeReplay", () => {
    it("should pause and resume playback", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [
        makeEvent(0, "vehicle", { vehicles: [] }),
        makeEvent(1000, "vehicle", { vehicles: [{ id: "v2" }] }),
      ];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      const vehicleListener = vi.fn();
      manager.on("vehicle", vehicleListener);

      manager.startReplay(1);
      vi.advanceTimersByTime(10); // first event fires

      manager.pauseReplay();
      const status = manager.getStatus();
      expect(status.mode).toBe("replay");
      expect(status.paused).toBe(true);

      vi.advanceTimersByTime(2000);
      // Second event should NOT have fired while paused
      expect(vehicleListener).toHaveBeenCalledTimes(1);

      manager.resumeReplay();
      vi.advanceTimersByTime(1100);
      expect(vehicleListener).toHaveBeenCalledTimes(2);
    });

    it("should ignore pause when not playing", () => {
      manager.pauseReplay(); // should not throw
    });

    it("should ignore resume when not paused", () => {
      manager.resumeReplay(); // should not throw
    });
  });

  describe("setSpeed", () => {
    it("should change playback speed", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [
        makeEvent(0, "vehicle", { vehicles: [] }),
        makeEvent(1000, "vehicle", { vehicles: [{ id: "v2" }] }),
      ];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      manager.startReplay(1);
      vi.advanceTimersByTime(10); // first event fires

      // Set to 10x speed — second event should fire in ~100ms
      manager.setSpeed(10);
      const status = manager.getStatus();
      expect(status.speed).toBe(10);
    });
  });

  describe("seekTo", () => {
    it("should seek to a specific timestamp", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [
        makeEvent(0, "vehicle", { vehicles: [{ id: "v1" }] }),
        makeEvent(500, "vehicle", { vehicles: [{ id: "v2" }] }),
        makeEvent(1000, "vehicle", { vehicles: [{ id: "v3" }] }),
      ];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      manager.startReplay(1);
      // Seek past the first two events
      manager.seekTo(600);

      const vehicleListener = vi.fn();
      manager.on("vehicle", vehicleListener);

      vi.advanceTimersByTime(1100);
      // Should only emit the third event (v3)
      expect(vehicleListener).toHaveBeenCalledTimes(1);
    });

    it("should throw when no recording is loaded", () => {
      expect(() => manager.seekTo(100)).toThrow("No recording loaded");
    });
  });

  describe("stopReplay", () => {
    it("should stop playback and reset state", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [makeEvent(0, "vehicle", { vehicles: [] })];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      manager.startReplay(1);
      manager.stopReplay();

      const status = manager.getStatus();
      expect(status.mode).toBe("live");
    });
  });

  describe("getStatus", () => {
    it("should return live mode when no recording is loaded", () => {
      const status = manager.getStatus();
      expect(status.mode).toBe("live");
    });

    it("should return replay status with progress when loaded", async () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const events = [
        makeEvent(0, "vehicle", { vehicles: [] }),
        makeEvent(1000, "vehicle", { vehicles: [] }),
      ];
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);

      manager.startReplay(1);

      const status = manager.getStatus();
      expect(status.mode).toBe("replay");
      expect(status.duration).toBe(1000);
      expect(status.speed).toBe(1);
      expect(status.progress).toBeGreaterThanOrEqual(0);
    });
  });

  describe("event emission by type", () => {
    async function loadAndPlay(events: RecordingEvent[]) {
      const filePath = path.join(tmpDir, "events.ndjson");
      writeRecording(filePath, makeHeader(), events);
      await manager.loadRecording(filePath);
      manager.startReplay(1);
    }

    it("should emit incident:created for incident events with action created", async () => {
      const listener = vi.fn();
      manager.on("incident:created", listener);
      await loadAndPlay([makeEvent(0, "incident", { action: "created", id: "i1" })]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit incident:cleared for incident events with action cleared", async () => {
      const listener = vi.fn();
      manager.on("incident:cleared", listener);
      await loadAndPlay([makeEvent(0, "incident", { action: "cleared", id: "i1" })]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit heatzones for heatzone events", async () => {
      const listener = vi.fn();
      manager.on("heatzones", listener);
      await loadAndPlay([makeEvent(0, "heatzone", { zones: [] })]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit waypoint:reached for waypoint events", async () => {
      const listener = vi.fn();
      manager.on("waypoint:reached", listener);
      await loadAndPlay([makeEvent(0, "waypoint", { vehicleId: "v1" })]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit route:completed events", async () => {
      const listener = vi.fn();
      manager.on("route:completed", listener);
      await loadAndPlay([makeEvent(0, "route:completed", { vehicleId: "v1" })]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit simulation:start events", async () => {
      const listener = vi.fn();
      manager.on("simulation:start", listener);
      await loadAndPlay([makeEvent(0, "simulation:start", {})]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit simulation:stop events", async () => {
      const listener = vi.fn();
      manager.on("simulation:stop", listener);
      await loadAndPlay([makeEvent(0, "simulation:stop", {})]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });

    it("should emit simulation:reset events", async () => {
      const listener = vi.fn();
      manager.on("simulation:reset", listener);
      await loadAndPlay([makeEvent(0, "simulation:reset", {})]);
      vi.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalled();
    });
  });
});
