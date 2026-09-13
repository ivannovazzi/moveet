import { useMemo } from "react";
import { PolygonLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoFence, GeoFenceType } from "@moveet/shared-types";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useSettledZoom } from "../hooks/useSettledZoom";
import { resolveMapColor } from "@/lib/mapColor";
import { LABEL_PRIORITY, mapLabelProps, useVisibleLabels, type LabelItem } from "@/lib/mapLabels";

type RGBA = [number, number, number, number];

/** Fade in/out duration in milliseconds, matching SpeedLimitSigns. */
const FADE_DURATION_MS = 500;

/** Stable empty array so an inactive memo never re-registers. */
const NO_LAYERS: Layer[] = [];

/** Label size, shared between the TextLayer and the declutter pass. */
const LABEL_SIZE = 11;

/** A fence the operator selected outranks the rest of the fence names. */
const SELECTED_LABEL_BOOST = 5;

// restricted = off-limits (danger); delivery/monitoring are both
// permitted-access zone types, so they share the "ok" hue.
const TYPE_FILL: Record<GeoFenceType, RGBA> = {
  restricted: resolveMapColor("var(--color-overlay-danger)", 64),
  delivery: resolveMapColor("var(--color-overlay-ok)", 64),
  monitoring: resolveMapColor("var(--color-overlay-ok)", 64),
};

const TYPE_STROKE: Record<GeoFenceType, RGBA> = {
  restricted: resolveMapColor("var(--color-overlay-danger)", 255),
  delivery: resolveMapColor("var(--color-overlay-ok)", 255),
  monitoring: resolveMapColor("var(--color-overlay-ok)", 255),
};

function hexToRgba(hex: string, alpha: number): RGBA {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b, Math.round(alpha * 255)];
}

function getFillRgba(fence: GeoFence): RGBA {
  if (fence.color) return hexToRgba(fence.color, 0.25);
  const base = TYPE_FILL[fence.type];
  return fence.active ? base : [base[0], base[1], base[2], Math.round(base[3] * 0.4)];
}

function getStrokeRgba(fence: GeoFence): RGBA {
  if (fence.color) {
    const rgba = hexToRgba(fence.color, 1);
    return fence.active ? rgba : [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * 0.4)];
  }
  const base = TYPE_STROKE[fence.type];
  return fence.active ? base : [base[0], base[1], base[2], Math.round(base[3] * 0.4)];
}

function centroid(points: [number, number][]): [number, number] {
  const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const y = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return [x, y];
}

// INTEGRATION: Map.tsx must pass `selectedFenceId` + `onSelectFence` from
// useGeofenceManager() so a fence click selects/deselects it. Optionally pass
// `selectable={false}` while another map interaction owns the click (e.g.
// dispatch/geofence-draw), otherwise a fence pick returns true and swallows
// DeckGL's map-level onClick. The pointer-on-hover cursor is automatic:
// DeckGL's getCursor already returns "pointer" for any hovered pickable layer.
interface GeofenceLayerProps {
  fences: GeoFence[];
  selectedFenceId?: string;
  /** Map click on a fence polygon selects it (panel-local selection). */
  onSelectFence?: (id: string) => void;
  /**
   * Whether fence polygons respond to map clicks. Defaults to true. Set false
   * when another interaction owns map clicks so a fence must NOT pick (which
   * would return true from onClick and suppress DeckGL's map-level onClick).
   */
  selectable?: boolean;
}

export default function GeofenceLayer({
  fences,
  selectedFenceId,
  onSelectFence,
  selectable = true,
}: GeofenceLayerProps) {
  const { viewport, getZoom } = useMapContext();
  const { settledZoom } = useSettledZoom(getZoom());

  // Fence names compete with every other map label, not just each other: a
  // zone name that buries a route's distance readout is the wrong trade.
  const labelItems = useMemo<LabelItem[]>(
    () =>
      fences.map((fence) => ({
        id: fence.id,
        position: centroid(fence.polygon),
        text: fence.name,
        size: LABEL_SIZE,
        priority:
          LABEL_PRIORITY.geofence + (fence.id === selectedFenceId ? SELECTED_LABEL_BOOST : 0),
      })),
    [fences, selectedFenceId]
  );

  const visibleLabels = useVisibleLabels("geofence-labels", labelItems, viewport, settledZoom);

  // Geometry and labels live in separate memos: a label verdict changes
  // whenever anything anywhere on the map moves, and rebuilding the polygons
  // for that would re-upload every fence outline for nothing.
  const geometryLayers = useMemo<Layer[]>(() => {
    if (fences.length === 0) return NO_LAYERS;

    return [
      new PolygonLayer<GeoFence>({
        id: "geofences",
        data: fences,
        getPolygon: (d: GeoFence) => d.polygon,
        getFillColor: (d: GeoFence) => getFillRgba(d),
        getLineColor: (d: GeoFence) => getStrokeRgba(d),
        getLineWidth: (d: GeoFence) => (d.id === selectedFenceId ? 2 : 1),
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        // Only pickable in browse mode: while another interaction owns map
        // clicks, a fence pick would return true and swallow the map-level
        // click. When pickable, DeckGL's getCursor shows a pointer on hover.
        pickable: selectable,
        onClick: (info: { object?: GeoFence }) => {
          if (!selectable || !info.object) return false;
          onSelectFence?.(info.object.id);
          // Mark handled so DeckGL.onClick (map-empty-click clear) doesn't fire.
          return true;
        },
        updateTriggers: {
          // Accessor identity changes don't re-evaluate attributes in deck.gl;
          // the selected fence's thicker outline needs an explicit trigger.
          getLineWidth: selectedFenceId,
        },
        transitions: {
          getFillColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
          getLineColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
      }),
    ];
  }, [fences, selectedFenceId, onSelectFence, selectable]);

  const labelLayers = useMemo<Layer[]>(() => {
    const labelled = fences.filter((fence) => visibleLabels.has(fence.id));
    if (labelled.length === 0) return NO_LAYERS;
    return [
      new TextLayer<GeoFence>({
        ...mapLabelProps(LABEL_SIZE),
        id: "geofence-labels",
        data: labelled,
        getPosition: (d: GeoFence) => centroid(d.polygon),
        getText: (d: GeoFence) => d.name,
        getColor: (d: GeoFence) => getStrokeRgba(d),
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        pickable: false,
        transitions: {
          getColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
      }),
    ];
  }, [fences, visibleLabels]);

  const layers = useMemo(
    () => (labelLayers.length === 0 ? geometryLayers : [...geometryLayers, ...labelLayers]),
    [geometryLayers, labelLayers]
  );

  useRegisterLayers("geofences", layers);

  return null;
}
