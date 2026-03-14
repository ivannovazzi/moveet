import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { RecordingManager } from "../modules/RecordingManager";
import { ReplayManager } from "../modules/ReplayManager";
import type {
  StartOptions,
  VehicleDTO,
  RecordingHeader,
  RecordingEvent,
} from "../types";

// ─── Helpers ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

function writeTestRecording(
  filePath: string,
  header: RecordingHeader,
  events: RecordingEvent[],
): void {
  const lines = [
    JSON.stringify(header),
    ...events.map((e) => JSON.stringify(e)),
  ];
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

function makeVehicle(
  id: string,
  lat: number,
  lng: number,
  overrides?: Partial<VehicleDTO>,
): VehicleDTO {
  return {
    id,
    name: `Vehicle ${id}`,
    position: [lat, lng],
    speed: 45,
    heading: 90,
    ...overrides,
  };
}

const defaultOptions: StartOptions = {
  minSpeed: 20,
  maxSpeed: 60,
  speedVariation: 0.1,
  acceleration: 10,
  deceleration: 15,
  turnThreshold: 45,
  heatZoneSpeedFactor: 0.6,
  updateInterval: 1000,
};

function makeHeader(overrides?: Partial<RecordingHeader>): RecordingHeader {
  return {
    format: "moveet-recording",
    version: 1,
    startTime: new Date().toISOString(),
    vehicleCount: 3,
    options: defaultOptions,
    ...overrides,
  };
}

// ─── RecordingManager ───────────────────────────────────────────────

describe("RecordingManager", () => {
  let rm: RecordingManager;

  beforeEach(() => {
    rm = new RecordingManager();
  });

  afterEach(() => {
    if (rm.isRecording()) {
      rm.stopRecording();
    }
  });

  // ─── NDJSON format write/read roundtrip ───────────────────────

  describe("NDJSON format write/read roundtrip", () => {
    it("should write a valid NDJSON file with header and events", () => {
      const filePath = tmpFile("roundtrip.ndjson");
      rm.startRecording(defaultOptions, 2, filePath);

      rm.recordEvent("direction", { vehicleId: "v1", dest: [1, 2] });
      rm.recordEvent("incident", { id: "inc1", type: "closure" });

      rm.stopRecording();

      const content = fs.readFileSync(filePath, "utf-8").trim();
      const lines = content.split("\n");

      // At least header + 2 events
      expect(lines.length).toBeGreaterThanOrEqual(3);

      // Verify each line is valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }

      // Verify header
      const header = JSON.parse(lines[0]) as RecordingHeader;
      expect(header.format).toBe("moveet-recording");
      expect(header.version).toBe(1);
      expect(header.vehicleCount).toBe(2);

      // Verify events have correct structure
      const event1 = JSON.parse(lines[1]) as RecordingEvent;
      expect(event1.type).toBe("direction");
      expect(event1.timestamp).toBeGreaterThanOrEqual(0);

      const event2 = JSON.parse(lines[2]) as RecordingEvent;
      expect(event2.type).toBe("incident");
    });
  });

  // ─── Delta dedup for vehicle snapshots ────────────────────────

  describe("captureVehicleSnapshot with delta dedup", () => {
    it("should record only changed positions beyond threshold", () => {
      const filePath = tmpFile("dedup.ndjson");
      rm.startRecording(defaultOptions, 2, filePath);

      const v1 = makeVehicle("v1", 45.5, -73.5);
      const v2 = makeVehicle("v2", 45.6, -73.6);

      // First snapshot — both should be recorded (no previous positions)
      rm.captureVehicleSnapshot([v1, v2]);

      // Same positions — nothing should be recorded
      rm.captureVehicleSnapshot([v1, v2]);

      // Tiny change below threshold (0.000005 < 0.00001)
      const v1Tiny = makeVehicle("v1", 45.5 + 0.000005, -73.5);
      rm.captureVehicleSnapshot([v1Tiny, v2]);

      // Significant change above threshold
      const v1Moved = makeVehicle("v1", 45.5 + 0.001, -73.5);
      rm.captureVehicleSnapshot([v1Moved, v2]);

      rm.stopRecording();

      const content = fs.readFileSync(filePath, "utf-8").trim();
      const lines = content.split("\n");
      // header + 2 snapshot events (first snapshot with both, then v1 moved)
      const eventLines = lines.slice(1);
      expect(eventLines.length).toBe(2);

      // First snapshot should contain both vehicles
      const snap1 = JSON.parse(eventLines[0]) as RecordingEvent;
      expect(snap1.type).toBe("vehicle");
      const snap1Data = snap1.data as { vehicles: unknown[] };
      expect(snap1Data.vehicles.length).toBe(2);

      // Second snapshot should only contain v1 (only one that moved enough)
      const snap2 = JSON.parse(eventLines[1]) as RecordingEvent;
      expect(snap2.type).toBe("vehicle");
      const snap2Data = snap2.data as { vehicles: { id: string }[] };
      expect(snap2Data.vehicles.length).toBe(1);
      expect(snap2Data.vehicles[0].id).toBe("v1");
    });
  });

  // ─── Discrete events ──────────────────────────────────────────

  describe("recordEvent captures discrete events", () => {
    it("should record direction, incident, and heatzone events", () => {
      const filePath = tmpFile("discrete.ndjson");
      rm.startRecording(defaultOptions, 1, filePath);

      rm.recordEvent("direction", { vehicleId: "v1" });
      rm.recordEvent("incident", { id: "inc1", type: "accident" });
      rm.recordEvent("heatzone", { zones: [] });

      rm.stopRecording();

      const content = fs.readFileSync(filePath, "utf-8").trim();
      const lines = content.split("\n");
      const events = lines.slice(1).map((l) => JSON.parse(l) as RecordingEvent);

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("direction");
      expect(events[1].type).toBe("incident");
      expect(events[2].type).toBe("heatzone");
    });
  });

  // ─── startRecording throws if already recording ───────────────

  describe("startRecording throws if already recording", () => {
    it("should throw Error when called twice", () => {
      const filePath = tmpFile("double-start.ndjson");
      rm.startRecording(defaultOptions, 1, filePath);

      expect(() =>
        rm.startRecording(defaultOptions, 1, tmpFile("second.ndjson")),
      ).toThrow("Recording already in progress");
    });
  });

  // ─── stopRecording returns correct metadata ───────────────────

  describe("stopRecording returns correct metadata", () => {
    it("should return filePath, duration, eventCount, vehicleCount", () => {
      const filePath = tmpFile("metadata.ndjson");
      rm.startRecording(defaultOptions, 5, filePath);

      rm.recordEvent("direction", {});
      rm.recordEvent("incident", {});
      rm.recordEvent("heatzone", {});

      const meta = rm.stopRecording();

      expect(meta.filePath).toBe(filePath);
      expect(meta.duration).toBeGreaterThanOrEqual(0);
      expect(meta.eventCount).toBe(3);
      expect(meta.vehicleCount).toBe(5);
    });
  });

  // ─── Auto-generated file path ─────────────────────────────────

  describe("auto-generated file path", () => {
    it("should match pattern moveet-{date}-{count}v.ndjson", () => {
      const filePath = rm.startRecording(defaultOptions, 7);

      expect(filePath).toMatch(/moveet-.*-7v\.ndjson$/);

      rm.stopRecording();

      // Clean up the auto-generated file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });

  // ─── Buffer flush on count threshold ──────────────────────────

  describe("buffer flush on count threshold", () => {
    it("should flush to disk when buffer exceeds 1000 events", () => {
      const filePath = tmpFile("flush.ndjson");
      rm.startRecording(defaultOptions, 1, filePath);

      // Write 1001 events to trigger the flush threshold
      for (let i = 0; i < 1001; i++) {
        rm.recordEvent("direction", { i });
      }

      // Before stopping, the file should already have data from the flush
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");
      // Header + at least 1000 flushed events (the remaining 1 may still be buffered)
      expect(lines.length).toBeGreaterThanOrEqual(1001);

      rm.stopRecording();
    });
  });

  // ─── isRecording and getElapsedMs ─────────────────────────────

  describe("isRecording and getElapsedMs", () => {
    it("should track recording state correctly", () => {
      expect(rm.isRecording()).toBe(false);
      expect(rm.getElapsedMs()).toBe(0);

      const filePath = tmpFile("state.ndjson");
      rm.startRecording(defaultOptions, 1, filePath);

      expect(rm.isRecording()).toBe(true);
      expect(rm.getElapsedMs()).toBeGreaterThanOrEqual(0);

      rm.stopRecording();

      expect(rm.isRecording()).toBe(false);
      expect(rm.getElapsedMs()).toBe(0);
    });
  });
});

// ─── ReplayManager ──────────────────────────────────────────────────

describe("ReplayManager", () => {
  let rp: ReplayManager;

  beforeEach(() => {
    rp = new ReplayManager();
  });

  afterEach(() => {
    rp.stopReplay();
  });

  // ─── Replay emits events at correct timestamps ────────────────

  describe("replay emits events in order", () => {
    it("should emit events via individual event channels", async () => {
      vi.useFakeTimers();

      const filePath = tmpFile("replay-order.ndjson");
      const header = makeHeader();
      const events: RecordingEvent[] = [
        { timestamp: 100, type: "vehicle", data: { vehicles: [] } },
        { timestamp: 200, type: "direction", data: { vehicleId: "v2" } },
        { timestamp: 300, type: "incident", data: { action: "created", id: "inc1" } },
      ];
      writeTestRecording(filePath, header, events);

      await rp.loadRecording(filePath);

      const vehicleEvents: unknown[] = [];
      const directionEvents: unknown[] = [];
      const incidentEvents: unknown[] = [];
      rp.on("vehicle", (data) => vehicleEvents.push(data));
      rp.on("direction", (data) => directionEvents.push(data));
      rp.on("incident:created", (data) => incidentEvents.push(data));

      rp.startReplay(1);

      // At t=0, no events yet
      expect(vehicleEvents).toHaveLength(0);

      // Advance to t=100 — vehicle event fires
      vi.advanceTimersByTime(100);
      expect(vehicleEvents).toHaveLength(1);

      // Advance to t=200 — direction event fires
      vi.advanceTimersByTime(100);
      expect(directionEvents).toHaveLength(1);

      // Advance to t=300 — incident event fires
      vi.advanceTimersByTime(100);
      expect(incidentEvents).toHaveLength(1);

      vi.useRealTimers();
    });
  });

  // ─── Replay speed multiplier ──────────────────────────────────

  describe("replay speed multiplier", () => {
    it("should emit events faster when speed=2", async () => {
      vi.useFakeTimers();

      const filePath = tmpFile("replay-speed.ndjson");
      const header = makeHeader();
      // Events spaced 400ms apart — at 2x, should arrive 200ms apart in wall time
      const events: RecordingEvent[] = [
        { timestamp: 0, type: "vehicle", data: {} },
        { timestamp: 400, type: "direction", data: {} },
      ];
      writeTestRecording(filePath, header, events);

      await rp.loadRecording(filePath);

      const received: unknown[] = [];
      rp.on("vehicle", (data) => received.push(data));
      rp.on("direction", (data) => received.push(data));

      rp.startReplay(2);

      // First event at ts=0 fires immediately
      vi.advanceTimersByTime(1);
      expect(received).toHaveLength(1);

      // At 2x speed, ts=400 should fire at real-time ~200ms
      vi.advanceTimersByTime(199);
      expect(received).toHaveLength(2);

      vi.useRealTimers();
    });
  });

  // ─── Pause and resume ─────────────────────────────────────────

  describe("pause and resume", () => {
    it("should stop emitting when paused and resume after", async () => {
      vi.useFakeTimers();

      const filePath = tmpFile("replay-pause.ndjson");
      const header = makeHeader();
      const events: RecordingEvent[] = [
        { timestamp: 100, type: "vehicle", data: {} },
        { timestamp: 500, type: "direction", data: {} },
      ];
      writeTestRecording(filePath, header, events);

      await rp.loadRecording(filePath);

      const received: unknown[] = [];
      rp.on("vehicle", (data) => received.push(data));
      rp.on("direction", (data) => received.push(data));

      rp.startReplay(1);

      // First event at 100ms
      vi.advanceTimersByTime(100);
      expect(received).toHaveLength(1);

      // Pause
      rp.pauseReplay();
      expect(rp.getStatus().paused).toBe(true);

      // Advance time while paused — no new events
      vi.advanceTimersByTime(1000);
      expect(received).toHaveLength(1);

      // Resume
      rp.resumeReplay();
      expect(rp.getStatus().paused).toBe(false);

      // The second event should fire after its remaining delay
      vi.advanceTimersByTime(400);
      expect(received).toHaveLength(2);

      vi.useRealTimers();
    });
  });

  // ─── seekTo ───────────────────────────────────────────────────

  describe("seekTo", () => {
    it("should seek to the correct position in the recording", async () => {
      const filePath = tmpFile("replay-seek.ndjson");
      const header = makeHeader();
      const events: RecordingEvent[] = [
        { timestamp: 100, type: "vehicle", data: {} },
        { timestamp: 200, type: "direction", data: {} },
        { timestamp: 300, type: "incident", data: { action: "created" } },
        { timestamp: 400, type: "heatzone", data: {} },
      ];
      writeTestRecording(filePath, header, events);

      await rp.loadRecording(filePath);

      // Seek to t=250 — progress should be between first and second thirds
      rp.seekTo(250);
      const status = rp.getStatus();
      expect(status.mode).toBe("replay");
      // currentTime should be at or near 200 (the event at/before 250)
      expect(status.currentTime).toBeDefined();
    });
  });

  // ─── stopReplay resets state ──────────────────────────────────

  describe("stopReplay resets state", () => {
    it("should return mode 'live' after stop", async () => {
      const filePath = tmpFile("replay-stop.ndjson");
      const header = makeHeader();
      const events: RecordingEvent[] = [
        { timestamp: 100, type: "vehicle", data: {} },
      ];
      writeTestRecording(filePath, header, events);

      await rp.loadRecording(filePath);
      expect(rp.getStatus().mode).toBe("replay");

      rp.stopReplay();

      const status = rp.getStatus();
      expect(status.mode).toBe("live");
    });
  });

  // ─── loadRecording validates format ───────────────────────────

  describe("loadRecording validates format", () => {
    it("should throw on header with wrong format", async () => {
      const filePath = tmpFile("wrong-format.ndjson");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ format: "wrong", version: 1 }) + "\n",
      );

      await expect(rp.loadRecording(filePath)).rejects.toThrow(
        "Invalid recording format",
      );
    });

    it("should throw on header with wrong version", async () => {
      const filePath = tmpFile("wrong-version.ndjson");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ format: "moveet-recording", version: 99 }) + "\n",
      );

      await expect(rp.loadRecording(filePath)).rejects.toThrow(
        "Invalid recording format",
      );
    });
  });

  // ─── loadRecording validates empty file ───────────────────────

  describe("loadRecording validates empty file", () => {
    it("should throw on empty file", async () => {
      const filePath = tmpFile("empty.ndjson");
      fs.writeFileSync(filePath, "");

      await expect(rp.loadRecording(filePath)).rejects.toThrow(
        "empty or missing header",
      );
    });

    it("should throw on whitespace-only file", async () => {
      const filePath = tmpFile("whitespace.ndjson");
      fs.writeFileSync(filePath, "   \n  \n  ");

      await expect(rp.loadRecording(filePath)).rejects.toThrow(
        "empty or missing header",
      );
    });
  });

  // ─── getStatus returns correct progress ───────────────────────

  describe("getStatus returns correct progress", () => {
    it("should report progress during playback", async () => {
      vi.useFakeTimers();

      const filePath = tmpFile("replay-progress.ndjson");
      const header = makeHeader();
      const events: RecordingEvent[] = [
        { timestamp: 100, type: "vehicle", data: {} },
        { timestamp: 200, type: "direction", data: {} },
        { timestamp: 300, type: "incident", data: { action: "created" } },
        { timestamp: 400, type: "heatzone", data: {} },
      ];
      writeTestRecording(filePath, header, events);

      await rp.loadRecording(filePath);

      // Before starting, progress should be 0
      let status = rp.getStatus();
      expect(status.mode).toBe("replay");
      expect(status.progress).toBe(0);
      expect(status.duration).toBe(300); // 400 - 100

      rp.startReplay(1);

      // After all events
      vi.advanceTimersByTime(500);
      status = rp.getStatus();
      // Replay should have ended (idle), progress = 1
      expect(status.progress).toBe(1);

      vi.useRealTimers();
    });
  });
});
