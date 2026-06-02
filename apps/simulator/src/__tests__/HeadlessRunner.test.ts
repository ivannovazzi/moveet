import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { HeadlessRunner } from "../headless/HeadlessRunner";
import type { TruthHeader, TruthStepRecord } from "../types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

function readLines(file: string): string[] {
  return fs.readFileSync(file, "utf-8").trimEnd().split("\n");
}

describe("HeadlessRunner", () => {
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

  it("produces a header line matching the format contract", () => {
    const out = tmpPath();
    const runner = new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 3,
      simStart: new Date("2026-05-25T00:00:00.000Z"),
      stepMs: 1000,
      totalSimMs: 5000,
      out,
      seed: 12345,
      network: "test",
    });
    runner.run();

    const header = JSON.parse(readLines(out)[0]) as TruthHeader;
    expect(header.format).toBe("moveet-headless-truth");
    expect(header.version).toBe(1);
    expect(header.simStart).toBe("2026-05-25T00:00:00.000Z");
    expect(header.stepMs).toBe(1000);
    expect(header.vehicleCount).toBe(3);
    expect(header.seed).toBe(12345);
    expect(header.network).toBe("test");
  });

  it("writes exactly totalSimMs/stepMs step records", () => {
    const out = tmpPath();
    new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 2,
      simStart: new Date("2026-05-25T00:00:00.000Z"),
      stepMs: 1000,
      totalSimMs: 10000,
      out,
      seed: 1,
      network: "test",
    }).run();

    const lines = readLines(out);
    // 1 header + 10 step records
    expect(lines.length).toBe(1 + 10);
  });

  it("stamps simTime monotonically starting one step after simStart", () => {
    const out = tmpPath();
    const simStart = new Date("2026-05-25T00:00:00.000Z");
    new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 2,
      simStart,
      stepMs: 1000,
      totalSimMs: 5000,
      out,
      seed: 1,
      network: "test",
    }).run();

    const lines = readLines(out);
    const records = lines.slice(1).map((l) => JSON.parse(l) as TruthStepRecord);

    // First record is simStart + 1 step (clock ticks before capture).
    expect(records[0].simTime).toBe("2026-05-25T00:00:01.000Z");

    let prev = simStart.getTime();
    for (const r of records) {
      const t = new Date(r.simTime).getTime();
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    // Last record == simStart + totalSimMs.
    expect(records[records.length - 1].simTime).toBe("2026-05-25T00:00:05.000Z");
  });

  it("captures every active vehicle every step (no dedup)", () => {
    const out = tmpPath();
    new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 3,
      simStart: new Date("2026-05-25T00:00:00.000Z"),
      stepMs: 1000,
      totalSimMs: 5000,
      out,
      seed: 1,
      network: "test",
    }).run();

    const records = readLines(out)
      .slice(1)
      .map((l) => JSON.parse(l) as TruthStepRecord);

    for (const r of records) {
      expect(r.vehicles).toHaveLength(3);
    }
  });

  it("is deterministic for a fixed seed (best-effort: seeds Math.random)", () => {
    const make = (out: string) =>
      new HeadlessRunner({
        geojsonPath: FIXTURE_PATH,
        vehicles: 3,
        simStart: new Date("2026-05-25T00:00:00.000Z"),
        stepMs: 1000,
        totalSimMs: 5000,
        out,
        seed: 777,
        network: "test",
      }).run();

    const a = tmpPath();
    const b = tmpPath();
    make(a);
    make(b);

    expect(fs.readFileSync(a, "utf-8")).toBe(fs.readFileSync(b, "utf-8"));
  });

  it("does not start any real timers / setInterval", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const out = tmpPath();
    new HeadlessRunner({
      geojsonPath: FIXTURE_PATH,
      vehicles: 2,
      simStart: new Date("2026-05-25T00:00:00.000Z"),
      stepMs: 1000,
      totalSimMs: 3000,
      out,
      seed: 1,
      network: "test",
    }).run();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
