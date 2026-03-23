# deck.gl Migration — Performance + HTML Overlays

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the custom D3 Canvas/SVG rendering stack with deck.gl WebGL layers while preserving the HTML overlay system for POI markers, incident markers, and speed limit signs.

**Architecture:** The `<DeckGL>` React component becomes the map container, replacing `RoadNetworkMap.tsx`'s Canvas+SVG+HTML triple-layer stack. WebGL layers handle roads, vehicles, breadcrumbs, heatmap, geofences, and traffic overlay. The existing HTML markers render as React children of `<DeckGL>`, positioned via `viewport.project()` — a 1:1 replacement for D3's `projection()`. The vehicle interpolation system (EMA-based lerp) is preserved and feeds interpolated positions into a `ScatterplotLayer` with custom rendering.

**Tech Stack:** `@deck.gl/core`, `@deck.gl/react`, `@deck.gl/layers`, `@deck.gl/aggregation-layers`, `@deck.gl/geo-layers`, React 19, TypeScript

---

## Architecture Decision: Why This Approach

### What changes

- **Road network**: Canvas Path2D → `PathLayer` (WebGL, automatic viewport culling)
- **Vehicles**: Custom Canvas RAF loop → `ScatterplotLayer` with `extensions` for custom shapes
- **Breadcrumbs**: SVG `<line>` DOM creation → `PathLayer` with opacity
- **Heatmap**: D3 `contourDensity` (CPU, SVG) → `HeatmapLayer` (GPU)
- **Geofences**: SVG `<path>` → `PolygonLayer`
- **Traffic overlay**: D3 SVG `<path>` per road → `PathLayer` with congestion colors
- **Directions/routes**: SVG polylines → `PathLayer`
- **Map container**: D3 zoom + geoMercator → deck.gl `MapView` controller

### What stays the same

- **HTML markers** (POIs, incidents, speed limits) — render as `<DeckGL>` children using `viewport.project()`
- **Vehicle interpolation** — the EMA-based lerp system in `VehiclesLayer.tsx:56-83` stays, feeding into deck.gl layer data
- **vehicleStore** — direct store reads on RAF, no React re-renders for positions
- **Data flow** — REST + WebSocket → DataProvider → stores → layers
- **All existing React contexts** — `MapContext`, `MapControlsContext`, `OverlayContext` are replaced with deck.gl equivalents

### Performance expectations

- Roads: 139K segments at 60fps (vs current frame drops) — PathLayer handles 1M+ paths
- Vehicles: GPU-accelerated rendering with built-in transitions
- Breadcrumbs: Single draw call per trail (vs 59 SVG DOM ops per trail per frame)
- Heatmap: GPU KDE (vs CPU contourDensity + SVG paths)
- POIs: HTML markers stay but benefit from deck.gl's viewport culling via `viewport.project()`

---

## Layer Stack (bottom to top)

```
deck.gl MapView (Web Mercator, dark background)
├── PathLayer: road network (regular roads)
├── PathLayer: road network (highways, wider)
├── PolygonLayer: geofences
├── PathLayer: traffic overlay (congestion colors)
├── PathLayer: breadcrumb trails (opacity gradient)
├── HeatmapLayer: vehicle density
├── PathLayer: direction/route polylines
├── ScatterplotLayer: vehicles (with interpolation)
├── ScatterplotLayer: pending dispatch markers
└── HTML Overlay (DeckGL children)
    ├── POI HTMLMarkers
    ├── Incident HTMLMarkers
    ├── Speed Limit HTMLMarkers
    └── Geofence labels
```

---

## Task 0: Install Dependencies and Verify Build

**Files:**

- Modify: `apps/ui/package.json`

**Step 1: Install deck.gl packages**

Run:

```bash
cd apps/ui && yarn add @deck.gl/core @deck.gl/react @deck.gl/layers @deck.gl/aggregation-layers @deck.gl/geo-layers @luma.gl/core @luma.gl/webgl
```

**Step 2: Verify the app still builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add apps/ui/package.json apps/ui/yarn.lock
git commit -m "chore(ui): add deck.gl dependencies for WebGL migration"
```

---

## Task 1: Create DeckGLMap Container (Replace RoadNetworkMap)

This is the foundation. Replace the triple-layer Canvas+SVG+HTML container with a single `<DeckGL>` component that renders WebGL layers and HTML children.

**Files:**

- Create: `apps/ui/src/components/Map/components/DeckGLMap.tsx`
- Create: `apps/ui/src/components/Map/hooks/useDeckViewState.ts`
- Modify: `apps/ui/src/components/Map/providers/contexts.ts` — update MapContext type
- Modify: `apps/ui/src/components/Map/providers/MapContextProvider.tsx`
- Modify: `apps/ui/src/components/Map/providers/ControlsContextProvider.tsx`
- Modify: `apps/ui/src/components/Map/providers/OverlayContextProvider.tsx`
- Modify: `apps/ui/src/components/Map/hooks.ts`
- Test: Verify road network renders at 60fps with pan/zoom

**Step 1: Create the deck.gl view state hook**

This hook manages the deck.gl `viewState` (longitude, latitude, zoom, pitch, bearing) and provides imperative controls (zoomIn, panTo, setBounds, focusOn).

```typescript
// apps/ui/src/components/Map/hooks/useDeckViewState.ts
import { useState, useCallback, useRef } from "react";
import { WebMercatorViewport } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import type { RoadNetwork, Position } from "@/types";

/**
 * Compute the initial viewState that fits a GeoJSON FeatureCollection
 * into the given width × height, analogous to D3's geoMercator().fitSize().
 */
function fitBounds(
  network: RoadNetwork,
  width: number,
  height: number,
): MapViewState {
  if (!width || !height || !network.features.length) {
    return { longitude: 0, latitude: 0, zoom: 1 };
  }

  // Compute bounding box from all coordinates
  let minLng = Infinity,
    maxLng = -Infinity;
  let minLat = Infinity,
    maxLat = -Infinity;
  for (const feature of network.features) {
    const coords =
      feature.geometry.type === "LineString"
        ? feature.geometry.coordinates
        : feature.geometry.type === "MultiLineString"
          ? feature.geometry.coordinates.flat()
          : [];
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const viewport = new WebMercatorViewport({ width, height });
  const { longitude, latitude, zoom } = viewport.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 20 },
  );
  return { longitude, latitude, zoom };
}

export function useDeckViewState(
  network: RoadNetwork,
  width: number,
  height: number,
) {
  const [viewState, setViewState] = useState<MapViewState>(() =>
    fitBounds(network, width, height),
  );
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  const onViewStateChange = useCallback(
    ({ viewState: vs }: { viewState: MapViewState }) => {
      setViewState(vs);
      viewStateRef.current = vs;
    },
    [],
  );

  const zoomIn = useCallback(() => {
    setViewState((prev) => ({
      ...prev,
      zoom: Math.min((prev.zoom ?? 1) + 1, 20),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewState((prev) => ({
      ...prev,
      zoom: Math.max((prev.zoom ?? 1) - 1, 0),
    }));
  }, []);

  const setZoom = useCallback((z: number) => {
    setViewState((prev) => ({ ...prev, zoom: z }));
  }, []);

  const panTo = useCallback((lng: number, lat: number) => {
    setViewState((prev) => ({ ...prev, longitude: lng, latitude: lat }));
  }, []);

  const focusOn = useCallback((lng: number, lat: number, zoom: number) => {
    setViewState((prev) => ({ ...prev, longitude: lng, latitude: lat, zoom }));
  }, []);

  const setBounds = useCallback(
    (bounds: [Position, Position]) => {
      const [[west, south], [east, north]] = bounds;
      const vp = new WebMercatorViewport({ width, height });
      const fitted = vp.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 20 },
      );
      setViewState({
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: fitted.zoom,
      });
    },
    [width, height],
  );

  const getBoundingBox = useCallback((): [Position, Position] => {
    const vs = viewStateRef.current;
    if (!width || !height)
      return [
        [0, 0],
        [0, 0],
      ];
    const vp = new WebMercatorViewport({ ...vs, width, height });
    const topLeft = vp.unproject([0, 0]);
    const bottomRight = vp.unproject([width, height]);
    return [topLeft as Position, bottomRight as Position];
  }, [width, height]);

  const getZoom = useCallback(() => viewStateRef.current.zoom ?? 1, []);

  return {
    viewState,
    onViewStateChange,
    controls: { zoomIn, zoomOut, panTo, setZoom, setBounds, focusOn },
    getBoundingBox,
    getZoom,
  };
}
```

**Step 2: Create the DeckGLMap component**

```tsx
// apps/ui/src/components/Map/components/DeckGLMap.tsx
import React, { useMemo } from "react";
import { DeckGL } from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { RoadNetwork, Position } from "@/types";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { useDeckViewState } from "../hooks/useDeckViewState";
import { MapControlsProvider } from "../providers/ControlsContextProvider";
import { MapContextProvider } from "../providers/MapContextProvider";
import { OverlayProvider } from "../providers/OverlayContextProvider";

interface DeckGLMapProps {
  data: RoadNetwork;
  strokeColor?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  children?: React.ReactNode; // WebGL layer children (rendered inside deck)
  htmlMarkers?: React.ReactNode; // HTML overlay children
  onClick?: (event: React.MouseEvent, position: Position) => void;
  onContextClick?: (event: React.MouseEvent, position: Position) => void;
  cursor?: string;
}

// Separate regular roads from highways for different styling
function splitRoadData(network: RoadNetwork) {
  const roads: { path: [number, number][] }[] = [];
  const highways: { path: [number, number][] }[] = [];

  for (const feature of network.features) {
    const coords =
      feature.geometry.type === "LineString"
        ? feature.geometry.coordinates
        : feature.geometry.type === "MultiLineString"
          ? feature.geometry.coordinates.flat()
          : [];

    if (coords.length < 2) continue;

    const path = coords as [number, number][];
    if (feature.properties.type === "highway") {
      highways.push({ path });
    } else {
      roads.push({ path });
    }
  }
  return { roads, highways };
}

export const DeckGLMap: React.FC<DeckGLMapProps> = ({
  data,
  strokeColor = "#444",
  strokeWidth = 1.5,
  strokeOpacity = 0.4,
  children,
  htmlMarkers,
  onClick,
  onContextClick,
  cursor = "grab",
}) => {
  const [containerRef, size] = useResizeObserver();
  const { viewState, onViewStateChange, controls, getBoundingBox, getZoom } =
    useDeckViewState(data, size.width, size.height);

  // Split road data once
  const { roads, highways } = useMemo(() => splitRoadData(data), [data]);

  // Road network layers
  const layers = useMemo(
    () => [
      new PathLayer({
        id: "roads",
        data: roads,
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: [68, 68, 68, Math.round(strokeOpacity * 255)],
        getWidth: strokeWidth,
        widthUnits: "pixels",
        widthMinPixels: 1,
        pickable: false,
        _pathType: "open" as const,
      }),
      new PathLayer({
        id: "highways",
        data: highways,
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: [68, 68, 68, Math.round(strokeOpacity * 255)],
        getWidth: strokeWidth * 2,
        widthUnits: "pixels",
        widthMinPixels: 1,
        pickable: false,
        _pathType: "open" as const,
      }),
    ],
    [roads, highways, strokeColor, strokeWidth, strokeOpacity],
  );

  const handleClick = (info: any, event: any) => {
    if (!onClick) return;
    if (info.coordinate) {
      const syntheticEvent = event.srcEvent as React.MouseEvent;
      onClick(syntheticEvent, [info.coordinate[0], info.coordinate[1]]);
    }
  };

  const handleContextMenu = (info: any, event: any) => {
    if (!onContextClick) return;
    if (info.coordinate) {
      const syntheticEvent = event.srcEvent as React.MouseEvent;
      onContextClick(syntheticEvent, [info.coordinate[0], info.coordinate[1]]);
    }
  };

  return (
    <MapContextProvider
      viewState={viewState}
      width={size.width}
      height={size.height}
      getBoundingBox={getBoundingBox}
      getZoom={getZoom}
    >
      <MapControlsProvider controls={controls}>
        <OverlayProvider
          viewState={viewState}
          width={size.width}
          height={size.height}
        >
          <div
            ref={containerRef}
            style={{ width: "100%", height: "100%", position: "relative" }}
          >
            <DeckGL
              viewState={viewState}
              onViewStateChange={onViewStateChange}
              layers={layers}
              controller={{ doubleClickZoom: false }}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              getCursor={() => cursor}
              style={{ background: "#111" }}
              views={new MapView({ repeat: false })}
            >
              {/* HTML overlay — positioned via viewport.project() */}
              {({ viewport }) => (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                  }}
                >
                  {htmlMarkers}
                </div>
              )}
            </DeckGL>
          </div>
        </OverlayProvider>
      </MapControlsProvider>
    </MapContextProvider>
  );
};
```

**Step 3: Update MapContext to use deck.gl viewport instead of D3 projection/transform**

The current `MapContext` exposes `projection: GeoProjection` and `transform: ZoomTransform`. These need to change to deck.gl's `WebMercatorViewport`. All consumers of `useMapContext()` will be updated in subsequent tasks.

Update `apps/ui/src/components/Map/providers/contexts.ts`:

```typescript
// New MapContextValue for deck.gl
export interface MapContextValue {
  viewport: WebMercatorViewport | null;
  viewState: MapViewState | null;
  getBoundingBox: () => [Position, Position];
  getZoom: () => number;
}
```

Update `MapContextProvider` to construct a `WebMercatorViewport` from `viewState + width + height` and pass it as `viewport`.

Update `OverlayProvider` to expose `viewport.project([lng, lat])` instead of D3 `projection()`.

**Step 4: Update HTMLMarker to use deck.gl viewport**

Replace D3 projection with `viewport.project()`:

```tsx
// apps/ui/src/components/Map/components/HTMLMarker.tsx
import React, { useRef, useLayoutEffect } from "react";
import { useMapContext } from "../hooks";
import type { Position } from "@/types";

interface HtmlMarkerProps extends React.HTMLAttributes<HTMLDivElement> {
  position: Position;
  offset?: [number, number];
  children?: React.ReactNode;
}

export default function HTMLMarker({
  position,
  offset = [0, 0],
  children,
  ...props
}: HtmlMarkerProps) {
  const { viewport } = useMapContext();
  const markerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!markerRef.current || !viewport) return;
    // position is [lng, lat] — project to screen pixels
    const [x, y] = viewport.project([position[0], position[1]]);
    // Scale inversely to zoom to keep markers constant size
    const zoomScale = Math.pow(2, viewport.zoom) / Math.pow(2, 12); // normalize around zoom 12
    markerRef.current.style.transform = `translate3d(${x + offset[0]}px, ${y + offset[1]}px, 0)`;
  }, [position, offset, viewport]);

  return (
    <div
      ref={markerRef}
      style={{ position: "absolute", left: 0, top: 0, height: 0, width: 0 }}
      {...props}
    >
      {children}
    </div>
  );
}
```

**Step 5: Run the app and verify roads render**

Run: `cd apps/ui && yarn dev`

Expected:

- Road network renders on dark background
- Pan/zoom works smoothly at 60fps
- No SVG or Canvas elements in DOM — only WebGL canvas from deck.gl
- HTML markers still appear (POIs, etc.)

**Step 6: Commit**

```bash
git add apps/ui/src/components/Map/
git commit -m "feat(ui): replace D3 map container with deck.gl DeckGLMap"
```

---

## Task 2: Migrate VehiclesLayer to deck.gl ScatterplotLayer

Port the custom Canvas vehicle renderer to a deck.gl `ScatterplotLayer`. Preserve the interpolation system.

**Files:**

- Modify: `apps/ui/src/Map/Vehicle/VehiclesLayer.tsx`

**Step 1: Refactor VehiclesLayer to produce interpolated data for deck.gl**

The existing RAF loop (`VehiclesLayer.tsx:267-536`) reads from `vehicleStore`, interpolates positions, and draws to Canvas. We keep the RAF interpolation loop but instead of drawing to Canvas, we update a data array that feeds the `ScatterplotLayer`.

Key changes:

- Keep `interpRef` and the EMA lerp system (lines 56-83, 298-346)
- Instead of `drawShape()` calls, push interpolated `{id, lng, lat, heading, color, type}` into a `dataRef`
- Return a `ScatterplotLayer` (or composite of layers) from the component
- For vehicle shapes (car/truck/bus polygons), use deck.gl's `PolygonLayer` with `getPolygon` returning rotated vertices, or use a custom deck.gl layer extension
- Hit testing: use deck.gl's `pickable: true` + `onClick` instead of manual Euclidean distance checks (lines 538-588)

```tsx
// Simplified structure — the interpolation loop stays but outputs to deck.gl
export default function VehiclesLayer({
  scale,
  vehicleFleetMap,
  hiddenFleetIds,
  selectedId,
  hoveredId,
  onClick,
}: VehiclesLayerProps) {
  const { viewport } = useMapContext();
  const [vehicleData, setVehicleData] = useState<InterpolatedVehicle[]>([]);
  const interpRef = useRef(new Map<string, VehicleInterp>());

  // RAF loop: interpolate positions, update vehicleData
  useEffect(() => {
    let rafId: number;
    const render = () => {
      rafId = requestAnimationFrame(render);
      // ... existing interpolation logic from lines 298-346 ...
      // Instead of ctx.drawShape(), build array:
      const data: InterpolatedVehicle[] = [];
      for (const [id, v] of store) {
        // ... interpolation ...
        data.push({ id, position: [lng, lat], heading, color, type });
      }
      setVehicleData(data); // triggers layer update
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Return deck.gl layers
  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: "vehicles",
        data: vehicleData,
        getPosition: (d) => d.position,
        getFillColor: (d) => hexToRgba(d.color),
        getRadius: 8,
        radiusUnits: "pixels",
        pickable: true,
        onClick: (info) => info.object && onClick(info.object.id),
        // selected/hovered highlighting via updateTriggers
      }),
    ],
    [vehicleData, selectedId, hoveredId],
  );

  // Register layers with parent DeckGL via context or callback
  return null; // layers registered via useDeckLayers hook
}
```

**Important design decision:** deck.gl doesn't natively support polygon vehicle shapes in `ScatterplotLayer` (it draws circles). Two options:

**Option A (simpler):** Use `ScatterplotLayer` with circles. Vehicles appear as colored dots. Fast, dead simple.

**Option B (faithful):** Use a `PolygonLayer` with per-vehicle rotated polygon vertices computed in the interpolation loop. More GPU work but preserves arrow/truck/bus shapes.

**Recommendation:** Start with Option A (circles). Add Option B later if visual fidelity matters. The circles already encode color, fleet, selection state.

**Step 2: Remove Canvas creation and manual hit testing**

Delete:

- Canvas DOM creation (`VehiclesLayer.tsx:222-263`)
- Manual hit testing via `addEventListener("click")` (`VehiclesLayer.tsx:538-588`)
- `drawShape()`, `drawGlowShape()`, `drawSelectionRing()` functions (`VehiclesLayer.tsx:100-175`)

These are all replaced by deck.gl's built-in WebGL rendering and GPU picking.

**Step 3: Verify vehicles render and are clickable**

Run: `cd apps/ui && yarn dev`

Expected:

- Vehicles appear as colored dots/shapes on the map
- Smooth interpolation between WebSocket updates
- Click on vehicle selects it
- Hover shows highlight
- Hidden fleets are not rendered

**Step 4: Commit**

```bash
git add apps/ui/src/Map/Vehicle/VehiclesLayer.tsx
git commit -m "feat(ui): migrate VehiclesLayer to deck.gl ScatterplotLayer"
```

---

## Task 3: Migrate BreadcrumbLayer to deck.gl PathLayer

Replace SVG `<line>` DOM creation (59 createElement calls per trail per frame) with a single `PathLayer`.

**Files:**

- Modify: `apps/ui/src/Map/Breadcrumb/BreadcrumbLayer.tsx`

**Step 1: Replace SVG DOM manipulation with PathLayer**

The current implementation (`BreadcrumbLayer.tsx:99-139`) creates individual SVG `<line>` elements per segment per frame. Replace with:

```tsx
export default function BreadcrumbLayer({
  selectedId,
  showAll,
  vehicleFleetMap,
  hiddenFleetIds,
}: BreadcrumbLayerProps) {
  const [trailData, setTrailData] = useState<TrailSegment[]>([]);

  // RAF loop reads from vehicleStore (same as before)
  useEffect(() => {
    let rafId: number;
    let lastVersion = -1;

    const render = () => {
      rafId = requestAnimationFrame(render);
      const currentVersion = vehicleStore.getVersion();
      if (currentVersion === lastVersion) return;
      lastVersion = currentVersion;

      const allTrails = vehicleStore.getAllTrails();
      const trails: TrailSegment[] = [];

      for (const [vehicleId, trail] of allTrails) {
        if (trail.length < 2) continue;
        if (!showAll && vehicleId !== selectedId) continue;
        const fleet = vehicleFleetMap.get(vehicleId);
        if (fleet && hiddenFleetIds.has(fleet.id)) continue;

        // Trail positions are [lat, lng] — convert to [lng, lat] for deck.gl
        const path = trail.map(([lat, lng]) => [lng, lat] as [number, number]);
        const color = fleet?.color ?? DEFAULT_TRAIL_COLOR;
        trails.push({ vehicleId, path, color });
      }
      setTrailData(trails);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [selectedId, showAll, vehicleFleetMap, hiddenFleetIds]);

  const layer = useMemo(
    () =>
      new PathLayer({
        id: "breadcrumbs",
        data: trailData,
        getPath: (d) => d.path,
        getColor: (d) => hexToRgba(d.color, 180), // slight transparency
        getWidth: 2,
        widthUnits: "pixels",
        widthMinPixels: 1,
        pickable: false,
        _pathType: "open",
      }),
    [trailData],
  );

  // Register layer with DeckGL
  return null;
}
```

**Note:** The opacity gradient (oldest → 0.05, newest → 1.0) per segment is harder with a single `PathLayer` since it colors the whole path uniformly. Two options:

- **Simple:** Use a single color with slight transparency. Good enough.
- **Faithful:** Split each trail into individual line segments as separate data items with per-segment alpha via `getColor`. Slightly more data but still 1 draw call.

**Step 2: Verify breadcrumb trails render**

Run: `cd apps/ui && yarn dev`
Expected: Selected vehicle shows trail, trail disappears when deselected

**Step 3: Commit**

```bash
git add apps/ui/src/Map/Breadcrumb/BreadcrumbLayer.tsx
git commit -m "feat(ui): migrate BreadcrumbLayer to deck.gl PathLayer"
```

---

## Task 4: Migrate HeatLayer to deck.gl HeatmapLayer

Replace CPU-bound D3 `contourDensity` + SVG paths with GPU-accelerated `HeatmapLayer`.

**Files:**

- Modify: `apps/ui/src/components/Map/components/HeatLayer.tsx`

**Step 1: Replace D3 contour density with deck.gl HeatmapLayer**

```tsx
import { HeatmapLayer } from "@deck.gl/aggregation-layers";

export default function HeatLayer({ data, opacity = 0.5 }: HeatLayerProps) {
  const layer = useMemo(
    () =>
      new HeatmapLayer({
        id: "heatmap",
        data: data.map(([lng, lat]) => ({ position: [lng, lat] })),
        getPosition: (d) => d.position,
        getWeight: 1,
        radiusPixels: 30,
        intensity: 1,
        colorRange: [
          [0, 255, 0, 255], // green
          [128, 255, 0, 255], // lime
          [255, 255, 0, 255], // yellow
          [255, 128, 0, 255], // orange
          [255, 0, 0, 255], // red
        ],
        opacity,
        debounceTimeout: 500,
        weightsTextureSize: 512, // fast mode (5-7ms vs 50-100ms)
        pickable: false,
      }),
    [data, opacity],
  );

  // Register layer with DeckGL
  return null;
}
```

**Step 2: Verify heatmap renders**

Run: `cd apps/ui && yarn dev`
Expected: Heatmap shows vehicle density with green→red gradient, updates smoothly

**Step 3: Commit**

```bash
git add apps/ui/src/components/Map/components/HeatLayer.tsx
git commit -m "feat(ui): migrate HeatLayer to deck.gl HeatmapLayer (GPU)"
```

---

## Task 5: Migrate GeofenceLayer to deck.gl PolygonLayer

**Files:**

- Modify: `apps/ui/src/Map/Geofence/GeofenceLayer.tsx`

**Step 1: Replace SVG path rendering with PolygonLayer**

```tsx
import { PolygonLayer } from "@deck.gl/layers";
import { TextLayer } from "@deck.gl/layers";

export default function GeofenceLayer({
  fences,
  selectedFenceId,
}: GeofenceLayerProps) {
  const layers = useMemo(
    () => [
      new PolygonLayer({
        id: "geofences",
        data: fences,
        getPolygon: (d) => d.polygon, // already [lng, lat][] from backend
        getFillColor: (d) => getFillColorRgba(d),
        getLineColor: (d) => getStrokeColorRgba(d),
        getLineWidth: (d) => (d.id === selectedFenceId ? 2 : 1),
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: false,
        getElevation: 0,
        opacity: (d) => (d.active ? 1 : 0.4),
      }),
      new TextLayer({
        id: "geofence-labels",
        data: fences.filter((f) => f.active !== false),
        getPosition: (d) => centroid(d.polygon),
        getText: (d) => d.name,
        getSize: 11,
        getColor: (d) => getStrokeColorRgba(d),
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        pickable: false,
      }),
    ],
    [fences, selectedFenceId],
  );

  // Register layers with DeckGL
  return null;
}
```

**Step 2: Verify geofences render with labels**

Run: `cd apps/ui && yarn dev`
Expected: Geofence polygons with fill, stroke, and centered name labels

**Step 3: Commit**

```bash
git add apps/ui/src/Map/Geofence/GeofenceLayer.tsx
git commit -m "feat(ui): migrate GeofenceLayer to deck.gl PolygonLayer"
```

---

## Task 6: Migrate TrafficOverlay to deck.gl PathLayer

**Files:**

- Modify: `apps/ui/src/Map/TrafficOverlay.tsx`

**Step 1: Replace D3 SVG path rendering with PathLayer**

The current implementation iterates network features, matches against traffic data, and renders SVG paths with congestion colors. Replace with a `PathLayer` where each data item is a road segment with its congestion factor.

```tsx
import { PathLayer } from "@deck.gl/layers";

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { edges: trafficEdges } = useTraffic();
  const { network } = useNetwork();

  const streetCongestion = useMemo(
    () => buildStreetCongestion(trafficEdges),
    [trafficEdges],
  );

  const trafficData = useMemo(() => {
    return network.features
      .filter((f) => {
        const sid = f.properties.streetId ?? f.properties["@id"];
        return sid != null && streetCongestion.has(sid);
      })
      .map((f) => {
        const sid = f.properties.streetId ?? f.properties["@id"];
        const congestion = streetCongestion.get(sid!)!;
        const coords =
          f.geometry.type === "LineString"
            ? f.geometry.coordinates
            : (f.geometry.coordinates?.flat() ?? []);
        return {
          path: coords as [number, number][],
          color: congestionColorRgba(congestion),
          width: HIGHWAY_WIDTH[f.properties.highway ?? ""] ?? 1.5,
        };
      });
  }, [network, streetCongestion]);

  if (!visible) return null;

  const layer = new PathLayer({
    id: "traffic-overlay",
    data: trafficData,
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: "pixels",
    jointRounded: true,
    capRounded: true,
    pickable: false,
    opacity: 0.85,
    _pathType: "open",
  });

  // Register layer with DeckGL
  return null;
}
```

**Step 2: Verify traffic overlay renders with congestion colors**

Run: `cd apps/ui && yarn dev`
Expected: Roads with traffic data show green→red congestion coloring

**Step 3: Commit**

```bash
git add apps/ui/src/Map/TrafficOverlay.tsx
git commit -m "feat(ui): migrate TrafficOverlay to deck.gl PathLayer"
```

---

## Task 7: Migrate Direction (Route) Layer to deck.gl

**Files:**

- Modify: `apps/ui/src/Map/Direction.tsx`

**Step 1: Replace SVG polylines + circle waypoints with PathLayer + ScatterplotLayer**

The current Direction component renders route polylines and numbered waypoint markers as SVG. Replace with:

- `PathLayer` for route polylines
- `ScatterplotLayer` or `TextLayer` for waypoint markers

**Step 2: Verify route rendering**

Run: `cd apps/ui && yarn dev`
Expected: Selected vehicle's route shows as polyline with waypoint markers

**Step 3: Commit**

```bash
git add apps/ui/src/Map/Direction.tsx
git commit -m "feat(ui): migrate Direction to deck.gl PathLayer"
```

---

## Task 8: Layer Registration System

All the migrated layers return `null` from their React render and need a way to register their deck.gl layers with the parent `DeckGLMap`. Create a layer context.

**Files:**

- Create: `apps/ui/src/components/Map/hooks/useDeckLayers.ts`
- Modify: `apps/ui/src/components/Map/components/DeckGLMap.tsx`

**Step 1: Create a layer registration hook**

```tsx
// apps/ui/src/components/Map/hooks/useDeckLayers.ts
import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
} from "react";
import type { Layer } from "@deck.gl/core";

interface DeckLayersContextValue {
  registerLayers: (id: string, layers: Layer[]) => void;
  unregisterLayers: (id: string) => void;
}

export const DeckLayersContext = createContext<DeckLayersContextValue>({
  registerLayers: () => {},
  unregisterLayers: () => {},
});

export function useDeckLayersProvider() {
  const layerMapRef = useRef(new Map<string, Layer[]>());
  const [allLayers, setAllLayers] = useState<Layer[]>([]);

  const registerLayers = useCallback((id: string, layers: Layer[]) => {
    layerMapRef.current.set(id, layers);
    setAllLayers(Array.from(layerMapRef.current.values()).flat());
  }, []);

  const unregisterLayers = useCallback((id: string) => {
    layerMapRef.current.delete(id);
    setAllLayers(Array.from(layerMapRef.current.values()).flat());
  }, []);

  return { allLayers, registerLayers, unregisterLayers };
}

/** Hook for child layers to register themselves */
export function useRegisterLayers(id: string, layers: Layer[]) {
  const { registerLayers, unregisterLayers } = useContext(DeckLayersContext);
  useEffect(() => {
    registerLayers(id, layers);
    return () => unregisterLayers(id);
  }, [id, layers, registerLayers, unregisterLayers]);
}
```

**Step 2: Wire DeckGLMap to combine road layers + registered child layers**

In `DeckGLMap.tsx`, wrap children in `<DeckLayersContext.Provider>` and pass `[...roadLayers, ...allLayers]` to `<DeckGL layers={...}>`.

**Step 3: Update all migrated layers to use `useRegisterLayers()`**

Each layer component (VehiclesLayer, BreadcrumbLayer, etc.) calls:

```tsx
useRegisterLayers("vehicles", vehicleLayers);
```

**Step 4: Verify all layers render together**

Run: `cd apps/ui && yarn dev`
Expected: Roads, vehicles, trails, heatmap, geofences, traffic all render on deck.gl

**Step 5: Commit**

```bash
git add apps/ui/src/components/Map/hooks/useDeckLayers.ts apps/ui/src/components/Map/components/DeckGLMap.tsx
git commit -m "feat(ui): add deck.gl layer registration system"
```

---

## Task 9: Wire Map.tsx to Use DeckGLMap

Replace `<RoadNetworkMap>` with `<DeckGLMap>` in the main Map orchestrator.

**Files:**

- Modify: `apps/ui/src/Map/Map.tsx`

**Step 1: Swap the import**

```diff
- import { RoadNetworkMap } from "@/components/Map/components/RoadNetworkMap";
+ import { DeckGLMap } from "@/components/Map/components/DeckGLMap";
```

Replace `<RoadNetworkMap>` with `<DeckGLMap>` keeping the same prop interface.

**Step 2: Update all layer children**

All SVG-based children that previously rendered into `<g className="markers">` now register via `useRegisterLayers`. The `htmlMarkers` prop stays unchanged — POIs, incidents, speed limits still render as HTML.

**Step 3: Verify complete app works**

Run: `cd apps/ui && yarn dev`

Expected:

- Full app renders with all features
- Pan/zoom at 60fps
- Vehicle click/hover works
- HTML markers (POIs, incidents, speed limits) positioned correctly
- Breadcrumbs, heatmap, geofences, traffic overlay all work
- Direction routes display correctly

**Step 4: Commit**

```bash
git add apps/ui/src/Map/Map.tsx
git commit -m "feat(ui): wire Map.tsx to use DeckGLMap instead of RoadNetworkMap"
```

---

## Task 10: Migrate GeofenceDrawTool to deck.gl

The interactive polygon drawing tool needs to work with deck.gl's coordinate system.

**Files:**

- Modify: `apps/ui/src/Map/Geofence/GeofenceDrawTool.tsx`

**Step 1: Replace D3 pointer/projection with deck.gl picking coordinates**

Use deck.gl's `onClick` info which provides `coordinate: [lng, lat]` directly. Replace SVG polygon rendering with a `PolygonLayer` for the in-progress polygon and `ScatterplotLayer` for vertex handles.

**Step 2: Verify drawing workflow**

Run: `cd apps/ui && yarn dev`
Expected: Click to add vertices, polygon closes, confirm/cancel works

**Step 3: Commit**

```bash
git add apps/ui/src/Map/Geofence/GeofenceDrawTool.tsx
git commit -m "feat(ui): migrate GeofenceDrawTool to deck.gl"
```

---

## Task 11: Migrate Remaining Small Layers

**Files:**

- Modify: `apps/ui/src/Map/Road.tsx` (selected road highlight)
- Modify: `apps/ui/src/Map/PendingDispatch.tsx` (dispatch markers)
- Modify: `apps/ui/src/Map/TrafficZones.tsx` (heat zone polygons)
- Modify: `apps/ui/src/Map/ViewportBboxReporter.tsx` (use deck.gl viewport)

**Step 1: Migrate each small layer**

- `Road.tsx`: Replace SVG `<Polyline>` with `PathLayer`
- `PendingDispatch.tsx`: Replace SVG markers with `ScatterplotLayer` + `TextLayer`
- `TrafficZones.tsx`: Replace SVG polygons with `PolygonLayer`
- `ViewportBboxReporter.tsx`: Use deck.gl viewport instead of D3 `getBoundingBox()`

**Step 2: Verify all features work**

Run: `cd apps/ui && yarn dev`
Expected: All small features render correctly

**Step 3: Commit**

```bash
git add apps/ui/src/Map/Road.tsx apps/ui/src/Map/PendingDispatch.tsx apps/ui/src/Map/TrafficZones.tsx apps/ui/src/Map/ViewportBboxReporter.tsx
git commit -m "feat(ui): migrate remaining small layers to deck.gl"
```

---

## Task 12: Update POIs to Use deck.gl Viewport for Spatial Deduplication

POIs stay as HTML markers but the deduplication logic needs to use deck.gl's viewport instead of D3 projection.

**Files:**

- Modify: `apps/ui/src/Map/POIs.tsx`

**Step 1: Replace D3 projection/transform with viewport.project()**

```tsx
function getBySpacing(
  items: POI[],
  viewport: WebMercatorViewport,
  minPxDistance: number,
) {
  const placed: Array<{ poi: POI; px: number; py: number }> = [];
  for (const poi of items) {
    const [lat, lng] = poi.coordinates;
    const [px, py] = viewport.project([lng, lat]);
    const tooClose = placed.some(
      ({ px: x2, py: y2 }) => distancePx(px, py, x2, y2) < minPxDistance,
    );
    if (!tooClose) placed.push({ poi, px, py });
  }
  return placed;
}
```

**Step 2: Verify POIs render with spacing**

Run: `cd apps/ui && yarn dev`
Expected: POIs appear with proper spacing, no overlap, viewport-culled

**Step 3: Commit**

```bash
git add apps/ui/src/Map/POIs.tsx
git commit -m "feat(ui): update POI deduplication to use deck.gl viewport"
```

---

## Task 13: Remove D3 Dependency (Where Possible)

After all layers are migrated, D3 is no longer needed for:

- `geoMercator` / `geoPath` (replaced by deck.gl MapView)
- `zoom` / `pointer` / `zoomIdentity` (replaced by deck.gl controller)
- `contourDensity` (replaced by HeatmapLayer)
- `select` (no more SVG DOM manipulation)

D3 may still be needed for:

- Color scales (`scaleSequential`, `interpolateRgb`) — could replace with simple functions
- Data utilities (`max`) — trivial to inline

**Files:**

- Modify: `apps/ui/package.json` — evaluate if d3 can be removed entirely
- Delete: `apps/ui/src/components/Map/components/RoadNetworkMap.tsx` (replaced by DeckGLMap)
- Clean up: Remove unused D3 imports across all migrated files

**Step 1: Audit D3 usage**

Run: `grep -r "from \"d3\"" apps/ui/src/ --include="*.ts" --include="*.tsx"` to find remaining D3 imports.

**Step 2: Remove or replace each usage**

**Step 3: Verify build passes**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds, no D3 imports remain (or minimal)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(ui): remove D3 dependency, replaced by deck.gl"
```

---

## Task 14: Update Tests

**Files:**

- Modify: `apps/ui/src/Map/__tests__/` — update existing tests for deck.gl
- Modify: `apps/ui/src/components/Map/` — update provider tests

**Step 1: Update MapContext mock to use deck.gl viewport**

Tests that mock `useMapContext()` need to return a `WebMercatorViewport` instead of D3 `projection` + `transform`.

**Step 2: Run all tests**

Run: `cd apps/ui && yarn test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/ui/src/
git commit -m "test(ui): update tests for deck.gl migration"
```

---

## Task 15: Performance Verification

**Step 1: Build production bundle and check sizes**

Run: `cd apps/ui && yarn build`

Check:

- Bundle size delta (deck.gl adds ~160-180KB gzipped, but D3 removal saves ~30KB)
- No duplicate large dependencies

**Step 2: Manual performance testing with Cairo network**

Test with the full 52MB Cairo network:

- [ ] Road network renders at 60fps during pan/zoom
- [ ] 100+ vehicles animate smoothly with interpolation
- [ ] Breadcrumb trails don't cause frame drops
- [ ] Heatmap updates without jank
- [ ] POI markers appear/disappear smoothly during pan
- [ ] Traffic overlay renders congestion colors
- [ ] Geofence drawing works
- [ ] No CPU overheating from rendering

**Step 3: Compare before/after**

| Metric                   | Before (D3)       | After (deck.gl)  | Target  |
| ------------------------ | ----------------- | ---------------- | ------- |
| Road render FPS          | < 30              | 60               | 60      |
| Vehicle render FPS       | 60 (already good) | 60               | 60      |
| Breadcrumb DOM ops/frame | 59 per trail      | 0 (WebGL)        | 0       |
| Heatmap compute          | ~800ms CPU        | ~5ms GPU         | < 10ms  |
| POI dedup                | O(n²)             | O(n²) same\*     | —       |
| Bundle size              | ~120KB (d3)       | ~280KB (deck.gl) | < 300KB |

\*POI dedup algorithm is the same; deck.gl doesn't help here. A quadtree optimization is a separate task (P6 from the performance analysis).

**Step 4: Commit final verification notes**

```bash
git commit -m "docs: add deck.gl migration performance verification"
```

---

## Migration Risk Notes

1. **Coordinate order**: D3 uses `projection([lng, lat])`, deck.gl uses `[lng, lat]` in data and `viewport.project([lng, lat])`. The codebase has inconsistent `[lat, lng]` vs `[lng, lat]` — audit every coordinate swap during migration.

2. **Zoom scale mapping**: D3 zoom `k` ranges [1, 15]. deck.gl zoom is logarithmic (like Mapbox). Vehicle scale formula `scale / Math.pow(k, 0.75)` needs adjustment.

3. **SVG event coordinates**: D3's `pointer()` gives coords in SVG space. deck.gl's `onClick` info gives world coordinates directly. All click/hover handlers need updating.

4. **Layer ordering**: In SVG, z-order is DOM order. In deck.gl, layer order in the `layers` array determines draw order (last = top). The layer registration system must respect ordering.

5. **GeofenceDrawTool**: Interactive polygon drawing is the most complex migration because it mixes mouse events, coordinate transforms, and progressive polygon rendering. Test thoroughly.

6. **HTMLMarker positioning**: The current `useLayoutEffect` + D3 projection approach will need to run on every `viewState` change. Ensure this doesn't cause React rendering bottlenecks with many markers (100+ POIs). Consider throttling or moving to `requestAnimationFrame`.
