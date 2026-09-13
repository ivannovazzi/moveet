import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

/**
 * The two colours of the map's label voice, declared once here rather than in
 * each layer that draws text: the neutral ink names read in, and the casing
 * the halo is drawn from.
 *
 * They are tokens, not resolved colours, deliberately. `resolveMapColor`
 * caches its first answer per token, so resolving at module load would cache a
 * pre-stylesheet value under the shared key and hand it to every layer that
 * later asks for the same token. Resolve inside the memo that builds the layer.
 */
export const LABEL_TOKEN = "var(--color-map-label)";
export const CASING_TOKEN = "var(--color-map-casing)";

/** Shared TextLayer style props. Spread FIRST, then the layer's own accessors. */
export interface MapLabelProps {
  fontFamily: string;
  fontWeight: number;
  getSize: number;
  sizeUnits: "pixels";
  characterSet: string[];
  fontSettings: { sdf: true; fontSize: number; radius: number; buffer: number };
  outlineWidth: number;
  outlineColor: [number, number, number, number];
}

/**
 * The atlas is rasterised at this size and every glyph is scaled down by
 * getSize / ATLAS_FONT_SIZE. deck.gl defaults to 64 already, but the whole
 * halo geometry documented above is expressed in atlas pixels, so the number
 * is pinned here rather than inherited.
 */
const ATLAS_FONT_SIZE = 64;

/**
 * Last-resort stack, mirroring `--font-sans` in `src/index.css`. Used when the
 * document has no resolved family yet (first paint, jsdom) — and it must be a
 * *concrete* stack, see `labelFontFamily()`.
 */
const FALLBACK_FONT_FAMILY = "Inter, system-ui, -apple-system, Segoe UI, sans-serif";

/**
 * Values that name no actual font: the CSS-wide keywords, and jsdom's stand-in
 * for "whatever the UA picks", which would reach the canvas as a family called
 * literally "depends on user agent".
 */
const UNUSABLE_FONT_FAMILIES = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "depends on user agent",
]);

let cachedFontFamily: string | null = null;

/**
 * A concrete font family for the SDF atlas.
 *
 * This must never be the CSS keyword `inherit` (or any other keyword): deck.gl
 * builds the glyph atlas on an offscreen 2D canvas with
 * `ctx.font = "600 64px <fontFamily>"`, and a canvas silently rejects an
 * invalid font shorthand — keeping its 10px sans-serif default. Every glyph is
 * then rasterised at 10px and scaled to getSize, which is how map labels
 * shipped as ~2px dashes at every zoom.
 *
 * Resolved lazily (the stylesheet may not be applied at module-eval time) and
 * cached, because the atlas is rebuilt per TextLayer and this reads layout.
 */
export function labelFontFamily(): string {
  if (cachedFontFamily) return cachedFontFamily;
  let resolved = "";
  try {
    resolved = getComputedStyle(document.body).fontFamily?.trim() ?? "";
  } catch {
    resolved = "";
  }
  cachedFontFamily =
    resolved && !UNUSABLE_FONT_FAMILIES.has(resolved) ? resolved : FALLBACK_FONT_FAMILY;
  return cachedFontFamily;
}

/** Test seam: forget the resolved family so the next call reads the DOM again. */
export function resetLabelFontFamily(): void {
  cachedFontFamily = null;
}

/**
 * deck.gl's default character set is ASCII 32–128. Nairobi place names carry a
 * little more than that — typographic quotes and dashes from the OSM `name`
 * tag, degree signs, ellipses — and any glyph missing from the atlas renders
 * as a blank box, so the default is extended rather than replaced.
 */
const EXTRA_CHARACTERS =
  "\u00a0\u00b0\u00b7\u00ab\u00bb" + // nbsp, degree, middot, guillemets
  "\u2010\u2011\u2012\u2013\u2014" + // hyphens and dashes
  "\u2018\u2019\u201a\u201c\u201d\u201e" + // typographic quotes
  "\u2022\u2026\u2032\u2033" + // bullet, ellipsis, prime, double prime
  "\u00e1\u00e4\u00e7\u00e8\u00e9\u00ea\u00ed\u00f1\u00f3\u00f6\u00fa\u00fc"; // accents

const CHARACTER_SET: string[] = [
  ...Array.from({ length: 128 - 32 }, (_, i) => String.fromCharCode(32 + i)),
  ...EXTRA_CHARACTERS,
];

/**
 * Colours resolve on call, not at module load: `resolveMapColor` caches its
 * first answer, and at module-eval time the stylesheet may not be applied yet.
 */
export function mapLabelProps(size = 11): MapLabelProps {
  return {
    fontFamily: labelFontFamily(),
    fontWeight: 600,
    getSize: size,
    sizeUnits: "pixels",
    characterSet: CHARACTER_SET,
    fontSettings: { sdf: true, fontSize: ATLAS_FONT_SIZE, radius: 16, buffer: 8 },
    outlineWidth: 8,
    // In the halo band the shader takes its alpha from outlineColor; 220 keeps
    // labels readable over bright fills without fully hiding what's underneath.
    outlineColor: resolveMapColor(CASING_TOKEN, 220),
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
// holding each layer's current candidates, flattened into one snapshot array.
//
// The snapshot's identity is load-bearing in both directions, because layers
// naturally build their `items` inline on every render. A caller re-registering
// an equal-but-new array must NOT produce a new snapshot, or the subscribers it
// wakes re-render, rebuild `items`, re-register, and the loop never settles.
// So the store compares contents (see `signature`) and only publishes on a real
// change; `useVisibleLabels` keys its own registration on the same signature.

const registry = new Map<string, LabelItem[]>();
const listeners = new Set<() => void>();
let snapshot: LabelItem[] = [];
let snapshotSignature = "";

/** Everything about a label that can change what the declutter decides. */
function signature(items: LabelItem[]): string {
  return items
    .map((item) => {
      const [dx, dy] = item.pixelOffset ?? [0, 0];
      const [lng, lat] = item.position;
      return `${item.id}|${item.text}|${lng}|${lat}|${item.size}|${item.priority}|${dx}|${dy}`;
    })
    .join(";");
}

function publish(): void {
  const next = Array.from(registry.values()).flat();
  const nextSignature = signature(next);
  if (nextSignature === snapshotSignature) return;
  snapshot = next;
  snapshotSignature = nextSignature;
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

/**
 * The slice of a viewport this module needs — keeps tests free of deck.gl, and
 * is satisfied structurally by deck.gl's `WebMercatorViewport`.
 *
 * `width`/`height` drive the off-screen cull and `longitude`/`latitude`/`zoom`
 * the throttle key. All are optional: without a size nothing is culled by
 * screen bounds, and without a centre every viewport identity looks alike, so a
 * bare `{ project }` still behaves exactly as it did before.
 */
export interface LabelViewport {
  project(lngLat: number[]): number[];
  width?: number;
  height?: number;
  longitude?: number;
  latitude?: number;
  zoom?: number;
}

/**
 * How far outside the canvas a label may sit and still be considered. Wide
 * enough that a label anchored just off-screen still blocks an on-screen
 * neighbour, so labels don't pop as you pan.
 */
const CULL_MARGIN_PX = 64;

/**
 * Ceiling on how often the pass re-runs while the view is changing. Panning
 * hands us a brand-new viewport object every animation frame, and the pass is
 * O(n log n) over every registered label on the map; at 60fps that is the
 * single most expensive thing on the main thread. 120ms is slow enough to cost
 * nothing and fast enough that the verdict never visibly lags the gesture.
 */
const VIEW_THROTTLE_MS = 120;

/**
 * A viewport's identity for throttling purposes. Rounded so the sub-pixel
 * drift of an inertial pan doesn't count as a change: ~1e-4 degrees is about
 * 11m, and 0.1 zoom levels is well below what moves a label.
 */
function viewKey(viewport: LabelViewport | null): string {
  if (!viewport) return "none";
  const lng = Math.round((viewport.longitude ?? 0) * 1e4) / 1e4;
  const lat = Math.round((viewport.latitude ?? 0) * 1e4) / 1e4;
  const zoom = Math.round((viewport.zoom ?? 0) * 10) / 10;
  return `${lng}|${lat}|${zoom}|${viewport.width ?? 0}|${viewport.height ?? 0}`;
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
  // Callers build `items` inline, so its identity churns every render. Pin the
  // array to its content signature and let everything downstream key on that.
  // The signature itself is memoised on the array identity, so a caller that
  // hands over a memoised array (the expensive ones do — POIs can register
  // hundreds) pays nothing per render.
  const itemsSignature = useMemo(() => signature(items), [items]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `itemsSignature` is the content identity of `items`
  const stableItems = useMemo(() => items, [itemsSignature]);

  useEffect(() => {
    registerLabels(layerId, stableItems);
    return () => unregisterLabels(layerId);
  }, [layerId, stableItems]);

  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // ── Throttle ────────────────────────────────────────────────────────────
  // The pass reads the live viewport through a ref, and re-runs only when the
  // *settled* view key changes. A pan produces a new viewport object per frame
  // and six of these hooks are mounted at once, so keying the memo on viewport
  // identity meant six full cross-layer passes per animation frame.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const key = viewKey(viewport);
  const [settledKey, setSettledKey] = useState(key);
  const lastRunRef = useRef(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (settledKey === key) return;
    const apply = () => {
      lastRunRef.current = Date.now();
      setSettledKey(key);
    };
    const elapsed = Date.now() - lastRunRef.current;
    if (elapsed >= VIEW_THROTTLE_MS) {
      apply();
    } else {
      // Trailing edge, so the frame the gesture ends on still gets a verdict.
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(apply, VIEW_THROTTLE_MS - elapsed);
    }
    return () => {
      if (trailingRef.current) clearTimeout(trailingRef.current);
    };
  }, [key, settledKey]);

  // `settledZoom` is not read in the body — the viewport already carries the
  // zoom — but it is what re-runs the pass once a zoom gesture comes to rest,
  // rather than leaving the previous zoom's verdict on screen. `settledKey`
  // does the same for pans. Between recomputes the memo hands back the last
  // Set, which is exactly the "keep showing what you decided" behaviour we want.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settledKey/settledZoom are recompute triggers, see above
  return useMemo(() => {
    const vp = viewportRef.current;
    if (!vp) return new Set(stableItems.map((item) => item.id));

    // `stableItems` may not have reached the store yet on the render that
    // produced them (registration happens in an effect), so prefer the live
    // prop over this layer's snapshot entry and take the rest from the store.
    const ownIds = new Set(stableItems.map((item) => item.id));
    const candidates = [...all.filter((item) => !ownIds.has(item.id)), ...stableItems];

    // Off-screen labels can neither be drawn nor block anything that is drawn,
    // so they are dropped before the O(n log n) pass rather than sorted first.
    // At street zoom the POI layer alone offers thousands of candidates and
    // only a few dozen are on the canvas.
    const cullWidth = Number.isFinite(vp.width) ? (vp.width as number) : null;
    const cullHeight = Number.isFinite(vp.height) ? (vp.height as number) : null;

    const boxes: LabelBox[] = [];
    for (const item of candidates) {
      const projected = vp.project([item.position[0], item.position[1]]);
      // A label behind the camera or at a degenerate coordinate projects to
      // NaN/Infinity; it has no box, so it can neither be placed nor block one.
      if (!Number.isFinite(projected?.[0]) || !Number.isFinite(projected?.[1])) continue;
      const [dx, dy] = item.pixelOffset ?? [0, 0];
      const { w, h } = estimateLabelSize(item.text, item.size);
      const x = projected[0] + dx;
      const y = projected[1] + dy;
      if (cullWidth !== null && cullHeight !== null) {
        if (x + w / 2 < -CULL_MARGIN_PX || x - w / 2 > cullWidth + CULL_MARGIN_PX) continue;
        if (y + h / 2 < -CULL_MARGIN_PX || y - h / 2 > cullHeight + CULL_MARGIN_PX) continue;
      }
      boxes.push({ id: item.id, x, y, w, h, priority: item.priority });
    }

    const visible = declutter(boxes);
    const mine = new Set<string>();
    for (const id of ownIds) if (visible.has(id)) mine.add(id);
    return mine;
  }, [all, stableItems, settledKey, settledZoom]);
}
