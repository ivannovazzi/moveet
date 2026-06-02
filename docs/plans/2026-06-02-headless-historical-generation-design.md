# Headless Historical Data Generation — Design

**Date:** 2026-06-02
**Status:** Approved, implementing
**Branch:** `feat/headless-historical-generation`

## Problem

We need to generate large quantities of historical moving-vehicle telemetry on real
road networks — e.g. a week of data — without waiting a week of wall-clock time, and
emit it through the **existing sinks** (Redpanda/Kafka + realism engine) with the
**simulation timestamps**, not `Date.now()`.

## Key Insight

The pipeline is **delta-time driven and clock-injectable end to end**. Wall-clock only
enters at three edges:

| Edge                 | File                                              | Coupling                            | Fix                                                    |
| -------------------- | ------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Sim tick driver      | `apps/simulator` `GameLoop.gameLoopTick()`        | `setInterval` + `Date.now()` deltas | Bypass with a fixed-`dt` loop                          |
| Recording timestamps | `apps/simulator` `RecordingManager.recordEvent()` | `Date.now() - startTime`            | Stamp absolute sim time                                |
| Realism emission     | `apps/adapter` `RealismEngine`                    | `setInterval(tickMs=250)`           | `deps.now` already injectable; drive `tick()` manually |

Everything else already takes time as a parameter (`SimulationClock.tick(dt)`,
`VehicleManager.updateVehicle(v, dt)`) or an injected `now` (`RealismEngine`). The
`RealismEngine` also takes a seedable RNG (`mulberry32(seed)`) → deterministic,
reproducible output. Confirmed: `RealismEngine.buildSample` stamps `timestamp: t` where
`t = this.now()`, and its GPS noise / Markov connectivity / `scheduleNext` are all
`this.now()`-driven — so injecting `now` makes the entire noise+cadence model run in
sim time, not just the label.

## Architecture — Two Phase

```
PHASE 1 (apps/simulator) — "generate truth", CPU-bound, runs as fast as CPU allows
  HeadlessRunner: clock.setTime(start); for N steps { clock.tick(dt); advanceAll(dt) }
    → writes back-dated NDJSON (raw trajectories, no dedup)

         truth.ndjson   ◄── reusable artifact (simulate once, re-emit many)

PHASE 2 (apps/adapter) — "emit", reuses real sinks + realism, bounded by Kafka throughput
  ReplayEmitter: read NDJSON → inject now=()=>record.simTime, seeded rng
    → realism.ingest() + manual realism.tick() → existing sinks → Redpanda
```

One virtual clock per phase. Phase 1 produces ground truth once; Phase 2 re-emits it
through the real sinks as many times / configs as desired, with no re-simulation and no
wall-clock waiting.

## NDJSON Format Contract (shared between phases — DO NOT diverge)

Line 1 = header, subsequent lines = step records. One JSON object per line.

```jsonc
// header (line 1)
{
  "format": "moveet-headless-truth",
  "version": 1,
  "simStart": "2026-05-25T00:00:00.000Z",  // absolute ISO, historical
  "stepMs": 1000,                            // sim-ms advanced per step
  "vehicleCount": 250,
  "seed": 12345,                             // sim RNG seed (reproducibility)
  "network": "nairobi"                       // network identifier
}
// step record (one per step; ABSOLUTE sim time, NOT a relative offset)
{
  "simTime": "2026-05-25T08:14:03.000Z",
  "vehicles": [
    { "id": "v1", "position": [-1.2921, 36.8219], "speed": 42.1, "heading": 270, "ignition": true }
  ]
}
```

- `position` is `[lat, lon]` (matches `VehicleDTO.position`).
- `speed` is km/h (matches `VehicleDTO.speed`).
- **No position dedup** in this mode: every active vehicle emits every step so Phase 2
  retains cadence for idle-but-running vehicles.
- `simTime` is the single source of truth; it flows untouched into the emitted `ts`.

## Phase 1 — apps/simulator

**New:** `src/headless/HeadlessRunner.ts` + CLI `src/headless/generate.ts`
(wire into `package.json` as e.g. `npm run generate -- --hours=168 --vehicles=250 --start=2026-05-25T00:00:00Z --step=1000 --out=truth.ndjson`).

Runner responsibilities:

1. Build the real module graph (RoadNetwork, VehicleManager, clock) the way `index.ts` does.
2. Seed N synthetic vehicles (reuse the existing synthetic-vehicle creation path used by
   `setOptions`/startup — assign random routes/destinations so they actually move).
3. `clock.setTime(simStart)`.
4. Loop `steps = totalSimMs / stepMs` times: `clock.tick(stepMs)`; advance every active
   vehicle by `stepMs`; capture a step record stamped with `clock.getState().currentTime`.
5. Stream records to NDJSON (reuse buffered writer pattern from `RecordingManager`).

**Seam required:** add a public `VehicleManager.advance(deltaMs)` (or
`tickAll(deltaMs)`) that ticks the clock + updates all registered vehicles deterministically
— the headless equivalent of `GameLoop.gameLoopTick()` but with explicit `dt` and no
`Date.now()`. `updateVehicle` is currently private; this method is the clean public seam.
Do **not** start the `GameLoop` `setInterval` in headless mode.

**RecordingManager changes** (or a dedicated `TruthWriter` if cleaner — implementer's call,
but prefer extending RecordingManager with a raw mode to avoid duplication):

1. Raw-export mode: stamp `simTime` absolute ISO from an injected clock, not `Date.now() - startTime`.
2. Disable the `POSITION_DELTA_THRESHOLD` dedup in this mode.

**Wall-clock leak fixes (simulator side):**

- `IncidentManager` uses `Date.now()` for incident `startTime`/cleanup. In headless mode it
  must use the sim clock so any incident-related telemetry is back-dated consistently.
  Inject the clock (constructor dep) and fall back to `Date.now()` only when absent.
- `TrafficManager` already uses `clock.getHour()` with a `new Date()` fallback — verify the
  clock is wired in the headless path so the fallback never triggers.

## Phase 2 — apps/adapter

**New:** `src/replay/ReplayEmitter.ts` + CLI `src/replay/emit.ts`
(e.g. `npm run emit -- --in=truth.ndjson --realism=on --seed=12345`).

Emitter responsibilities (reuse the existing `PluginManager` + sinks + `RealismEngine`):

```ts
let virtual = firstRecord.simTime; // ms epoch
const engine = new RealismEngine({
  now: () => virtual, // sim time, never Date.now()
  rng: mulberry32(seed), // deterministic
  publish: (batch) => pluginManager.publishToSinks(batch), // real sinks
  config: realismConfig,
});
// IMPORTANT: do not let the auto-started setInterval run. Either add an
// `autoStart: false` option to RealismEngineDeps, or call engine.stop()
// immediately after construction. Then drive tick() manually.
for (const record of ndjson) {
  while (virtual < record.simTime) {
    // walk virtual time in realism-tick steps
    virtual = Math.min(virtual + REALISM_TICK_MS, record.simTime);
    await engine.tick(); // emits devices whose nextEmitAt ≤ virtual
  }
  virtual = record.simTime;
  await engine.ingest(record.vehicles.map(toVehicleUpdate)); // refresh true positions
}
await drain(); // final flush
```

- **Realism-disabled variant:** skip the engine; emit each record's vehicles as
  `VehicleUpdate`s with `timestamp = record.simTime` straight to `publishUpdates()`.
- **Timestamp correctness:** the emitted fix `timestamp` is the current `virtual` (sim time);
  it flows into `VehicleUpdate.timestamp` → the Redpanda sink's existing back-date path
  (`redpanda.ts` ~lines 296/357) → emitted `ts`. No field is ever stamped with `Date.now()`.
- **Backpressure:** `await` each `publish` — Phase 2's wall-clock cost is bounded by Kafka
  write throughput, not simulated duration.

**RealismEngine change:** add an `autoStart?: boolean` (default true) to `RealismEngineDeps`;
when false the constructor does not call `this.start()`. The unit tests already drive `tick()`
manually with injected `now`/`rng`, so this only formalizes the existing seam.

## Testing

- **Phase 1:** unit test `HeadlessRunner` produces a deterministic NDJSON (fixed seed →
  identical output); `simTime` is monotonic and starts at `simStart`; record count ==
  `totalSimMs/stepMs`; no dedup (every active vehicle present each step); no `setInterval`
  started. Test the new `VehicleManager.advance(dt)` seam.
- **Phase 2:** unit test `ReplayEmitter` against a small fixture NDJSON with a mock sink:
  every emitted message's `ts` equals a sim time from the file (never wall-clock);
  realism-on vs realism-off both back-date correctly; deterministic with fixed seed.
- Both apps' existing suites (`npm test`) must stay green; `npm run lint` clean.

## Out of Scope (YAGNI)

- UI changes — this is a data-generation tool.
- Resumable/checkpointed generation — a week generates in minutes; rerun if needed.
- Parquet/S3 output — Kafka via existing sinks is the target.
