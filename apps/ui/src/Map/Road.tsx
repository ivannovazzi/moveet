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
        outlineWidth: 2,
        outlineColor: [0, 0, 0, 180],
        pickable: false,
      }),
    ];
  }, [road]);

  useRegisterLayers("selected-road", layers);

  return null;
}
