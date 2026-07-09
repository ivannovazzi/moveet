# Manual Heatzones — Design

**Issue:** fleetsim-all-qfxm · **Branch:** `feat/manual-heatzones` · **Date:** 2026-07-09

## Problem

Heatzones were never implemented properly. Today the simulator auto-generates ~10 random
slowdown polygons on startup and regenerates them every 5 minutes; the UI renders them
read-only. There is no way to draw or control zones. We want to draw them manually by hand
and have full control, and they must work spotlessly.

## Locked requirements

- **Authoritative** — drawn zones live in the simulator and slow vehicles that drive through
  them, via the existing `HEATZONE_SPEED_FACTOR` path.
- **No automatic generation** — remove the startup generate and the 5-minute regen timer.
  Random generation survives only as an on-demand **Seed random** button that _appends_ zones.
  Drawn and seeded zones coexist and are all editable.
- **Draw** — freehand lasso.
- **Per-zone control** — intensity slider, move/reshape, delete one; plus a Clear-all.
- **Persistence** — simulator in-memory. Survives a UI reload (re-fetch on load). Cleared on a
  simulator restart. No new storage layer.
- **Draw engine** — `@deck.gl/editable-layers` (official deck.gl editing package), pinned to
  the `^9.x` line matching deck.gl 9.2/9.3.

## Wire contract (unchanged shared type)

`packages/shared-types/src/ws.ts` `Heatzone` stays as-is — no shared-types change needed:

```ts
interface Heatzone {
  type: "Feature";
  properties: { id: string; intensity: number; timestamp: string; radius: number };
  geometry: { type: "Polygon"; coordinates: Position[] };
}
```

For lasso polygons `radius` is derived from the polygon bbox (kept for wire-compat / PIP grid).

## REST API (simulator, `apps/simulator/src/routes/network.ts`)

Every mutation re-broadcasts the full list on the existing `heatzones` WS channel
(`network.emit("heatzones", exportHeatZones())`), so all clients converge. Server is the
single source of truth.

| Method | Path              | Body                                         | Returns                                                 |
| ------ | ----------------- | -------------------------------------------- | ------------------------------------------------------- |
| GET    | `/heatzones`      | —                                            | `Heatzone[]`                                            |
| POST   | `/heatzones`      | `{ geometry: Polygon, intensity?: number }`  | created `Heatzone` (server assigns id/timestamp/radius) |
| PATCH  | `/heatzones/:id`  | `{ geometry?: Polygon, intensity?: number }` | updated `Heatzone` (404 if missing)                     |
| DELETE | `/heatzones/:id`  | —                                            | 204 (404 if missing)                                    |
| DELETE | `/heatzones`      | —                                            | 204 (clear all)                                         |
| POST   | `/heatzones/seed` | `{ count?: number }`                         | full `Heatzone[]` after appending                       |

## Simulator changes

- `HeatZoneManager` gains `addZone(feature)`, `updateZone(id, {polygon?, intensity?})`,
  `removeZone(id)`, `clearZones()`. Each keeps the spatial-grid index and point-in-polygon
  correct after mutation. Zones get stable ids.
- `generateHeatedZones` stays but **appends** rather than replacing (used by seed).
- `RoadNetwork` exposes the new CRUD and emits `heatzones` after every mutation.
- `SimulationController` — drop the startup auto-generate and the `autoHeatZoneInterval` regen.

## UI changes (`apps/ui`)

- Add `@deck.gl/editable-layers@^9`.
- Replace the read-only `TrafficZones` display with an `EditableGeoJsonLayer`-backed component
  that preserves the intensity→alpha fill:
  - Default `ViewMode` (display + click-to-select).
  - Tool-driven `DrawPolygonByDraggingMode` (lasso), `ModifyMode` (reshape), `TranslateMode` (move).
- Client gains `createHeatzone`, `updateHeatzone`, `deleteHeatzone`, `clearHeatzones`,
  `seedHeatzones`. Mutations are server round-trips; the WS broadcast updates `HeatZoneContext`
  which re-renders the layer. Reshape/move PATCH fires on drag-end (debounced) for smoothness.
- Dock: repurpose the flame "Generate heat zones" button into a **Zones** tool group —
  Draw (lasso) · Seed random · Clear all — plus a selection popover with an intensity slider
  and delete.

## Testing

- Simulator: `HeatZoneManager` CRUD unit tests (grid reindex + PIP correct after edits), route
  tests for every endpoint, assertion that auto-regen no longer runs.
- UI: jsdom layer tests per the `deckgl-map-layers` skill — mode switching, mutation calls fire
  on draw/edit/delete, intensity PATCH. Then a real-browser verify: draw a lasso, watch vehicles
  slow, reshape, delete.

## Out of scope (YAGNI)

Circles/rectangles, freehand smoothing, disk persistence, undo/redo, multi-user conflict
resolution beyond last-write-wins broadcast.
