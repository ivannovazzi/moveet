import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Fleet, VehicleType } from "@/types";
import { vehicleStore } from "../../hooks/vehicleStore";
import { VEHICLE_INTERPOLATION } from "../../data/constants";
import { useRegisterLayers } from "../../components/Map/hooks/useDeckLayers";
import { useMapContext } from "../../components/Map/hooks";
import { VehicleIconAtlasManager, type VehicleAtlas } from "./vehicleIconAtlas";

// Type-specific default colors (used when no fleet color)
const VEHICLE_TYPE_COLORS: Record<string, string> = {
  car: "#dcdcdc",
  truck: "#f59e0b",
  motorcycle: "#8b5cf6",
  ambulance: "#ef4444",
  bus: "#3b82f6",
};

const DEFAULT_FILL = "#dcdcdc";
const SELECTED_STROKE: [number, number, number, number] = [0, 102, 204, 255];
const SELECTED_BG: [number, number, number, number] = [33, 255, 205, 77];
const HOVER_STROKE: [number, number, number, number] = [251, 201, 1, 255];
const HOVER_BG: [number, number, number, number] = [251, 201, 1, 40];

interface VehiclesLayerProps {
  scale: number;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  hiddenVehicleTypes: Set<VehicleType>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
}

/** Interpolated vehicle data for the deck.gl IconLayer. */
interface VehicleIconDatum {
  id: string;
  position: [number, number]; // [lng, lat]
  /** Icon rotation in degrees, CCW (deck.gl convention). */
  angle: number;
  /** Atlas key for this vehicle's (type, color) sprite. */
  icon: string;
  isSelected: boolean;
  isHovered: boolean;
}

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

const { DEFAULT_LERP_MS, MIN_LERP_MS, MAX_T, TELEPORT_FACTOR, TELEPORT_MIN_FLOOR_M } =
  VEHICLE_INTERPOLATION;

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

function iconSizeForZoom(zoom: number): number {
  const size = BASE_SIZE_PX * Math.pow(2, (zoom - REFERENCE_ZOOM) * SIZE_ZOOM_EXPONENT);
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
}: VehiclesLayerProps) {
  const { getZoom, getBoundingBox } = useMapContext();
  const [vehicleData, setVehicleData] = useState<VehicleIconDatum[]>([]);
  const [iconSize, setIconSize] = useState(BASE_SIZE_PX);
  const [atlasManager] = useState(() => new VehicleIconAtlasManager());
  // Warm the atlas with the default per-type sprites so the icon layer exists
  // (and renders instantly) before the first fleet-colored vehicle arrives.
  const [atlas, setAtlas] = useState<VehicleAtlas>(() => {
    for (const [type, color] of Object.entries(VEHICLE_TYPE_COLORS)) {
      atlasManager.register(type, color);
    }
    return atlasManager.build();
  });
  const interpRef = useRef(new Map<string, VehicleInterp>());

  // Refs for values that change but shouldn't restart the RAF loop
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoveredRef = useRef(hoveredId);
  hoveredRef.current = hoveredId;
  const fleetMapRef = useRef(vehicleFleetMap);
  fleetMapRef.current = vehicleFleetMap;
  const hiddenFleetsRef = useRef(hiddenFleetIds);
  hiddenFleetsRef.current = hiddenFleetIds;
  const hiddenTypesRef = useRef(hiddenVehicleTypes);
  hiddenTypesRef.current = hiddenVehicleTypes;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const getZoomRef = useRef(getZoom);
  getZoomRef.current = getZoom;
  const getBoundingBoxRef = useRef(getBoundingBox);
  getBoundingBoxRef.current = getBoundingBox;

  // RAF interpolation loop: reads from vehicleStore, updates React state
  // Throttled to ~30fps to avoid overwhelming React with state updates
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
    // Sticky add/remove flag — survives throttled frames so a removal isn't
    // dropped when the 33ms gate skips the frame it was detected on.
    let structureChanged = false;
    const STATE_UPDATE_INTERVAL = 33; // ~30fps for React state updates

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

        for (const [id, v] of store) {
          const existing = interps.get(id);
          const lat = v.position[0];
          const lng = v.position[1];
          const heading = ((v.heading ?? 0) * Math.PI) / 180;

          if (existing) {
            const posChanged = lat !== existing.nextLat || lng !== existing.nextLng;
            if (!posChanged) continue;

            // Teleport detection: if the new position is beyond what continuous
            // motion could produce (bulk reset, WS reconnect resync, dispatch
            // repositioning), snap instead of animating a fly-across.
            const elapsed = now - existing.updateTime;
            const speedMps = (v.speed ?? 0) * (1000 / 3600);
            const maxPlausibleM =
              speedMps * (elapsed / 1000) * TELEPORT_FACTOR + TELEPORT_MIN_FLOOR_M;
            const distanceM = approxDistanceMeters(existing.nextLat, existing.nextLng, lat, lng);
            const isTeleport = distanceM > maxPlausibleM;

            // Snap when spawning or teleporting; reset lerpMs so the next
            // normal tick doesn't animate using a polluted EMA.
            if (existing.isNew || isTeleport) {
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

            // Update per-vehicle lerp duration via EMA (alpha = 0.3)
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

      // Skip the React state update when nothing visible changed: no vehicle
      // moved (mid-lerp), none was added/removed, and zoom/viewport/selection/
      // filters are all unchanged. WS ticks that re-send identical positions
      // no longer cause re-renders.
      if (!structureChanged && !animating && !zoomChanged && !visualsChanged && !boundsChanged) {
        return;
      }

      // Throttle React state updates to avoid 60fps re-renders
      if (now - lastSetStateTime < STATE_UPDATE_INTERVAL) return;
      lastSetStateTime = now;
      lastZoom = currentZoom;
      lastSelected = currentSelectedId;
      lastHovered = currentHoveredId;
      lastFleetMap = fleetMapRef.current;
      lastHiddenFleets = hiddenFleetsRef.current;
      lastHiddenTypes = hiddenTypesRef.current;
      lastBoundsKey = boundsKey;
      structureChanged = false;

      const store = vehicleStore.getAll();
      const fleetMap = fleetMapRef.current;
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
        const defaultColor = VEHICLE_TYPE_COLORS[vehicleType] || DEFAULT_FILL;
        const color = resolveCSSColor(fleet?.color ?? defaultColor);

        vehicles.push({
          id: v.id,
          position: [lng, lat], // deck.gl expects [lng, lat]
          // Heading is compass radians (0 = north, CW); deck.gl rotates CCW.
          angle: (-heading * 180) / Math.PI,
          icon: atlasManager.register(vehicleType, color),
          isSelected: v.id === currentSelectedId,
          isHovered: v.id === currentHoveredId,
        });
      }

      // Rebuild the sprite atlas only when a new (type, color) combo appeared
      if (atlasManager.isDirty) {
        setAtlas(atlasManager.build());
      }
      setIconSize(iconSizeForZoom(currentZoom));
      setVehicleData(vehicles);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
    // atlasManager is created once via useState and never changes identity
  }, [atlasManager]);

  // Stable click handler
  const handleClick = useCallback((info: { object?: VehicleIconDatum }) => {
    if (info.object) {
      onClickRef.current(info.object.id);
      return true; // mark handled so DeckGL.onClick (clearMap) doesn't fire
    }
  }, []);

  // Highlight rings under the selected and hovered vehicles
  const ringData = useMemo(
    () => vehicleData.filter((v) => v.isSelected || v.isHovered),
    [vehicleData]
  );

  // Build deck.gl layers
  const layers = useMemo(() => {
    const ringLayer = new ScatterplotLayer<VehicleIconDatum>({
      id: "vehicle-highlight-ring",
      data: ringData,
      getPosition: (d) => d.position,
      getFillColor: (d) => (d.isSelected ? SELECTED_BG : HOVER_BG),
      getLineColor: (d) => (d.isSelected ? SELECTED_STROKE : HOVER_STROKE),
      getRadius: iconSize * 0.75,
      radiusUnits: "pixels",
      stroked: true,
      lineWidthMinPixels: 2,
      pickable: false,
    });

    const vehiclesLayer = new IconLayer<VehicleIconDatum>({
      id: "vehicles",
      data: vehicleData,
      iconAtlas: atlas.iconAtlas,
      iconMapping: atlas.iconMapping,
      getPosition: (d) => d.position,
      getIcon: (d) => d.icon,
      getAngle: (d) => d.angle,
      getSize: iconSize,
      sizeUnits: "pixels",
      billboard: false,
      pickable: true,
      onClick: handleClick,
      autoHighlight: true,
      highlightColor: [251, 201, 1, 80],
    });

    return [ringLayer, vehiclesLayer];
  }, [vehicleData, ringData, atlas, iconSize, handleClick]);

  // Register layers with the DeckGLMap parent
  useRegisterLayers("vehicles", layers);

  // Render nothing — layers are registered via useRegisterLayers
  return null;
}
