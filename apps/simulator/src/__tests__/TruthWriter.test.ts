import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { TruthWriter } from "../headless/TruthWriter";
import type { TruthHeader, VehicleDTO } from "../types";

function readLines(file: string): string[] {
  return fs.readFileSync(file, "utf-8").trimEnd().split("\n");
}

describe("TruthWriter", () => {
  const tmpFiles: string[] = [];

  function tmpPath(): string {
    const p = path.join(os.tmpdir(), `truth-test-${Date.now()}-${Math.random()}.ndjson`);
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

  const header: TruthHeader = {
    format: "moveet-headless-truth",
    version: 1,
    simStart: "2026-05-25T00:00:00.000Z",
    stepMs: 1000,
    vehicleCount: 2,
    seed: 12345,
    network: "test",
  };

  function vehicle(id: string, lat: number, lon: number): VehicleDTO {
    return { id, name: id, type: "car", position: [lat, lon], speed: 10, heading: 90 };
  }

  it("writes the header as the first line per the format contract", () => {
    const file = tmpPath();
    const writer = new TruthWriter(file, header);
    writer.close();

    const lines = readLines(file);
    expect(JSON.parse(lines[0])).toEqual(header);
  });

  it("stamps absolute simTime from the provided Date (not Date.now() - startTime)", () => {
    const file = tmpPath();
    const writer = new TruthWriter(file, header);
    const t = new Date("2026-05-25T08:14:03.000Z");
    writer.writeStep(t, [vehicle("v1", -1.29, 36.82)]);
    writer.close();

    const lines = readLines(file);
    const record = JSON.parse(lines[1]);
    expect(record.simTime).toBe("2026-05-25T08:14:03.000Z");
    expect(record.vehicles[0]).toMatchObject({
      id: "v1",
      position: [-1.29, 36.82],
      speed: 10,
      heading: 90,
      ignition: true,
    });
  });

  it("does NOT dedup: an unchanged vehicle is captured on every step", () => {
    const file = tmpPath();
    const writer = new TruthWriter(file, header);
    const v = vehicle("v1", -1.29, 36.82);
    writer.writeStep(new Date("2026-05-25T00:00:01.000Z"), [v]);
    // identical position next step
    writer.writeStep(new Date("2026-05-25T00:00:02.000Z"), [v]);
    writer.close();

    const lines = readLines(file);
    // header + 2 step records
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[1]).vehicles).toHaveLength(1);
    expect(JSON.parse(lines[2]).vehicles).toHaveLength(1);
  });
});
