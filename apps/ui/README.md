# Moveet UI

A React/TypeScript dashboard for the [Moveet](../simulator/) vehicle simulator. Renders a custom D3.js SVG map -- no Leaflet or Mapbox -- showing real-time vehicle positions, routes, heat zones, and points of interest over the Nairobi road network.

## Features

- **Real-time vehicle tracking** via WebSocket with exponential backoff reconnection
- **Custom SVG map renderer** built on D3.js (geoMercator projection, zoom/pan, viewport culling)
- **Route visualization** with animated direction polylines
- **Heat zones and traffic overlays** using D3 contour density
- **POI markers** with spatial deduplication and viewport culling
- **Road network overlay** rendered from GeoJSON
- **Search** with typeahead over roads and POIs
- **Control panel** for simulation parameters, vehicle list, and display toggles

## Tech Stack

- React 19, TypeScript, Vite
- D3.js v7 (projection, zoom, rendering)
- CSS Modules with `classnames` for conditional styling
- Vitest, @testing-library/react, jsdom for testing
- ESLint + Prettier for linting and formatting

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm (ships with Node.js)
- The [simulator](../simulator/) running on port 5010

### Install

```bash
npm install
```

### Environment

Create a `.env` file or rely on the defaults:

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5010` | Simulator REST API base URL |
| `VITE_WS_URL` | `ws://localhost:5010` | Simulator WebSocket URL |

### Run

```bash
npm run dev
```

The dev server starts on [http://localhost:5012](http://localhost:5012) with hot module replacement.

## Available Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and produce a production build |
| `npm test` | Run tests in watch mode (Vitest) |
| `npm run test:coverage` | Run tests with v8 coverage report |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format files with Prettier |
| `npm run format:check` | Check formatting (useful in CI) |

## Architecture Overview

```
Backend REST + WebSocket (port 5010)
    |
SimulationService (singleton HTTP + WS client)
    |
DataProvider (React Context)
    |
App.tsx
    |
    +-- ControlPanel    -- status, vehicle list, simulation params, toggles
    +-- Map             -- D3 SVG renderer with layered visuals
    +-- SearchBar       -- typeahead over roads and POIs
    +-- ContextMenu     -- right-click actions
```

**SimulationService** (`src/utils/client.ts`) combines an HTTP client and a WebSocket client into a single entry point for all backend communication. The WebSocket client reconnects automatically with exponential backoff (up to 30 seconds, max 10 attempts).

**DataProvider** exposes simulation state (options, roads, POIs, directions, heat zones, network) through React Context, consumed by the rest of the component tree.

**Map** (`src/components/Map/RoadNetworkMap.tsx`) uses `d3.geoMercator()` with `fitSize()` to project GeoJSON coordinates onto an SVG canvas. Zoom and pan are handled by `d3.zoom()`. The map exposes three React contexts -- `MapContext` (projection and transform), `MapControlsContext` (imperative zoom/pan), and `OverlayContext` (HTML element positioning) -- and renders through two layers: an SVG `<g>` group for geometric primitives and an absolute-positioned `<div>` for HTML markers.

**Key hooks**: `useVehicles` (batches WebSocket updates via `requestAnimationFrame`), `useOptions` (debounced server writes), `useDirections`, `useNetwork`, `useRoads`, `usePois`, `useHeatzones`.

Path alias: `@/` maps to `./src/` (configured in `vite.config.ts` and `tsconfig.app.json`).

## License

MIT
