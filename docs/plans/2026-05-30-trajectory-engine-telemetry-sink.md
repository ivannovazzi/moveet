# Trajectory-Engine Telemetry Sink

**Date:** 2026-05-30
**Status:** Implemented

## Goal

Let moveet feed the external **trajectory-engine** PoC with GPS telemetry, with no
code changes on the engine side. The two systems already share the local
`suite_redpanda` broker on the `suite_network` Docker network; we just publish
engine-shaped JSON to the engine's input topic.

## The contract (trajectory-engine input)

The engine's ingestor consumes JSON from Kafka/Redpanda topic
`trajectory.telemetry.raw`, keyed by `String(vehicleId)`, validated against a
frozen Zod schema. Every field is **required**:

| Field       | Type    | Units / range        |
| ----------- | ------- | -------------------- |
| `ts`        | int     | epoch milliseconds   |
| `vehicleId` | int ≥ 0 | identity / Kafka key |
| `lat`       | number  | degrees, [-90, 90]   |
| `lon`       | number  | degrees, [-180, 180] |
| `speed`     | number  | **m/s**, ≥ 0         |
| `heading`   | number  | degrees, [0, 360)    |
| `altitude`  | number  | metres               |
| `accuracy`  | number  | metres, ≥ 0          |
| `ignition`  | boolean | engine state         |

Region/route labels are derived server-side by the engine; producers must NOT
send them. Malformed messages are skipped by the ingestor without stalling.

## What moveet has today

- The simulator's internal `Vehicle` carries `speed` (km/h) and `bearing`
  (degrees), but `AdapterSyncManager` dropped both when POSTing to the adapter's
  `/sync` — the adapter only saw `{id, name, latitude, longitude, type}`.
- The adapter's `RedpandaSink` emitted its own native shape
  (`{eventType, eventId, occurredOn, vehicleId, vehicleType, latitude, longitude, timestamp}`)
  to `dispatch.vehicle.positions`.
- moveet does not simulate `altitude`, `accuracy`, or `ignition` at all.

## Field mapping (engine ← moveet)

| Engine field | Source                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts`         | `Date.now()` at publish (sim syncs every ~500 ms; sub-second skew is acceptable)                                                                                       |
| `vehicleId`  | `id` parsed as int when it is a non-negative integer string (moveet defaults are `"0"`, `"1"`, …); otherwise a deterministic 31-bit hash (handles `"static-0"`, UUIDs) |
| `lat`/`lon`  | `latitude` / `longitude`                                                                                                                                               |
| `speed`      | enriched `speed` (km/h) ÷ 3.6                                                                                                                                          |
| `heading`    | enriched `bearing`, normalized to [0, 360)                                                                                                                             |
| `altitude`   | config `defaultAltitude` (default `0`)                                                                                                                                 |
| `accuracy`   | config `defaultAccuracy` (default `5`)                                                                                                                                 |
| `ignition`   | `speed > 0.5 m/s`                                                                                                                                                      |

## Changes (all in moveet, one PR)

1. **`packages/shared-types`** — add optional `speed?`, `heading?` to
   `VehicleUpdate`.
2. **`apps/simulator` `AdapterSyncManager`** — include `speed: v.speed` and
   `heading: v.bearing` in the `/sync` payload (and the `SyncVehicle` type in
   `Adapter.ts`).
3. **`apps/adapter` `RedpandaSink`** — add a `format` config
   (`"dispatch"` default | `"trajectory"`) plus `defaultAltitude` /
   `defaultAccuracy`. When `format === "trajectory"`, build the 9-field engine
   payload with an integer Kafka key. The `/sync` handler already passes extra
   fields through, so no handler change is needed.
4. **Tests** — extend `redpanda.test.ts` for the trajectory format and the
   id→int helper.
5. **Docs** — adapter `.env.example` + README snippet.

## Enabling it

Simulator `.env`:

```
ADAPTER_URL=http://localhost:5011
```

Adapter `.env`:

```
SINK_TYPES=redpanda
SINK_REDPANDA_CONFIG={"brokers":"suite_redpanda:9092","topic":"trajectory.telemetry.raw","format":"trajectory"}
```

## Out of scope (YAGNI)

- The engine's `trajectory.telemetry.events` (spawn/despawn) topic.
- Threading the simulator's per-batch timestamp through to `ts` (publish-time
  `now()` is good enough for the PoC).

## Docker test plan

1. Bring up the trajectory-engine stack (creates the topic + ingestor +
   TimescaleDB + web on `suite_network`).
2. Run the moveet adapter + simulator pointed at `suite_redpanda:9092` with
   `format: "trajectory"`.
3. Verify: messages on `trajectory.telemetry.raw` match the schema, rows land in
   TimescaleDB, and vehicles render on the engine web UI (`:5180`).
