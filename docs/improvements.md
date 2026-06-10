# Codebase Improvement Tracker

Audit date: 2026-06-10. Findings across usability, performance, ergonomics, engineering best practices, and design patterns for all apps and the monorepo. Check items off as they are fixed; add a PR link next to completed items.

**Status 2026-06-10:** all high + medium findings addressed (or closed as invalid/already-fixed after verification) on branch `fix/audit-high-medium-findings`. Low findings remain open.

**Legend:** 🔴 High · 🟡 Medium · 🟢 Low
**IDs:** `SIM` simulator · `ADP` adapter · `UI` ui · `REPO` monorepo/cross-cutting

## Summary

| Area      | High   | Medium | Low    | Total  |
| --------- | ------ | ------ | ------ | ------ |
| Simulator | 6      | 9      | 5      | 20     |
| Adapter   | 4      | 9      | 7      | 20     |
| UI        | 3      | 13     | 6      | 22     |
| Monorepo  | 2      | 5      | 7      | 14     |
| **Total** | **15** | **36** | **25** | **76** |

### Suggested quick wins (low effort, high value)

- [x] REPO-01 — Fix `VITE_API_URL`/`VITE_WS_URL` in `docker-compose.ghcr.yml` (UI can't reach simulator as configured)
- [x] ADP-02 — Add SIGINT handler to adapter (Ctrl+C currently skips all cleanup)
- [x] SIM-06 — Replace `console.log` with structured logger in simulator config dump
- [x] REPO-03 — Fix stale "yarn" claim in root `CLAUDE.md` (everything uses npm workspaces)
- [ ] REPO-09 — Delete stray `--version/` directory at repo root
- [x] UI-12 — Wire up error reporting in `ErrorBoundary` (currently console-only)

---

## Simulator (`apps/simulator`)

### High

- [x] **SIM-01** 🔴 Global error handler lacks request context — `src/index.ts:139-142`
      Logs only `err.message`, returns generic 500. The correlation-ID middleware runs earlier but isn't used here. Log method/path/request ID and stack (dev), return the correlation ID in the error body.
- [x] **SIM-02** 🔴 Race in `WebSocketBroadcaster.flush()` client-state mutation — `src/modules/WebSocketBroadcaster.ts:315,325-326`
      `droppedFlushes`/`lastSent` are mutated after async sends; `bboxCache` assumes immutable bbox references that can be mutated externally. Use immutable keys, reset counters before sending, wrap `client.send()` in try/catch.
      _Done — the real defect was send-error isolation (added `safeSend`); the async-race/bbox-mutation claims were verified invalid (`flush()` is fully synchronous, cache keys are value-derived)._
- [x] **SIM-03** 🔴 A\* heuristic can go stale/inadmissible — `src/modules/RoadNetwork.ts:582-599`
      `maxNetworkSpeed` is precomputed; later speed overrides/incidents can invalidate it, pruning optimal paths. Spatial grid search expands to radius 3 with no distance cap. Recompute on incident-edge changes; bound grid expansion.
      _Closed: claim verified invalid — edge speeds are immutable after construction and incidents only increase cost, so the heuristic stays admissible; grid search was already bounded._
- [x] **SIM-04** 🔴 `VehicleManager.advance()` has no per-vehicle error isolation — `src/modules/VehicleManager.ts:263-270`
      One throwing vehicle update aborts the whole batch mid-state. Try/catch inside the loop; log and skip the failing vehicle.
- [x] **SIM-05** 🔴 Graceful shutdown drops in-flight work — `src/setup/gracefulShutdown.ts:36-90`
      Server closes immediately; in-flight adapter syncs and pending pathfinding-pool requests aren't drained. Add a bounded drain phase before close.
- [x] **SIM-06** 🔴 Config dump bypasses structured logging — `src/utils/config.ts:158`
      `logConfig()` uses `console.log` instead of `logger.info`, skipping transports/redaction. One-line fix. _(verified)_

### Medium

- [x] **SIM-07** 🟡 PathfindingPool pending queue is unbounded — `src/modules/PathfindingPool.ts:120-150`
      Per-request timeouts exist but no backpressure; stalled workers grow memory without limit. Add `maxPendingRequests` + queue-depth metric.
- [x] **SIM-08** 🟡 In-memory rate limiter breaks under clustering — `src/middleware/rateLimiter.ts:24-31`
      Per-process IP buckets; multiple instances multiply effective limits. Document the limitation or support an external store.
- [x] **SIM-09** 🟡 Adapter sync has no backoff/retry strategy — `src/modules/AdapterSyncManager.ts:82-102`
      Failures log and retry every interval, flooding logs during outages. Add exponential backoff with jitter; surface persistent failure as an event.
- [x] **SIM-10** 🟡 `/stop` endpoint lacks idempotency/state checks — `src/routes/simulation.ts:44-51`
      Calls `stop()` unconditionally; concurrent stops can race. Validate running state, make idempotent, emit status before responding.
- [x] **SIM-11** 🟡 Route cache TTL not refreshed on hit; incidents don't invalidate — `src/modules/RoadNetwork.ts:128-133,313-314`
      Hot routes get evicted after 60s regardless of use; incident cost changes leave stale cached routes. Refresh TTL on hit and invalidate on incident change.
- [x] **SIM-12** 🟡 Bounding-box margin ignores latitude — `src/routes/vehicles.ts:42,93-100`
      Hardcoded 0.1° margin isn't latitude-scaled. Scale longitude margin by `cos(lat)`.
- [x] **SIM-13** 🟡 Game loop clock delta unclamped — `src/modules/GameLoop.ts:83-110`
      GC pauses produce large deltas that make the sim clock jump. Clamp delta (e.g. 2× interval) and log when exceeded.
- [x] **SIM-14** 🟡 Auto heat-zone timer leaks across start/reset — `src/modules/SimulationController.ts:132-145,207-212`
      Timer isn't cleared on `reset()`; restart guard can leave a stale timer firing. Always clear and restart in `start()`/`reset()`.
      _Done — `reset()` already cleared the timer via `stop()`; `start()` now always clears+restarts and regenerates zones immediately._
- [x] **SIM-15** 🟡 `asyncHandler` has no handler timeout — `src/routes/helpers.ts:7-10`
      A hung route (e.g. pathfinding) keeps connections open indefinitely. Add an optional timeout race.
      _Done — opt-in `timeoutMs` capability with tests; not applied to routes since pathfinding is already bounded by the pool’s 30s per-request timeout._

### Low

- [ ] **SIM-16** 🟢 Visited-edges circular buffer overflow behavior undocumented — `src/modules/VehicleRegistry.ts:69-72`
      At 1000 entries old edges are silently overwritten, weakening unvisited-edge selection. Document or switch to time-window expiry.
- [ ] **SIM-17** 🟢 `serializeVehicle()` strips fields needed for replay/debugging — `src/utils/serializer.ts:3-12`
      No route/segment info in the DTO. Add a `VehicleDetailDTO` or optional fields; document broadcast vs persisted shape.
- [ ] **SIM-18** 🟢 Heat-zone generation does expensive turf work per attempt — `src/modules/HeatZoneManager.ts:49-103`
      O(attempts × nodes) with repeated polygon generation. Precompute sector→node mapping, cache polygons.
- [ ] **SIM-19** 🟢 GeoJSON load has no error handling or schema validation — `src/modules/RoadNetwork.ts` (load path)
      Corrupt/oversized files crash with opaque errors. Wrap I/O + parse, validate schema.
- [ ] **SIM-20** 🟢 Tests reach private fields via `@ts-expect-error` — `src/modules/VehicleManager.ts:114-153`
      Masks real type errors and makes refactors risky. Expose public test accessors instead.

---

## Adapter (`apps/adapter`)

### High

- [x] **ADP-01** 🔴 HTTP server instance not captured for graceful shutdown — `src/index.ts:328-330`
      `app.listen()` return value discarded; SIGTERM shuts down plugins but never calls `server.close()`, so pending requests hang and new connections are accepted during shutdown.
- [x] **ADP-02** 🔴 No SIGINT handler — `src/index.ts:314-323`
      Only SIGTERM is trapped; Ctrl+C kills the process without closing Kafka producers/clients. Share the shutdown handler across both signals. _(verified)_
- [x] **ADP-03** 🔴 RealismEngine tick errors swallowed — `src/realism/RealismEngine.ts:147`
      `setInterval(() => void this.tick(), …)` discards rejections; systematic failures never surface. Wrap the callback, log/metric uncaught errors, expose tick-loop health.
- [x] **ADP-04** 🔴 No `unhandledRejection`/`uncaughtException` handlers — `src/index.ts`
      Errors outside try/catch crash the process without context. Add process-level handlers that log and shut down cleanly.

### Medium

- [x] **ADP-05** 🟡 No Express error-handling middleware — `src/index.ts:94-110`
      Unhandled route errors return default HTML instead of structured JSON. Add a final error middleware.
- [x] **ADP-06** 🟡 Redpanda sink fails late when topic missing — `src/plugins/sinks/redpanda.ts:298`
      `allowAutoTopicCreation: false` with no pre-flight check; error only appears on first publish after the sink reports "active". Check topic existence in `connect()`.
- [x] **ADP-07** 🟡 ReplayEmitter hangs forever on empty source — `src/replay/ReplayEmitter.ts:153-162`
      Header-wait loop never breaks on an empty iterable, blocking the emit job queue. Add timeout/max-iteration guard.
      _Closed: already handled on main — `run()` throws "Recording is empty (no header line)" when the iterator ends; audit claim was stale._
- [x] **ADP-08** 🟡 Invalid JSON config env vars silently fall back to `{}` — `src/utils/config.ts:52-60`
      A typo in `REALISM_CONFIG`/`SINK_*_CONFIG` is masked. Validate all JSON env vars at startup and fail loudly.
- [x] **ADP-09** 🟡 Redpanda health-check admin connect has no timeout — `src/plugins/sinks/redpanda.ts:640-670`
      `Promise.race` covers the check but not `admin.connect()`; a hanging broker stalls the health endpoint. Add a connect timeout.
- [x] **ADP-10** 🟡 Chunked batch publish can deliver out of order on partial failure — `src/plugins/sinks/redpanda.ts:574-629`
      Mid-chunk failure + retry corrupts time-series ordering. Fail the batch atomically or add per-chunk sequencing.
- [x] **ADP-11** 🟡 GraphQL mutation/subscription guard regex too loose — `src/plugins/sources/graphql.ts:82-89`
      Bare `/mutation|subscription/i` matches substrings and misses word-boundary cases. Use `\b(?:mutation|subscription)\b`.
      _Closed: already handled on main — regex already uses `\b(mutation|subscription)\b` with tests; audit claim was stale._
- [x] **ADP-12** 🟡 `POST /config/sinks` doesn't validate sink type against registry — `src/index.ts:229-247`
      Unknown types fail later with a generic error instead of an early 400. Check `registry.getSinkFactory(type)` first.
      _Done — registry lookup + 400 already existed; added the valid-types list to the error message._
- [x] **ADP-13** 🟡 Plugin shutdown has no timeout — `src/index.ts:314-323`
      A hanging disconnect blocks process exit until SIGKILL. Wrap shutdown in a ~10s timeout then force-exit.

### Low

- [ ] **ADP-14** 🟢 ConsoleSink bypasses structured logger — `src/plugins/sinks/console.ts:19-23`
- [ ] **ADP-15** 🟢 `express.json()` default 100KB limit too small for large `/sync` batches — `src/index.ts:101`
      Set an explicit limit and handle 413 cleanly.
- [ ] **ADP-16** 🟢 Recording header parsed via type cast, no validation — `src/replay/ReplayEmitter.ts:158-162`
      Validate with Zod (already a dependency) and fail with a clear error.
- [ ] **ADP-17** 🟢 Kafka producer has no compression codec — `src/plugins/sinks/redpanda.ts:293-300`
      GZIP would cut telemetry bandwidth/storage substantially; make it configurable.
- [ ] **ADP-18** 🟢 HTTP client ignores `Retry-After` on 429 — `src/utils/httpClient.ts:44`
- [ ] **ADP-19** 🟢 No request size/latency observability on `/sync` — `src/index.ts:114-192`
      Log payload size + latency, or add basic metrics counters.
- [ ] **ADP-20** 🟢 `isReady` name misleading (set true even if plugins failed to connect) — `src/index.ts:92,105,325`
      Rename to `startupComplete` or add real source/sink health to readiness.

---

## UI (`apps/ui`)

### High

- [x] **UI-01** 🔴 `App.tsx` is a 660-line god component — `src/App.tsx:67-647`
      Geofence drawing, dispatch flow, incident CRUD, recording, filtering, and map interaction all live in one component. Extract per-domain hooks (`useGeofenceState`, `useDispatchManager`, `useIncidentManager`) and a thin orchestrator.
- [x] **UI-02** 🔴 Vehicle rendering couples interpolation to React state at 30fps — `src/Map/Vehicle/VehiclesLayer.tsx:238`
      `STATE_UPDATE_INTERVAL = 33ms` throttling causes jerky motion despite interpolation. Move interpolation into a pure RAF loop with a persistent renderer; only sync React state for selection/hover.
      _Done (partial by design) — setState skipped when nothing visible changed, explicit rebuild triggers, latent zoom-drop throttle bug fixed; full off-React renderer rewrite deemed out of scope (layers flow through React context)._
- [x] **UI-03** 🔴 `vehicleStore` Map mutated by WS handler while RAF loop reads it — `src/hooks/vehicleStore.ts:20-34`
      Mid-frame batch arrivals can expose partially-updated state. Buffer WS batches and swap/apply on frame boundaries.
      _Done — `enqueue()` buffers WS batches, all read paths flush atomically at the read boundary; the literal mid-batch race was impossible (single-threaded JS) but per-message version churn was real._

### Medium

- [x] **UI-04** 🟡 `useDirections` unstable dependency causes re-subscription churn — `src/hooks/useDirections.ts:92`
      Stabilize the callback (useCallback/reducer) to stop redundant re-registrations.
      _Closed: claim verified invalid — `setDirections`/`fetchDirections` identities are stable; no re-subscription churn exists._
- [x] **UI-05** 🟡 `useOptions` debounce cleanup race on unmount — `src/hooks/useOptions.ts:22-36`
      Pending debounced server write is orphaned on unmount. Tie cleanup to the effect that owns the timer.
- [x] **UI-06** 🟡 DataProvider has no `dataReady` signal — `src/data/index.tsx:1-45`
      Children mounting before network/roads load render incomplete UI silently. Expose a readiness flag/hook for fallbacks.
- [x] **UI-07** 🟡 `Map.tsx` layer subtree rebuilds on every render — `src/Map/Map.tsx:39-95`
      Inline callbacks + unstable props force deck.gl layer rebuilds. Memoize the layer subtree keyed on the actual inputs.
- [x] **UI-08** 🟡 POI layer + CollisionFilterExtension recreated on every zoom settle — `src/Map/POIs.tsx:129`
      Discards deck.gl's in-flight collision indexes. Persist the extension instance across zoom updates.
      _Closed: already handled on main — `collisionFilter` is module-level; per-zoom layer descriptor recreation is the intended deck.gl pattern._
- [x] **UI-09** 🟡 Connection status dead-ends after max reconnect attempts — `src/components/ConnectionStatus.tsx:26`
      "Please refresh" shown forever with no retry. Add a Retry button that resets the attempt counter.
- [x] **UI-10** 🟡 Dispatch waypoints not validated client-side — `src/hooks/useDispatchFlow.ts:105-142`
      Clicks outside the network fail silently after a 5s server round-trip. Validate against network bounds and toast immediately.
- [x] **UI-11** 🟡 No viewport culling for off-screen vehicles — `src/Map/Vehicle/VehiclesLayer.tsx:350-397`
      All vehicles are interpolated/projected per frame even when invisible. Cull by viewport bounds before interpolation.
- [x] **UI-12** 🟡 ErrorBoundary only logs to console — `src/components/ErrorBoundary.tsx:30-32`
      Production crashes are invisible. Add Sentry (or at minimum localStorage snapshots).
      _Done — bounded (10) localStorage error snapshots with corrupt-log recovery; no external service added._
- [x] **UI-13** 🟡 `useVehicles` re-maps the full array every throttle tick — `src/hooks/useVehicles.ts:147-163`
      Filter/search re-runs even when only positions changed. Split filtering from position updates or add change detection.
- [x] **UI-14** 🟡 Trail-length change mutates store synchronously and may block — `src/Controls/TogglesPanel.tsx:45-50`
      Trimming 100k+ trail points on the main thread; localStorage write unguarded. Debounce + try/catch.
- [x] **UI-15** 🟡 No WebGL context-loss handling — `src/components/Map/components/DeckGLMap.tsx:65-100`
      Context loss freezes the map silently. Wire `onError` to a fallback or use luma.gl context restoration.
- [x] **UI-16** 🟡 `useDispatchFlow` has no tests despite 6-state flow — `src/hooks/useDispatchFlow.ts`
      Other hooks are tested; this one isn't. Cover happy path, failure+retry, clear-resets-selection, waypoint add/remove/move.
      _Done — suite already existed (16 tests, audit claim stale); extended with 5 bounds-validation tests (21 total)._

### Low

- [ ] **UI-17** 🟢 Sparse memoization across components (~10 `React.memo` total) — codebase-wide
      Start with VehicleList items, POI markers, direction labels.
- [ ] **UI-18** 🟢 `useDeckLayers` microtask batching can starve under churn — `src/components/Map/hooks/useDeckLayers.ts:45-58`
      Switch to a short timer-based debounce to yield to the event loop.
- [ ] **UI-19** 🟢 Keyboard shortcut handler: incomplete contentEditable guard + stale closures — `src/App.tsx:402-425`
      Extract into a hook with stable refs.
- [ ] **UI-20** 🟢 Direction text layers can overlap/overflow — `src/Map/Direction.tsx:154-186`
- [ ] **UI-21** 🟢 luma.gl error suppression filter too broad — `src/main.tsx:9-13`
      Substring match on `maxTextureDimension2D` can hide real errors; tighten the filter.
- [ ] **UI-22** 🟢 No bundle size budget — `vite.config.ts`
      Add visualizer + CI warning on chunk/total gzip growth.

> Unverified leads (flagged by the audit but not confirmed by reading the code — verify before acting): `useSubscribeFilter` may send one WS subscription message per rapid filter toggle (consider debouncing); `SearchBar` dropdown may lack listbox/option ARIA roles and focus handling; fleet legend / incident marker colors are user-defined with no contrast validation (WCAG AA risk).

---

## Monorepo & cross-cutting

### High

- [x] **REPO-01** 🔴 `docker-compose.ghcr.yml` uses wrong UI env var names — `docker-compose.ghcr.yml:28-29`
      Sets `API_URL`/`WS_URL` but the UI reads `VITE_API_URL`/`VITE_WS_URL` (and Vite bakes them at build time). As shipped, the UI falls back to hardcoded defaults. _(verified)_
- [x] **REPO-02** 🔴 `apps/network` undocumented in root CLAUDE.md/architecture — `CLAUDE.md`
      Root doc says "three-project system"; the network CLI (GeoJSON prep pipeline) is a real build dependency. Add it to the table and overview.

### Medium

- [x] **REPO-03** 🟡 CLAUDE.md claims UI uses yarn — it uses npm workspaces — `CLAUDE.md:13,43` _(verified)_
- [x] **REPO-04** 🟡 Package version skew: shared-types 0.0.4, eslint-config 0.0.1 vs monorepo 0.0.7 — `packages/*/package.json`, `.release-please-manifest.json`
      release-please only tracks root. Add packages to the config or mark them private and version with the monorepo.
- [x] **REPO-05** 🟡 GeoJSON mount path drift between compose files — `docker-compose.yml` (`/data/...`) vs `apps/simulator/compose.yml` (`/app/data/...`)
      Standardize on one path and sync both files.
- [x] **REPO-06** 🟡 CI coverage upload omits `apps/network` — `.github/workflows/ci.yml`
      Network has vitest + coverage but isn't collected. Add it to the artifact paths.
- [x] **REPO-07** 🟡 `apps/network` versioning/publish intent ambiguous (independent 0.1.0, not in release-please) — `apps/network/package.json`
      Decide standalone vs monorepo-versioned and document it.

### Low

- [ ] **REPO-08** 🟢 Root `.env` contains junk (`ASDASD=test`) — gitignored and untracked, so no leak risk, but delete it or replace with a documented `.env.example`. _(verified: not tracked by git)_
- [ ] **REPO-09** 🟢 Stray `--version/` directory at repo root — leftover from a botched CLI invocation; delete it.
- [ ] **REPO-10** 🟢 UI ESLint config is `.js` while other apps use `.mjs` — `apps/ui/eslint.config.js`
- [ ] **REPO-11** 🟢 turbo.json lint tasks could declare explicit `"outputs": []` — `turbo.json`
- [ ] **REPO-12** 🟢 turbo `^type-check` dependency on shared-types works by convention only — `turbo.json`, `packages/shared-types/package.json`
      Document the contract or remove the edge.
- [ ] **REPO-13** 🟢 `apps/simulator/compose.yml` drifts from root compose conventions (ports/mounts) — keep in sync or generate one from the other.
- [ ] **REPO-14** 🟢 turbo build `outputs: ["dist/**"]` could exclude test artifacts for tighter caching — `turbo.json`
