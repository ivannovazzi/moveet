import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { GenerationManager } from "../modules/GenerationManager";
import type { RecordingMetadata, RecordingHeader } from "../types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

/**
 * The GenerationManager drives the real HeadlessRunner, which writes into the
 * recordings/ dir (resolved from cwd). These tests run a tiny generation and
 * clean up the produced file afterward.
 */
describe("GenerationManager", () => {
  const produced: string[] = [];

  afterEach(() => {
    for (const f of produced.splice(0)) {
      try {
        fs.rmSync(f);
      } catch {
        // ignore
      }
    }
  });

  function waitFor<T>(gm: GenerationManager, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      gm.once(event, (payload: T) => resolve(payload));
      gm.once("generate:error", (e: { error: string }) => reject(new Error(e.error)));
    });
  }

  it("runs a job, emits progress + complete, and produces a parseable back-dated recording", async () => {
    const gm = new GenerationManager();

    let sawProgress = false;
    gm.on("generate:progress", (p: { jobId: string; totalSteps: number; pct: number }) => {
      sawProgress = true;
      expect(p.totalSteps).toBe(5);
      expect(p.pct).toBeGreaterThanOrEqual(0);
    });

    const completePromise = waitFor<{ jobId: string; metadata: RecordingMetadata }>(
      gm,
      "generate:complete"
    );

    const jobId = gm.start({
      startTime: new Date("2026-05-25T00:00:00.000Z"),
      steps: 5,
      vehicleCount: 2,
      stepMs: 1000,
      seed: 1,
      geojsonPath: FIXTURE_PATH,
    });

    expect(jobId).toBeTruthy();
    expect(gm.isRunning()).toBe(true);
    expect(gm.getStatus().state).toBe("running");

    const { jobId: doneJobId, metadata } = await completePromise;
    expect(doneJobId).toBe(jobId);
    expect(sawProgress).toBe(true);
    expect(gm.getStatus().state).toBe("done");

    produced.push(metadata.filePath);

    const lines = fs.readFileSync(metadata.filePath, "utf-8").trim().split("\n");
    const header = JSON.parse(lines[0]) as RecordingHeader;
    expect(header.format).toBe("moveet-recording");
    expect(header.generated).toBe(true);
    expect(header.startTime).toBe("2026-05-25T00:00:00.000Z");
    expect(metadata.duration).toBe(5000); // simulated span
    expect(path.basename(metadata.filePath)).toContain("moveet-generated");
  });

  it("returns null (409 signal) when a job is already running", async () => {
    const gm = new GenerationManager();
    const completePromise = waitFor(gm, "generate:complete");

    const first = gm.start({
      startTime: new Date("2026-05-25T00:00:00.000Z"),
      steps: 5,
      vehicleCount: 2,
      stepMs: 1000,
      geojsonPath: FIXTURE_PATH,
    });
    expect(first).toBeTruthy();

    // Second start while the first is still running must be rejected.
    const second = gm.start({
      startTime: new Date("2026-05-25T00:00:00.000Z"),
      steps: 5,
      vehicleCount: 2,
      stepMs: 1000,
      geojsonPath: FIXTURE_PATH,
    });
    expect(second).toBeNull();

    const { metadata } = (await completePromise) as { metadata: RecordingMetadata };
    produced.push(metadata.filePath);
  });
});
