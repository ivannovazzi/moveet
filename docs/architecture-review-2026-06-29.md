# Moveet Architecture Review

**Date:** 2026-06-29
**Scope:** Whole-system architecture (simulator, adapter, ui, network CLI, shared-types).
**Lens:** Performance, scaling, maintainability, testing, quality/resilience/operability.
**Method:** Four independent, read-only, evidence-grounded reviews (one per quality attribute), then synthesis. Tactical items already addressed by the 2026-06 polish/performance pass (epic `fleetsim-all-8adv`) are intentionally excluded; this document assesses the systemic, structural architecture only.

---

## Table of contents

1. [Overall verdict](#1-overall-verdict)
2. [Scorecard](#2-scorecard)
3. [The three systemic issues that matter](#3-the-three-systemic-issues-that-matter)
4. [Performance and scaling](#4-performance-and-scaling)
5. [Maintainability and structure](#5-maintainability-and-structure)
6. [Testing strategy](#6-testing-strategy)
7. [Resilience, quality and operability](#7-resilience-quality-and-operability)
8. [What is genuinely strong](#8-what-is-genuinely-strong)
9. [Prioritized roadmap](#9-prioritized-roadmap)
10. [Appendix: key evidence map](#10-appendix-key-evidence-map)

---

## 1. Overall verdict

Moveet is an **exceptionally well-built single-node system that has essentially no horizontal-scaling story and no enforced cross-service contract.** The day-to-day engineering craft is high: clean sub-manager decomposition, real WebSocket backpressure, fail-soft startup, exemplary graceful shutdown, schema-validated configuration with secret redaction, and a tested prototype-pollution guard. The weaknesses are not sloppiness; they are **structural and concentrated.**

The architecture is fundamentally one process, one game loop, one in-memory authoritative state, and a 22 MB road graph duplicated roughly six times across the main thread and worker pool. The contracts between the three runtime services (REST and WebSocket) are declared independently on each side with nothing enforcing agreement, so the most frequently changed seam in the system is the one the type system does not protect.

Net assessment: the system is production-ready as a fleet simulator and dev/test telemetry source. It is not ready for a role where it must scale beyond one large machine, survive instance loss without data loss, or act as a system of record.

---

## 2. Scorecard

| Dimension                 | Grade  | One-line                                                                          |
| ------------------------- | ------ | --------------------------------------------------------------------------------- |
| Performance (single-node) | **B+** | Hot paths are genuinely well-optimized; the ceiling is structural, not tactical.  |
| Scaling (horizontal)      | **D**  | No story by design: one process, one loop, in-memory state, graph duplicated ~6x. |
| Maintainability           | **B**  | Strong abstractions, but a few god objects plus an unenforced service contract.   |
| Testing                   | **B-** | Disciplined and broad, but no apex: no E2E, no contract tests, no load tests.     |
| Quality / Resilience      | **B**  | Excellent shutdown, config and redaction; blind to degradation (no metrics).      |

Grades reflect the architecture relative to the system's stated purpose (a fleet simulator and dev/test telemetry source), not relative to a globally distributed production platform.

---

## 3. The three systemic issues that matter

Everything else is secondary to these three. Two of them were flagged independently by more than one reviewer, which is a strong signal that they are real and structural rather than stylistic.

### Issue A: The cross-service contract is unenforced (highest priority)

The full discriminated union of ~30 WebSocket message variants (`WebSocketMessage`) lives **only** in the UI at `apps/ui/src/utils/wsTypes.ts:62-93`. The simulator produces every message through an untyped generic, `WebSocketBroadcaster.broadcast<T>(type: string, data: T)` (`apps/simulator/src/modules/WebSocketBroadcaster.ts:160`), called roughly 30 times with string literals across `apps/simulator/src/setup/eventWiring.ts:66-238`. There is no shared message type and no compile-time link between producer and consumer.

The REST contract has the same shape: the simulator declares ~55 routes as string literals across `apps/simulator/src/routes/*.ts`; the UI re-declares the same paths and asserts response types by hand across 55 calls in `apps/ui/src/utils/client.ts`. Inbound request bodies are zod-validated server-side, but outbound responses are emitted with bare `res.json(...)` and the UI's response type is an unchecked `<T>` assertion.

Consequence: a renamed message type, a dropped field, or a changed payload shape **compiles cleanly on both sides and fails no test.** It surfaces only as a runtime no-op in the browser. The single most frequently changed seam in the system is the one with the least protection. The docs already contain a live instance of this drift: the UI CLAUDE.md references a `"vehicle"` message type while the code emits `"vehicles"`.

This issue spans three of the five dimensions: it is the top maintainability risk (silent breakage on the hot seam), the top testing gap (the services can drift independently with green CI), and a quality gap (the WS payload is shallow-validated, so a version-skewed `VehicleDTO` reaches the GL layer and can render NaN positions).

**Highest-leverage fix:** lift the WebSocket message union and the REST request/response schemas into `@moveet/shared-types`, type `broadcast()` against the union (`broadcast<K extends Msg["type"]>(type: K, data: Extract<Msg,{type:K}>["data"])`), and validate on both ends. The union already exists; it is simply in the wrong package. This is a low-effort, high-impact change that removes an entire bug class by construction.

### Issue B: Single-node, in-memory, single-loop architecture

The simulator is a single Node process. `apps/simulator/src/index.ts` is a bare `app.listen` with no clustering, no sharding, and no sticky-session layer. All mutable state lives in plain JavaScript `Map`s owned by one process: vehicles plus edge spatial index in `VehicleRegistry`, routes in `RouteManager`, the active-vehicle set in `GameLoop`, analytics in `AnalyticsAccumulator`. The whole simulation is driven by one `setInterval` (`GameLoop.ts:74`) that iterates every active vehicle inline; all physics, analytics, serialization, and event emission for every vehicle happen synchronously on the main event loop every tick.

This single fact produces three distinct problems:

- **Scaling ceiling.** Vertical-only into the low thousands of vehicles and dozens-to-low-hundreds of clients on a large machine, after which the tick-time wall (CPU) and the multi-copy-graph wall (RAM) are reached at roughly the same time. Horizontal scaling is structurally impossible without a rewrite, because car-following (`RouteManager.findVehicleAhead`) and congestion (`TrafficManager`) require all vehicles on an edge to be co-resident in one process.

- **Single point of failure with lossy recovery.** Persistence is optional (`PERSISTENCE_ENABLED`, default false) and, critically, snapshots only static definitions (fleets, geofences, incidents) and **not vehicle motion state** (`PersistenceManager.ts:197-228`). A restart loses all in-flight vehicle movement even with persistence enabled.

- **A self-inflicted CPU tax.** The WebSocket fan-out cost is `clients x vehicles`, re-serialized per client (`WebSocketBroadcaster.flush`, `WebSocketBroadcaster.ts:295-356`), on the same thread as the simulation. Client count therefore directly steals CPU from the simulation loop.

**Highest-leverage fix for scale:** extract the broadcaster onto a pub/sub bus (Redis or NATS) as a separately-scalable subscriber tier. Its backpressure, delta, and bbox-filter logic are already well-built; moving it off the simulation thread removes `clients x vehicles` work from the loop, lets client count scale independently, and is the necessary first step toward later regional sharding of the simulator itself.

A cheaper, complementary memory win: the 22 MB GeoJSON network is parsed and retained on the main thread (`RoadNetwork.ts:143`) and independently re-parsed in each of up to four workers (`PathfindingPool.ts:84-86`), giving roughly six full copies in RAM. Build the graph once into a `SharedArrayBuffer` and release the raw FeatureCollection after build.

### Issue C: Debuggable on crash, blind to degradation

There are **no metrics anywhere** in the system: no `prom-client` or OpenTelemetry, no `/metrics` endpoint, no sink success/drop counters, no WebSocket client gauge, and no latency histograms across any of the four apps. Correlation IDs are generated on both the simulator and the adapter but are wired through neither hop: the simulator's adapter HTTP client (`Adapter.ts:27-54`) never forwards `x-request-id`, and the canonical telemetry envelope hardcodes `correlation_id: null` / `trace_id: null` (`redpanda.ts:732`) even though the schema is built to carry them.

Consequence: an operator can diagnose a crash (good structured logs, an error boundary, persisted UI snapshots) but cannot see a degradation. The at-most-once delivery drops and the single-point-of-failure stalls are invisible until a user complains. Drop counts live only in a 200/202 response body, not in any metric.

**Highest-leverage fix:** add a metrics layer (for example `prom-client` plus `/metrics`) exposing sink success/drop/failure counters, sync latency, WebSocket client count, and reconnect events; and thread `x-request-id` from the simulator's adapter client through the adapter and into the telemetry envelope's existing correlation fields. This is low-risk, touches few files, and is the prerequisite for safely operating every other gap.

---

## 4. Performance and scaling

**Dimension verdict:** an exceptionally well-built single-node simulator whose hot paths were tactically optimized to a genuinely high standard, sitting on an architecture that scales only vertically and whose memory scales with map size rather than with load. The asked benchmark of 100 vehicles x 50 clients x 2 Hz does not come close to stressing it; the real walls appear in the low thousands of vehicles and dozens-to-low-hundreds of clients.

### Scaling model

- **Single process, single loop, single authoritative state (Critical).** See Issue B. No horizontal story; vertical ceiling is one core's worth of synchronous tick work. Evidence: `index.ts:156` (bare `app.listen`), `GameLoop.ts:74` (single `setInterval`), `GameLoop.ts:115-147` (inline per-vehicle iteration), state ownership in `VehicleRegistry.ts:14-18`, `RouteManager.ts:26-38`, `GameLoop.ts:36-42`, `AnalyticsAccumulator.ts:12-18`. The clock-delta clamp at `GameLoop.ts:109-112` is the canary: when the tick body exceeds the interval it begins firing and motion gets choppy.

### Memory model

- **Graph duplicated N+1 times, plus a retained 22 MB blob (High).** Main thread parses and keeps the parsed FeatureCollection forever (`RoadNetwork.ts:143`, retained because lazy getters re-scan `this.data.features`), plus the built graph (nodes, edges, roads, connectedEdges, edgeBaseCost, spatial grid, sector indices). Each worker re-parses the same 22 MB file and rebuilds its own graph (`PathfindingPool.ts:84-86`), pool size `min(cpus, 4)` (`PathfindingPool.ts:68`). Result: roughly 1 main graph + 1 retained blob + 4 worker graphs. This is the dominant memory cost and scales with graph size, not vehicle count. Fix: release `this.data` after build; back the worker graph with a `SharedArrayBuffer`.
- **Growth is otherwise mostly bounded, with named exceptions (Low/Medium).** Bounded: per-vehicle visited-edges (`CircularBuffer`, `MAX_VISITED_EDGES: 1000`), `analytics_history` pruned to 7 days, snapshots capped at 50, recording NDJSON flushed in 1000-line batches, broadcaster spatial index cleared on reset. Leak: `AnalyticsAccumulator` maps (`stats`, `prevPositions`, `speedSamples`) are cleared only on reset, never on individual vehicle removal (`AnalyticsAccumulator.ts:200-204`); long runs with id churn leak per retired id.

### Real-time fan-out

- **Fan-out is O(clients x vehicles), re-serialized per client (Medium).** `WebSocketBroadcaster.flush` loops every client and does a per-client delta filter plus a fresh `JSON.stringify` (`WebSocketBroadcaster.ts:295-356`). At 100 x 50 x 2 Hz this is trivial (the flush runs at 10 Hz and does roughly 5,000 delta checks plus up to 50 small stringifies per 100 ms window). It becomes a wall at, for example, 2,000 vehicles x 200 clients (400k comparisons plus 200 large stringifies per 100 ms), on the same thread as the game loop. Fix: serialize once per distinct filter bucket; move the broadcaster off the simulation thread (Issue B).

### CPU hot paths

- **Per-tick per-vehicle work plus per-vehicle serialize-and-emit is the first wall (High).** Each vehicle runs `updateSpeed` (with `peekNextEdge`, `findVehicleAhead`, congestion, heat-zone checks, trig) then `serializeVehicle` and `emit("update", ...)` once per vehicle (`GameLoop.ts:128-136`), and each emit synchronously runs the `eventWiring.ts:58-62` handler (queue update, spatial index update, recording capture, batch set). The structure is "do everything for every vehicle, inline, every tick."
- **Pathfinding throughput hard-capped at 4 workers, with bursty demand (High).** Pool size `min(cpus, 4)` (`PathfindingPool.ts:68`), pending queue capped at 1,000 then rejected (`PathfindingPool.ts:144-150`). Demand spikes structurally: every idle vehicle re-requests a route every 3 s (`RouteManager.PATHFIND_COOLDOWN`), and `handleIncidentCreated` reroutes every overlapping vehicle at once (`RouteManager.ts:591-635`). A mass-reroute can fill the queue and start rejecting (caught and logged, vehicle keeps its old route, so reroutes silently do not happen under load). Fix: drop the pool cap to scale with cores; debounce and stagger incident reroutes.
- **`findVehicleAhead` is O(vehicles-on-edge) (Low/Medium).** On a jammed edge this trends toward O(k^2) per edge per tick, degrading exactly when traffic is heaviest. Mitigated by the edge-to-vehicles index keeping it O(on-edge) rather than O(all).

### UI rendering

- **The road-network layer has no viewport culling or LOD (High).** `useRoadLayers` (`DeckGLMap.tsx:29-83`) binds the full feature arrays as `PathLayer.data` with no viewport slicing; on a large network (a Cairo network is reported around 160k features) this saturates GPU/CPU on pan and zoom regardless of vehicle count. Mitigated: geometry uploads once and only color re-evaluates via `updateTriggers`. Fix: tile or LOD the road layer by zoom; this is the single biggest UI win for large cities.
- **The vehicle hot path is correctly kept out of React (mostly good).** WS updates land in an external `vehicleStore`; a RAF loop interpolates and updates only position/angle GPU attributes; React state is throttled to ~30 Hz and skipped when nothing visual changed (`VehiclesLayer.tsx:344-350`); vehicle viewport culling with a 25% margin is implemented. Residual cost is the O(N) interpolation loop per frame, visible around 800+ vehicles.

Correction worth recording: `docs/performance-analysis.md` is a pre-fix document. Its "SVG line per segment" breadcrumb claim and its "O(n^2) POI dedup" claim are stale; current POI handling is a single O(n) `.filter` gated on `!isZooming` (`POIs.tsx:73`). Treat that document's specific numbers as directional history, not current state.

### Adapter throughput

- **Batched and pooled, but sequential Redpanda chunking and stateful single-process (Medium).** `POST /sync` passes the whole batch to each sink via `Promise.allSettled` (S operations for S sinks, not N x S), all sinks reuse a single client/producer. The Redpanda sink sends chunks sequentially with abort-on-first-failure to preserve ordering, so one slow or failed chunk stalls or drops the remainder. Realism device state is in-process heap (`RealismEngine.ts`), so the adapter cannot scale horizontally without state loss. Fix: parallelize Redpanda chunks or raise `batchSize`; externalize realism device state for active-active.

### Data and IO

- **Snapshot serialization is chunked off the burst, but recording writes are synchronous on the main thread (Medium).** Auto-save uses `saveNowChunked` with `setImmediate` yields (`PersistenceManager.ts:120-127, 177-193`); SQLite uses WAL plus prepared statements. But when recording, `captureVehicleSnapshot([data])` runs per vehicle per tick (`eventWiring.ts:60`) with synchronous `fs.writeSync` flushes (`RecordingManager.ts:325`). Fix: batch recording capture once per flush; move NDJSON writes to async IO.

**Single highest-leverage change for scale:** extract the WebSocket fan-out into its own tier fed by a pub/sub bus (Issue B).

---

## 5. Maintainability and structure

**Dimension verdict:** an above-average, conscientiously-built codebase that is meaningfully more maintainable than its size suggests. The drag is concentrated and structural rather than pervasive: a handful of god objects, and (most importantly) cross-service contracts declared independently on each side. Low day-to-day risk for in-app changes; elevated risk for any change that crosses a service boundary.

### God objects

- **`RoadNetwork.ts` (1055 lines) is a severe god object (High).** One `EventEmitter` subclass mixes graph building, spatial indexing, A\* pathfinding, worker-pool lifecycle, POI extraction, speed-limit extraction, incident cost management, an LRU route cache, and name search. Any change to graph representation, incident handling, or POI logic forces reasoning about the whole surface. Fix: extract `GraphBuilder`, `SpatialIndex`, `PathfindingEngine`, and `NetworkData` collaborators; `RoadNetwork` becomes a thin facade.
- **`redpanda.ts` sink (962 lines) folds 9 concerns into one file (Medium).** Config parsing, Kafka and Schema-Registry connection, a generic payload-template engine, per-message context building, fan-out, batching/chunking, AVRO encoding, and health-check-with-timeout. Several pieces (templating, context, chunking, fan-out) are sink-generic but live only here while the GraphQL/REST sinks re-implement their own batching. Fix: lift the generic pieces into shared `plugins/format/*` utilities.
- **Oversized UI components (Medium).** `GeofenceDrawTool.tsx` (511 lines) mixes DOM event handling, geometry/hit-testing, and layer construction; `client.ts` is 676 lines. `VehiclesLayer.tsx` (514 lines) is large but the RAF-closure coupling makes its size more defensible.
- **Genuinely good and worth keeping:** `App.tsx` (387 lines) looks like a god component but is a clean orchestrator (one `useState`, 20 delegated hooks). `SimulationController.ts` and `eventWiring.ts` are thin wiring layers with no embedded domain logic.

### Cross-service coupling (the biggest systemic issue here)

- **WS protocol typed on the UI side only; simulator emits it untyped (High).** See Issue A.
- **REST contract string-matched independently on both ends (Medium/High).** See Issue A.
- **`shared-types` is types-only; runtime infra is duplicated per app (Medium).** Both services re-implement `errorHandler` middleware (with divergent names and logger wiring), `correlationId` middleware, and near-identical `logger.ts` pino setups that have already drifted (the simulator validates `LOG_LEVEL` through zod and lacks secret redaction; the adapter reads `process.env.LOG_LEVEL` raw but adds `redact: [...]`). An HTTP-client-with-retries exists in both the adapter and the UI. Fix: add a `@moveet/server-kit` package for shared middleware, the logger factory, and the retrying HTTP client.

### Duplication

- **A\* cost, heap, and OSM graph-build are hand-duplicated in the pathfinding worker (Medium, mitigated).** The main thread extracts `pathfinding/cost.ts` and `heap.ts`; the worker (`pathfinding-worker.ts`, 534 lines) re-implements all of it plus the OSM parser by hand. This is a known, documented, test-locked duplication (the worker is launched as a raw entry file under plain Node, which cannot resolve the extensionless ESM imports the rest of the codebase uses). Fix: pre-bundle the shared modules into the worker at build time (an esbuild `.cjs` worker entry) to eliminate the copies while keeping it self-contained.
- **Good:** the dot-path resolver is not duplicated (single guarded `getNestedValue` in `plugins/utils.ts`); per-app `types/index.ts` re-export from `shared-types` rather than redefining.

### Configuration, state, abstractions

- **Config and conventions are mostly consistent.** Both services centralize env parsing in one zod schema with fail-loud `safeParse`; no scattered `process.env` access by design. The divergences are the logger/errorHandler drift noted above.
- **Module-level singletons with init-order coupling (Medium).** The simulator instantiates managers as module-level singletons (`index.ts:57-70`) with `persistenceManager`/`stateStore` as mutable `let` conditionally initialized later, guarded by `if (stateStore)` checks in `eventWiring.ts`. Convenient and testable enough (constructor-injected), but the let-then-maybe-init pattern is easy to get wrong.
- **UI state fragmented across three mechanisms (Medium).** Seven React Contexts, module-singleton external stores (`vehicleStore`, `analyticsStore`), and 20+ domain hooks. This is a pragmatic split (Context for slow read-mostly data, a direct-read store for the 30 fps vehicle hot path) rather than a mistake, but there is no single source of truth and the empty `src/store/` directory is a misleading breadcrumb.
- **Clean abstractions worth keeping:** the adapter plugin system (`DataSource`/`DataSink` plus facade/registry/publisher/health-aggregator) and the deck.gl layer registry (`useRegisterLayers`, microtask-coalesced, z-sorted).
- **Directory hazard (Low/Medium):** `apps/ui/src/Map/` (feature layers) and `apps/ui/src/components/Map/` (the DeckGLMap host plus a second context system) coexist, with hooks scattered across three locations. Intentional (lazy GL vendor chunk) but undocumented at the directory level.

**Single highest-leverage structural change:** move the WebSocket message union and REST schemas into `@moveet/shared-types` and derive both producer and consumer from them (Issue A).

---

## 6. Testing strategy

**Dimension verdict:** above-average for a project this size and unusually disciplined in spots most teams skip, but the suite is broad-but-flat and bottom-heavy. It is a large unit plus in-process-HTTP base with no apex. The three boundaries that define the system (REST, WebSocket, AVRO) are each verified only against hand-rolled mocks on one side, so the services can drift independently; rendering correctness and real-time performance, the two things a fleet-simulation product is judged on, are structurally outside what the tests can see.

### Findings

- **No top to the pyramid: zero cross-service E2E (High).** No Playwright/Cypress/Puppeteer anywhere. The one "integration" test explicitly sets `config.adapterURL = ""` to keep the adapter out. No test boots simulator plus adapter plus ui together. Any break that lives between services passes CI green. Fix: one thin black-box smoke E2E (docker-compose up of the GHCR images, start a simulation, poll `/vehicles`, assert a WS frame arrives and a vehicle moves).
- **The simulator-to-ui WebSocket contract can drift freely (High).** See Issue A. There is no shared message-type enum and no test that feeds a real simulator-produced frame into the UI parser. Fix: shared union plus a fixture of real broadcaster output asserted by the UI parser.
- **AVRO / external sink contract asserted only against mocks (High).** The Schema-Registry client is mocked so `encode()` returns `Buffer.from(JSON.stringify(...))` (`redpanda.test.ts:44-67`); the AVRO schema is hardcoded in `redpanda.ts` with no `.avsc` file in the repo, and tests assert the pre-encode JSON shape, never AVRO conformance. Fix: round-trip the payload against the real avro library in-process (no network); extract the schema to a versioned file.
- **UI confidence ceiling: jsdom renders no pixels, deck.gl is mocked out (Medium/High).** Layer tests mock `useRegisterLayers` and assert layer props, never rendered output; ~15 `Map/*.tsx` files have no test; `renderWithProviders` exists with zero usages. The entire rendering-correctness class (wrong projection, swapped coordinates, blank map) is invisible. Fix: a small number of real-browser smoke tests (Playwright against a built UI with a mocked WS feed).
- **Tests coupled to repo infrastructure (Medium).** `ci-config.test.ts` string-matches `.github/workflows/ci.yml`; `dependabot-config.test.ts` parses `.github/dependabot.yml`; `packageJson.test.ts` and `module-resolution.test.ts` read `package.json`/`tsconfig`. These are repo-policy lint rules masquerading as app unit tests; a legitimate CI refactor goes red in the simulator's suite. Fix: move them to a dedicated root-level repo-policy check, assert parsed structure rather than exact command strings. (Note: the 2026-06 pass already had to repair two of these after a CI/tsconfig refactor, which is exactly the brittleness this finding describes.)
- **Flat 50% coverage floor with no protection of critical paths (Medium).** Identical `{lines,branches,functions,statements: 50}` in simulator/adapter/ui; only network has tuned per-concern floors. No per-file floors anywhere, so the hot paths the whole system depends on (pathfinding cost, movement, delivery) have no individual guarantee. Fix: per-file thresholds pinning `modules/RoadNetwork.ts`, `modules/RouteManager.ts`, `modules/pathfinding/**`, `modules/VehicleManager.ts` to a high floor (for example 80%).
- **No performance/load/regression guards on the hot paths (Medium).** `VehicleManagerPerf.test.ts` asserts behavior, not budgets; its one timing assertion is a wide tolerance band and a mild flake vector. No autocannon/k6/benchmark tooling. Fix: a benchmark guard (vitest `bench` or a committed-budget script) on pathfinding latency and a full game-loop tick at a fixed vehicle count.
- **Residual determinism risks (Low/Medium).** `HeadlessRunner` seeding is "best-effort"; `SpatialVehicleIndex.test.ts` uses unseeded `Math.random()`; several UI tests hard-code timer-advance amounts matching production throttle constants. Fix: a seeded RNG abstraction injected into the simulator; derive UI timer-advances from the imported interval constants.

### What the suite cannot catch (passes CI green)

1. Cross-service field/shape divergence (simulator/adapter/ui).
2. Rendering correctness (projection, coordinates, blank or throwing WebGL layers).
3. Real-time behavior at scale (throughput collapse, tick-time regressions, memory growth).
4. Real AVRO/registry incompatibility (schema evolution, encode failures).
5. Native runtime drift (a `better-sqlite3` ABI break on a Node major other than the pinned one).
6. True WebSocket transport behavior (the hand-rolled mock cannot surface backpressure, framing, reconnect-under-load).

**Single highest-leverage testing investment:** make the cross-boundary contracts executable and shared (Issue A), starting with the WebSocket envelope, then add one docker-compose smoke E2E as the apex.

---

## 7. Resilience, quality and operability

**Dimension verdict:** a well-engineered, defensively-coded system that is production-ready for its declared purpose but not for a role where its output is a system of record or where it must survive instance loss without data loss. Craftsmanship is high; the systemic weaknesses are concentrated and consistent: a single in-memory instance with non-recoverable motion state, at-most-once delivery with no DLQ, a correlation chain built on both ends but wired through neither hop, and no metrics anywhere.

### Failure modes and blast radius

- **The in-memory simulator is the single point of failure by design**, and recovery is lossy (motion state is not snapshotted; `PersistenceManager.ts:197-228`). See Issue B.
- **Dependency failures are otherwise handled gracefully and in isolation.** The simulator runs standalone; `AdapterSyncManager` uses a self-scheduling timeout chain with exponential backoff plus jitter capped at 60 s and falls back to synthetic vehicles when the adapter is empty or errors. A failing sink does not block other sinks or crash the adapter (`Publisher.publishUpdates` uses `Promise.allSettled`). The UI uses bounded reconnect (10 attempts) with full-state resync and a visible banner.

### Delivery guarantees and data integrity

- **At-most-once is honestly documented and correctly implemented, but is a real gap for the Flare-dev topology** where the adapter publishes the platform's canonical telemetry envelope to a production-shaped Redpanda. Sink failures are counted and surfaced then dropped (no DLQ, no outbox, no replay). The redpanda sink aborts the remainder of a batch on a chunk failure to preserve ordering, which is a thoughtful correctness choice. Only the GraphQL sink's upsert mutation is idempotent (relevant because the resilient HTTP client retries). The realism store-and-forward buffer is in-memory and not restart-safe. The async 202 path (realism enabled) widens the drop window because the simulator treats 2xx as success. Replay integrity itself is sound (back-dated against a virtual clock, its own RealismEngine to avoid double-degradation).

### Observability (the weakest dimension)

- **Structured logging: yes** (pino across all three services with child loggers).
- **Correlation IDs exist but connect across neither hop (headline defect).** See Issue C.
- **No metrics anywhere.** See Issue C.
- **Health/readiness:** the adapter has a proper readiness gate (503 until plugins init) and a `/health` that rolls up real plugin status; the simulator's `/health` is shallow (`!!network`, `simulation.ready`) with no `/ready` and no dependency check.
- **No remote error telemetry in the UI** (errors terminate at `console.error` plus a 10-entry localStorage ring buffer).

### Type-safety and validation at boundaries

- **REST edges are well-guarded** (simulator zod schemas with `.strict()` and bounded arrays; adapter per-item `safeParse`).
- **The WS protocol is shallow-validated on both ends:** the inbound `subscribe` filter is cast `as SubscribeFilter` with no runtime validation; outbound, `isValidMessage` checks only `type` plus presence of `data`, never payload shape, so a version-skewed `VehicleDTO` can render NaN positions.
- **GeoJSON ingestion is fully trusted:** `RoadNetwork.ts:143` does `JSON.parse(...) as FeatureCollection` with no schema, size cap, or coordinate sanity check.
- **Casts at trust boundaries in adapter plugins:** whole-config casts in `mysql.ts`/`postgres.ts` bypass required-field enforcement; the graphql sink accepts an arbitrary `variablesTransform` function from config (trusted-config, unguarded).

### Configuration and secrets (a strength)

- Fail-fast single-source config (zod, throws on misconfig); UI config validated and frozen at module load.
- Secret redaction is schema-driven plus a name-pattern safety net; the sweep confirmed no secret is logged in any sink/source file; no secrets are tracked in git.
- One operability limitation: UI config is baked at build time (`import.meta.env.VITE_*`), so one image cannot be promoted across environments without a rebuild.

### Security posture

- **Not vulnerable to prototype pollution** (centralized, tested guard) and **no command injection** in the network CLI (`execFileSync`, no shell, zod-validated bbox).
- **Dependency audit gate is below the severity of open advisories:** the CI gate is `--audit-level=critical`, so all highs (including `ws`, which powers the WS server) pass silently. Docker base images are not covered by Dependabot.
- **No authentication or origin checks on the simulator's mutating REST/WS API** (`cors({ origin: true })`, no WS `verifyClient`). Acceptable for the stated localhost dev-tool purpose, but a hard ceiling on safe exposure, and the Flare-dev topology bridges to real infrastructure.
- Geofabrik download has no integrity verification (the published checksum is never checked).

### Operational readiness (a strength)

- **Graceful shutdown is excellent in both services** (re-entrancy latch, bounded drain of in-flight syncs and pathfinding, worker teardown, `uncaughtException`/`unhandledRejection` handlers with a hard-exit safety net). Resource cleanup is thorough, including a session-identity guard so a stale sync settling after restart cannot corrupt the new session.
- Persistence is careful (WAL, prepared statements, chunked off-hot-path serialization, bounded retention).
- Deployment/versioning is solid (release-please, multi-arch GHCR images from a workspace-aware root Dockerfile, least-privilege CI with pinned Node and actions).

**Single highest-leverage hardening:** metrics plus end-to-end correlation propagation (Issue C). If delivery integrity is the priority for the Flare-dev path specifically, the close runner-up is a persistent outbox/DLQ to convert at-most-once into at-least-once for the redpanda sink.

---

## 8. What is genuinely strong

This is not a weak codebase, and an objective review must say so plainly.

- **Real-time transport:** per-client backpressure (64 KB buffer cap, disconnect after 50 dropped flushes), delta updates, a batched 10 Hz flush decoupled from tick rate, and server-side viewport (bbox) filtering via a spatial index. Better than most implementations.
- **Simulation core:** a single loop drives all vehicles (not a timer per vehicle), per-vehicle error isolation in the tick, an A* worker pool with static-cost precompute and a bounded queue, and a test asserting main-thread A* equals worker-thread A\*.
- **Abstractions:** the adapter plugin system (clean `DataSource`/`DataSink` plus facade/registry/publisher), the deck.gl layer registry, and `App.tsx` as a true thin orchestrator.
- **Operability:** exemplary graceful shutdown in both services, thorough resource cleanup, WAL plus chunked off-thread persistence, fail-fast zod config, and schema-driven secret redaction with no secrets in logs or git.
- **Testing discipline in spots most teams skip:** real worker-thread and real-SQLite execution, an OpenAPI spec guarded against route drift, and `shared-types` as the single source for core entities.

---

## 9. Prioritized roadmap

Ranked by leverage (impact per unit of effort and risk). The first two are high-impact and low-risk; do them first.

1. **Share and enforce the WS and REST contract** (maintainability + testing + quality). Lift the WebSocket message union and REST request/response schemas into `@moveet/shared-types`; type `broadcast()` against the union; validate on both ends. Highest leverage, lowest effort: the union already exists in the wrong package. Closes the largest bug class by construction. (Issue A.)
2. **Add metrics plus correlation propagation** (quality/operability). `prom-client` plus `/metrics` for sink success/drop/failure, sync latency, WS client count, reconnect events; thread `x-request-id` through the sim-to-adapter hop and into the telemetry envelope. Prerequisite for operating every other gap safely. (Issue C.)
3. **Decouple the broadcaster onto a pub/sub bus** (scaling). Removes `clients x vehicles` work from the simulation thread, lets client count scale independently, and is the first step toward regional sharding. (Issue B.)
4. **Add one docker-compose smoke E2E plus a perf/load guard** on the game loop and pathfinding (testing). Gives the pyramid an apex and guards the hot paths the product is judged on.
5. **Release the retained GeoJSON and share the worker graph via `SharedArrayBuffer`** (performance/memory). Could roughly halve steady-state RSS.
6. **Decompose the god objects** (`RoadNetwork.ts` 1055, `redpanda.ts` 962, `client.ts` 676) and add per-file coverage floors on the hot modules (maintainability + testing).

Explicitly not worth doing: there is no broad rewrite warranted. The at-most-once delivery and the no-auth posture are correct trade-offs for a dev/test simulator; they become gaps only if the role changes to system-of-record or public exposure. The pathfinding-worker duplication is a known, tested, deliberate trade-off; resolve it via build-time bundling, not by abandoning the worker isolation.

---

## 10. Appendix: key evidence map

| Area                                    | Primary evidence                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single loop / state ownership           | `apps/simulator/src/modules/GameLoop.ts:74,109-147`; `VehicleRegistry.ts:14-18`; `RouteManager.ts:26-38`                                                                  |
| Graph duplication / retained blob       | `apps/simulator/src/modules/RoadNetwork.ts:143`; `apps/simulator/src/workers/pathfinding-worker.ts:201`; `PathfindingPool.ts:68,84-86`                                    |
| WS fan-out + backpressure + bbox filter | `apps/simulator/src/modules/WebSocketBroadcaster.ts:160,216-225,295-356,310-319`                                                                                          |
| Pathfinding pool limits                 | `apps/simulator/src/modules/PathfindingPool.ts:68,144-150`; `RouteManager.ts:591-635`                                                                                     |
| UI road layer (no culling)              | `apps/ui/src/components/Map/components/DeckGLMap.tsx:29-83`                                                                                                               |
| UI vehicle hot path                     | `apps/ui/src/Map/Vehicle/VehiclesLayer.tsx:344-350,369-388`; `apps/ui/src/hooks/vehicleStore.ts`                                                                          |
| WS contract (UI-only union)             | `apps/ui/src/utils/wsTypes.ts:62-93,106-140`; `apps/simulator/src/setup/eventWiring.ts:66-238`                                                                            |
| REST contract (both ends)               | `apps/simulator/src/routes/*.ts`; `apps/ui/src/utils/client.ts`                                                                                                           |
| Duplicated server infra                 | `apps/{simulator,adapter}/src/middleware/errorHandler.ts`; `.../correlationId.ts`; `.../utils/logger.ts`                                                                  |
| Persistence (no motion state)           | `apps/simulator/src/modules/PersistenceManager.ts:120-127,177-228`                                                                                                        |
| Delivery semantics                      | `apps/adapter/src/plugins/publisher.ts:23-42`; `apps/adapter/src/plugins/sinks/redpanda.ts`                                                                               |
| Correlation gap                         | `apps/simulator/src/modules/Adapter.ts:27-54`; `apps/adapter/src/plugins/sinks/redpanda.ts:732`                                                                           |
| Coverage gates                          | `apps/{simulator,adapter,ui,network}/vitest.config.ts`                                                                                                                    |
| Repo-coupled tests                      | `apps/simulator/src/__tests__/{ci-config,dependabot-config}.test.ts`; `apps/ui/src/__tests__/packageJson.test.ts`; `apps/adapter/src/__tests__/module-resolution.test.ts` |
| Stale perf doc                          | `docs/performance-analysis.md` (pre-fix; treat numbers as historical)                                                                                                     |

---

_This review is a point-in-time architectural assessment produced from a read-only analysis. File and line references reflect the tree as of 2026-06-29 and may shift as the code evolves._
