import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { RecordingManager } from "../../modules/RecordingManager";

describe("RecordingManager", () => {
  let manager: RecordingManager;
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-test-"));
    manager = new RecordingManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (manager.isRecording()) {
      manager.stopRecording();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const defaultOptions = {
    minSpeed: 20,
    maxSpeed: 60,
    speedVariation: 0.2,
    acceleration: 5,
    deceleration: 10,
    turnThreshold: 0.5,
    heatZoneSpeedFactor: 0.5,
    updateInterval: 100,
  };

  describe("startRecording", () => {
    it("should create a recording file with valid NDJSON header", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      const result = manager.startRecording(defaultOptions, 5, filePath);

      expect(result).toBe(filePath);
      expect(manager.isRecording()).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);

      // Stop to flush and close
      manager.stopRecording();

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      const header = JSON.parse(lines[0]);
      expect(header.format).toBe("moveet-recording");
      expect(header.version).toBe(1);
      expect(header.vehicleCount).toBe(5);
      expect(header.options).toEqual(defaultOptions);
    });

    it("should auto-generate file path when none provided", () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = manager.startRecording(defaultOptions, 3);
        expect(result).toContain("moveet-");
        expect(result).toContain("-3v.ndjson");
        manager.stopRecording();
      } finally {
        process.chdir(origCwd);
      }
    });

    it("should throw when already recording", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);
      expect(() => manager.startRecording(defaultOptions, 1, filePath)).toThrow(
        "Recording already in progress"
      );
    });

    it("should emit recording:started event", () => {
      const listener = vi.fn();
      manager.on("recording:started", listener);
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);
      expect(listener).toHaveBeenCalledWith({ filePath });
    });
  });

  describe("stopRecording", () => {
    it("should return metadata with duration and file size", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 2, filePath);

      vi.advanceTimersByTime(500);

      const metadata = manager.stopRecording();
      expect(metadata.filePath).toBe(filePath);
      expect(metadata.vehicleCount).toBe(2);
      expect(metadata.duration).toBeGreaterThanOrEqual(500);
      expect(metadata.fileSize).toBeGreaterThan(0);
      expect(metadata.eventCount).toBe(0);
      expect(manager.isRecording()).toBe(false);
    });

    it("should throw when not recording", () => {
      expect(() => manager.stopRecording()).toThrow("No recording in progress");
    });

    it("should emit recording:stopped event with metadata", () => {
      const listener = vi.fn();
      manager.on("recording:stopped", listener);
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);
      manager.stopRecording();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ filePath, vehicleCount: 1 }));
    });
  });

  describe("isRecording / getElapsedMs", () => {
    it("should return false when not recording", () => {
      expect(manager.isRecording()).toBe(false);
      expect(manager.getElapsedMs()).toBe(0);
    });

    it("should return elapsed time while recording", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);
      vi.advanceTimersByTime(1234);
      expect(manager.getElapsedMs()).toBeGreaterThanOrEqual(1234);
    });
  });

  describe("recordEvent", () => {
    it("should buffer and flush events to file", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);

      manager.recordEvent("vehicle", { vehicles: [{ id: "v1" }] });
      manager.recordEvent("direction", { vehicleId: "v1" });

      manager.stopRecording();

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      // Header + 2 events
      expect(lines.length).toBe(3);

      const event1 = JSON.parse(lines[1]);
      expect(event1.type).toBe("vehicle");
      expect(event1.timestamp).toBeGreaterThanOrEqual(0);

      const event2 = JSON.parse(lines[2]);
      expect(event2.type).toBe("direction");
    });

    it("should not record when not recording", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.recordEvent("vehicle", { vehicles: [] });
      // No file should be created
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("should auto-flush when buffer reaches limit", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);

      // Write 1001 events (threshold is 1000)
      for (let i = 0; i < 1001; i++) {
        manager.recordEvent("vehicle", { i });
      }

      // The first 1000 should already be flushed
      manager.stopRecording();

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      // Header + 1001 events
      expect(lines.length).toBe(1002);
    });
  });

  describe("captureVehicleSnapshot", () => {
    it("should record vehicles with changed positions", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);

      manager.captureVehicleSnapshot([
        { id: "v1", position: [-1.3, 36.8], speed: 40, heading: 90, name: "Car 1" } as any,
      ]);

      manager.stopRecording();

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      expect(lines.length).toBe(2); // header + 1 vehicle event
      const event = JSON.parse(lines[1]);
      expect(event.type).toBe("vehicle");
      expect(event.data.vehicles[0].id).toBe("v1");
    });

    it("should skip vehicles whose position has not changed", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);

      const vehicle = {
        id: "v1",
        position: [-1.3, 36.8],
        speed: 40,
        heading: 90,
        name: "Car 1",
      } as any;

      manager.captureVehicleSnapshot([vehicle]);
      manager.captureVehicleSnapshot([vehicle]); // same position

      manager.stopRecording();

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      // Header + only 1 event (second was deduped)
      expect(lines.length).toBe(2);
    });

    it("should include vehicle with fleetId when present", () => {
      const filePath = path.join(tmpDir, "test.ndjson");
      manager.startRecording(defaultOptions, 1, filePath);

      manager.captureVehicleSnapshot([
        {
          id: "v1",
          position: [-1.3, 36.8],
          speed: 40,
          heading: 90,
          fleetId: "fleet-1",
          name: "Car",
        } as any,
      ]);

      manager.stopRecording();

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      const event = JSON.parse(lines[1]);
      expect(event.data.vehicles[0].fleetId).toBe("fleet-1");
    });

    it("should not record when not recording", () => {
      manager.captureVehicleSnapshot([
        { id: "v1", position: [-1.3, 36.8], speed: 40, heading: 90, name: "Car" } as any,
      ]);
      // Should not throw
    });
  });
});
