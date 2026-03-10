# Moveet

[![CI](https://github.com/ivannovazzi/moveet/actions/workflows/ci.yml/badge.svg)](https://github.com/ivannovazzi/moveet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](apps/simulator/compose.yml)

A real-time vehicle fleet simulator built around provider-agnostic road-network data, with A\* pathfinding, realistic movement physics, and a custom browser-side route rendering engine.

<!-- Screenshot goes here -->

---

## Features

- **Map-data agnostic simulation core** -- ingests GeoJSON/OpenStreetMap-derived road graphs and can be adapted to any compatible road network dataset rather than a single baked-in map provider or city
- **A\* pathfinding on graph topology** -- computes routes with a haversine heuristic across bidirectional road segments and node-level connectivity
- **Realistic vehicle motion model** -- updates each vehicle independently with acceleration, deceleration, and turn-speed reduction
- **Custom route drawing engine** -- renders roads, routes, vehicles, POIs, and overlays through a D3-driven HTML/SVG scene instead of Leaflet, Mapbox, or a tile-widget dependency
- **Real-time state distribution** -- WebSocket streams push vehicle positions, route updates, heat zones, and simulation state to connected clients
- **Heat-zone generation** -- derives traffic density regions around high-connectivity intersections
- **Interactive operator UI** -- includes vehicle filtering, route visualization, POI search, simulation controls, and contextual actions
- **Optional external integration** -- adapter service bridges to external fleet management APIs via GraphQL and Kafka/Redpanda
- **Docker Compose** -- single-command deployment of all three services

## Use Case

Moveet exists to generate realistic, moving vehicle data on real road networks -- the kind of data you need when building or testing fleet management software but don't have a fleet driving around.

Point it at any environment -- staging, CI, local dev -- and it will continuously produce GPS positions, speeds, and routes that behave like real vehicles: they follow actual roads, accelerate and brake through turns, and cluster in traffic zones. The adapter's plugin system lets you push that data wherever your application expects it.

### Data Sources & Sinks

The adapter service uses a plugin architecture to connect the simulator to external systems. Plugins are hot-swappable at runtime via REST API, so you can reconfigure integrations without restarting.

**Sources** (where vehicles are read from):

| Plugin | Description |
|---|---|
| `static` | Built-in synthetic vehicles (default, no external dependency) |
| `graphql` | Fetch vehicles from a GraphQL API |
| `rest` | Fetch vehicles from a REST API |
| `mysql` | Query vehicles from a MySQL database |
| `postgres` | Query vehicles from a PostgreSQL database |

**Sinks** (where position updates are pushed to):

| Plugin | Description |
|---|---|
| `console` | Log updates to stdout (debugging) |
| `graphql` | Push updates to a GraphQL mutation endpoint |
| `rest` | POST updates to a REST API |
| `kafka` | Publish to Kafka/Redpanda topics |
| `redis` | Publish to Redis channels |
| `webhook` | Fire-and-forget HTTP webhooks |

Multiple sinks can be active simultaneously -- e.g. stream to Kafka for your event pipeline while also pushing to a REST endpoint for a legacy system.

## Architecture

```
apps/ui (React + D3 route renderer)
    |  REST + WebSocket
    v
apps/simulator (simulation engine, Express + WS, road-network graph)
    |  GET /vehicles, POST /sync
    v
apps/adapter (optional bridge to external fleet management APIs)
    |  GraphQL + Kafka/Redpanda
    v
External API  or  Local dev stack
```

The **simulator** is the core service and works standalone with synthetic vehicles plus a routable road-network graph. The **UI** connects to it for visualization and implements its own browser-native route/map drawing layer using React + D3 over HTML/SVG primitives. The **adapter** is only needed when integrating with external fleet management systems.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [npm](https://www.npmjs.com/) >= 9
- [Yarn](https://yarnpkg.com/) (for the UI project)
- [Docker](https://www.docker.com/) (optional, for containerized deployment)

### Install and Run

```bash
# Clone the repository
git clone https://github.com/ivannovazzi/moveet.git
cd moveet

# Install dependencies (npm workspaces + Turborepo)
npm install

# Start all services in development mode
npm run dev
```

This starts all three services via Turborepo. Alternatively, start them individually:

```bash
# Simulator only (port 5010)
npm run dev:sim

# UI only (port 5012)
npm run dev:ui

# Adapter only (port 5011)
npm run dev:adapter
```

Or run each project directly:

```bash
# Terminal 1: Simulator
cd apps/simulator && npm run dev

# Terminal 2: UI
cd apps/ui && yarn dev

# Terminal 3 (optional): Adapter
cd apps/adapter && npm run dev
```

Once running, open [http://localhost:5012](http://localhost:5012) to view the dashboard.

## Docker Compose

All three services can be run together with Docker Compose:

```bash
cd apps/simulator && docker compose up
```

## Project Structure

| Project | Path | Description | Port | Package Manager |
|---|---|---|---|---|
| **simulator** | [`apps/simulator/`](apps/simulator/) | Simulation engine -- map-data ingestion, road-network graph construction, A\* pathfinding, vehicle movement, REST API + WebSocket | 5010 | npm |
| **adapter** | [`apps/adapter/`](apps/adapter/) | Bridge service -- translates between simulator HTTP API and external systems (GraphQL, Kafka) | 5011 | npm |
| **ui** | [`apps/ui/`](apps/ui/) | Dashboard -- custom HTML/SVG rendering engine for roads, routes, vehicles, heat zones, POIs, and real-time operator controls | 5012 | yarn |

Each project has its own README with detailed architecture documentation.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ES2022 target) |
| Simulator | Node.js, Express, WebSocket (ws), Turf.js |
| UI | React 19, D3.js 7, Vite, Sass, CSS Modules |
| Adapter | Express, graphql-request, KafkaJS, ioredis |
| Testing | Vitest, Testing Library |
| Build | Turborepo, npm workspaces |
| Deployment | Docker, Docker Compose |

## Testing

Tests are written with [Vitest](https://vitest.dev/) across all projects. Run the full suite from the root:

```bash
npm test
```

Or run tests for a specific project:

```bash
# Simulator tests (pathfinding, heat zones, adapter)
cd apps/simulator && npm test

# UI tests (components, hooks)
cd apps/ui && yarn test
```

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

Please see [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) Ivan Novazzi
