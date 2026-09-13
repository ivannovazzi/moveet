import { useEffect, useMemo, useSyncExternalStore } from "react";
import { resolveMapColor } from "./mapColor";

/**
 * One style for every label drawn on the map, plus a tiny cross-layer
 * declutter store.
 *
 * Before this module each overlay built its own TextLayer: job and dispatch
 * labels shipped with no halo at all, POI/geofence/road labels each repeated
 * the same SDF incantation, and three of them disagreed about the font. The
 * map now has a single label voice — `mapLabelProps(size)` — and layers only
 * supply what is genuinely theirs (text, position, colour, anchors).
 *
 * ── Why the SDF settings look like this ──────────────────────────────────
 * deck.gl only draws an outline for an SDF font atlas. Without `sdf: true` it
 * logs "fontSettings.sdf is required to render outline" and silently ignores
 * `outlineWidth`/`outlineColor` — which is exactly how three layers shipped
 * with invisible halos.
 *
 * With SDF the halo is measured in font-atlas pixels (the atlas renders at
 * fontSettings.fontSize = 64) and occupies 0.75 * outlineWidth of them, then
 * scales down by getSize / 64. So outlineWidth 8 → 6 atlas px → roughly 1px on
 * screen at getSize 11. Two atlas settings have to keep up:
 *   - radius (default 12): distance is only encoded up to radius * (1 - cutoff)
 *     px outside the glyph; 16 keeps the halo at half the encoded range, away
 *     from the smoothing clamp. Above `radius` deck.gl clamps and the halo
 *     stops growing, so radius >= outlineWidth.
 *   - buffer (default 4): the glyph's padding in the atlas, so it must be >=
 *     the 6 atlas px the halo occupies or the atlas clips it.
 *
 * `src/Map/__tests__/textLayerOutlines.test.ts` guards those three numbers.
 *
 * Also deliberate: CollisionFilterExtension is NOT used for label placement.
 * On a TextLayer it culls every label, and it only works on pickable layers —
 * hence the hand-rolled `declutter()` below.
 */

/** Shared TextLayer style props. Spread FIRST, then the layer's own accessors. */
export interface MapLabelProps {
  fontFamily: string;
  fontWeight: number;
  getSize: number;
  sizeUnits: "pixels";
  fontSettings: { sdf: true; radius: number; buffer: number };
  outlineWidth: number;
  outlineColor: [number, number, number, number];
}

/**
 * Colours resolve on call, not at module load: `resolveMapColor` caches its
 * first answer, and at module-eval time the stylesheet may not be applied yet.
 */
export function mapLabelProps(size = 11): MapLabelProps {
  return {
    fontFamily: "inherit",
    fontWeight: 600,
    getSize: size,
    sizeUnits: "pixels",
    fontSettings: { sdf: true, radius: 16, buffer: 8 },
    outlineWidth: 8,
    // In the halo band the shader takes its alpha from outlineColor; 220 keeps
    // labels readable over bright fills without fully hiding what's underneath.
    outlineColor: resolveMapColor("var(--color-map-casing)", 220),
  };
}

/**
 * Who wins when two labels overlap. A road the operator selected outranks a
 * route readout, which outranks dispatch/job chatter, which outranks the
 * ambient POI carpet.
 */
export const LABEL_PRIORITY = {
  selectedRoad: 100,
  routeDistance: 90,
  dispatch: 80,
  job: 70,
  geofence: 60,
  poi: 10,
} as const;

/** A label's screen footprint. `x`/`y` are the centre of the box, in pixels. */
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

/** Breathing room between two kept labels, in pixels. */
const PADDING_PX = 2;

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + PADDING_PX * 2 &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + PADDING_PX * 2
  );
}

/**
 * Greedy axis-aligned rectangle rejection: walk the boxes from most to least
 * important and keep one only if it clears everything already kept. Ties break
 * on id so the same frame always yields the same set (a label that flickered
 * between two equal-priority neighbours would be worse than one that is gone).
 */
export function declutter(items: LabelBox[]): Set<string> {
  const ordered = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const kept: LabelBox[] = [];
  const visible = new Set<string>();
  for (const item of ordered) {
    if (kept.some((other) => overlaps(item, other))) continue;
    kept.push(item);
    visible.add(item.id);
  }
  return visible;
}

/**
 * Cheap proxy for text metrics — measuring through canvas would mean a layout
 * read per label per frame, and the declutter only needs the box to be about
 * right. 0.58em average advance is close for the UI font at label sizes.
 */
export function estimateLabelSize(text: string, size: number): { w: number; h: number } {
  return { w: text.length * size * 0.58, h: size * 1.3 };
}

/** One candidate label, in geographic coordinates. */
export interface LabelItem {
  id: string;
  /** `[lng, lat]`, deck.gl order. */
  position: [number, number];
  text: string;
  size: number;
  priority: number;
  pixelOffset?: [number, number];
}

// ── Cross-layer registry ───────────────────────────────────────────────────
// Layers are independent components, so decluttering one against another needs
// a place outside React for them to meet. This is that place: a module store
// holding each layer's current candidates, flattened into one snapshot array
// whose identity changes exactly when the contents do.

const registry = new Map<string, LabelItem[]>();
const listeners = new Set<() => void>();
let snapshot: LabelItem[] = [];

function publish(): void {
  snapshot = Array.from(registry.values()).flat();
  for (const listener of listeners) listener();
}

export function registerLabels(layerId: string, items: LabelItem[]): void {
  registry.set(layerId, items);
  publish();
}

export function unregisterLabels(layerId: string): void {
  if (registry.delete(layerId)) publish();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LabelItem[] {
  return snapshot;
}

/** The slice of a viewport this module needs — keeps tests free of deck.gl. */
export interface LabelViewport {
  project(lngLat: number[]): number[];
}

/**
 * Register `items` for `layerId` and get back the ids that survive decluttering
 * against every other registered layer. With no viewport (first paint, or a
 * headless test) nothing is culled — better a crowded frame than a blank one.
 */
export function useVisibleLabels(
  layerId: string,
  items: LabelItem[],
  viewport: LabelViewport | null,
  settledZoom: number
): Set<string> {
  useEffect(() => {
    registerLabels(layerId, items);
    return () => unregisterLabels(layerId);
  }, [layerId, items]);

  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // `settledZoom` is not read in the body — the viewport already carries the
  // zoom — but it is what re-runs the pass once a zoom gesture comes to rest,
  // rather than leaving the previous zoom's verdict on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settledZoom is a recompute trigger, see above
  return useMemo(() => {
    if (!viewport) return new Set(items.map((item) => item.id));

    // `items` may not have reached the store yet on the render that produced
    // them (registration happens in an effect), so prefer the live prop over
    // this layer's snapshot entry and take the other layers from the store.
    const ownIds = new Set(items.map((item) => item.id));
    const candidates = [...all.filter((item) => !ownIds.has(item.id)), ...items];

    const boxes: LabelBox[] = [];
    for (const item of candidates) {
      const projected = viewport.project([item.position[0], item.position[1]]);
      if (!projected) continue;
      const [dx, dy] = item.pixelOffset ?? [0, 0];
      const { w, h } = estimateLabelSize(item.text, item.size);
      boxes.push({
        id: item.id,
        x: projected[0] + dx,
        y: projected[1] + dy,
        w,
        h,
        priority: item.priority,
      });
    }

    const visible = declutter(boxes);
    const mine = new Set<string>();
    for (const id of ownIds) if (visible.has(id)) mine.add(id);
    return mine;
  }, [all, items, viewport, settledZoom]);
}
