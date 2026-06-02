import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { HeadlessRunner } from "../headless/HeadlessRunner";
import type { RecordingHeader, RecordingEvent, VehicleSnapshot } from "../types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

function readLines(file: string): string[] {
  return fs.readFileSync(file, "utf-8").trimEnd().split("\n");
}

describe("HeadlessRunner (RecordingManager raw mode)", () => {
  const tmpFiles: string[] = [];

  function tmpPath(): string {
    const p = path.join(os.tmpdir(), `headless-test-${Date.now()}-${Math.random()}.ndjson`);
    tmpFiles.push(p);
    return p;
  }

  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      try {
        fs.rmSync(f);
      } catch {
        // ignore
      }
    }
  });

  it("writes a parseable recording header back-dated to simStart with generated fields", async () => {
    const out = tmpPath();
    const metadata = await new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 3,
      simStart: new Date("2026-05-25T00:00:00.000Z"),
      stepMs: 1000,
      totalSimMs: 5000,
      out,
      seed: 12345,
    }).run();

    const header = JSON.parse(readLines(out)[0]) as RecordingHeader;
    expect(header.format).toBe("moveet-recording");
    expect(header.version).toBe(1);
    expect(header.startTime).toBe("2026-05-25T00:00:00.000Z");
    expect(header.generated).toBe(true);
    expect(header.stepMs).toBe(1000);
    expect(header.seed).toBe(12345);
    expect(header.vehicleCount).toBe(3);

    // Metadata is ready to insert into stateStore like a normal recording.
    expect(metadata.startTime).toBe("2026-05-25T00:00:00.000Z");
    expect(metadata.filePath).toBe(out);
    expect(metadata.vehicleCount).toBe(3);
    expect(metadata.eventCount).toBeGreaterThan(0);
  });

  it("stamps vehicle events with sim-clock-relative offsets (header.startTime + offset = sim time)", async () => {
    const out = tmpPath();
    const simStart = new Date("2026-05-25T00:00:00.000Z");
    await new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 2,
      simStart,
      stepMs: 1000,
      totalSimMs: 5000,
      out,
      seed: 1,
    }).run();

    const events = readLines(out)
      .slice(1)
      .map((l) => JSON.parse(l) as RecordingEvent)
      .filter((e) => e.type === "vehicle");

    // 5 steps → 5 vehicle events, offsets 1000..5000 (clock ticks before capture).
    expect(events.length).toBe(5);
    expect(events[0].timestamp).toBe(1000);
    expect(events[events.length - 1].timestamp).toBe(5000);

    let prev = -1;
    for (const e of events) {
      expect(e.timestamp).toBeGreaterThan(prev);
      prev = e.timestamp;
      // Absolute sim time reconstruction is back-dated, never wall-clock.
      const abs = simStart.getTime() + e.timestamp;
      expect(abs).toBeLessThan(Date.now());
    }
  });

  it("captures every active vehicle every step (no dedup)", async () => {
    const out = tmpPath();
    await new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 3,
      simStart: new Date("2026-05-25T00:00:00.000Z"),
      stepMs: 1000,
      totalSimMs: 5000,
      out,
      seed: 1,
    }).run();

    const events = readLines(out)
      .slice(1)
      .map((l) => JSON.parse(l) as RecordingEvent)
      .filter((e) => e.type === "vehicle");

    for (const e of events) {
      const vehicles = (e.data as { vehicles: VehicleSnapshot[] }).vehicles;
      expect(vehicles).toHaveLength(3);
    }
  });

  it("is deterministic for a fixed seed (best-effort: seeds Math.random)", async () => {
    const make = (out: string) =>
      new HeadlessRunner({
        geojsonPath: FIXTURE_PATH,
        vehicles: 3,
        simStart: new Date("2026-05-25T00:00:00.000Z"),
        stepMs: 1000,
        totalSimMs: 5000,
        out,
        seed: 777,
      }).run();

    const a = tmpPath();
    const b = tmpPath();
    await make(a);
    await make(b);

    expect(fs.readFileSync(a, "utf-8")).toBe(fs.readFileSync(b, "utf-8"));
  });
});
