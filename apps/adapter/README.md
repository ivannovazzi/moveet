# Moveet Adapter

A TypeScript/Express bridge service that connects the Moveet simulator to external fleet management systems. Built on a plugin-based architecture of **sources** (data in) and **sinks** (data out), allowing flexible integration with various APIs, databases, and message brokers.

## Architecture

```
                    GET /vehicles             POST /sync
Simulator ──────────────────────────>  Adapter  <──────────────────  Simulator
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               │                         │                         │
           Sources                       │                      Sinks
         (fetch vehicles)                │               (push position updates)
               │                         │                         │
    ┌──────────┼──────────┐              │          ┌──────────────┼──────────────┐
    │          │          │              │          │         │         │         │
 GraphQL    REST     Static          MySQL      GraphQL   REST    Redpanda   Redis
                                   Postgres                       (Kafka)
                                                            Webhook   Console
```

**Sources** fetch vehicle data from a configured backend:

| Source   | Description                                       |
| -------- | ------------------------------------------------- |
| GraphQL  | Queries a GraphQL API for vehicle data            |
| REST     | Fetches from a REST endpoint                      |
| Static   | Returns generated mock vehicles (for development) |
| MySQL    | Queries a MySQL database                          |
| Postgres | Queries a PostgreSQL database                     |

**Sinks** push vehicle position updates to one or more destinations:

| Sink           | Description                                     |
| -------------- | ----------------------------------------------- |
| GraphQL        | Pushes updates via GraphQL mutation             |
| REST           | POSTs updates to a REST endpoint                |
| Redpanda/Kafka | Publishes updates as Kafka messages via KafkaJS |
| Redis          | Publishes updates via Redis Pub/Sub             |
| Webhook        | POSTs updates to a webhook URL                  |
| Console        | Logs updates to stdout (for development)        |

Multiple sinks can be active simultaneously. Updates are published to all active sinks in parallel.

## Modes

The adapter auto-configures from environment variables at startup:

1. **GraphQL mode** (`API_URL` and `TOKEN` set) -- Connects to a GraphQL API as both source and sink. Fetches vehicles via query and pushes position updates via mutation.

2. **Alternative mode** (`USE_ALTERNATIVE_API=true`) -- Uses a local GraphQL API as the source and Redpanda/Kafka as the sink. Fetches up to 100 vehicles and publishes position updates to a Kafka topic.

3. **Dev mode** (no env vars configured) -- Falls back to a static source with 20 mock vehicles and a console sink. Useful for local development without any external dependencies.

Plugins can also be configured at runtime via the REST config API (see endpoints below).

## Requirements

- Node.js >= 18
- Docker (optional)

## Installation

```bash
git clone https://github.com/ivannovazzi/moveet.git
cd moveet/apps/adapter
npm install
```

## Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

### Environment Variables

| Variable              | Default                         | Description                                                                                                                                                   |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `5011`                          | Server port                                                                                                                                                   |
| `CORS_ORIGINS`        | `*`                             | Allowed CORS origins. Use `*` to allow all origins, or a comma-separated list (e.g. `http://localhost:5010,http://localhost:5012`) to restrict.               |
| `API_URL`             | --                              | GraphQL API URL (GraphQL mode)                                                                                                                                |
| `TOKEN`               | --                              | Auth token for GraphQL API (GraphQL mode)                                                                                                                     |
| `USE_ALTERNATIVE_API` | `false`                         | Set to `true` for alternative mode                                                                                                                            |
| `ALTERNATIVE_API_URL` | `http://localhost:4001/graphql` | Local GraphQL API URL (alternative mode)                                                                                                                      |
| `REDPANDA_BROKERS`    | `localhost:19092`               | Comma-separated Redpanda/Kafka broker addresses                                                                                                               |
| `REDPANDA_TOPIC`      | `dispatch.vehicle.positions`    | Kafka topic for vehicle position updates                                                                                                                      |
| `REALISM_CONFIG`      | `` (off)                        | JSON config for the telemetry realism engine (GPS noise / dropouts / cadence jitter). Off unless `enabled:true`. See [Telemetry realism](#telemetry-realism). |

## API Endpoints

### Data Endpoints

**`GET /vehicles`** -- Fetches vehicles from the active source plugin.

**`POST /sync`** -- Pushes vehicle position updates to all active sink plugins. Accepts either a JSON array of updates or `{ "vehicles": [...] }`.

### Plugin Configuration Endpoints

**`GET /config`** -- Returns the current plugin configuration and health status of all active sources/sinks.

**`POST /config/source`** -- Sets the active source plugin.

```json
{ "type": "graphql", "config": { "url": "http://localhost:4001/graphql" } }
```

**`POST /config/sinks`** -- Adds or replaces a sink plugin.

```json
{ "type": "redpanda", "config": { "brokers": "localhost:19092", "topic": "my.topic" } }
```

**`DELETE /config/sinks/:type`** -- Removes a sink plugin by type.

**`POST /config/realism`** -- Hot-applies the realism engine config at runtime (partial bodies are merged over the current config). See [Telemetry realism](#telemetry-realism).

```json
{ "config": { "enabled": true, "reportingPeriodMs": 5000, "jitterMs": 800 } }
```

**`GET /health`** -- Returns health check status for the active source and all sinks (plus a `realism` status block when the engine is active).

### Observability

**`GET /metrics`** -- Prometheus exposition (text format) for scraping, served via `prom-client` (`src/metrics.ts`). It uses a dedicated registry and exposes the default Node/process collectors (event-loop lag, GC, heap, etc.) alongside two custom collectors:

- `adapter_sink_delivery_total{sink,outcome}` -- per-sink delivery outcome counter. `outcome` is one of `success`, `drop` (a per-item/per-chunk delivery that was attempted but not delivered, reflecting the at-most-once, no-DLQ semantics), or `failure` (a whole-sink publish error). Counts are mirrored from each publish's per-sink result.
- `adapter_publish_duration_seconds{path,outcome}` -- a latency histogram for publish operations (e.g. the `POST /sync` handler), bucketed from a few milliseconds up to multiple seconds.

`/metrics` (like `/health`) is exempt from the readiness gate that returns 503 while plugins are still initializing, so a scraper sees the service come up.

### Redpanda sink: payload formats

The Redpanda sink supports three output shapes via its `format` config field:

- **`dispatch`** (default) -- moveet's native event:
  `{ eventType, eventId, occurredOn, vehicleId, vehicleType, latitude, longitude, timestamp }`.
- **`canonical-avro`** -- the platform's canonical telemetry-ingest envelope,
  Confluent-AVRO encoded to `telemetry.device.raw`. Its envelope carries real
  `metadata.correlation_id` and `metadata.trace_id` sourced from the inbound
  `x-request-id` (threaded from the request via the `correlationId` middleware),
  rather than the hardcoded nulls used previously. When no request context is
  threaded through (e.g. the realism async path), both fall back to `null`,
  preserving prior behaviour. See [Canonical-AVRO schema](#canonical-avro-schema).
- **`trajectory`** -- pure-GPS telemetry consumed by the external **trajectory-engine**:
  `{ ts, deviceId, deviceType, lat, lon, speed, heading, altitude, accuracy, ignition }`.
  `deviceId` comes from the update's `id`, and `deviceType` is sourced from
  `metadata.deviceType` (omitted automatically when no metadata is present, so the
  payload stays back-compatible with rosters that carry no device type). The payload
  has no `vehicleId` — the engine resolves `deviceId → vehicleId` itself from the
  connector's assignment events. `speed` is converted km/h → m/s, `heading` is
  normalized to `[0, 360)`, `ignition` is derived from speed, and
  `altitude`/`accuracy` (which moveet does not simulate) come from the
  `defaultAltitude` / `defaultAccuracy` config fields.

```json
{
  "type": "redpanda",
  "config": {
    "brokers": "suite_redpanda:9092",
    "topic": "telemetry.device.raw",
    "format": "trajectory",
    "defaultAltitude": 0,
    "defaultAccuracy": 5
  }
}
```

For the engine to receive real `speed` and `heading`, run the simulator with
`ADAPTER_URL` set -- the simulator forwards both on `/sync` (without it, speed
falls back to 0 and ignition to `false`).

The Kafka key is the `keyField` config field — a dot-path resolved against each
message context (`id`, `metadata.deviceId`, etc.). For trajectory telemetry set
`keyField: "id"` so each message is keyed by the device id the trajectory engine
joins on.

### Recipe: drive the real fleet from the connector (pure config)

There is no bespoke connector source. The connector use-case is just the generic
`rest` source pointed at the connector's fleet-roster pull API, plus the
`trajectory` sink preset. The `rest` source pulls the roster, maps each
assignment's `deviceId` to the simulated entity id, and captures `deviceType` /
`vehicleId` as metadata; the `trajectory` sink keys telemetry by that `deviceId`
and emits `deviceType` from the metadata.

```bash
SOURCE_TYPE=rest
SOURCE_CONFIG={"url":"http://suite_connector:3002/api/fleet/roster","vehiclePath":"assignments","fieldMap":{"id":"deviceId"},"metadataMap":{"deviceType":"deviceType","vehicleId":"vehicleId"}}

SINK_TYPES=redpanda
SINK_REDPANDA_CONFIG={"brokers":"suite_redpanda:9092","topic":"telemetry.device.raw","format":"trajectory","keyField":"id"}
```

How it maps:

- **`vehiclePath: "assignments"`** -- iterate the roster's `assignments` array;
  each assignment is one simulated entity. (A device with no `vehicleId` simply
  carries `null` metadata; point `vehiclePath` at whichever array the roster
  endpoint returns.)
- **`fieldMap.id: "deviceId"`** -- the simulated entity's `id` **is** the real
  `deviceId`. The simulator drives one moving entity per device, so positions are
  generated per device and there is no synthetic `vehicleId → device` fan-out to
  maintain.
- **`metadataMap`** -- `deviceType` and `vehicleId` are captured into the
  update's `metadata` and flow end-to-end to the sink.
- **`format: "trajectory"` + `keyField: "id"`** -- the sink emits
  `{ ts, deviceId: <id>, deviceType: <metadata.deviceType>, lat, lon, speed (m/s),
heading, altitude, accuracy, ignition }` and keys each message by the
  `deviceId` — exactly what the trajectory engine consumes. `deviceType` is
  omitted when the roster carried none.

The roster endpoint may return coordinates or not; the `rest` source treats
position as optional (the simulator seeds positions when absent). Supply
`fieldMap.lat` / `fieldMap.lng` if the endpoint does carry coordinates.

#### Equivalent with an explicit `payloadTemplate`

`format: "trajectory"` is shorthand for the template below; use the explicit
template when you need to add or rename fields:

```bash
SINK_REDPANDA_CONFIG={"brokers":"suite_redpanda:9092","topic":"telemetry.device.raw","keyField":"id","payloadTemplate":{"ts":"ts","deviceId":"id","deviceType":"metadata.deviceType","lat":"lat","lon":"lon","speed":"speed","heading":"heading","altitude":"altitude","accuracy":"accuracy","ignition":"ignition"}}
```

### Recipe: co-locate a vehicle's devices (no jumping)

A single vehicle often carries **several devices** — e.g. a fitted GPS unit and
the driver's shift phone. If each device is driven as its own simulated entity,
the two are routed independently and the vehicle appears to "jump" between them.
The fix is two generic, composable features:

- **`groupBy` on the `rest` source** groups the roster by a field (here
  `vehicleId`) so each **vehicle** is **one** simulated entity. Every item in
  the group is recorded under `metadata.devices` as
  `{ id: <deviceId>, ...<metadataMap> }` (e.g. `{ id, deviceType }`). The entity
  `id` is the `groupBy` value; `limit` then caps the number of **groups**.
- **`fanOut` on the `redpanda` sink** takes a dot-path to an array in the
  message context (`metadata.devices`) and emits **one message per element**.
  Every message shares the vehicle's `lat`/`lon`/`speed`/`heading`/`ts`/
  `ignition` (so all the devices are **co-located** — no jump), while the
  current element is exposed as `device` for `keyField` / `payloadTemplate`
  (`device.id`, `device.deviceType`, …). A missing/empty array emits nothing.

```bash
SOURCE_TYPE=rest
SOURCE_CONFIG={"url":"http://suite_connector:3002/api/fleet/roster","vehiclePath":"assignments","groupBy":"vehicleId","fieldMap":{"id":"deviceId"},"metadataMap":{"deviceType":"deviceType"},"limit":30}

SINK_TYPES=redpanda
SINK_REDPANDA_CONFIG={"brokers":"suite_redpanda:9092","topic":"telemetry.device.raw","keyField":"device.id","defaultAltitude":1650,"defaultAccuracy":5,"fanOut":"metadata.devices","payloadTemplate":{"ts":"ts","deviceId":"device.id","deviceType":"device.deviceType","lat":"lat","lon":"lon","speed":"speed","heading":"heading","altitude":"altitude","accuracy":"accuracy","ignition":"ignition"}}
```

Each vehicle is one moving entity; its devices ride along and are emitted at the
**same** position, keyed by each **real** `deviceId`. The trajectory engine
resolves every one of those device ids to that single vehicle — with no jumping.
Both features are fully back-compatible: omit `groupBy` for one entity per item,
omit `fanOut` for one message per update.

### Chunked publishing

When a publish exceeds `batchSize`, the Redpanda sink splits it into chunks and
sends them **concurrently** (`Promise.allSettled`) rather than sequentially as it
did before. This is safe because the message stream is keyed per-entity
(per-vehicle/per-device) and chunking splits across keys, so two chunks never
carry the same key -- Kafka preserves order within a key and there is no
cross-key ordering to preserve. Parallelising lifts throughput from O(sum of
chunk latencies) to O(max chunk latency), and a transient failure in one chunk
no longer aborts the rest: failed chunks are reported (counts + `failures[]`) and
dropped (at-most-once, no DLQ), while the remaining chunks still deliver. If
**every** chunk fails (nothing delivered), the sink throws so the publisher marks
it failed. The chunk-split and parallel fan-out machinery lives in the shared
`src/plugins/format/chunking.ts`.

### Canonical-AVRO schema

The `canonical-avro` envelope's AVRO schema is no longer hardcoded inline; it is
extracted to a versioned artifact at
`src/plugins/sinks/schemas/canonical-telemetry.v1.avsc`, loaded at module init.
Keeping it as a standalone `.avsc` lets it be reviewed/diffed as a contract
artifact and round-trip tested against the real `avsc` codec (the same codec the
Confluent Schema Registry uses) in
`src/plugins/sinks/redpanda.avro-roundtrip.test.ts` -- encoding then decoding the
exact envelopes the sink emits, in-process and offline, which catches
schema/payload mismatches a mocked registry cannot. The schema is registered
under the subject `telemetry.device.raw-telemetry.location.reported`.

The Redpanda sink's reusable, transport-agnostic pieces now live under
`src/plugins/format/`: `template.ts` (the payload-template engine), `context.ts`
(per-message context + `fanOut` expansion), and `chunking.ts` (chunk split +
concurrent fan-out with per-chunk accounting). They know nothing about Kafka or
AVRO, so other sinks could reuse them; only Redpanda consumes them today.

## Telemetry realism

An optional engine that degrades outgoing telemetry for **all** sinks to mimic
real-world device behavior. **Off by default** — it only engages when
`REALISM_CONFIG` (or a runtime `POST /config/realism`) sets `enabled: true`.
When enabled it applies three independent effects:

1. **Correlated GPS noise** -- a first-order Gauss-Markov process perturbs
   lat/lon so error _drifts_ realistically over time instead of jumping each
   tick. Reported `accuracy` is derived from the same model, and degrades in the
   poor-signal state.
2. **Connectivity dropouts (store-and-forward)** -- a 3-state Markov model
   (connected / degraded / disconnected) toggles connectivity. Updates produced
   while offline are buffered and flushed (with their original, back-dated
   timestamps) on reconnect, or dropped if `storeAndForward:false`.
3. **Jittered reporting cadence** -- emission is decoupled from ingest. The
   engine reports each device on a jittered `reportingPeriodMs`, not on every
   incoming `/sync`.

Because emission becomes asynchronous when the engine is enabled, **`POST /sync`
returns HTTP 202** (accepted) instead of per-sink results.

Configure at startup via `REALISM_CONFIG` (a JSON string), at runtime via
`POST /config/realism`, or interactively from the UI's **Realism** tab. Config
keys (all optional; sensible defaults applied):

```jsonc
{
  "enabled": false,
  "reportingPeriodMs": 5000, // nominal per-device emit period
  "jitterMs": 800, // std-dev of Gaussian cadence jitter
  "gps": {
    "connectedSigmaM": 4,
    "connectedTauS": 120,
    "degradedSigmaM": 25,
    "degradedTauS": 30,
  },
  "connectivity": {
    "meanConnectedS": 600,
    "meanDegradedS": 45,
    "meanDisconnectedS": 60,
    "degradedFromConnectedS": 120,
  },
  "storeAndForward": true,
  "maxBufferPerDevice": 500,
  "emitStaleAfterMs": 15000, // stop emitting a device with no ingest within this window (0 = never)
  "seed": 0, // optional: deterministic RNG for reproducible runs
}
```

Because emission is decoupled from ingest, the engine would otherwise replay
each device's last-known position forever — so a paused/stopped simulator (which
stops calling `/sync`) would still produce telemetry. `emitStaleAfterMs` closes
that: a device whose true state hasn't been refreshed within the window is
**quiesced and evicted** (telemetry goes quiet a few seconds after pause, and
memory stays bounded); the next ingest re-creates it fresh. Set `0` to keep
emitting the last-known position indefinitely.

`GET /config` returns a `realism` block (`{ config, schema, status }`); the
`status` reports live per-state device counts and buffered-sample totals, which
the UI Realism tab polls.

## Commands

```bash
npm run dev      # Start dev server with hot-reload (tsx watch)
npm run build    # Compile TypeScript to dist/
npm start        # Run production build (NODE_ENV=production)
npm run type-check # Type-check without emitting
npm test         # Run tests (vitest)
# Lint + format run repo-wide via Biome from the root: `npm run lint` / `npm run format`
```

## Docker

Build and run:

```bash
docker build -t moveet-adapter .
docker run -p 5011:5011 moveet-adapter
```

Override configuration with environment variables:

```bash
docker run -p 5011:5011 \
  -e USE_ALTERNATIVE_API=true \
  -e ALTERNATIVE_API_URL=http://host.docker.internal:4001/graphql \
  -e REDPANDA_BROKERS=host.docker.internal:19092 \
  moveet-adapter
```

Or run the full Moveet stack via Docker Compose from the `apps/simulator/` directory:

```bash
cd ../simulator && docker compose up
```

## Project Structure

```
src/
  index.ts                   # Express server, routes, plugin registration, auto-config
  metrics.ts                 # prom-client registry + custom collectors; GET /metrics handler
  utils/config.ts            # Centralized config from env vars
  types/index.ts             # Vehicle, VehicleUpdate, and enum types
  plugins/
    types.ts                 # DataSource, DataSink, PluginConfig, PublishContext interfaces
    manager.ts               # PluginManager — registry, lifecycle, fan-out
    format/                  # Sink-generic payload helpers (extracted from redpanda)
      template.ts            # Payload-template engine
      context.ts             # Per-message context + fanOut expansion
      chunking.ts            # Chunk split + concurrent fan-out with per-chunk accounting
    sources/
      graphql.ts             # GraphQL source
      rest.ts                # REST source
      static.ts              # Static/mock source
      mysql.ts               # MySQL source
      postgres.ts            # PostgreSQL source
    sinks/
      graphql.ts             # GraphQL sink
      rest.ts                # REST sink
      redpanda.ts            # Redpanda/Kafka sink (KafkaJS)
      redis.ts               # Redis Pub/Sub sink
      webhook.ts             # Webhook sink
      console.ts             # Console/stdout sink
      schemas/
        canonical-telemetry.v1.avsc  # Versioned canonical telemetry AVRO schema
```

## License

MIT
