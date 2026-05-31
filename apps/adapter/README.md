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

| Variable              | Default                         | Description                                                                                                                                     |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `5011`                          | Server port                                                                                                                                     |
| `CORS_ORIGINS`        | `*`                             | Allowed CORS origins. Use `*` to allow all origins, or a comma-separated list (e.g. `http://localhost:5010,http://localhost:5012`) to restrict. |
| `API_URL`             | --                              | GraphQL API URL (GraphQL mode)                                                                                                                  |
| `TOKEN`               | --                              | Auth token for GraphQL API (GraphQL mode)                                                                                                       |
| `USE_ALTERNATIVE_API` | `false`                         | Set to `true` for alternative mode                                                                                                              |
| `ALTERNATIVE_API_URL` | `http://localhost:4001/graphql` | Local GraphQL API URL (alternative mode)                                                                                                        |
| `REDPANDA_BROKERS`    | `localhost:19092`               | Comma-separated Redpanda/Kafka broker addresses                                                                                                 |
| `REDPANDA_TOPIC`      | `dispatch.vehicle.positions`    | Kafka topic for vehicle position updates                                                                                                        |

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

**`GET /health`** -- Returns health check status for the active source and all sinks.

### Redpanda sink: payload formats

The Redpanda sink supports two output shapes via its `format` config field:

- **`dispatch`** (default) -- moveet's native event:
  `{ eventType, eventId, occurredOn, vehicleId, vehicleType, latitude, longitude, timestamp }`.
- **`trajectory`** -- pure-GPS telemetry consumed by the external **trajectory-engine**:
  `{ ts, deviceId, lat, lon, speed, heading, altitude, accuracy, ignition }`, keyed
  by the string `deviceId`. The payload carries `deviceId` as a string and has no
  `vehicleId` — the engine resolves `deviceId → vehicleId` itself from the
  connector's assignment events. `speed` is converted km/h → m/s, `heading` is
  normalized to `[0, 360)`, `ignition` is derived from speed, and
  `altitude`/`accuracy` (which moveet does not simulate) come from the
  `defaultAltitude` / `defaultAccuracy` config fields.

```json
{
  "type": "redpanda",
  "config": {
    "brokers": "suite_redpanda:9092",
    "topic": "trajectory.telemetry.raw",
    "format": "trajectory",
    "defaultAltitude": 0,
    "defaultAccuracy": 5
  }
}
```

For the engine to receive real `speed` and `heading`, run the simulator with
`ADAPTER_URL` set -- the simulator forwards both on `/sync` (without it, speed
falls back to 0 and ignition to `false`).

The trajectory sink also takes a `keyBy` field that selects which id becomes the
Kafka key and the payload's `deviceId`:

- **`vehicleId`** (default) -- synthetic mode: the simulator's own id (e.g.
  `"static-0"`) is emitted verbatim as the string `deviceId` and used as the
  Kafka key. Use with synthetic sources; behaviour is unchanged.
- **`deviceId`** -- the simulator is driving the connector's **real** vehicles
  (see the `connector` source below), so each update fans out to the device(s)
  currently bound to that vehicle. Both the Kafka key and the payload `deviceId`
  are the real connector `deviceId`. Vehicles with no currently-bound device
  emit nothing.

### `connector` source: load the real fleet roster

`SOURCE_TYPE=connector` makes the adapter consume the connector's
(dispatch-cc-consumer) two **compacted AVRO topics** to build an in-memory fleet
roster instead of synthesising vehicles:

- `trajectory.fleet.vehicle` (key = `vehicleId`) -- the vehicle catalogue.
- `trajectory.fleet.assignment` (key = `deviceId`) -- device→vehicle bindings;
  a `null` `vehicle_id` unbinds the device.

Messages are decoded through the **Confluent Schema Registry** (the writer
schema is resolved by the id embedded in each message, so moveet doesn't carry
the AVRO definitions — it re-validates the decoded shape with Zod). The source
drains both topics from the beginning to the current end of log, then exposes
one vehicle per **bound** vehicle (real `vehicleId`s). Pair it with the
`trajectory` sink keyed by `deviceId` so the engine joins moveet's telemetry to
the connector's assignments by the same real device ids.

```json
{
  "type": "connector",
  "config": {
    "brokers": "suite_redpanda:9092",
    "schemaRegistry": "http://suite_redpanda:18081",
    "vehicleTopic": "trajectory.fleet.vehicle",
    "assignmentTopic": "trajectory.fleet.assignment"
  }
}
```

## Commands

```bash
npm run dev      # Start dev server with hot-reload (tsx watch)
npm run build    # Compile TypeScript to dist/
npm start        # Run production build (NODE_ENV=production)
npm run lint     # Type-check without emitting
npm test         # Run tests (vitest)
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
  utils/config.ts            # Centralized config from env vars
  types/index.ts             # Vehicle, VehicleUpdate, and enum types
  plugins/
    types.ts                 # DataSource, DataSink, PluginConfig interfaces
    manager.ts               # PluginManager — registry, lifecycle, fan-out
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
```

## License

MIT
