import { useState, useCallback, useRef, useEffect } from "react";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import type { RoadNetwork, Position } from "@/types";
import type { PanToOptions, DeckViewStateControls } from "../providers/types";
import { fitPadding, getInsets, visibleCentre } from "../mapInsets";

export type { DeckViewStateControls };

const DEFAULT_ZOOM = 12;

/**
 * How many zoom levels one button press / keyboard shortcut moves. A full level
 * per press (matching Google Maps / Mapbox) — the previous 0.5 barely changed
 * the view and read as an unresponsive control.
 */
const ZOOM_STEP = 1;

/**
 * How far past the full-network fit the user may zoom out (levels). The floor is
 * derived from the fitted zoom on load so it tracks the actual network + the
 * current viewport; this margin just grants a little breathing room around it.
 * Prevents zooming out to empty ocean/continent around a single city.
 */
const MIN_ZOOM_MARGIN = 1;

/** Air left around a fitted bounding box, on top of whatever the chrome claims. */
const FIT_PADDING = 40;

/**
 * The camera centre that puts [lng, lat] in the middle of the part of the map
 * the chrome is *not* covering (see `mapInsets`).
 *
 * The dock, the search bar, the inspector and an open section panel all float
 * over the canvas, so the viewport's centre is frequently underneath one of
 * them. Deck's own viewport maths does the conversion: `panByPosition` — the
 * same call the drag controller uses — asks which map centre puts a given
 * coordinate under a given pixel, which is exactly the question here with the
 * pixel being the visible rect's centre rather than the viewport's. Falls back
 * to the target itself when the viewport has no size yet, or when the chrome
 * leaves too little room for the shift to be an improvement.
 */
function centreForTarget(
  lng: number,
  lat: number,
  zoom: number,
  width: number,
  height: number
): { longitude: number; latitude: number } {
  const centre = visibleCentre(width, height, getInsets());
  if (!centre) return { longitude: lng, latitude: lat };
  const vp = new WebMercatorViewport({ width, height, longitude: lng, latitude: lat, zoom });
  const panned = vp.panByPosition([lng, lat], centre);
  if (panned.longitude == null || panned.latitude == null) return { longitude: lng, latitude: lat };
  return { longitude: panned.longitude, latitude: panned.latitude };
}

const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: 36.82,
  latitude: -1.29,
  zoom: DEFAULT_ZOOM,
  pitch: 0,
  bearing: 0,
  // Conservative floor until the network loads and we derive a tighter one from
  // its fitted bounds (see the fit-to-bounds effect).
  minZoom: 8,
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
  // value without re-creating on every pan/zoom.
  const viewStateRef = useRef(viewState);
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

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
      // The first fit is the whole network, so it keeps plain padding: the
      // chrome's bands would squeeze the city into whatever strip is left.
      { padding: FIT_PADDING }
    );

    setViewState((prev) => ({
      ...prev,
      longitude: fitted.longitude,
      latitude: fitted.latitude,
      zoom: fitted.zoom,
      // Floor the zoom-out at (fit − margin) so the network always roughly
      // fills the viewport and you can't zoom out into empty space around it.
      minZoom: fitted.zoom - MIN_ZOOM_MARGIN,
    }));
    initializedRef.current = true;
  }, [data, width, height]);

  const onViewStateChange = useCallback(
    ({ viewState: newViewState }: { viewState: MapViewState }) => {
      setViewState(newViewState);
    },
    []
  );

  // Control methods. Zoom buttons/keyboard shortcuts ease with the same
  // FlyToInterpolator as panTo/focusOn (200ms — short enough to feel like a
  // direct response, long enough not to snap) instead of jumping instantly.
  const zoomIn = useCallback(() => {
    setViewState((prev) => ({
      ...prev,
      zoom: Math.min((prev.zoom ?? 1) + ZOOM_STEP, prev.maxZoom ?? 20),
      transitionDuration: 200,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewState((prev) => ({
      ...prev,
      zoom: Math.max((prev.zoom ?? 1) - ZOOM_STEP, prev.minZoom ?? 1),
      transitionDuration: 200,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, []);

  const panTo = useCallback(
    (lng: number, lat: number, options: PanToOptions) => {
      setViewState((prev) => ({
        ...prev,
        ...centreForTarget(lng, lat, prev.zoom ?? DEFAULT_ZOOM, width, height),
        transitionDuration: options?.duration ?? 300,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    },
    [width, height]
  );

  const setZoom = useCallback((zoom: number) => {
    setViewState((prev) => ({ ...prev, zoom }));
  }, []);

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
        // Per-side padding, so a box fitted while the Fleet panel is open sits
        // in the strip of map the panel leaves rather than behind it.
        { padding: fitPadding(width, height, getInsets(), FIT_PADDING) }
      );
      setViewState((prev) => ({
        ...prev,
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: fitted.zoom,
      }));
    },
    [width, height]
  );

  const focusOn = useCallback(
    (lng: number, lat: number, zoom: number, options: PanToOptions) => {
      setViewState((prev) => ({
        ...prev,
        ...centreForTarget(lng, lat, zoom, width, height),
        zoom,
        transitionDuration: options?.duration ?? 500,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    },
    [width, height]
  );

  const controls: DeckViewStateControls = {
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
