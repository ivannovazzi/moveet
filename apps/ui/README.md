# Moveet UI

A React/TypeScript dashboard for the [Moveet](../simulator/) vehicle simulator. It renders a real-time, GPU-accelerated map of vehicle positions, routes, traffic, heat zones, incidents, geofences, and points of interest over the road network using deck.gl 9 (WebGL) — no Leaflet or Mapbox.

## Features

- **Real-time vehicle tracking** via WebSocket with exponential-backoff reconnection
- **WebGL map renderer** built on deck.gl 9 + luma.gl (`IconLayer`, `PathLayer`, `ScatterplotLayer`, `PolygonLayer`) over a `MapView` / `WebMercatorViewport`
- **Smooth vehicle animation** — a `requestAnimationFrame` hot path interpolates positions/headings between WebSocket ticks
- **Route visualization** with direction paths, multi-stop waypoints, and ETAs
- **Traffic overlay** (Google-Maps-style congestion ramp), **heat zones**, and a vehicle **heatmap**
- **Incidents, geofences (draw + alerts), POIs, speed-limit signs, breadcrumb trails**
- **Dispatch flow** — multi-select vehicles, set waypoints on the map, batch-dispatch with per-vehicle results
- **Record & replay** with scrubbing and speed control
- **Search** with typeahead over roads and POIs
- **Cursor-anchored map context menu** (right-click) with collision-aware positioning, keyboard nav, and typeahead, built on the Radix `DropdownMenu` primitive
- **Toast notifications** (sonner) on key async actions
- **Polished surface treatment** — refined easing, a layered shadow scale with built-in edge highlights, soft surface gradients, and curated entrance animations, all behind the reduced-motion guard

## Tech Stack

- **React 19**, **TypeScript**, **Vite 8**
- **deck.gl 9** (`@deck.gl/core|layers|react|geo-layers|aggregation-layers|extensions`) + **luma.gl 9** (`@luma.gl/core|webgl`, WebGL2 adapter) for all map rendering
- **Tailwind CSS v4** (`@tailwindcss/vite`) with an oklch design-token `@theme` (dark-only)
- **shadcn/ui** primitives (Radix-based) with the `cn()` class-merge helper (`clsx` + `tailwind-merge`)
- **lucide-react** icons, **cmdk** command palette, **sonner** toasts
- **Vitest** + **@testing-library/react** + **jsdom** for tests

## Getting Started

### Prerequisites

- Node.js (LTS recommended) and npm
- The [simulator](../simulator/) running on port 5010

### Install & run

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5012 with HMR
```

### Environment

| Variable       | Default                 | Description                 |
| -------------- | ----------------------- | --------------------------- |
| `VITE_API_URL` | `http://localhost:5010` | Simulator REST API base URL |
| `VITE_WS_URL`  | `ws://localhost:5010`   | Simulator WebSocket URL     |

## Available Commands

| Command                           | Description                                          |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev`                     | Vite dev server with HMR                             |
| `npm run build`                   | Type-check (`tsc -b`) and produce a production build |
| `npm run type-check`              | Type-check only (`tsc -b --noEmit`)                  |
| `npm test`                        | Run tests once (Vitest)                              |
| `npm run test:watch`              | Run tests in watch mode                              |
| `npm run test:coverage`           | Run tests with v8 coverage                           |

Linting and formatting are handled repo-wide by **Biome**; run `npm run lint` / `npm run format` from the monorepo root (there are no per-app lint/format scripts).

## Architecture Overview

```
Simulator REST + WebSocket (port 5010)
    │
SimulationService (src/utils/client.ts) — singleton HttpClient + WebSocketClient,
    composed from per-domain segment classes in src/utils/client/
    │
    ├── vehicleStore (src/hooks/vehicleStore.ts) — external store; WS vehicle
    │     ticks land here directly (no React) and the deck.gl layer reads it
    │     on every RAF frame
    │
    └── DataProvider (src/data/) — React Context, split per domain
          (options, roads, pois, directions, heatzones, network, dataReady)
    │
App.tsx — layout, WS lifecycle, vehicle filters/selection, dispatch/geofence/…
    │
    ├── Controls (src/Controls/)  — icon rail + sliding panels (vehicles, fleets,
    │                                incidents, analytics, geofences, adapter, …)
    ├── Map (src/Map/ + src/components/Map/) — deck.gl WebGL canvas + layers
    └── SearchBar / Zoom / BottomDock / legends
```

### Map system (deck.gl, no third-party map library)

`src/components/Map/components/DeckGLMap.tsx` is the WebGL canvas:

- A `MapView` with a controller; view state is managed by `useDeckViewState` (fit-to-bounds on first load, pan/zoom/`FlyToInterpolator`).
- A `WebMercatorViewport` is rebuilt from the view state and exposed through `useMapContext()` (`project`, `getZoom`, `getBoundingBox`, `viewport`/`viewState`).
- **Layer registry pattern**: feature components (`src/Map/**`) render `null` and register their deck.gl layers via `useRegisterLayers(id, layers)` (`src/components/Map/hooks/useDeckLayers.ts`). The manager batches register/unregister into one microtask-coalesced rebuild, sorts by a fixed z-order, and feeds a single `layers` array to `<DeckGL>`. Road layers are built directly in `DeckGLMap`.
- `DeckGLMap` is loaded lazily (`React.lazy` + `Suspense`) so the shell/controls paint before the deck.gl/luma.gl chunk is fetched and the GL context is created.

### Vehicle rendering hot path

`src/Map/Vehicle/VehiclesLayer.tsx` runs a `requestAnimationFrame` loop that reads `vehicleStore` directly, interpolates per-vehicle position/heading (EMA-timed lerp with teleport detection), viewport-culls, and publishes a throttled (~30 fps) snapshot to an `IconLayer` (sprites from a lazily-built canvas atlas) plus a `ScatterplotLayer` selection/hover ring. `updateTriggers` keep non-positional accessors (icon, ring colors) from re-evaluating on pure-movement frames.

### Styling

- Tailwind v4 utilities + an oklch `@theme` palette in `src/index.css` (dark-only). A small motion scale (`duration-fast|normal|slow`) maps to `--transition-duration-*`; the 700 ms entrance animation is reserved for the one-time `[data-ready]` reveal.
- A polish token layer in `src/index.css` adds refined easing curves (`--ease-*`), a layered shadow scale with a built-in edge highlight (`shadow-raised|elevated|floating|glow-accent`), whisper-soft surface gradient utilities (`surface-glass|raised|accent`), and curated entrance animations, all under a `prefers-reduced-motion` guard. Applied across panels, the icon rail, floating overlays, and the shadcn input primitives.
- `src/styles/tokens.css` holds the few domain color tokens read at runtime by canvas/deck.gl code that can't use Tailwind classes (POI category fills, `--color-vehicle-*`).
- Components compose classes with `cn()` (`src/lib/utils.ts`); shadcn/ui primitives live in `src/components/ui/`.

### Key hooks

- `useVehicles` — vehicle list state; throttled React snapshot of `vehicleStore`, text/visibility filtering. Selection/hover are scalar (`filters.selected`/`filters.hovered`), not folded into the array.
- `useDirections` — route data as `Map<vehicleId, DirectionState>` driven by WS messages
- `useNetwork`, `useRoads`, `usePois`, `useHeatzones`, `useTraffic`, `useIncidents`, `useFleets`, `useGeofenceManager`, `useAnalytics`, `useDispatchFlow`, `useRecording`, `useReplay`

### Communication

- `src/utils/httpClient.ts` — typed fetch wrapper returning `ApiResponse<T>` (never throws; returns `{ error }`)
- `src/utils/wsClient.ts` — WebSocket with exponential-backoff reconnection
- `src/utils/wsTypes.ts` — discriminated union of WS message types + runtime type guard
- `src/utils/client.ts` — `SimulationService` singleton that composes per-domain segment classes from `src/utils/client/` (`connection`, `simulation`, `fleets`, `geofences`, `incidents`, `recording`, `scenarios`, `telemetry`, `types`) and re-exposes their bound methods, so the public API is unchanged

Path alias: `@/` → `./src/` (configured in `vite.config.ts` and `tsconfig.app.json`).

## License

MIT
