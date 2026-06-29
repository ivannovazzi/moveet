# Moveet Simulator

Vehicle location simulator for fleet management systems. Simulates multiple vehicles moving along real road networks using OpenStreetMap data with features like heat zones, pathfinding, and external adapter integration.

## Features

- **Real Road Networks**: builds a bidirectional graph from OpenStreetMap GeoJSON for realistic movement
- **A\* Pathfinding**: haversine-heuristic routing, off-loaded to a worker-thread pool; turn restrictions, one-ways, surface/smoothness and congestion costs
- **Multi-stop Routing**: waypoints with per-stop dwell times
- **Traffic & Heat Zones**: time-of-day congestion model and dynamic slowdown polygons
- **Incidents**: accidents/closures/construction that re-cost the network and trigger reroutes
- **Geofences**: enter/exit detection with events
- **Fleets**: fleet definitions and vehicle assignment
- **Recording & Replay**: capture a live run to NDJSON and replay it
- **Headless Generation**: deterministic fast-forward generation of recordings
- **Analytics**: per-tick fleet/vehicle stats, broadcast and persisted as a time-series
- **Persistence**: optional SQLite state snapshots + restore
- **Real-time Transport**: WebSocket broadcasting; optional external adapter integration
- **Rate Limiting** and **Docker Support**

## Requirements

- Node.js 26 (the repo pins Node 26; the `better-sqlite3` native module is compiled for your Node major on install)
- Docker (optional)
- OpenStreetMap export file (.geojson)

## Installation

```bash
git clone https://github.com/ivannovazzi/moveet.git
cd moveet/apps/simulator
npm install
```

## Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration. **Required variables:**

```bash
GEOJSON_PATH=./data/network.geojson
```

## Configuration Options

All config is parsed and validated through a single zod schema in `src/utils/config.ts`. Invalid values fail fast at startup with a descriptive error.

| Variable                | Description                                                                              | Default                |
| ----------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `PORT`                  | HTTP server port                                                                         | 5010                   |
| `GEOJSON_PATH`          | Path to OpenStreetMap GeoJSON file                                                       | ./data/network.geojson |
| `UPDATE_INTERVAL`       | Vehicle position update frequency (ms)                                                   | 500                    |
| `MIN_SPEED`             | Minimum vehicle speed (km/h)                                                             | 20                     |
| `MAX_SPEED`             | Maximum vehicle speed (km/h); must be greater than `MIN_SPEED`                           | 60                     |
| `ACCELERATION`          | Speed increase rate (km/h per tick)                                                      | 5                      |
| `DECELERATION`          | Speed decrease rate (km/h per tick)                                                      | 7                      |
| `TURN_THRESHOLD`        | Angle to trigger turn slowdown (degrees)                                                 | 30                     |
| `SPEED_VARIATION`       | Speed randomization factor (0.0-1.0)                                                     | 0.1                    |
| `HEATZONE_SPEED_FACTOR` | Speed multiplier inside heat zones (0.0-1.0)                                             | 0.5                    |
| `VEHICLE_COUNT`         | Number of synthetic vehicles when running without an adapter                             | 70                     |
| `VEHICLE_TYPES`         | Optional JSON vehicle-type distribution override (empty = built-in weighting)            | (built-in)             |
| `ADAPTER_URL`           | URL of the external adapter service. **Presence enables the adapter**; empty = disabled  | (empty)                |
| `ADAPTER_SYNC_INTERVAL` | How often (ms) vehicle positions are pushed to the adapter. 0 = follow `UPDATE_INTERVAL` | 0                      |
| `SYNC_ADAPTER_TIMEOUT`  | Timeout (ms) for each adapter sync request                                               | 5000                   |
| `PERSISTENCE_ENABLED`   | Enable the SQLite persistence layer                                                      | false                  |
| `PERSISTENCE_INTERVAL`  | Auto-save snapshot interval (seconds)                                                    | 30                     |
| `RESTORE_STATE`         | Restore state from the latest snapshot on startup                                        | false                  |
| `STATE_DB_PATH`         | Path to the SQLite state database                                                        | data/state.db          |
| `ANALYTICS_INTERVAL`    | How often (ms) the analytics snapshot is broadcast and persisted                         | 5000                   |
| `LOG_LEVEL`             | Pino log level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`)                  | info                   |

> Note: there is no `USE_ADAPTER` or `SYNC_ADAPTER` flag. The adapter is enabled simply by setting `ADAPTER_URL`.

## API Endpoints

### Simulation Control

#### `GET /status`

Get current simulation status.

**Response:**

```json
{
  "isRunning": true,
  "vehicleCount": 10,
  "updateInterval": 500
}
```

#### `POST /start`

Start the simulation with optional configuration.

**Request Body:**

```json
{
  "updateInterval": 500,
  "minSpeed": 20,
  "maxSpeed": 60
}
```

#### `POST /stop`

Stop the simulation.

#### `POST /reset`

Reset the simulation to initial state.

### Vehicle Management

#### `GET /vehicles`

Get all vehicles with their current state.

**Response:**

```json
[
  {
    "id": "vehicle-1",
    "name": "Vehicle 1",
    "position": [45.5017, -73.5673],
    "speed": 45,
    "status": "moving"
  }
]
```

#### `POST /direction`

Set destination for specific vehicles.

**Request Body:**

```json
[
  {
    "id": "vehicle-1",
    "lat": 45.5017,
    "lng": -73.5673
  }
]
```

### Network Queries

#### `POST /find-node`

Find the nearest road network node to coordinates. **Rate limited.**

**Request Body:** `[longitude, latitude]`

#### `POST /find-road`

Find the nearest road to coordinates. **Rate limited.**

**Request Body:** `[longitude, latitude]`

#### `POST /search`

Search for locations by name. **Rate limited.**

**Request Body:**

```json
{
  "query": "Main Street"
}
```

#### `GET /network`

Get the entire road network (GeoJSON).

#### `GET /roads`

Get all roads in the network.

#### `GET /pois`

Get all points of interest.

### Heat Zones

#### `POST /heatzones`

Generate new heat zones.

#### `GET /heatzones`

Get current heat zones.

### Configuration

#### `GET /options`

Get current simulation options.

#### `POST /options`

Update simulation options.

## WebSocket API

Connect to `ws://localhost:5010` for real-time updates.

**Message Types** (non-exhaustive): `vehicle`/`vehicles`, `status`, `clock`, `options`, `heatzones`, `direction`, `traffic`, `analytics`, `waypoint:reached`, `route:completed`, `vehicle:rerouted`, `incident:created`, `incident:cleared`, `geofence:event`, `fleet:created`/`fleet:deleted`/`fleet:assigned`, `scenario:*`, `replay:status`, `generate:progress`/`generate:complete`/`generate:error`, `reset`.

Beyond the endpoints shown above, the API also exposes incidents (`/incidents`), geofences (`/geofences`), fleets (`/fleets`), analytics (`/analytics/*`), traffic (`/traffic`, `/traffic-profile`), clock (`/clock`), speed limits (`/speed-limits`), recording, replay (`/replay/status`), scenarios, and state persistence (`/state/save`, `/state/restore`, `/state/snapshots`). See the OpenAPI/Scalar reference served by the app for the full set.

## Docker Usage

### Build and Run

```bash
docker build -t moveet-simulator .
docker run -p 5010:3000 -v $(pwd)/data/network.geojson:/app/data/network.geojson moveet-simulator
```

### Using Docker Compose

```bash
docker compose up
```

## Development

### Start Development Server

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

## Architecture

This is a ~40-module, EventEmitter-based system. `src/index.ts` mounts the Express routes and WebSocket server; `src/setup/eventWiring.ts` is the single hub that forwards every module's events to the `WebSocketBroadcaster` and recording layer.

```
                 HTTP + WebSocket API (src/routes, src/setup)
                                │
                       SimulationController  ──────────────►  ReplayManager
                                │                              ScenarioManager
                                ▼                              GenerationManager / HeadlessRunner
                          VehicleManager (facade)
        ┌──────────────┬───────────┴───────────┬───────────────┐
        ▼              ▼                        ▼               ▼
  VehicleRegistry  RouteManager            GameLoop      AdapterSyncManager ──► Adapter
  (+ spatial idx)   │  (physics, routes)   (tick)        AnalyticsAccumulator
                    ▼
                RoadNetwork  ──► pathfinding/{cost,heap}  +  PathfindingPool ─► pathfinding-worker (threads)
                    │
        ┌───────────┼───────────┬───────────┬──────────────┐
        ▼           ▼           ▼           ▼              ▼
  HeatZoneManager TrafficManager IncidentManager GeoFenceManager  (domain features)

  StateStore + PersistenceManager (SQLite snapshots + analytics_history)
  WebSocketBroadcaster (batched vehicle updates)
```

See `CLAUDE.md` for a fuller module breakdown.

## Troubleshooting

### Application won't start

**Check GeoJSON file exists:**

```bash
ls -la data/network.geojson
```

**Verify environment variables:**

```bash
cat .env
```

### Vehicles not moving

- Ensure simulation is started: `POST /start`
- Check vehicle count: `GET /vehicles`
- Verify GeoJSON has valid road network

### High memory usage

- Reduce number of vehicles
- Increase `UPDATE_INTERVAL`
- Check for memory leaks in logs

### Rate limit errors

- Reduce request frequency
- Increase rate limit in code (not recommended for production)

## License

MIT
