import { useMemo, useEffect } from "react";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { Position, Road } from "@/types";
import { useMapControls } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

interface DirectionProps {
  road: Road;
}

function getBounds(streets: Position[]): [Position, Position] {
  const bounds = {
    min: { x: Infinity, y: Infinity },
    max: { x: -Infinity, y: -Infinity },
  };
  streets.forEach(([x, y]) => {
    bounds.min.x = Math.min(bounds.min.x, x);
    bounds.min.y = Math.min(bounds.min.y, y);
    bounds.max.x = Math.max(bounds.max.x, x);
    bounds.max.y = Math.max(bounds.max.y, y);
  });
  return [
    [bounds.min.x, bounds.min.y],
    [bounds.max.x, bounds.max.y],
  ];
}

function centroid(coords: Position[]): Position {
  if (coords.length === 0) return [0, 0];
  const sumLng = coords.reduce((s, c) => s + c[0], 0);
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  return [sumLng / coords.length, sumLat / coords.length];
}

export default function DirectionMap({ road }: DirectionProps) {
  const { setBounds } = useMapControls();

  useEffect(() => {
    setBounds(getBounds(road.streets.flat()));
  }, [road.streets, setBounds]);

  const layers = useMemo(() => {
    if (road.streets.length === 0) return [];

    const pathData = road.streets.map((street, i) => ({
      id: `road-street-${i}`,
      path: street as [number, number][],
    }));

    const allCoords = road.streets.flat();
    const center = centroid(allCoords);

    return [
      new PathLayer<(typeof pathData)[number]>({
        id: "selected-road-paths",
        data: pathData,
        getPath: (d) => d.path,
        getColor: [255, 255, 255, 255],
        getWidth: 2,
        widthUnits: "pixels",
        jointRounded: true,
        capRounded: true,
        // Not pickable: the path has no click handler, so a hover highlight
        // would imply interactivity it doesn't have (a click falls through
        // to the map and clears the selection).
        pickable: false,
      }),
      new TextLayer({
        id: "selected-road-label",
        data: [{ text: road.name, position: center }],
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: [255, 255, 255, 255],
        getSize: 14,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        fontFamily: "inherit",
        // SDF is required for deck.gl to draw an outline at all; see the fuller
        // explanation on the geofence label layer. Halo is 0.75 * outlineWidth
        // atlas px scaled by getSize / 64, so outlineWidth 8 → 6 atlas px →
        // ~1.3px on screen at getSize 14. radius must be >= outlineWidth and
        // buffer >= the halo's 6 atlas px, or the atlas clips it.
        fontSettings: { sdf: true, radius: 16, buffer: 8 },
        outlineWidth: 8,
        outlineColor: [0, 0, 0, 180],
        pickable: false,
      }),
    ];
  }, [road]);

  useRegisterLayers("selected-road", layers);

  return null;
}
