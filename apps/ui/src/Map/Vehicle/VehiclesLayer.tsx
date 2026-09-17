import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { Fleet, VehicleType } from "@/types";
import { vehicleStore } from "../../hooks/vehicleStore";
import { VEHICLE_INTERPOLATION, shouldSnapPosition } from "../../data/constants";
import { useRegisterLayers } from "../../components/Map/hooks/useDeckLayers";
import { useMapContext } from "../../components/Map/hooks";
import { VehicleIconAtlasManager, type VehicleAtlas } from "./vehicleIconAtlas";
import {
  VEHICLE_MESHES,
  MESH_VEHICLE_TYPES,
  MESH_REFERENCE_LENGTH_M,
  meshTypeFor,
} from "./vehicleMeshes";
import { shouldAggregate } from "./densityView";
import { resolveMapColor } from "../../lib/mapColor";

// Type-specific default colors (used when no fleet color). These reference the
// shared --color-vehicle-* tokens (tokens.css) and are resolved to concrete
// values at runtime via resolveCSSColor() so the atlas is keyed by a stable,
// concrete color regardless of where the color came from.
const VEHICLE_TYPE_COLORS: Record<string, string> = {
  car: "var(--color-vehicle-car)",
  truck: "var(--color-vehicle-truck)",
  motorcycle: "var(--color-vehicle-motorcycle)",
  ambulance: "var(--color-vehicle-ambulance)",
  bus: "var(--color-vehicle-bus)",
};

// Fallback used when a CSS variable can't be resolved (e.g. jsdom in tests).
const DEFAULT_FILL = "#dcdcdc";
/** Selection shares the route's blue so vehicle and route read as one object. */
const SELECTED_TOKEN = "var(--color-route-selected)";
const SELECTED_FILL_ALPHA = 70;
const SELECTED_HALO_ALPHA = 38;
/** Hover is the shared interaction amber, distinct from the selection blue. */
const HOVER_TOKEN = "var(--color-overlay-hover)";
const HOVER_STROKE_ALPHA = 255;
const HOVER_BG_ALPHA = 40;

interface VehiclesLayerProps {
  scale: number;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  hiddenVehicleTypes: Set<VehicleType>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
  /** Canvas hover — mirrors the sidebar list's hover state (undefined = none). */
  onHover?: (id: string | undefined) => void;
  /**
   * The user's "Density" visibility toggle. When on, sprites are suppressed
   * in the zoom/count window where `VehicleDensityLayer` takes over (see
   * `densityView.shouldAggregate`). Off by default and costs a single boolean
   * read per animation frame in that case.
   */
  densityMode?: boolean;
  /**
   * Whether sprites respond to map clicks. Defaults to true. Set false when
   * another interaction owns map clicks (e.g. placing a job's pickup): a sprite
   * pick returns true and would otherwise swallow the map-level click, so a
   * point landing on a vehicle would silently do nothing.
   */
  selectable?: boolean;
}

/** Interpolated vehicle data for the deck.gl IconLayer / SimpleMeshLayer. */
interface VehicleIconDatum {
  id: string;
  position: [number, number]; // [lng, lat]
  /** Icon rotation in degrees, CCW (deck.gl convention). */
  angle: number;
  /** Atlas key for this vehicle's (type, color) sprite. */
  icon: string;
  /** Mesh bucket this vehicle belongs to (an entry in `VEHICLE_MESHES`). */
  meshType: string;
  isSelected: boolean;
  isHovered: boolean;
  /**
   * Icon tint [r,g,b,a] — dimmed alpha for near-idle vehicles, full for
   * moving ones. One of two shared module-level references, so the
   * IconLayer's `getColor` accessor returns a stored reference rather than
   * allocating, and the publish loop allocates nothing for it either.
   */
  iconColor: RGBA;
  /**
   * The vehicle's own colour as [r,g,b,a] for the mesh, which (unlike the
   * pre-tinted sprite) carries no colour of its own. Always opaque; idle is
   * signalled by dimming. Interned per (colour, idle) pair in `meshColorFor`,
   * so this is a shared reference too.
   */
  meshColor: RGBA;
  /**
   * Mesh rotation as deck.gl's [pitch, yaw, roll] in degrees. Only yaw moves;
   * it holds the same value as `angle`. Stored on the datum (not built in the
   * accessor) so a 1000-vehicle frame does not allocate 1000 arrays per
   * accessor pass.
   */
  orientation: [number, number, number];
}

type RGBA = [number, number, number, number];

/** Per-vehicle interpolation state for smooth animation between WS updates. */
interface VehicleInterp {
  prevLat: number;
  prevLng: number;
  prevHeading: number;
  nextLat: number;
  nextLng: number;
  nextHeading: number;
  updateTime: number;
  /** Per-vehicle lerp duration measured via EMA. */
  lerpMs: number;
  /** True until the first position change — snap instead of animating. */
  isNew: boolean;
}

const { DEFAULT_LERP_MS, MIN_LERP_MS, MAX_T } = VEHICLE_INTERPOLATION;

/** Lerp a single value from a to b by t in [0, 1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-arc lerp for angles in radians. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * Approximate geodesic distance in meters between two (lat, lng) points using
 * the equirectangular projection. Accurate to ~0.5% at city scale — plenty for
 * a teleport threshold check, and ~3× cheaper than a full haversine.
 */
function approxDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLatM = (lat2 - lat1) * 111320;
  const dLngM = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLatM * dLatM + dLngM * dLngM);
}

/**
 * Resolve a CSS variable reference like "var(--color-vehicle-fill)" to its
 * computed value, or return the input unchanged if it's already a plain color.
 * Results are cached to avoid getComputedStyle on every frame.
 */
const cssColorCache = new Map<string, string>();
function resolveCSSColor(color: string): string {
  if (!color.startsWith("var(")) return color;
  const cached = cssColorCache.get(color);
  if (cached) return cached;
  const match = color.match(/^var\(([^)]+)\)$/);
  if (!match) return DEFAULT_FILL;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  const resolved = value || DEFAULT_FILL;
  cssColorCache.set(color, resolved);
  return resolved;
}

/**
 * Build a vehicleId -> resolved color lookup for every vehicle currently
 * carrying a fleet color. Called only when `vehicleFleetMap` changes identity
 * (fleet assignment/color edits), not per animation frame — the hot loop
 * below does a plain Map.get() instead of resolving CSS per vehicle per tick.
 */
function buildFleetColorMap(fleetMap: Map<string, Fleet>): Map<string, string> {
  const colors = new Map<string, string>();
  for (const [vehicleId, fleet] of fleetMap) {
    colors.set(vehicleId, resolveCSSColor(fleet.color));
  }
  return colors;
}

/** Resolved default (no-fleet) color per vehicle type. Static — computed once. */
const DEFAULT_TYPE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(VEHICLE_TYPE_COLORS).map(([type, color]) => [type, resolveCSSColor(color)])
);

function defaultColorForType(vehicleType: string): string {
  return DEFAULT_TYPE_COLORS[vehicleType] ?? DEFAULT_FILL;
}

/**
 * Zoom-dependent vehicle sizing. Vehicles grow when zooming in and shrink
 * when zooming out, but at a reduced rate (exponent < 1) so they remain
 * visible at overview zoom levels instead of becoming sub-pixel.
 *
 * BASE_SIZE_PX is the icon size at REFERENCE_ZOOM, chosen to match the
 * on-screen footprint of the previous geographic polygon shapes (which grew
 * on screen at rate 2^((zoom - 16) * 0.4) — geographic scaling 2^(zoom - 16)
 * damped by the old 0.6 shrink exponent).
 */
const REFERENCE_ZOOM = 16;
const SIZE_ZOOM_EXPONENT = 0.4;
const BASE_SIZE_PX = 24;
const MIN_SIZE_PX = 10;
const MAX_SIZE_PX = 72;

// Idle vs. moving tint — below this speed a vehicle reads as stopped rather
// than just moving slowly, so it's dimmed to visually separate it from
// actively-moving traffic without a new status enum.
const IDLE_SPEED_KMH = 1;
const IDLE_ICON_ALPHA = 166; // 0.65 * 255
const MOVING_ICON_ALPHA = 255;

/** The only two sprite tints there are — shared so the hot loop allocates none. */
const IDLE_ICON_TINT: RGBA = [255, 255, 255, IDLE_ICON_ALPHA];
const MOVING_ICON_TINT: RGBA = [255, 255, 255, MOVING_ICON_ALPHA];

/**
 * Zoom at (and above) which vehicles render as 3D meshes instead of sprites.
 *
 * This is a readability threshold, not a performance one: a model costs about
 * 30 triangles against the sprite's 2, which is noise beside the road network
 * already on screen. It sits one step above the density threshold, so the three
 * representations tile the zoom range without a gap: hexagons below 13 (when
 * the user opts in), sprites from 13 to 14, meshes from 14 up.
 *
 * It was 16 — the anchor of the sizing curve — which turned out to be too far
 * in: vehicles only became 3D once you were almost on top of them, and the
 * whole middle of the zoom range, where you actually watch the fleet move, was
 * still flat. 14 is roughly where a simplified model is still wider than it is
 * ambiguous, at about 11 screen pixels.
 */
export const MESH_ZOOM_THRESHOLD = 14;

/** Web Mercator ground resolution at zoom 0, metres per pixel (256px tiles). */
const METERS_PER_PIXEL_AT_Z0 = 156543.03392;

/**
 * Smallest a vehicle is allowed to get on screen, in pixels.
 *
 * Below this the models stop being shapes and start being specks, so the floor
 * takes over from true scale. See `meshSizeScaleForZoom`.
 */
export const MIN_MESH_PX = 7;

/**
 * How much to scale the models by, given the camera.
 *
 * `SimpleMeshLayer` measures its geometry in metres on the ground and the
 * models are authored at life size, so **1 is true scale** and that is what
 * this returns wherever it can. An earlier pass instead scaled them to match
 * the sprite's pixel footprint, which made a car about 57 metres long at zoom
 * 16 — most of the width of a city block, and the reason the fleet looked
 * enormous against the street grid.
 *
 * True scale alone does not work at every zoom: a 4.4m car is under two pixels
 * at zoom 16 and invisible. So the return is clamped to a floor of
 * `MIN_MESH_PX` on screen. The two regimes meet at about zoom 18.3, where a
 * real car finally covers 7 pixels; from there in, the scale is honest, and
 * further out vehicles hold at a legible minimum instead of vanishing.
 *
 * `latitude` matters because Web Mercator's metres-per-pixel is latitude
 * dependent. It costs one cosine per publish.
 */
function meshSizeScaleForZoom(zoom: number, latitude: number): number {
  const metersPerPixel =
    (METERS_PER_PIXEL_AT_Z0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  const floor = (MIN_MESH_PX * metersPerPixel) / MESH_REFERENCE_LENGTH_M;
  return Math.max(1, floor);
}

/**
 * How far a near-idle vehicle's mesh colour is pulled towards black.
 *
 * Sprites signal idle by dropping alpha, which a mesh cannot borrow: a
 * semi-transparent solid still writes depth, so its own far faces blend over
 * its near ones in whatever order the index buffer happens to be in, and the
 * vehicle turns inside out. Meshes stay fully opaque and dim instead.
 */
const IDLE_MESH_DIM = 0.74;

/**
 * The neutral paints a vehicle can be finished in.
 *
 * Real traffic is overwhelmingly white, silver and grey, and a street where
 * every car is the same shade of one colour reads as a diagram rather than as
 * traffic. Each vehicle picks one of these deterministically from its id, so a
 * fleet varies without flickering: the same vehicle is the same colour on every
 * frame, across reconnects, and in every session.
 *
 * All four are neutral by construction, so the fleet hue mixed in on top is
 * still the only thing that carries meaning.
 */
export const MESH_PAINTS: ReadonlyArray<readonly [number, number, number]> = [
  [236, 238, 241], // white
  [196, 200, 206], // silver
  [142, 148, 158], // grey
  [92, 97, 106], // graphite
];

/**
 * Pick a vehicle's paint from its id — an FNV-1a hash, folded to the palette.
 *
 * Computed inline on every publish rather than cached. It is a handful of
 * character operations against ids that are a few characters long, which is
 * cheaper than the bookkeeping a cache would need to avoid growing without
 * bound as vehicles come and go.
 */
function paintForId(id: string): readonly [number, number, number] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return MESH_PAINTS[(hash >>> 0) % MESH_PAINTS.length];
}

/**
 * How far towards the chosen paint the fleet colour is pulled.
 *
 * A vehicle rendered in a saturated fleet colour reads as a marker shaped like
 * a car, not as a car. A lit 3D body also needs far less colour than a flat
 * sprite does to stay distinguishable. What is left of the hue is enough to
 * tell two fleets apart side by side, while the fleet colour stays at full
 * strength everywhere it actually carries meaning: the sprites, the legend and
 * the selection ring.
 */
const MESH_PAINT_MIX = 0.72;

/**
 * Intern the [r,g,b,a] tuple a mesh instance is coloured with.
 *
 * The sprite atlas bakes the vehicle colour into the texture, so the IconLayer
 * only ever tints white. A mesh has no colour of its own, so the fleet colour
 * has to arrive through `getColor`.
 *
 * `resolveMapColor` does the parsing, via a 1x1 canvas, because the colour
 * arriving here is whatever `tokens.css` holds and those tokens are `oklch()`.
 * The atlas's own `parseColor` only understands hex and `rgb()`: handed
 * `oklch(0.62 0.15 250)` it pulls out the three numbers and reads them as RGB,
 * yielding [1, 0, 250]. That turned every vehicle type into the same saturated
 * blue, since the third oklch component is a hue angle.
 *
 * `resolveMapColor` is documented as too slow for a per-frame path, which is
 * exactly why this map exists: the key space is (fleet colours x 2 idle
 * states), so a miss happens once per colour and every datum afterwards holds
 * a shared reference.
 */
const meshColorCache = new Map<string, RGBA>();
function meshColorFor(
  color: string,
  idle: boolean,
  paint: readonly [number, number, number]
): RGBA {
  const key = `${color}|${paint[0]}|${idle ? 1 : 0}`;
  const cached = meshColorCache.get(key);
  if (cached) return cached;
  const [r, g, b] = resolveMapColor(color);
  const dim = idle ? IDLE_MESH_DIM : 1;
  const mix = (channel: number, neutral: number) =>
    Math.round((neutral * MESH_PAINT_MIX + channel * (1 - MESH_PAINT_MIX)) * dim);
  const value: RGBA = [mix(r, paint[0]), mix(g, paint[1]), mix(b, paint[2]), 255];
  meshColorCache.set(key, value);
  return value;
}

/**
 * Constant empty publish used while the density view has taken over. Reusing
 * one reference means React bails out of every re-render after the first
 * suppressed frame instead of churning on a fresh `[]` each tick.
 */
const EMPTY_VEHICLES: VehicleIconDatum[] = [];

function iconSizeForZoom(zoom: number): number {
  const size = BASE_SIZE_PX * 2 ** ((zoom - REFERENCE_ZOOM) * SIZE_ZOOM_EXPONENT);
  return Math.min(Math.max(size, MIN_SIZE_PX), MAX_SIZE_PX);
}

/**
 * deck.gl-based vehicle renderer with sprite icons.
 *
 * Preserves the RAF interpolation loop from the polygon version: reads
 * directly from vehicleStore on each animation frame, applies per-vehicle
 * EMA-based lerp, and feeds interpolated positions + headings to an
 * IconLayer via React state.
 *
 * Each vehicle renders as a detailed top-down sprite (car, truck, bus,
 * motorcycle, ambulance) tinted with its fleet color and rotated by heading.
 * Sprites live in a lazily-built canvas atlas (see vehicleIconAtlas.ts).
 */
export default function VehiclesLayer({
  scale: _scale,
  vehicleFleetMap,
  hiddenFleetIds,
  hiddenVehicleTypes,
  selectedId,
  hoveredId,
  onClick,
  onHover,
  densityMode = false,
  selectable = true,
}: VehiclesLayerProps) {
  const { getZoom, getBoundingBox } = useMapContext();
  const [vehicleData, setVehicleData] = useState<VehicleIconDatum[]>([]);
  const [iconSize, setIconSize] = useState(BASE_SIZE_PX);
  // Zoomed-in vehicles render as lit 3D meshes, zoomed-out ones as sprites.
  // Both are driven by the same publish, so the swap costs a layer rebuild and
  // nothing in the hot loop.
  const [use3D, setUse3D] = useState(false);
  const [meshSizeScale, setMeshSizeScale] = useState(1);
  const [atlasManager] = useState(() => new VehicleIconAtlasManager());
  // Warm the atlas with the default per-type sprites so the icon layer exists
  // (and renders instantly) before the first fleet-colored vehicle arrives.
  const [atlas, setAtlas] = useState<VehicleAtlas>(() => {
    for (const [type, color] of Object.entries(VEHICLE_TYPE_COLORS)) {
      atlasManager.register(type, resolveCSSColor(color));
    }
    return atlasManager.build();
  });
  const interpRef = useRef(new Map<string, VehicleInterp>());
  // Set when the tab regains focus: the rAF loop is paused while hidden, so the
  // next batch of updates is applied as a snap (not animated) to avoid a glide
  // from the stale pre-hidden position to the current one.
  const forceSnapRef = useRef(false);

  // Refs for values that change but shouldn't restart the RAF loop
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoveredRef = useRef(hoveredId);
  hoveredRef.current = hoveredId;
  const fleetMapRef = useRef(vehicleFleetMap);
  fleetMapRef.current = vehicleFleetMap;
  // Precomputed vehicleId -> resolved color, rebuilt only when vehicleFleetMap
  // changes identity (not per animation frame). Avoids resolveCSSColor() calls
  // in the hot loop for the common case of unchanged fleet assignments/colors.
  const fleetColorsRef = useRef<Map<string, string>>(new Map());
  const fleetColorsSourceRef = useRef<Map<string, Fleet> | null>(null);
  if (fleetColorsSourceRef.current !== vehicleFleetMap) {
    fleetColorsSourceRef.current = vehicleFleetMap;
    fleetColorsRef.current = buildFleetColorMap(vehicleFleetMap);
  }
  const hiddenFleetsRef = useRef(hiddenFleetIds);
  hiddenFleetsRef.current = hiddenFleetIds;
  const hiddenTypesRef = useRef(hiddenVehicleTypes);
  hiddenTypesRef.current = hiddenVehicleTypes;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const getZoomRef = useRef(getZoom);
  getZoomRef.current = getZoom;
  const getBoundingBoxRef = useRef(getBoundingBox);
  getBoundingBoxRef.current = getBoundingBox;
  const densityModeRef = useRef(densityMode);
  densityModeRef.current = densityMode;
  const selectableRef = useRef(selectable);
  selectableRef.current = selectable;

  // RAF interpolation loop: reads from vehicleStore, updates React state
  // Throttled to ~60fps to keep motion smooth without unbounded re-renders
  useEffect(() => {
    let rafId: number;
    let lastVersion = -1;
    let lastZoom = -1;
    let animating = false;
    let lastSetStateTime = 0;
    // Last-published visual inputs — used to skip redundant React state
    // updates when a WS tick arrives but nothing visible actually changed
    // (e.g. a stationary fleet still streaming position updates).
    let lastSelected: string | undefined;
    let lastHovered: string | undefined;
    let lastFleetMap: Map<string, Fleet> | null = null;
    let lastHiddenFleets: Set<string> | null = null;
    let lastHiddenTypes: Set<VehicleType> | null = null;
    let lastBoundsKey = "";
    // Whether the density (hexagon) view was on screen on the last publish.
    let lastAggregated = false;
    // Sticky add/remove flag — survives throttled frames so a removal isn't
    // dropped when the 16ms gate skips the frame it was detected on.
    let structureChanged = false;
    // Publish interpolated positions at up to 60fps. The RAF loop already
    // computes a fresh lerp every animation frame; capping the deck.gl publish
    // at 30fps (the previous value) halved the visible motion frame rate and
    // was the dominant cause of choppy movement. At 16ms a 60Hz display passes
    // the gate every frame (full 60fps), while a 120Hz display is bounded to
    // 60fps so the per-frame array rebuild + attribute upload stays cheap. The
    // "nothing visible changed" guard above still suppresses updates on idle
    // scenes, so this only raises the rate while vehicles are actually moving.
    const STATE_UPDATE_INTERVAL = 16; // ~60fps for React state updates

    const render = () => {
      rafId = requestAnimationFrame(render);

      const currentVersion = vehicleStore.getVersion();
      const currentSelectedId = selectedRef.current;
      const currentHoveredId = hoveredRef.current;
      const now = performance.now();
      const currentZoom = getZoomRef.current();

      const positionsChanged = currentVersion !== lastVersion;
      const zoomChanged = Math.abs(currentZoom - lastZoom) > 0.01;

      // Update interpolation targets when new data arrives
      if (positionsChanged) {
        lastVersion = currentVersion;

        const store = vehicleStore.getAll();
        const interps = interpRef.current;
        // Consumed once per applied batch: force every vehicle to snap this pass.
        const forceSnap = forceSnapRef.current;
        forceSnapRef.current = false;

        for (const [id, v] of store) {
          const existing = interps.get(id);
          const lat = v.position[0];
          const lng = v.position[1];
          const heading = ((v.heading ?? 0) * Math.PI) / 180;

          if (existing) {
            const posChanged = lat !== existing.nextLat || lng !== existing.nextLng;
            if (!posChanged) continue;

            // Snap (jump) instead of animating when motion can't be continuous:
            // a teleport/reposition (bulk reset, WS resync, dispatch), a stale
            // update after a starved rAF loop (backgrounded tab, sleep/wake), or
            // a forced snap on tab refocus. Otherwise animate the delta normally.
            const elapsed = now - existing.updateTime;
            const speedMps = (v.speed ?? 0) * (1000 / 3600);
            const distanceM = approxDistanceMeters(existing.nextLat, existing.nextLng, lat, lng);
            const snap =
              forceSnap ||
              shouldSnapPosition({
                isNew: existing.isNew,
                elapsedMs: elapsed,
                distanceM,
                speedMps,
              });

            // Snap when spawning, teleporting, or after a continuity gap; reset
            // lerpMs so the next normal tick doesn't animate using a polluted EMA.
            if (snap) {
              existing.prevLat = lat;
              existing.prevLng = lng;
              existing.prevHeading = heading;
              existing.nextLat = lat;
              existing.nextLng = lng;
              existing.nextHeading = heading;
              existing.updateTime = now;
              existing.isNew = false;
              existing.lerpMs = DEFAULT_LERP_MS;
              continue;
            }

            // Update per-vehicle lerp duration via EMA (alpha = 0.3). The gap
            // guard above snaps (and resets lerpMs) before `elapsed` can exceed
            // MAX_CONTINUOUS_GAP_MS, so the EMA stays bounded without a clamp.
            if (elapsed > MIN_LERP_MS) {
              existing.lerpMs =
                existing.lerpMs === DEFAULT_LERP_MS
                  ? elapsed
                  : existing.lerpMs * 0.7 + elapsed * 0.3;
            }

            // Snap prev to wherever we currently are in the lerp (avoid jump-back)
            const snapT = Math.min((now - existing.updateTime) / existing.lerpMs, 1);
            existing.prevLat = lerp(existing.prevLat, existing.nextLat, snapT);
            existing.prevLng = lerp(existing.prevLng, existing.nextLng, snapT);
            existing.prevHeading = lerpAngle(existing.prevHeading, existing.nextHeading, snapT);
            existing.nextLat = lat;
            existing.nextLng = lng;
            existing.nextHeading = heading;
            existing.updateTime = now;
          } else {
            interps.set(id, {
              prevLat: lat,
              prevLng: lng,
              prevHeading: heading,
              nextLat: lat,
              nextLng: lng,
              nextHeading: heading,
              updateTime: now,
              lerpMs: DEFAULT_LERP_MS,
              isNew: true,
            });
            structureChanged = true;
          }
        }

        // Remove stale vehicles
        for (const id of interps.keys()) {
          if (!store.has(id)) {
            interps.delete(id);
            structureChanged = true;
          }
        }
      }

      // Determine if any vehicle is still mid-interpolation
      animating = false;
      const interps = interpRef.current;
      for (const state of interps.values()) {
        if (now - state.updateTime < state.lerpMs * MAX_T) {
          animating = true;
          break;
        }
      }

      // Viewport bounds — used both as a rebuild trigger (panning must reveal
      // culled vehicles) and for the culling test below.
      const [[west, south], [east, north]] = getBoundingBoxRef.current();
      const boundsKey = `${west},${south},${east},${north}`;
      const boundsChanged = boundsKey !== lastBoundsKey;

      const visualsChanged =
        currentSelectedId !== lastSelected ||
        currentHoveredId !== lastHovered ||
        fleetMapRef.current !== lastFleetMap ||
        hiddenFleetsRef.current !== lastHiddenFleets ||
        hiddenTypesRef.current !== lastHiddenTypes;

      // Density (aggregation) mode. When the user's Density toggle is on AND
      // the view has zoomed past the point where sprites are readable,
      // VehicleDensityLayer owns the picture and this layer publishes nothing.
      // With the toggle off this is one ref read and a `false` — the rest of
      // the hot path is untouched, and `vehicleStore.getAll()` is not called
      // an extra time.
      const aggregated = densityModeRef.current
        ? shouldAggregate({
            enabled: true,
            zoom: currentZoom,
            vehicleCount: vehicleStore.getAll().size,
          })
        : false;
      const aggregationChanged = aggregated !== lastAggregated;

      // Dirty check: skip building/publishing the VehicleIconDatum[] array
      // entirely when nothing visible changed — no vehicle moved (mid-lerp),
      // none was added/removed, and zoom/viewport/selection/filters are all
      // unchanged. WS ticks that re-send identical positions no longer cause
      // a fresh array allocation or a re-render.
      const isDirty =
        structureChanged ||
        animating ||
        zoomChanged ||
        visualsChanged ||
        boundsChanged ||
        aggregationChanged;
      if (!isDirty) {
        return;
      }

      // Throttle React state updates to a ~60fps ceiling
      if (now - lastSetStateTime < STATE_UPDATE_INTERVAL) return;
      lastSetStateTime = now;
      lastZoom = currentZoom;
      lastSelected = currentSelectedId;
      lastHovered = currentHoveredId;
      lastFleetMap = fleetMapRef.current;
      lastHiddenFleets = hiddenFleetsRef.current;
      lastHiddenTypes = hiddenTypesRef.current;
      lastBoundsKey = boundsKey;
      lastAggregated = aggregated;
      structureChanged = false;

      // Hexagon plate is on screen — skip the per-vehicle build entirely.
      // Interpolation state above kept updating, so switching back to sprites
      // (zoom in, or toggle off) resumes mid-motion rather than snapping.
      if (aggregated) {
        setVehicleData(EMPTY_VEHICLES);
        return;
      }

      const store = vehicleStore.getAll();
      const fleetMap = fleetMapRef.current;
      const fleetColors = fleetColorsRef.current;
      const hiddenFleets = hiddenFleetsRef.current;
      const hiddenTypes = hiddenTypesRef.current;

      // Viewport culling: skip interpolation/projection work for vehicles
      // well outside the current viewport. A 25% margin keeps vehicles near
      // the edges (and their enter animations) intact while panning. Skipped
      // when bounds are degenerate (no viewport yet, e.g. in tests).
      const cullEnabled = east - west > 1e-9 && north - south > 1e-9;
      const marginLng = (east - west) * 0.25;
      const marginLat = (north - south) * 0.25;

      const vehicles: VehicleIconDatum[] = [];

      for (const [, v] of store) {
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        if (cullEnabled && v.id !== currentSelectedId && v.id !== currentHoveredId) {
          const vLat = v.position[0];
          const vLng = v.position[1];
          if (
            vLng < west - marginLng ||
            vLng > east + marginLng ||
            vLat < south - marginLat ||
            vLat > north + marginLat
          ) {
            continue;
          }
        }
        const fleet = fleetMap.get(v.id);
        if (fleet && hiddenFleets.has(fleet.id)) continue;
        if (hiddenTypes.size > 0 && hiddenTypes.has((v.type as VehicleType) || "car")) continue;

        // Interpolate position from stored state
        const state = interps.get(v.id);
        let lat: number, lng: number, heading: number;

        if (state) {
          const elapsed = now - state.updateTime;
          const t01 = Math.min(elapsed / state.lerpMs, MAX_T);
          lat = lerp(state.prevLat, state.nextLat, t01);
          lng = lerp(state.prevLng, state.nextLng, t01);
          heading = lerpAngle(state.prevHeading, state.nextHeading, Math.min(t01, 1));
        } else {
          lat = v.position[0];
          lng = v.position[1];
          heading = ((v.heading ?? 0) * Math.PI) / 180;
        }

        const vehicleType = v.type || "car";
        // Precomputed lookups — no resolveCSSColor() call in the hot loop.
        const color = fleetColors.get(v.id) ?? defaultColorForType(vehicleType);
        const idle = (v.speed ?? 0) < IDLE_SPEED_KMH;
        // Heading is compass radians (0 = north, CW); both deck.gl's icon
        // rotation and the mesh's yaw turn CCW, so the same negated value
        // drives either representation.
        const angle = (-heading * 180) / Math.PI;

        vehicles.push({
          id: v.id,
          position: [lng, lat], // deck.gl expects [lng, lat]
          angle,
          icon: atlasManager.register(vehicleType, color),
          meshType: meshTypeFor(vehicleType),
          isSelected: v.id === currentSelectedId,
          isHovered: v.id === currentHoveredId,
          iconColor: idle ? IDLE_ICON_TINT : MOVING_ICON_TINT,
          meshColor: meshColorFor(color, idle, paintForId(v.id)),
          // [pitch, yaw, roll]: vehicles stay level, so only yaw moves.
          orientation: [0, angle, 0],
        });
      }

      // Rebuild the sprite atlas only when a new (type, color) combo appeared
      if (atlasManager.isDirty) {
        setAtlas(atlasManager.build());
      }
      setIconSize(iconSizeForZoom(currentZoom));
      // Both are plain numbers/booleans, so React bails out of the re-render on
      // every frame the camera didn't actually move.
      setUse3D(currentZoom >= MESH_ZOOM_THRESHOLD);
      setMeshSizeScale(meshSizeScaleForZoom(currentZoom, (south + north) / 2));
      setVehicleData(vehicles);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
    // atlasManager is created once via useState and never changes identity
  }, [atlasManager]);

  // While the tab is hidden the browser pauses requestAnimationFrame, so the
  // interpolation state goes stale and WS updates queue up. On refocus, snap the
  // next applied batch to the true positions instead of animating a fly-across.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") forceSnapRef.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Stable click handler. Reads `selectable` through a ref so the handler stays
  // stable (it is baked into the IconLayer) while still honouring a mode change.
  const handleClick = useCallback((info: { object?: VehicleIconDatum }) => {
    if (selectableRef.current && info.object) {
      onClickRef.current(info.object.id);
      return true; // mark handled so DeckGL.onClick (clearMap) doesn't fire
    }
    // Not handled: the click falls through to DeckGL's map-level onClick, so a
    // modal point-picking mode still receives a point that lands on a sprite.
    return false;
  }, []);

  // Stable hover handler — mirrors sidebar list hover so mousing over a
  // vehicle on the canvas highlights it the same way as in the list.
  const handleHover = useCallback((info: { object?: VehicleIconDatum }) => {
    onHoverRef.current?.(info.object?.id);
  }, []);

  // Highlight rings under the selected and hovered vehicles
  const ringData = useMemo(
    () => vehicleData.filter((v) => v.isSelected || v.isHovered),
    [vehicleData]
  );

  // Build deck.gl layers. The two layers are rebuilt each ~60fps tick because
  // `vehicleData` carries fresh interpolated positions, but `updateTriggers`
  // pin the non-positional accessors (icon, ring colors) to stable keys so deck
  // only re-evaluates them when they actually change — pure-movement frames
  // re-upload only position/angle, not icon/color attributes.
  // Ring colours resolve once on first render — after the stylesheet is
  // applied, but out of the ~30fps `layers` memo below: resolveMapColor reads
  // computed style on a cache miss, which has no business in a per-frame path.
  const ringColors = useMemo(
    () => ({
      selectedStroke: resolveMapColor(SELECTED_TOKEN),
      selectedFill: resolveMapColor(SELECTED_TOKEN, SELECTED_FILL_ALPHA),
      selectedHalo: resolveMapColor(SELECTED_TOKEN, SELECTED_HALO_ALPHA),
      hoverStroke: resolveMapColor(HOVER_TOKEN, HOVER_STROKE_ALPHA),
      hoverBg: resolveMapColor(HOVER_TOKEN, HOVER_BG_ALPHA),
    }),
    []
  );

  const layers = useMemo(() => {
    const { selectedStroke, selectedFill, selectedHalo, hoverStroke, hoverBg } = ringColors;
    const ringKey = `${selectedId ?? ""}|${hoveredId ?? ""}`;

    // Wide soft disc behind the selected vehicle only — findable at any zoom
    // without a heavier ring competing with the sprite.
    const haloLayer = new ScatterplotLayer<VehicleIconDatum>({
      id: "vehicle-selection-halo",
      data: ringData.filter((d) => d.isSelected),
      getPosition: (d) => d.position,
      getFillColor: selectedHalo,
      getRadius: iconSize * 1.7,
      radiusUnits: "pixels",
      stroked: false,
      pickable: false,
      transitions: { getRadius: 200 },
    });

    const ringLayer = new ScatterplotLayer<VehicleIconDatum>({
      id: "vehicle-highlight-ring",
      data: ringData,
      getPosition: (d) => d.position,
      getFillColor: (d) => (d.isSelected ? selectedFill : hoverBg),
      getLineColor: (d) => (d.isSelected ? selectedStroke : hoverStroke),
      getRadius: (d) => iconSize * (d.isSelected ? 0.95 : 0.75),
      getLineWidth: (d) => (d.isSelected ? 3 : 2),
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      stroked: true,
      pickable: false,
      updateTriggers: {
        getFillColor: ringKey,
        getLineColor: ringKey,
        getRadius: [ringKey, iconSize],
        getLineWidth: ringKey,
      },
      // Animate hover/select transitions instead of popping instantly between
      // colors/radius — deck.gl interpolates internally, no extra state needed.
      transitions: {
        getFillColor: 200,
        getLineColor: 200,
        getRadius: 200,
      },
    });

    if (use3D) {
      // One SimpleMeshLayer per vehicle type: a mesh layer draws a single
      // geometry, so the five shapes cost five instanced draw calls rather than
      // one. Bucketing is a single pass over the publish, and empty buckets are
      // skipped so a fleet of nothing but cars still issues one call.
      const buckets = new Map<string, VehicleIconDatum[]>();
      for (const d of vehicleData) {
        const bucket = buckets.get(d.meshType);
        if (bucket) bucket.push(d);
        else buckets.set(d.meshType, [d]);
      }

      const meshLayers = MESH_VEHICLE_TYPES.filter((type) => buckets.has(type)).map(
        (type) =>
          new SimpleMeshLayer<VehicleIconDatum>({
            id: `vehicles-mesh-${type}`,
            data: buckets.get(type),
            mesh: VEHICLE_MESHES[type],
            getPosition: (d) => d.position,
            // Stored references, built once per vehicle per publish — see the
            // RAF loop above. Nothing is allocated inside these accessors.
            getOrientation: (d) => d.orientation,
            getColor: (d) => d.meshColor,
            sizeScale: meshSizeScale,
            // Matte: vehicles should read by silhouette and shading, not by a
            // specular highlight sliding across them as the camera turns.
            material: {
              ambient: 0.6,
              diffuse: 0.78,
              shininess: 24,
              specularColor: [38, 40, 48],
            },
            pickable: true,
            onClick: handleClick,
            onHover: handleHover,
          })
      );

      return [haloLayer, ringLayer, ...meshLayers];
    }

    const vehiclesLayer = new IconLayer<VehicleIconDatum>({
      id: "vehicles",
      data: vehicleData,
      iconAtlas: atlas.iconAtlas,
      iconMapping: atlas.iconMapping,
      getPosition: (d) => d.position,
      getIcon: (d) => d.icon,
      getAngle: (d) => d.angle,
      // Icon sprites are already tinted per-vehicle-color; this tints on top
      // to dim idle vehicles, so full white = no change from the sprite.
      // `d.iconColor` is a stored reference built once per vehicle per
      // publish (see the RAF loop above), not allocated here.
      getColor: (d) => d.iconColor,
      getSize: iconSize,
      sizeUnits: "pixels",
      billboard: false,
      pickable: true,
      onClick: handleClick,
      // Hover feedback is the React-driven ring above (via onHover →
      // hoveredId) — no autoHighlight, which would stack a second treatment.
      onHover: handleHover,
      updateTriggers: {
        // Icons only change when the atlas rebuilds (new type/color combo).
        getIcon: atlas,
      },
    });

    return [haloLayer, ringLayer, vehiclesLayer];
  }, [
    vehicleData,
    ringData,
    atlas,
    iconSize,
    ringColors,
    handleClick,
    handleHover,
    selectedId,
    hoveredId,
    use3D,
    meshSizeScale,
  ]);

  // Register layers with the DeckGLMap parent
  useRegisterLayers("vehicles", layers);

  // Render nothing — layers are registered via useRegisterLayers
  return null;
}
