import React, { useCallback, useMemo, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { MapView, WebMercatorViewport } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";
import { PathLayer } from "@deck.gl/layers";
import type { Position, RoadNetwork } from "@/types";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { useDeckViewState } from "../hooks/useDeckViewState";
import { useDeckLayerManager, DeckLayersContext } from "../hooks/useDeckLayers";
import { DeckMapContextProvider } from "../providers/MapContextProvider";
import { DeckControlsProvider } from "../providers/ControlsContextProvider";
import { DeckOverlayProvider } from "../providers/OverlayContextProvider";

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
}

// Separate road features into regular roads and highways for distinct styling
function useRoadLayers(
  data: RoadNetwork,
  strokeColor: string,
  strokeWidth: number,
  strokeOpacity: number
) {
  return useMemo(() => {
    const roads = data.features.filter((f) => f.properties.type !== "highway");
    const highways = data.features.filter((f) => f.properties.type === "highway");

    return [
      new PathLayer({
        id: "roads",
        data: roads,
        getPath: (d) => d.geometry.coordinates as [number, number][],
        getColor: hexToRgba(strokeColor, strokeOpacity),
        getWidth: strokeWidth,
        widthUnits: "pixels",
        widthMinPixels: 1,
        jointRounded: true,
        capRounded: true,
      }),
      new PathLayer({
        id: "highways",
        data: highways,
        getPath: (d) => d.geometry.coordinates as [number, number][],
        getColor: hexToRgba("#444", strokeOpacity),
        getWidth: strokeWidth * 2,
        widthUnits: "pixels",
        widthMinPixels: 1,
        jointRounded: true,
        capRounded: true,
      }),
    ];
  }, [data, strokeColor, strokeWidth, strokeOpacity]);
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
}) => {
  const [containerRef, size] = useResizeObserver();
  const deckContainerRef = useRef<HTMLDivElement>(null);
  const { viewState, onViewStateChange, controls } = useDeckViewState({
    data,
    width: size.width,
    height: size.height,
  });
  const { registeredLayers, contextValue: layerContextValue } = useDeckLayerManager();

  const roadLayers = useRoadLayers(data, strokeColor, strokeWidth, strokeOpacity);
  const allLayers = useMemo(
    () => [...roadLayers, ...registeredLayers],
    [roadLayers, registeredLayers]
  );

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

  const getBoundingBox = useCallback((): [Position, Position] => {
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

  const MAP_VIEW = useMemo(
    () =>
      new MapView({
        id: "main",
        controller: true,
      }),
    []
  );

  return (
    <DeckMapContextProvider
      viewport={viewport}
      viewState={viewState}
      getBoundingBox={getBoundingBox}
      getZoom={getZoom}
      project={project}
    >
      <DeckControlsProvider controls={controls}>
        <DeckOverlayProvider viewport={viewport} getRef={() => deckContainerRef.current}>
          <DeckLayersContext.Provider value={layerContextValue}>
            <div
              ref={containerRef}
              style={{ width: "100%", height: "100%", position: "relative" }}
              onContextMenu={handleContextMenu}
            >
              <div ref={deckContainerRef} style={{ width: "100%", height: "100%" }}>
                <DeckGL
                  views={MAP_VIEW}
                  viewState={viewState as MapViewState}
                  onViewStateChange={
                    onViewStateChange as Parameters<typeof DeckGL>[0]["onViewStateChange"]
                  }
                  layers={allLayers}
                  onClick={handleClick}
                  controller={true}
                  style={{ position: "relative" }}
                  getCursor={() => cursor}
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
              </div>
              {/* SVG children slot — for backward compat during migration, not rendered in deck.gl */}
              {children && (
                <svg
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    display: "none",
                  }}
                  aria-hidden
                >
                  <g className="markers">{children}</g>
                </svg>
              )}
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
