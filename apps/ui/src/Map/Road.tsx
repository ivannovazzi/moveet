import { useMemo, useEffect } from "react";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { Position, Road } from "@/types";
import { useMapContext, useMapControls } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useSettledZoom } from "./hooks/useSettledZoom";
import { resolveMapColor } from "@/lib/mapColor";
import {
  LABEL_PRIORITY,
  LABEL_TOKEN,
  mapLabelProps,
  useVisibleLabels,
  type LabelItem,
} from "@/lib/mapLabels";

/** Label size, shared between the TextLayer and the declutter pass. */
const LABEL_SIZE = 14;

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
  const { viewport, getZoom } = useMapContext();
  const { settledZoom } = useSettledZoom(getZoom());

  useEffect(() => {
    setBounds(getBounds(road.streets.flat()));
  }, [road.streets, setBounds]);

  const center = useMemo(
    () => (road.streets.length === 0 ? null : centroid(road.streets.flat())),
    [road]
  );

  // The road the operator explicitly selected outranks every other label on the
  // map, so this registers at the top of the priority scale and the POI carpet
  // yields to it rather than the other way round.
  const labelItems = useMemo<LabelItem[]>(
    () =>
      center === null
        ? []
        : [
            {
              id: "selected-road",
              position: [center[0], center[1]],
              text: road.name,
              size: LABEL_SIZE,
              priority: LABEL_PRIORITY.selectedRoad,
            },
          ],
    [center, road.name]
  );

  const visibleLabels = useVisibleLabels("selected-road-label", labelItems, viewport, settledZoom);

  const layers = useMemo(() => {
    if (road.streets.length === 0) return [];

    const pathData = road.streets.map((street, i) => ({
      id: `road-street-${i}`,
      path: street as [number, number][],
    }));

    const showLabel = center !== null && visibleLabels.has("selected-road");

    return [
      new PathLayer<(typeof pathData)[number]>({
        id: "selected-road-paths",
        data: pathData,
        getPath: (d) => d.path,
        getColor: resolveMapColor(LABEL_TOKEN),
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
        ...mapLabelProps(LABEL_SIZE),
        id: "selected-road-label",
        data: showLabel && center ? [{ text: road.name, position: center }] : [],
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: resolveMapColor(LABEL_TOKEN),
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        pickable: false,
      }),
    ];
  }, [road, center, visibleLabels]);

  useRegisterLayers("selected-road", layers);

  return null;
}
