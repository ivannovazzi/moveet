import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { GenerationManager } from "../modules/GenerationManager";
import { config } from "../utils/config";
import type { RecordingMetadata, RecordingHeader } from "../types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

/**
 * Unroutable by construction (RFC 6761 reserves `.invalid`). `GenerationManager`
 * exposes no `useSource` flag, so `HeadlessRunner` derives it from
 * `!!config.adapterURL` — this pins that branch on without naming a port that
 * something might actually be serving.
 */
const STUB_ADAPTER_URL = "http://adapter.invalid";

/** Deterministic stand-in for the adapter's fleet; 3 vehicles so the vehicleCount=2 cap bites. */
const STUB_FLEET = [
  { id: "src-0", name: "Source Vehicle 1", type: "car" },
  { id: "src-1", name: "Source Vehicle 2", type: "truck" },
  { id: "src-2", name: "Source Vehicle 3", type: "bus" },
];

/**
 * The GenerationManager drives the real HeadlessRunner, which writes into the
 * recordings/ dir (resolved from cwd). These tests run a tiny generation and
 * clean up the produced file afterward.
 *
 * The fleet source is stubbed at the transport (`fetch`). Previously this suite
 * inherited `ADAPTER_URL=http://localhost:5011` from `.env` and issued a REAL
 * `GET /vehicles`, so what it generated depended on what happened to be
 * listening: `docker compose up` publishes the adapter on 5011 and the run
 * silently pulled that service's live fleet, while an idle machine fell back to
 * synthetic vehicles. Same test, two different code paths and two different
 * inputs. Stubbing fetch pins the `useSource` path deterministically and keeps
 * the suite offline.
 */
describe("GenerationManager", () => {
  const produced: string[] = [];
  let origAdapterURL: string;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    origAdapterURL = config.adapterURL;
    (config as { adapterURL: string }).adapterURL = STUB_ADAPTER_URL;
    fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => STUB_FLEET,
    }));
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    for (const f of produced.splice(0)) {
      try {
        fs.rmSync(f);
      } catch {
        // ignore
      }
    }
    (config as { adapterURL: string }).adapterURL = origAdapterURL;
    vi.unstubAllGlobals();
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

    const completePromise = waitFor<{
      jobId: string;
      metadata: RecordingMetadata;
    }>(gm, "generate:complete");

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

    // The fleet came from the stubbed source, not the network, and the
    // requested vehicleCount capped the 3-vehicle stub fleet down to 2.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe(`${STUB_ADAPTER_URL}/vehicles`);
    expect(header.vehicleCount).toBe(2);
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

    const { metadata } = (await completePromise) as {
      metadata: RecordingMetadata;
    };
    produced.push(metadata.filePath);
  });
});
