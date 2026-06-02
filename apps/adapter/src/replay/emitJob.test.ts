import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { VehicleUpdate } from "../types";
import { EmitJobRunner } from "./emitJob";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "__fixtures__", "recording.ndjson");

const START = Date.parse("2026-05-25T00:00:00.000Z");

/** A Response whose body streams the fixture NDJSON as a Web ReadableStream. */
function fixtureResponse(): Response {
  const bytes = new TextEncoder().encode(readFileSync(FIXTURE, "utf8"));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** Wait until the runner leaves the "emitting" state (job settled). */
async function waitSettled(runner: EmitJobRunner): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (!runner.isRunning()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Emit job did not settle");
}

describe("EmitJobRunner", () => {
  it("emits a fetched recording back-dated, progressing idle → emitting → done", async () => {
    const published: VehicleUpdate[][] = [];
    const fetchFn = vi.fn(async () => fixtureResponse()) as unknown as typeof fetch;

    const runner = new EmitJobRunner({
      simulatorUrl: "http://sim.test:5010",
      fetchFn,
      realismConfig: {},
      publish: async (u) => {
        published.push(u.map((x) => ({ ...x })));
        return { status: "success", sinks: [] };
      },
    });

    expect(runner.getStatus().state).toBe("idle");

    const jobId = runner.start({ recordingId: 7, realism: "off" });
    expect(jobId).toBeTruthy();
    expect(runner.getStatus().state).toBe("emitting");

    await waitSettled(runner);

    const status = runner.getStatus();
    expect(status.state).toBe("done");
    expect(status.emitted).toBe(3);
    expect(status.pct).toBe(100);

    // fetched the right URL
    expect(fetchFn).toHaveBeenCalledWith("http://sim.test:5010/recordings/7/download");

    // every emitted timestamp is back-dated (historical, < now)
    const all = published.flat();
    expect(all.length).toBe(6);
    for (const u of all) {
      expect(u.timestamp).toBeGreaterThanOrEqual(START);
      expect(u.timestamp!).toBeLessThan(Date.now());
    }
  });

  it("returns null (→ 409) when a job is already running", async () => {
    // Slow publish keeps the first job in flight while we attempt a second start.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));

    const runner = new EmitJobRunner({
      simulatorUrl: "http://sim.test:5010",
      fetchFn: (async () => fixtureResponse()) as unknown as typeof fetch,
      realismConfig: {},
      publish: async () => {
        await gate;
        return { status: "success", sinks: [] };
      },
    });

    const first = runner.start({ recordingId: 1, realism: "off" });
    expect(first).toBeTruthy();
    // Yield so the job begins and is awaiting the gated publish.
    await new Promise((r) => setTimeout(r, 10));
    expect(runner.isRunning()).toBe(true);

    const second = runner.start({ recordingId: 2, realism: "off" });
    expect(second).toBeNull();

    release();
    await waitSettled(runner);
    expect(runner.getStatus().state).toBe("done");
  });

  it("reports error state on fetch failure", async () => {
    const runner = new EmitJobRunner({
      simulatorUrl: "http://sim.test:5010",
      fetchFn: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
      realismConfig: {},
      publish: async () => ({ status: "success", sinks: [] }),
    });

    runner.start({ recordingId: 99, realism: "off" });
    await waitSettled(runner);

    const status = runner.getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toContain("404");
  });
});
