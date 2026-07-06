import { useState, useCallback, useRef, useEffect } from "react";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import type { RoadNetwork, Position } from "@/types";
import type { PanToOptions, DeckViewStateControls } from "../providers/types";

export type { DeckViewStateControls };

const DEFAULT_ZOOM = 12;

const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: 36.82,
  latitude: -1.29,
  zoom: DEFAULT_ZOOM,
  pitch: 0,
  bearing: 0,
  minZoom: 1,
  maxZoom: 20,
};

interface UseDeckViewStateOptions {
  data: RoadNetwork | null;
  width: number;
  height: number;
}

export function useDeckViewState({ data, width, height }: UseDeckViewStateOptions) {
  const [viewState, setViewState] = useState<MapViewState>(DEFAULT_VIEW_STATE);
  const initializedRef = useRef(false);

  // Live view-state ref so stable callbacks (getZoom) can read the current
  // value without re-creating on every pan/zoom. Kept in sync synchronously via
  // applyViewState below — a per-frame `useEffect([viewState])` copy would run
  // on every pan/zoom frame just to mirror state and would be one frame stale.
  const viewStateRef = useRef(viewState);

  // The single writer for view state: updates React state AND the live ref in
  // lockstep so ref readers (getZoom) never lag, including programmatic camera
  // moves that don't round-trip through DeckGL's onViewStateChange.
  const applyViewState = useCallback((update: (prev: MapViewState) => MapViewState) => {
    setViewState((prev) => {
      const next = update(prev);
      viewStateRef.current = next;
      return next;
    });
  }, []);

  // Fit to data bounds on first load
  useEffect(() => {
    if (!data || !data.features.length || !width || !height || initializedRef.current) return;

    // Compute GeoJSON bounding box manually
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
    for (const feature of data.features) {
      for (const [lng, lat] of feature.geometry.coordinates) {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }

    // Guard against degenerate bounds (no valid coordinates)
    if (!isFinite(west) || !isFinite(south) || !isFinite(east) || !isFinite(north)) return;

    const vp = new WebMercatorViewport({ width, height });
    const fitted = vp.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 40 }
    );

    applyViewState((prev) => ({
      ...prev,
      longitude: fitted.longitude,
      latitude: fitted.latitude,
      zoom: fitted.zoom,
    }));
    initializedRef.current = true;
  }, [data, width, height, applyViewState]);

  const onViewStateChange = useCallback(
    ({ viewState: newViewState }: { viewState: MapViewState }) => {
      applyViewState(() => newViewState);
    },
    [applyViewState]
  );

  // Control methods. Zoom buttons/keyboard shortcuts ease with the same
  // FlyToInterpolator as panTo/focusOn (200ms — short enough to feel like a
  // direct response, long enough not to snap) instead of jumping instantly.
  const zoomIn = useCallback(() => {
    applyViewState((prev) => ({
      ...prev,
      zoom: Math.min((prev.zoom ?? 1) + 0.5, 20),
      transitionDuration: 200,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [applyViewState]);

  const zoomOut = useCallback(() => {
    applyViewState((prev) => ({
      ...prev,
      zoom: Math.max((prev.zoom ?? 1) - 0.5, 1),
      transitionDuration: 200,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [applyViewState]);

  const panTo = useCallback(
    (lng: number, lat: number, options: PanToOptions) => {
      applyViewState((prev) => ({
        ...prev,
        longitude: lng,
        latitude: lat,
        transitionDuration: options?.duration ?? 300,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    },
    [applyViewState]
  );

  const setZoom = useCallback(
    (zoom: number) => {
      applyViewState((prev) => ({ ...prev, zoom }));
    },
    [applyViewState]
  );

  const getZoom = useCallback(() => viewStateRef.current.zoom ?? DEFAULT_ZOOM, []);

  const setBounds = useCallback(
    (bounds: [Position, Position]) => {
      if (!width || !height) return;
      const [[x0, y0], [x1, y1]] = bounds;
      const vp = new WebMercatorViewport({ width, height });
      const fitted = vp.fitBounds(
        [
          [x0, y0],
          [x1, y1],
        ],
        { padding: 40 }
      );
      applyViewState((prev) => ({
        ...prev,
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: fitted.zoom,
      }));
    },
    [width, height, applyViewState]
  );

  const focusOn = useCallback(
    (lng: number, lat: number, zoom: number, options: PanToOptions) => {
      applyViewState((prev) => ({
        ...prev,
        longitude: lng,
        latitude: lat,
        zoom,
        transitionDuration: options?.duration ?? 500,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    },
    [applyViewState]
  );

  const controls: DeckViewStateControls = {
    // Real controls are always ready; the module stub reports false until this
    // provider mounts (see providers/controls.ts).
    ready: true,
    zoomIn,
    zoomOut,
    panTo,
    setZoom,
    getZoom,
    setBounds,
    focusOn,
  };

  return { viewState, onViewStateChange, controls };
}
