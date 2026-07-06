import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView, WebMercatorViewport } from "@deck.gl/core";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";

// `TooltipContent` isn't re-exported from the @deck.gl/core package root
// (only from its internal tooltip-widget module) — mirror deck's own type.
type TooltipContent =
  | null
  | string
  | { text?: string; html?: string; className?: string; style?: Partial<CSSStyleDeclaration> };
import { SectionErrorFallback } from "@/components/ErrorBoundary";
import { webgl2Adapter } from "@luma.gl/webgl";
import { PathLayer } from "@deck.gl/layers";
import type { Position, RoadNetwork } from "@/types";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { useDeckViewState } from "../hooks/useDeckViewState";
import { useDeckLayerManager, DeckLayersContext } from "../hooks/useDeckLayers";
import { DeckMapContextProvider } from "../providers/MapContextProvider";
import { DeckControlsProvider } from "../providers/ControlsContextProvider";
import { DeckOverlayProvider } from "../providers/OverlayContextProvider";
import { computeFeatureBounds, cullRoadFeatures, type ViewportBox } from "./roadCulling";

/**
 * Recompute viewport culling at most this often (ms). Panning fires viewState
 * changes every animation frame; without throttling we would re-cull the whole
 * network ~60x/s. A coarse cadence keeps panning smooth while still updating
 * the bound feature set promptly.
 */
const CULL_THROTTLE_MS = 120;

interface DeckGLMapProps {
  data: RoadNetwork;
  strokeColor?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  children?: React.ReactNode;
  htmlMarkers?: React.ReactNode;
  onClick?: (event: React.MouseEvent, position: Position) => void;
  onContextClick?: (event: React.MouseEvent, position: Position) => void;
  cursor?: string;
  getTooltip?: (info: PickingInfo) => TooltipContent;
}

// Separate road features into regular roads and highways for distinct styling,
// then cull each group to the current viewport + zoom LOD before binding.
function useRoadLayers(
  data: RoadNetwork,
  strokeColor: string,
  strokeWidth: number,
  strokeOpacity: number,
  viewportBox: ViewportBox | null,
  zoom: number
) {
  // Split the (large) feature set and precompute per-feature bounds ONCE per
  // network load. Toggling stroke opacity (showDirections) or panning must not
  // re-run this O(features) work. The bounds arrays are index-aligned with the
  // feature arrays and feed the bbox-intersection test in cullRoadFeatures.
  const { roads, highways, roadBounds, highwayBounds } = useMemo(() => {
    const roads: RoadNetwork["features"] = [];
    const highways: RoadNetwork["features"] = [];
    for (const f of data.features) {
      (f.properties.type === "highway" ? highways : roads).push(f);
    }
    return {
      roads,
      highways,
      roadBounds: computeFeatureBounds(roads),
      highwayBounds: computeFeatureBounds(highways),
    };
  }, [data]);

  // Cull to the viewport (+ margin) and zoom LOD. Recomputed only when the
  // (throttled) viewport box or zoom changes — see useThrottledCullInputs — so
  // panning does not re-slice on every animation frame. Highways are major
  // arterials and are never dropped by the LOD filter; only the bbox cull
  // applies to them.
  const visibleRoads = useMemo<RoadNetwork["features"]>(() => {
    if (!viewportBox) return roads;
    return cullRoadFeatures(roads, roadBounds, viewportBox, zoom);
  }, [roads, roadBounds, viewportBox, zoom]);

  const visibleHighways = useMemo<RoadNetwork["features"]>(() => {
    if (!viewportBox) return highways;
    return cullRoadFeatures(highways, highwayBounds, viewportBox, zoom);
  }, [highways, highwayBounds, viewportBox, zoom]);

  return useMemo(() => {
    const roadColor = hexToRgba(strokeColor, strokeOpacity);
    const highwayColor = hexToRgba("#444", strokeOpacity);
    // Color/opacity flows through getColor with an updateTriggers key so only
    // the color attribute re-evaluates. Geometry re-uploads only when the
    // bound `data` array actually changes (viewport/zoom cull), and deck.gl
    // diff-updates by the stable layer id, so a color/opacity-only change does
    // not rebind geometry.
    const colorTrigger = `${strokeColor}:${strokeOpacity}`;

    return [
      new PathLayer({
        id: "roads",
        data: visibleRoads,
        getPath: (d) => d.geometry.coordinates as [number, number][],
        getColor: roadColor,
        getWidth: strokeWidth,
        widthUnits: "pixels",
        widthMinPixels: 1,
        jointRounded: true,
        capRounded: true,
        updateTriggers: { getColor: colorTrigger },
      }),
      new PathLayer({
        id: "highways",
        data: visibleHighways,
        getPath: (d) => d.geometry.coordinates as [number, number][],
        getColor: highwayColor,
        getWidth: strokeWidth * 2,
        widthUnits: "pixels",
        widthMinPixels: 1,
        jointRounded: true,
        capRounded: true,
        updateTriggers: { getColor: `#444:${strokeOpacity}` },
      }),
    ];
  }, [visibleRoads, visibleHighways, strokeColor, strokeWidth, strokeOpacity]);
}

/**
 * Throttle the culling inputs (viewport bbox + zoom) derived from viewState so
 * the O(features) cull runs at most once per CULL_THROTTLE_MS during a pan/zoom
 * gesture, with a trailing update so the final resting frame is never skipped.
 */
function useThrottledCullInputs(
  viewport: WebMercatorViewport | null,
  zoom: number
): { box: ViewportBox | null; zoom: number } {
  const computeBox = useCallback((): ViewportBox | null => {
    if (!viewport) return null;
    const [west, south, east, north] = viewport.getBounds();
    return [
      [west, south],
      [east, north],
    ];
  }, [viewport]);

  const [inputs, setInputs] = useState<{ box: ViewportBox | null; zoom: number }>(() => ({
    box: computeBox(),
    zoom,
  }));

  const lastRunRef = useRef(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const apply = () => {
      lastRunRef.current = Date.now();
      setInputs({ box: computeBox(), zoom });
    };
    const elapsed = Date.now() - lastRunRef.current;
    if (elapsed >= CULL_THROTTLE_MS) {
      apply();
    } else {
      // Schedule a trailing run so the last gesture frame still updates.
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(apply, CULL_THROTTLE_MS - elapsed);
    }
    return () => {
      if (trailingRef.current) clearTimeout(trailingRef.current);
    };
  }, [computeBox, zoom]);

  return inputs;
}

export const DeckGLMap: React.FC<DeckGLMapProps> = ({
  data,
  strokeColor = "#33f",
  strokeWidth = 1.5,
  strokeOpacity = 0.4,
  children,
  onClick,
  onContextClick,
  htmlMarkers,
  cursor = "grab",
  getTooltip,
}) => {
  const [containerRef, size] = useResizeObserver();
  const deckContainerRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState<Error | null>(null);

  // Surface deck/WebGL failures instead of freezing silently. Layer-scoped
  // errors only affect that layer and are logged; deck-level errors (WebGL
  // context creation/loss) take down the whole canvas, so show the fallback.
  const handleDeckError = useCallback((error: Error, layer?: Layer) => {
    console.error("deck.gl error:", error, layer ?? "(deck-level)");
    if (!layer) setMapError(error);
  }, []);
  const { viewState, onViewStateChange, controls } = useDeckViewState({
    data,
    width: size.width,
    height: size.height,
  });
  const { registeredLayers, contextValue: layerContextValue } = useDeckLayerManager();

  // Build a WebMercatorViewport for context consumers
  const viewport = useMemo(() => {
    if (!size.width || !size.height || !viewState) return null;
    return new WebMercatorViewport({
      width: size.width,
      height: size.height,
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch ?? 0,
      bearing: viewState.bearing ?? 0,
    });
  }, [size.width, size.height, viewState]);

  // Throttled viewport box + zoom feed the road culling/LOD. Decoupling these
  // from per-frame viewState changes keeps panning smooth on large networks.
  const cullInputs = useThrottledCullInputs(viewport, viewState.zoom ?? 0);
  const roadLayers = useRoadLayers(
    data,
    strokeColor,
    strokeWidth,
    strokeOpacity,
    cullInputs.box,
    cullInputs.zoom
  );
  const allLayers = useMemo(
    () => [...roadLayers, ...registeredLayers],
    [roadLayers, registeredLayers]
  );

  /** Returns [[west, south], [east, north]] i.e. [[minLng, minLat], [maxLng, maxLat]]. */
  const getBoundingBox = useCallback((): [[number, number], [number, number]] => {
    if (!viewport) {
      return [
        [0, 0],
        [0, 0],
      ];
    }
    const [west, south, east, north] = viewport.getBounds();
    return [
      [west, south],
      [east, north],
    ];
  }, [viewport]);

  const getZoom = useCallback(() => viewState.zoom ?? 0, [viewState.zoom]);

  // Stable accessor for the overlay container — passing a fresh closure each
  // render would recompute the overlay context value and re-render every
  // consumer (HTMLMarkers, overlays) on every map render.
  const getRef = useCallback(() => deckContainerRef.current, []);

  const project = useCallback(
    (position: Position): [number, number] | null => {
      if (!viewport) return null;
      const [x, y] = viewport.project([position[0], position[1]]);
      return [x, y];
    },
    [viewport]
  );

  // Map click handler: convert pixel to geo coordinates
  const handleClick = useCallback(
    (info: { coordinate?: number[] | null }, event: { srcEvent: MouseEvent }) => {
      if (!onClick || !info.coordinate) return;
      const [lng, lat] = info.coordinate;
      onClick(event.srcEvent as unknown as React.MouseEvent, [lng, lat]);
    },
    [onClick]
  );

  // Context menu: deck.gl doesn't have a built-in onContextMenu, so we attach to the container
  const handleContextMenu = useCallback(
    (evt: React.MouseEvent) => {
      if (!onContextClick || !viewport) return;
      evt.preventDefault();
      const rect = (evt.currentTarget as HTMLElement).getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const coords = viewport.unproject([x, y]);
      onContextClick(evt, [coords[0], coords[1]]);
    },
    [onContextClick, viewport]
  );

  // Cursor feedback: the `cursor` prop is an explicit mode override supplied by
  // Map.tsx (crosshair for dispatch ROUTE and for geofence drawing, "wait"
  // while dispatching) and always wins when set to anything but the idle
  // "grab". Otherwise reflect deck.gl's own hover/drag state so pickable
  // objects (vehicles, POIs, …) show a pointer and panning shows a grabbing
  // hand.
  const getCursor = useCallback(
    ({ isDragging, isHovering }: { isDragging: boolean; isHovering: boolean }) => {
      if (cursor !== "grab") return cursor;
      if (isDragging) return "grabbing";
      if (isHovering) return "pointer";
      return cursor;
    },
    [cursor]
  );

  // Keyboard zoom, active while the map container has focus (click it first,
  // or Tab to it): +/- mirror the on-screen zoom buttons. Escape is handled
  // globally by the app-level dispatcher (useInteractionKeyboard), not here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "+" || evt.key === "=") {
        controls.zoomIn();
      } else if (evt.key === "-" || evt.key === "_") {
        controls.zoomOut();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, controls]);

  // Controller config lives on the view (single source of truth — do not also
  // pass `controller` to <DeckGL>): the map is strictly 2D so rotation is
  // disabled, smooth scroll-zoom and a short inertia make pan/zoom feel less
  // stepped.
  const MAP_VIEW = useMemo(
    () =>
      new MapView({
        id: "main",
        controller: {
          dragRotate: false,
          touchRotate: false,
          scrollZoom: { smooth: true },
          inertia: 250,
        },
      }),
    []
  );

  if (mapError) {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <SectionErrorFallback section="Map" />
      </div>
    );
  }

  return (
    <DeckMapContextProvider
      viewport={viewport}
      viewState={viewState}
      getBoundingBox={getBoundingBox}
      getZoom={getZoom}
      project={project}
    >
      <DeckControlsProvider controls={controls}>
        <DeckOverlayProvider viewport={viewport} getRef={getRef}>
          <DeckLayersContext.Provider value={layerContextValue}>
            <div
              ref={containerRef}
              style={{ width: "100%", height: "100%", position: "relative", outline: "none" }}
              className="focus-visible:ring-inset focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onContextMenu={handleContextMenu}
              tabIndex={0}
            >
              <div ref={deckContainerRef} style={{ width: "100%", height: "100%" }}>
                {size.width > 0 && size.height > 0 && (
                  <DeckGL
                    views={MAP_VIEW}
                    viewState={viewState as MapViewState}
                    onViewStateChange={
                      onViewStateChange as Parameters<typeof DeckGL>[0]["onViewStateChange"]
                    }
                    layers={allLayers}
                    onClick={handleClick}
                    onError={handleDeckError}
                    pickingRadius={5}
                    style={{ position: "relative" }}
                    getCursor={getCursor}
                    getTooltip={getTooltip}
                    deviceProps={{ adapters: [webgl2Adapter] }}
                  >
                    {/* HTML overlay — children rendered as absolute-positioned elements */}
                    {viewport && (
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
                        <div style={{ pointerEvents: "auto" }}>{htmlMarkers}</div>
                      </div>
                    )}
                  </DeckGL>
                )}
              </div>
              {/* Layer components (VehiclesLayer, BreadcrumbLayer, etc.) render null
                  and register deck.gl layers via useRegisterLayers hooks. */}
              {children}
            </div>
          </DeckLayersContext.Provider>
        </DeckOverlayProvider>
      </DeckControlsProvider>
    </DeckMapContextProvider>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────

function hexToRgba(hex: string, opacity: number): [number, number, number, number] {
  const h = hex.replace("#", "");
  const bigint =
    h.length === 3 ? parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16) : parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b, Math.round(opacity * 255)];
}
