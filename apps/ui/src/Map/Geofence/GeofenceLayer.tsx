import { useMemo } from "react";
import { PolygonLayer, TextLayer } from "@deck.gl/layers";
import type { GeoFence, GeoFenceType } from "@moveet/shared-types";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";

type RGBA = [number, number, number, number];

/** Fade in/out duration in milliseconds, matching SpeedLimitSigns. */
const FADE_DURATION_MS = 500;

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
  const layers = useMemo(() => {
    if (fences.length === 0) return [];

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
      new TextLayer<GeoFence>({
        id: "geofence-labels",
        data: fences,
        getPosition: (d: GeoFence) => centroid(d.polygon),
        getText: (d: GeoFence) => d.name,
        getSize: 11,
        getColor: (d: GeoFence) => getStrokeRgba(d),
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        pickable: false,
        fontFamily: "system-ui",
        transitions: {
          getColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
        outlineColor: [0, 0, 0, 153],
        outlineWidth: 3,
      }),
    ];
  }, [fences, selectedFenceId, onSelectFence, selectable]);

  useRegisterLayers("geofences", layers);

  return null;
}
