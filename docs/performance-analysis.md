# Performance Analysis Report

**Date**: 2026-03-20
**Network**: Cairo, Egypt (52 MB GeoJSON)
**Scale**: 820,405 nodes | 1,482,466 directed edges | 160,924 features

---

## Problem Statement

After expanding to the Cairo road network and adding recent features (POIs, traffic signals, turn restrictions, multilingual search), three critical performance regressions appeared:

1. **Backend bootstrap** — loading the network takes very long
2. **UI rendering** — went from very performant to unusable
3. **CPU overload** — laptop overheats with just a few vehicles

---

## Root Cause

The Cairo network is 86% residential roads (120,960 of 139,763 LineStrings). The system was designed for a smaller network and lacks optimizations at this scale.

---

## 1. Slow Backend Bootstrap

| Bottleneck                                                               | Location                    | Impact                         |
| ------------------------------------------------------------------------ | --------------------------- | ------------------------------ |
| 52MB GeoJSON parsed synchronously on main thread                         | `RoadNetwork.ts:132`        | Blocks startup 500ms+          |
| Same 52MB parsed again in each of 4 worker threads                       | `pathfinding-worker.ts:144` | 200MB+ I/O, 4x redundant parse |
| 3 separate passes over 160K features (edges, turn restrictions, signals) | `RoadNetwork.ts:336-511`    | 3x iteration overhead          |
| 3 redundant spatial indexes built (grid, sector edges, sector nodes)     | `RoadNetwork.ts:84-92`      | Triple memory + build time     |
| 820K nodes + 1.48M edges all loaded into memory                          | —                           | Massive heap footprint         |

## 2. UI Rendering Collapse

| Bottleneck                                                                                                    | Location                     | Impact                        |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| All 139,763 road segments rendered every frame — no viewport culling, no LOD                                  | `RoadNetworkMap.tsx:42-112`  | GPU/CPU saturated on zoom/pan |
| Breadcrumb trail: creates `<line>` SVG per segment per frame (100 vehicles x 60 points = 5,900 DOM ops/frame) | `BreadcrumbLayer.tsx:99-140` | FPS drops below 30            |
| POI deduplication is O(n^2) — 21K+ POIs = millions of distance checks                                         | `POIs.tsx:20-47`             | Stutter on pan/zoom           |
| Heatmap contour density fully recalculated every 800ms                                                        | `HeatLayer.tsx:45-73`        | Frame jank spikes             |
| Selection/hover triggers full canvas redraw even when positions unchanged                                     | `VehiclesLayer.tsx:365-531`  | Unnecessary GPU work          |
| No progressive network loading or streaming                                                                   | `useNetwork.ts`              | Initial load stalls 1-2s+     |

## 3. CPU Overload (Laptop Overheating)

| Bottleneck                                                                                    | Location                          | Impact                          |
| --------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------- |
| Per-vehicle per-tick: heat zone ray-cast + traffic lookup + vehicle-ahead scan + speed recalc | `RouteManager.ts:319-374`         | 140 ops/sec for 70 vehicles     |
| A\* pathfinding uses haversine (sin/cos/atan2) per explored node on 820K-node graph           | `pathfinding-worker.ts:260+`      | Thousands of trig ops per route |
| Route cache: only 500 entries, 60s TTL, invalidated on any incident change                    | `RoadNetwork.ts:127-129`          | Low hit rate, repeated A\*      |
| `findNearestNode()` fallback does O(820K) linear scan                                         | `RoadNetwork.ts:581-619`          | Called on every spawn/route     |
| WebSocket: 2,100 delta checks/sec (all vehicles x all clients x flush rate)                   | `WebSocketBroadcaster.ts:268-322` | Constant CPU churn              |
| Traffic snapshot iterates all edges every 2s                                                  | `eventWiring.ts:86-96`            | O(50K) work every 2s            |
| `nonCircularRouteEdges()` deep clones every edge in every route                               | `helpers.ts:36-45`                | Memory thrashing                |

---

## Proposed Improvements

### P0 — Network Reduction (biggest single win)

**Problem**: 86% of roads are `residential` (120,960 of 139,763). Most are irrelevant for fleet simulation.

**Solution**: Filter the network at generation time to exclude low-value road classes. Keep motorway, trunk, primary, secondary, tertiary (and their links). Drop residential, living_street, construction, service.

**Expected reduction**: Features 139K -> ~14K roads (~90%), nodes 820K -> ~80K, file 52MB -> ~5MB.

The entire stack benefits: faster parse, faster A\*, faster rendering, less memory.

### P1 — Pre-serialize Graph for Workers

Instead of each worker thread parsing 52MB GeoJSON independently:

- Build graph once in main thread
- Serialize to a compact binary format (or SharedArrayBuffer)
- Workers load the pre-built graph directly

### P2 — Viewport Culling for Road Network (UI)

Only render road segments whose bounding box intersects the viewport. With a spatial index (quadtree), rendering goes from 139K segments to ~500-2000 visible ones.

### P3 — Canvas Breadcrumb Trails (UI)

Replace per-frame SVG DOM creation with a single canvas `Path2D` per vehicle trail. One `stroke()` call per trail instead of 59 `createElementNS()` + `appendChild()` calls.

### P4 — Batch Vehicle Updates (Backend)

Instead of per-vehicle per-tick computation:

- Batch heat zone checks (spatial query once for all vehicles)
- Cache traffic congestion per edge for the tick duration
- Only recompute speed when vehicle changes edge (not every 500ms)

### P5 — Increase Route Cache (Backend)

- Increase from 500 -> 5000 entries
- Increase TTL from 60s -> 600s
- Use per-edge incident fingerprint instead of global (one incident shouldn't invalidate all routes)

### P6 — POI Quadtree Deduplication (UI)

Replace O(n^2) spacing loop with a quadtree insertion — O(n log n).

### P7 — Replace Haversine with Euclidean in A\* (Backend)

For the A\* heuristic, squared Euclidean distance is admissible and avoids all trig. The heuristic doesn't need to be accurate, just a lower bound.

---

## Expected Impact

| Fix                      | Bootstrap             | UI FPS                   | CPU Load              |
| ------------------------ | --------------------- | ------------------------ | --------------------- |
| P0 Network reduction     | 10x faster            | 5-10x fewer elements     | 10x less A\* work     |
| P1 Pre-serialize graph   | 4x faster worker init | —                        | Less startup CPU      |
| P2 Viewport culling      | —                     | 50-100x fewer draw calls | Less GPU              |
| P3 Canvas breadcrumbs    | —                     | 100x fewer DOM ops       | Less CPU              |
| P4 Batch vehicle updates | —                     | —                        | ~3x less per-tick CPU |
| P5 Route cache           | —                     | —                        | Fewer A\* calls       |
| P6 POI quadtree          | —                     | Smoother pan/zoom        | Less CPU              |
| P7 Euclidean heuristic   | —                     | Faster pathfinding       | Faster pathfinding    |

---

## Road Classification Breakdown

| Road Type      | Count   | % of Total |
| -------------- | ------- | ---------- |
| Residential    | 120,960 | 86.6%      |
| Tertiary       | 4,756   | 3.4%       |
| Tertiary link  | 2,496   | 1.8%       |
| Unclassified   | 2,380   | 1.7%       |
| Secondary      | 1,797   | 1.3%       |
| Primary        | 1,464   | 1.0%       |
| Secondary link | 1,416   | 1.0%       |
| Primary link   | 1,375   | 1.0%       |
| Trunk link     | 871     | 0.6%       |
| Motorway link  | 801     | 0.6%       |
| Motorway       | 760     | 0.5%       |
| Trunk          | 512     | 0.4%       |
| Living street  | 161     | 0.1%       |
| Construction   | 13      | <0.1%      |
| Service        | 1       | <0.1%      |

## POI Type Distribution (Top 15)

| POI Type          | Count |
| ----------------- | ----- |
| Crossing          | 7,263 |
| Other/Unknown     | 7,201 |
| Motorway junction | 854   |
| Restaurant        | 489   |
| Bench             | 454   |
| Turning loop      | 445   |
| Cafe              | 424   |
| Parking entrance  | 389   |
| Speed camera      | 376   |
| Place of worship  | 365   |
| Fast food         | 299   |
| Bank              | 244   |
| Traffic signals   | 212   |
| Pharmacy          | 205   |
| Fuel              | 160   |
