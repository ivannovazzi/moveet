import { useState, useCallback, useRef, useEffect } from "react";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import type { RoadNetwork, Position } from "@/types";
import { networkBounds } from "@/utils/coordinates";
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
 * How far the camera may lean back (degrees). deck.gl's own ceiling is 60; past
 * roughly that the horizon enters the frame and the road network stretches into
 * a haze of near-parallel lines, which costs a lot of geometry to draw and says
 * nothing about where the vehicles are.
 */
const MAX_PITCH = 60;

/** The pitch the tilt key and the `t` shortcut lean to from flat. */
const TILT_PITCH = 45;

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
  const vp = new WebMercatorViewport({
    width,
    height,
    longitude: lng,
    latitude: lat,
    zoom,
  });
  const panned = vp.panByPosition([lng, lat], centre);
  if (panned.longitude == null || panned.latitude == null) return { longitude: lng, latitude: lat };
  return { longitude: panned.longitude, latitude: panned.latitude };
}

/**
 * The camera before a network has been loaded. It carries no city: the centre
 * comes from the network's own bounds, so hardcoding one here would pin the map
 * to whichever city happened to ship first (it was Nairobi) and show a frame of
 * it every time the simulator serves a different one. Null island is a
 * deliberate placeholder — `fitted` stays false until the first fit lands and
 * the canvas is hidden until then, so this view state is never seen.
 */
const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: 0,
  latitude: 0,
  zoom: DEFAULT_ZOOM,
  pitch: 0,
  bearing: 0,
  // Conservative floor until the network loads and we derive a tighter one from
  // its fitted bounds (see the fit-to-bounds effect).
  minZoom: 8,
  maxZoom: 20,
  // The controller clamps a rotate drag to this, so a gesture cannot lean past
  // the horizon even though it is free to lean.
  maxPitch: MAX_PITCH,
};

interface UseDeckViewStateOptions {
  data: RoadNetwork | null;
  width: number;
  height: number;
}

export function useDeckViewState({ data, width, height }: UseDeckViewStateOptions) {
  const [viewState, setViewState] = useState<MapViewState>(DEFAULT_VIEW_STATE);
  const [fitted, setFitted] = useState(false);
  // The bounds the camera was last fitted to, as a comparable key. A resize
  // must not re-fit (it would throw away the user's pan/zoom on every dock
  // toggle), but a *different* network must — the simulator can be pointed at
  // another city, and the old centre is then in the wrong hemisphere.
  const fittedBoundsRef = useRef<string | null>(null);

  // Live view-state ref so stable callbacks (getZoom) can read the current
  // value without re-creating on every pan/zoom.
  const viewStateRef = useRef(viewState);
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  // Centre on the network the simulator actually served — on load, and again
  // whenever its bounds change.
  useEffect(() => {
    if (!data || !width || !height) return;

    // null for an empty network or one with no valid coordinates: nothing to
    // aim at, so leave the camera (and `fitted`) alone rather than flying to
    // an infinite box.
    const bounds = networkBounds(data);
    if (!bounds) return;

    const key = bounds.flat().join(",");
    if (fittedBoundsRef.current === key) return;

    const vp = new WebMercatorViewport({ width, height });
    const fit = vp.fitBounds(
      bounds,
      // The first fit is the whole network, so it keeps plain padding: the
      // chrome's bands would squeeze the city into whatever strip is left.
      { padding: FIT_PADDING }
    );

    setViewState((prev) => ({
      ...prev,
      longitude: fit.longitude,
      latitude: fit.latitude,
      zoom: fit.zoom,
      // Floor the zoom-out at (fit − margin) so the network always roughly
      // fills the viewport and you can't zoom out into empty space around it.
      minZoom: fit.zoom - MIN_ZOOM_MARGIN,
    }));
    fittedBoundsRef.current = key;
    setFitted(true);
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

  /**
   * Lean the camera to an absolute pitch, clamped to what the drag gesture is
   * allowed to reach so the key and the drag cannot disagree about the ceiling.
   */
  const setPitch = useCallback((pitch: number) => {
    setViewState((prev) => ({
      ...prev,
      pitch: Math.min(Math.max(pitch, 0), MAX_PITCH),
      transitionDuration: 200,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, []);

  const getPitch = useCallback(() => viewStateRef.current.pitch ?? 0, []);

  /**
   * The tilt key and the `t` shortcut: flat ⇄ leaning. A toggle rather than a
   * stepper because the tilt is a way of *looking* at the map (flyovers,
   * stacked interchanges) rather than a value to dial in — and any pitch a drag
   * left behind counts as "leaning", so one press always gets you back to flat.
   */
  const toggleTilt = useCallback(() => {
    setPitch(getPitch() > 0 ? 0 : TILT_PITCH);
  }, [setPitch, getPitch]);

  const setBounds = useCallback(
    (bounds: [Position, Position]) => {
      if (!width || !height) return;
      const [[x0, y0], [x1, y1]] = bounds;
      const vp = new WebMercatorViewport({ width, height });
      const fit = vp.fitBounds(
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
        longitude: fit.longitude,
        latitude: fit.latitude,
        zoom: fit.zoom,
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
    setPitch,
    getPitch,
    toggleTilt,
  };

  return { viewState, onViewStateChange, controls, fitted };
}
