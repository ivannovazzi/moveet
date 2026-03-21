import { useState, useCallback, useRef, useEffect } from "react";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import type { RoadNetwork, Position } from "@/types";
import type { PanToOptions, DeckViewStateControls } from "../providers/types";

export type { DeckViewStateControls };

const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: 36.82,
  latitude: -1.29,
  zoom: 12,
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

  // Fit to data bounds on first load
  useEffect(() => {
    if (!data || !width || !height || initializedRef.current) return;

    // Compute GeoJSON bounding box manually (replaces d3.geoBounds)
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
    const vp = new WebMercatorViewport({ width, height });
    const fitted = vp.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 40 }
    );

    setViewState((prev) => ({
      ...prev,
      longitude: fitted.longitude,
      latitude: fitted.latitude,
      zoom: fitted.zoom,
    }));
    initializedRef.current = true;
  }, [data, width, height]);

  const onViewStateChange = useCallback(
    ({ viewState: newViewState }: { viewState: MapViewState }) => {
      setViewState(newViewState);
    },
    []
  );

  // Control methods
  const zoomIn = useCallback(() => {
    setViewState((prev) => ({ ...prev, zoom: Math.min((prev.zoom ?? 1) + 0.5, 20) }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewState((prev) => ({ ...prev, zoom: Math.max((prev.zoom ?? 1) - 0.5, 1) }));
  }, []);

  const panTo = useCallback((lng: number, lat: number, options: PanToOptions) => {
    setViewState((prev) => ({
      ...prev,
      longitude: lng,
      latitude: lat,
      transitionDuration: options?.duration ?? 300,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setViewState((prev) => ({ ...prev, zoom }));
  }, []);

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
      setViewState((prev) => ({
        ...prev,
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: fitted.zoom,
      }));
    },
    [width, height]
  );

  const focusOn = useCallback((lng: number, lat: number, zoom: number, options: PanToOptions) => {
    setViewState((prev) => ({
      ...prev,
      longitude: lng,
      latitude: lat,
      zoom,
      transitionDuration: options?.duration ?? 500,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, []);

  const controls: DeckViewStateControls = {
    zoomIn,
    zoomOut,
    panTo,
    setZoom,
    setBounds,
    focusOn,
  };

  return { viewState, onViewStateChange, controls };
}
