import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  RecordingManager,
  KeyframeStateAccumulator,
  type KeyframeState,
  type RecordingKeyframe,
} from "../modules/RecordingManager";
import { ReplayManager } from "../modules/ReplayManager";
import { SimulationClock } from "../modules/SimulationClock";
import type { StartOptions, VehicleDTO, RecordingEvent, RecordingHeader } from "../types";

// ─── Fixtures & helpers ─────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-keyframe-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

const defaultOptions: StartOptions = {
  minSpeed: 20,
  maxSpeed: 60,
  speedVariation: 0.1,
  acceleration: 10,
  deceleration: 15,
  turnThreshold: 45,
  heatZoneSpeedFactor: 0.6,
  adapterSyncInterval: 1000,
  updateInterval: 1000,
};

const SIM_START = new Date("2026-05-25T00:00:00.000Z");

/** Sim ms advanced per generated step. */
const STEP_MS = 1000;
/** Keyframe cadence used by the synthetic recordings below (30 steps). */
const KEYFRAME_MS = 30_000;

function makeVehicle(id: string, lat: number, lng: number): VehicleDTO {
  return {
    id,
    name: `Vehicle ${id}`,
    type: "car",
    position: [lat, lng],
    speed: 45,
    heading: 90,
  };
}

interface BuiltRecording {
  filePath: string;
  /** Every non-header line, in file order. */
  lines: Record<string, unknown>[];
  /** Only the RecordingEvent lines (what ReplayManager loads into `events`). */
  events: RecordingEvent[];
  keyframeCount: number;
  eventCount: number;
}

/**
 * Writes a deterministic synthetic recording in RAW mode, so every timestamp is
 * an exact sim-clock offset (`step * STEP_MS`) rather than wall clock.
 *
 * The event mix deliberately includes long-lived state that is NOT recoverable
 * from a window of recent lines: an incident created at step 3 and never
 * cleared, a heatzone payload refreshed rarely, and per-vehicle directions.
 */
function buildRecording(
  filePath: string,
  steps: number,
  keyframeIntervalMs: number
): BuiltRecording {
  const clock = new SimulationClock();
  clock.setTime(SIM_START);
  const rm = new RecordingManager({ keyframeIntervalMs });
  rm.startRecording(defaultOptions, 3, filePath, {
    startTime: SIM_START,
    stepMs: STEP_MS,
    clock,
  });

  for (let step = 1; step <= steps; step++) {
    clock.tick(STEP_MS);

    rm.captureVehicleSnapshot([
      makeVehicle("v-moving", 1 + step * 0.001, 36),
      makeVehicle("v-slow", 2 + step * 0.0000001, 36),
      // Never moves at all — in a live recording dedup would drop it after the
      // first line, which is precisely what makes seeking lossy without keyframes.
      makeVehicle("v-parked", 3, 36),
    ]);

    if (step % 10 === 0) {
      rm.recordEvent("direction", {
        vehicleId: "v-moving",
        route: { id: `route-${step}`, coordinates: [[1, 36]] },
      });
    }
    if (step % 37 === 0) {
      rm.recordEvent("heatzone", { zones: [{ id: `hz-${step}`, intensity: step / 100 }] });
    }
    if (step === 3) {
      rm.recordEvent("incident", {
        action: "created",
        id: "inc-early",
        type: "accident",
        edgeIds: ["e1"],
      });
    }
    if (step === 4) {
      rm.recordEvent("incident", {
        action: "created",
        id: "inc-transient",
        type: "closure",
        edgeIds: ["e2"],
      });
    }
    if (step === 6) {
      rm.recordEvent("incident", { action: "cleared", id: "inc-transient", reason: "expired" });
    }
    if (step === 50) {
      rm.recordEvent("direction", { vehicleId: "v-slow", route: { id: "route-slow" } });
    }
    if (step === 55) {
      // Completing the route must drop v-slow's direction from restored state.
      rm.recordEvent("route:completed", { vehicleId: "v-slow" });
    }
  }

  const meta = rm.stopRecording();
  const keyframeCount = rm.getKeyframeCount();

  const lines = fs
    .readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

  return {
    filePath,
    lines,
    events: lines.filter((l) => l.type !== "keyframe") as unknown as RecordingEvent[],
    keyframeCount,
    eventCount: meta.eventCount,
  };
}

/** Rewrites a recording with every keyframe line removed — i.e. exactly what a
 * pre-keyframe simulator would have produced for the same run. */
function stripKeyframes(src: string, dest: string): void {
  const lines = fs.readFileSync(src, "utf-8").trim().split("\n");
  const kept = lines.filter((l, i) => i === 0 || JSON.parse(l).type !== "keyframe");
  fs.writeFileSync(dest, kept.join("\n") + "\n");
}

/** Replay channels a client would receive, in emission order. */
interface Captured {
  channel: string;
  data: unknown;
}

function capture(rp: ReplayManager): Captured[] {
  const out: Captured[] = [];
  const channels = [
    "vehicle",
    "direction",
    "heatzones",
    "incident:created",
    "incident:cleared",
    "route:completed",
    "waypoint:reached",
    "vehicle:rerouted",
  ] as const;
  for (const channel of channels) {
    rp.on(channel, (data: unknown) => out.push({ channel, data }));
  }
  return out;
}

/**
 * Folds a stream of replay-channel messages into the same state shape a
 * keyframe holds. This is the client's view: whatever a viewer would have on
 * screen after receiving these messages.
 */
function foldChannels(captured: Captured[]): KeyframeState {
  const acc = new KeyframeStateAccumulator();
  for (const { channel, data } of captured) {
    const payload = data as Record<string, unknown>;
    switch (channel) {
      case "vehicle":
        acc.apply("vehicle", payload);
        break;
      case "direction":
        acc.apply("direction", payload);
        break;
      case "heatzones":
        acc.apply("heatzone", payload);
        break;
      case "incident:created":
        acc.apply("incident", { ...payload, action: "created" });
        break;
      case "incident:cleared":
        acc.apply("incident", { ...payload, action: "cleared" });
        break;
      case "route:completed":
        acc.apply("route:completed", payload);
        break;
      default:
        break;
    }
  }
  return acc.toKeyframeState();
}

/** Sorts the collections in a KeyframeState so two folds compare structurally. */
function normalize(state: KeyframeState): KeyframeState {
  const byId = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
    String(a.id ?? a.vehicleId).localeCompare(String(b.id ?? b.vehicleId));
  return {
    vehicles: [...state.vehicles].sort((a, b) => a.id.localeCompare(b.id)),
    directions: [...state.directions].sort(byId),
    incidents: [...state.incidents].sort(byId),
    heatzones: state.heatzones,
  };
}

// ─── RecordingManager: writing keyframes ────────────────────────────

describe("RecordingManager keyframes", () => {
  it("writes keyframe lines at the configured recording-time cadence", () => {
    const filePath = tmpFile("cadence.ndjson");
    const rec = buildRecording(filePath, 300, KEYFRAME_MS);

    // 300 steps x 1000 ms = 300 s of recording time / 30 s cadence.
    expect(rec.keyframeCount).toBe(10);

    const keyframes = rec.lines.filter(
      (l) => l.type === "keyframe"
    ) as unknown as RecordingKeyframe[];
    expect(keyframes).toHaveLength(10);

    const timestamps = keyframes.map((k) => k.timestamp);
    expect(timestamps).toEqual([
      30_000, 60_000, 90_000, 120_000, 150_000, 180_000, 210_000, 240_000, 270_000, 300_000,
    ]);

    // Keyframes are interleaved in file order and never precede the first event.
    expect(rec.lines[0].type).not.toBe("keyframe");
  });

  it("does not write keyframes when the cadence is disabled", () => {
    const filePath = tmpFile("no-keyframes.ndjson");
    const rec = buildRecording(filePath, 300, 0);

    expect(rec.keyframeCount).toBe(0);
    expect(rec.lines.some((l) => l.type === "keyframe")).toBe(false);
  });

  it("does not count keyframes toward the recording's eventCount metadata", () => {
    const withKf = buildRecording(tmpFile("count-kf.ndjson"), 120, KEYFRAME_MS);
    const withoutKf = buildRecording(tmpFile("count-nokf.ndjson"), 120, 0);

    expect(withKf.keyframeCount).toBe(4);
    expect(withKf.eventCount).toBe(withoutKf.eventCount);
    // The extra lines on disk are exactly the keyframes.
    expect(withKf.lines.length - withoutKf.lines.length).toBe(withKf.keyframeCount);
  });

  it("captures the whole fleet in a keyframe, including vehicles dedup dropped", () => {
    // Live mode (dedup on), driven by fake timers so the recording clock is exact.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));

    const filePath = tmpFile("dedup-keyframe.ndjson");
    const rm = new RecordingManager({ keyframeIntervalMs: 1000 });
    rm.startRecording(defaultOptions, 2, filePath);

    const parked = makeVehicle("v-parked", 45.6, -73.6);
    rm.captureVehicleSnapshot([makeVehicle("v-moving", 45.5, -73.5), parked]);

    vi.advanceTimersByTime(1500);
    // v-parked has not moved: dedup keeps it out of the event line entirely.
    rm.captureVehicleSnapshot([makeVehicle("v-moving", 45.51, -73.5), parked]);
    rm.stopRecording();

    const lines = fs
      .readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    const events = lines.filter((l) => l.type !== "keyframe") as unknown as RecordingEvent[];
    const keyframes = lines.filter((l) => l.type === "keyframe") as unknown as RecordingKeyframe[];

    // The second event line carries only the vehicle that moved...
    const second = events[1].data as { vehicles: { id: string }[] };
    expect(second.vehicles.map((v) => v.id)).toEqual(["v-moving"]);

    // ...but the keyframe still describes the entire fleet.
    expect(keyframes).toHaveLength(1);
    const ids = keyframes[0].state.vehicles.map((v) => v.id).sort();
    expect(ids).toEqual(["v-moving", "v-parked"]);
    const moving = keyframes[0].state.vehicles.find((v) => v.id === "v-moving");
    expect(moving?.position).toEqual([45.51, -73.5]);
  });

  it("keyframe state carries active incidents, latest heatzones and live directions", () => {
    const filePath = tmpFile("state-contents.ndjson");
    const rec = buildRecording(filePath, 120, KEYFRAME_MS);
    const keyframes = rec.lines.filter(
      (l) => l.type === "keyframe"
    ) as unknown as RecordingKeyframe[];

    // Keyframe at t=120 000 (step 120), well past every discrete event above.
    const last = keyframes[keyframes.length - 1];
    expect(last.timestamp).toBe(120_000);

    // Incident created at step 3 and never cleared survives; the one cleared at
    // step 6 does not.
    expect(last.state.incidents.map((i) => i.id)).toEqual(["inc-early"]);

    // Only the most recent heatzone payload is retained (step 111 = 3 x 37).
    expect(last.state.heatzones).toEqual({ zones: [{ id: "hz-111", intensity: 1.11 }] });

    // v-slow's direction was dropped by route:completed at step 55.
    expect(last.state.directions.map((d) => d.vehicleId)).toEqual(["v-moving"]);
    // A keyframe reflects state at its exact line position: it is written right
    // after the vehicle batch that crossed the cadence, so the direction event
    // emitted later in the same step (route-120) is not in it yet.
    expect((last.state.directions[0].route as { id: string }).id).toBe("route-110");

    // Full fleet, including the vehicle that never moves.
    expect(last.state.vehicles.map((v) => v.id).sort()).toEqual(["v-moving", "v-parked", "v-slow"]);
  });
});

// ─── ReplayManager: keyframe-accelerated seeking ────────────────────

describe("ReplayManager seek with keyframes", () => {
  let rp: ReplayManager;

  beforeEach(() => {
    rp = new ReplayManager();
  });

  afterEach(() => {
    rp.stopReplay();
  });

  it("indexes keyframes out of the event stream at load time", async () => {
    const rec = buildRecording(tmpFile("load.ndjson"), 120, KEYFRAME_MS);
    await rp.loadRecording(rec.filePath);

    expect(rp.getKeyframeCount()).toBe(4);
    // Duration is derived from events only — keyframes must not shift it.
    expect(rp.getStatus().duration).toBe(
      rec.events[rec.events.length - 1].timestamp - rec.events[0].timestamp
    );
  });

  it("seeking late rolls forward only the events since the last keyframe", async () => {
    const rec = buildRecording(tmpFile("bounded.ndjson"), 300, KEYFRAME_MS);
    await rp.loadRecording(rec.filePath);

    const first = rec.events[0].timestamp;
    const last = rec.events[rec.events.length - 1].timestamp;
    rp.seekTo(last - first);

    const stats = rp.getSeekStats();
    expect(stats.usedKeyframe).toBe(true);
    // The seek target is near the end of a ~340-event recording, yet the fold
    // only touched the tail after the last keyframe.
    expect(stats.eventsRolledForward).toBeLessThan(rec.events.length / 4);
    expect(stats.startIndex).toBeGreaterThan(0);
  });

  it("seek cost is flat in session length (O(1)), while the fallback is linear", async () => {
    // Identical event rate and keyframe cadence at 1x, 4x and 16x the session
    // length. If seeking were O(session) the work would grow with it.
    const LENGTHS = [150, 600, 2400];

    async function seekToEnd(file: string, events: RecordingEvent[]): Promise<number> {
      const manager = new ReplayManager();
      await manager.loadRecording(file);
      const first = events[0].timestamp;
      const lastTs = events[events.length - 1].timestamp;
      manager.seekTo(lastTs - first);
      const rolled = manager.getSeekStats().eventsRolledForward;
      manager.stopReplay();
      return rolled;
    }

    const totals: number[] = [];
    const withKeyframes: number[] = [];
    const withoutKeyframes: number[] = [];

    for (const steps of LENGTHS) {
      const rec = buildRecording(tmpFile(`olen-${steps}.ndjson`), steps, KEYFRAME_MS);
      const legacyPath = tmpFile(`olen-${steps}-legacy.ndjson`);
      stripKeyframes(rec.filePath, legacyPath);

      totals.push(rec.events.length);
      withKeyframes.push(await seekToEnd(rec.filePath, rec.events));
      withoutKeyframes.push(await seekToEnd(legacyPath, rec.events));
    }

    // Sanity: the sessions really do grow ~4x each step.
    expect(totals[1] / totals[0]).toBeGreaterThan(3.5);
    expect(totals[2] / totals[1]).toBeGreaterThan(3.5);
    expect(totals[2]).toBeGreaterThan(2000);

    // A keyframe interval holds 30 vehicle batches plus a handful of discrete
    // events. This bound is a function of cadence x event rate only — it has no
    // term for how long the recording ran.
    const PER_INTERVAL_BOUND = 45;
    for (const rolled of withKeyframes) {
      expect(rolled).toBeLessThan(PER_INTERVAL_BOUND);
    }

    // Flat: 16x the session buys at most a rounding-level difference in work.
    expect(Math.max(...withKeyframes) - Math.min(...withKeyframes)).toBeLessThanOrEqual(2);

    // The fallback, by contrast, scans every earlier event — strictly linear.
    // (A few events share the final timestamp, so the fold stops a hair short
    // of the total; the point is that it tracks the total, not the cadence.)
    for (let i = 0; i < LENGTHS.length; i++) {
      expect(totals[i] - withoutKeyframes[i]).toBeLessThan(5);
    }
    expect(withoutKeyframes[2] / withoutKeyframes[0]).toBeGreaterThan(3.5 * 3.5);
    expect(withKeyframes[2]).toBeLessThan(withoutKeyframes[2] / 40);
  });

  it("state after a keyframe seek is identical to the same seek without keyframes", async () => {
    const rec = buildRecording(tmpFile("equiv.ndjson"), 240, KEYFRAME_MS);
    const legacyPath = tmpFile("equiv-legacy.ndjson");
    stripKeyframes(rec.filePath, legacyPath);

    // Land strictly between two event timestamps so no boundary ambiguity.
    const first = rec.events[0].timestamp;
    const targetOffset = 200 * STEP_MS + 500 - first;

    const withKf = new ReplayManager();
    const kfCaptured = capture(withKf);
    await withKf.loadRecording(rec.filePath);
    withKf.seekTo(targetOffset);
    const kfStats = withKf.getSeekStats();
    withKf.stopReplay();

    const legacy = new ReplayManager();
    const legacyCaptured = capture(legacy);
    await legacy.loadRecording(legacyPath);
    legacy.seekTo(targetOffset);
    const legacyStats = legacy.getSeekStats();
    legacy.stopReplay();

    expect(kfStats.usedKeyframe).toBe(true);
    expect(legacyStats.usedKeyframe).toBe(false);
    expect(legacyStats.eventsRolledForward).toBeGreaterThan(kfStats.eventsRolledForward * 5);
    // Both land on the same playback position.
    expect(kfStats.targetIndex).toBe(legacyStats.targetIndex);

    // The property that matters: the emitted state is byte-for-byte the same.
    expect(normalize(foldChannels(kfCaptured))).toEqual(normalize(foldChannels(legacyCaptured)));
    expect(kfCaptured).toEqual(legacyCaptured);
  });

  it("state after a keyframe seek matches playing the recording forward to that point", async () => {
    vi.useFakeTimers();

    const rec = buildRecording(tmpFile("forward.ndjson"), 120, KEYFRAME_MS);
    const first = rec.events[0].timestamp;
    const targetAbs = 100 * STEP_MS + 500;
    const targetOffset = targetAbs - first;

    // Ground truth: play from the start at 1x and stop at the target.
    const forward = new ReplayManager();
    const forwardCaptured = capture(forward);
    await forward.loadRecording(rec.filePath);
    forward.startReplay(1);
    vi.advanceTimersByTime(targetOffset);
    forward.pauseReplay();
    const forwardIndex = forward.getSeekStats(); // untouched by playback
    forward.stopReplay();

    expect(forwardIndex.eventsRolledForward).toBe(0); // no seek happened
    expect(forwardCaptured.length).toBeGreaterThan(100);

    // Keyframe seek to the same instant.
    const seeked = new ReplayManager();
    const seekCaptured = capture(seeked);
    await seeked.loadRecording(rec.filePath);
    seeked.seekTo(targetOffset);
    expect(seeked.getSeekStats().usedKeyframe).toBe(true);
    seeked.stopReplay();

    expect(normalize(foldChannels(seekCaptured))).toEqual(normalize(foldChannels(forwardCaptured)));

    vi.useRealTimers();
  });

  it("restores state a naive index jump would lose (parked vehicles, old incidents)", async () => {
    const rec = buildRecording(tmpFile("restore.ndjson"), 240, KEYFRAME_MS);
    const captured = capture(rp);
    await rp.loadRecording(rec.filePath);

    rp.seekTo(200 * STEP_MS + 500 - rec.events[0].timestamp);
    const state = foldChannels(captured);

    // The parked vehicle has no event line anywhere near the seek target.
    expect(state.vehicles.map((v) => v.id).sort()).toEqual(["v-moving", "v-parked", "v-slow"]);
    // The incident was created at step 3, ~200 steps earlier.
    expect(state.incidents.map((i) => i.id)).toEqual(["inc-early"]);
    // Heatzones and directions are present too.
    expect(state.heatzones).not.toBeNull();
    expect(state.directions.map((d) => d.vehicleId)).toEqual(["v-moving"]);
  });

  it("keyframe lines are never emitted during normal forward playback", async () => {
    vi.useFakeTimers();

    const rec = buildRecording(tmpFile("no-leak.ndjson"), 90, KEYFRAME_MS);
    const legacyPath = tmpFile("no-leak-legacy.ndjson");
    stripKeyframes(rec.filePath, legacyPath);

    async function playAll(file: string): Promise<Captured[]> {
      const manager = new ReplayManager();
      const captured = capture(manager);
      await manager.loadRecording(file);
      manager.startReplay(1);
      vi.advanceTimersByTime(200_000);
      manager.stopReplay();
      return captured;
    }

    const withKf = await playAll(rec.filePath);
    const legacy = await playAll(legacyPath);

    expect(withKf).toEqual(legacy);
    expect(withKf.every((c) => c.channel !== "keyframe")).toBe(true);

    vi.useRealTimers();
  });
});

// ─── Backward compatibility with pre-keyframe recordings ────────────

describe("ReplayManager backward compatibility (keyframe-less recordings)", () => {
  let rp: ReplayManager;

  beforeEach(() => {
    rp = new ReplayManager();
  });

  afterEach(() => {
    rp.stopReplay();
  });

  /**
   * A hand-written fixture in the exact pre-keyframe on-disk format: header
   * line plus plain RecordingEvent lines, nothing else. This is what every
   * recording produced before this change looks like.
   */
  function writeLegacyFixture(filePath: string): RecordingEvent[] {
    const header: RecordingHeader = {
      format: "moveet-recording",
      version: 1,
      startTime: SIM_START.toISOString(),
      vehicleCount: 2,
      options: defaultOptions,
    };
    const events: RecordingEvent[] = [
      {
        timestamp: 100,
        type: "vehicle",
        data: {
          vehicles: [
            { id: "v1", position: [1, 36], speed: 10, heading: 0, edgeId: "" },
            { id: "v2", position: [2, 36], speed: 20, heading: 90, edgeId: "" },
          ],
        },
      },
      {
        timestamp: 200,
        type: "incident",
        data: { action: "created", id: "legacy-inc", type: "closure", edgeIds: ["e9"] },
      },
      { timestamp: 300, type: "heatzone", data: { zones: [{ id: "legacy-hz" }] } },
      { timestamp: 400, type: "direction", data: { vehicleId: "v1", route: { id: "legacy-r" } } },
      {
        timestamp: 500,
        type: "vehicle",
        // v2 is absent from here on: exactly the dedup gap keyframes exist to close.
        data: { vehicles: [{ id: "v1", position: [1.5, 36], speed: 12, heading: 5, edgeId: "" }] },
      },
      { timestamp: 600, type: "waypoint", data: { vehicleId: "v1", remaining: 2 } },
      {
        timestamp: 700,
        type: "incident",
        data: { action: "cleared", id: "legacy-inc", reason: "x" },
      },
      {
        timestamp: 800,
        type: "vehicle",
        data: { vehicles: [{ id: "v1", position: [1.9, 36], speed: 14, heading: 7, edgeId: "" }] },
      },
    ];
    fs.writeFileSync(
      filePath,
      [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join("\n") + "\n"
    );
    return events;
  }

  it("loads a pre-keyframe fixture and reports zero keyframes", async () => {
    const filePath = tmpFile("legacy-fixture.ndjson");
    const events = writeLegacyFixture(filePath);

    const header = await rp.loadRecording(filePath);
    expect(header.format).toBe("moveet-recording");
    expect(rp.getKeyframeCount()).toBe(0);
    expect(rp.getStatus().duration).toBe(events[events.length - 1].timestamp - events[0].timestamp);
  });

  it("replays a pre-keyframe fixture forward, unchanged", async () => {
    vi.useFakeTimers();

    const filePath = tmpFile("legacy-forward.ndjson");
    writeLegacyFixture(filePath);
    const captured = capture(rp);

    await rp.loadRecording(filePath);
    rp.startReplay(1);
    vi.advanceTimersByTime(1000);

    expect(captured.map((c) => c.channel)).toEqual([
      "vehicle",
      "incident:created",
      "heatzones",
      "direction",
      "vehicle",
      "waypoint:reached",
      "incident:cleared",
      "vehicle",
    ]);
    expect(rp.getStatus().progress).toBe(1);

    vi.useRealTimers();
  });

  it("falls back to folding from the start when seeking a pre-keyframe fixture", async () => {
    const filePath = tmpFile("legacy-seek.ndjson");
    writeLegacyFixture(filePath);
    const captured = capture(rp);

    await rp.loadRecording(filePath);
    // Offsets are relative to the first event (t=100), so 550 lands at t=650.
    rp.seekTo(550);

    const stats = rp.getSeekStats();
    expect(stats.usedKeyframe).toBe(false);
    expect(stats.keyframeIndex).toBe(-1);
    expect(stats.startIndex).toBe(0);
    // Folded every event before t=650: the six lines at 100..600.
    expect(stats.targetIndex).toBe(6);
    expect(stats.eventsRolledForward).toBe(6);

    const state = foldChannels(captured);
    // v2's only line was at t=100 — the fallback still recovers it.
    expect(state.vehicles.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
    expect(state.vehicles.find((v) => v.id === "v1")?.position).toEqual([1.5, 36]);
    // The incident was still open at t=650 (cleared at t=700).
    expect(state.incidents.map((i) => i.id)).toEqual(["legacy-inc"]);
    expect(state.heatzones).toEqual({ zones: [{ id: "legacy-hz" }] });
    expect(state.directions.map((d) => d.vehicleId)).toEqual(["v1"]);
  });

  it("seeks past a clear-event correctly on a pre-keyframe fixture", async () => {
    const filePath = tmpFile("legacy-seek-late.ndjson");
    writeLegacyFixture(filePath);
    const captured = capture(rp);

    await rp.loadRecording(filePath);
    rp.seekTo(750); // t=850, past the incident clear at t=700

    const state = foldChannels(captured);
    expect(state.incidents).toEqual([]);
    expect(state.vehicles.find((v) => v.id === "v1")?.position).toEqual([1.9, 36]);
    expect(state.vehicles.find((v) => v.id === "v2")?.position).toEqual([2, 36]);
  });

  it("seeking to the start of a pre-keyframe fixture emits nothing", async () => {
    const filePath = tmpFile("legacy-seek-zero.ndjson");
    writeLegacyFixture(filePath);
    const captured = capture(rp);

    await rp.loadRecording(filePath);
    rp.seekTo(0);

    expect(rp.getSeekStats().eventsRolledForward).toBe(0);
    expect(captured).toHaveLength(0);
  });
});
