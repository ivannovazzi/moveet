# Moveet Simulator

Vehicle location simulator for fleet management systems. Simulates multiple vehicles moving along real road networks using OpenStreetMap data with features like heat zones, pathfinding, and external adapter integration.

## Features

- **Real Road Networks**: Uses OpenStreetMap GeoJSON data for realistic vehicle movement
- **Heat Zones**: Dynamic areas that affect vehicle behavior and speed
- **A\* Pathfinding**: Intelligent routing between locations
- **WebSocket Support**: Real-time vehicle updates
- **External Adapter**: Integration with external fleet management systems
- **Rate Limiting**: Built-in protection against API abuse
- **Docker Support**: Easy deployment with Docker and docker-compose

## Requirements

- Node.js >= 18
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

| Variable                | Description                                                | Default                |
| ----------------------- | ---------------------------------------------------------- | ---------------------- |
| `PORT`                  | HTTP server port                                           | 5010                   |
| `GEOJSON_PATH`          | Path to OpenStreetMap GeoJSON file                         | ./data/network.geojson |
| `UPDATE_INTERVAL`       | Vehicle position update frequency (ms)                     | 500                    |
| `MIN_SPEED`             | Minimum vehicle speed (km/h)                               | 20                     |
| `MAX_SPEED`             | Maximum vehicle speed (km/h)                               | 60                     |
| `ACCELERATION`          | Speed increase rate (km/h/update)                          | 5                      |
| `DECELERATION`          | Speed decrease rate (km/h/update)                          | 7                      |
| `TURN_THRESHOLD`        | Angle to trigger turn behavior (degrees)                   | 30                     |
| `SPEED_VARIATION`       | Speed randomization factor (0.0-1.0)                       | 0.1                    |
| `HEATZONE_SPEED_FACTOR` | Speed reduction in heat zones (0.0-1.0)                    | 0.5                    |
| `ADAPTER_URL`           | URL of external adapter service (enables adapter when set) | -                      |
| `SYNC_ADAPTER_TIMEOUT`  | Interval for syncing vehicle positions to adapter (ms)     | 5000                   |

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

**Message Types:**

- `vehicle`: Vehicle position update
- `status`: Simulation status change
- `heatzones`: Heat zone updates
- `direction`: Vehicle direction change
- `options`: Configuration change

## Docker Usage

### Build and Run

```bash
docker build -t moveet-simulator .
docker run -p 5010:3000 -v $(pwd)/export.geojson:/app/export.geojson moveet-simulator
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

```
┌─────────────────┐
│   HTTP/WS API   │
└────────┬────────┘
         │
    ┌────┴─────┐
    │  index   │
    └────┬─────┘
         │
    ┌────┴──────────────┐
    │ SimulationController│
    └────┬──────────────┘
         │
    ┌────┴─────────┐
    │VehicleManager│
    └────┬─────────┘
         │
    ┌────┴───────┐      ┌─────────┐
    │RoadNetwork │──────│ Adapter │
    └────────────┘      └─────────┘
         │
    ┌────┴──────────┐
    │ HeatZoneManager│
    └───────────────┘
```

## Troubleshooting

### Application won't start

**Check GeoJSON file exists:**

```bash
ls -la export.geojson
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
