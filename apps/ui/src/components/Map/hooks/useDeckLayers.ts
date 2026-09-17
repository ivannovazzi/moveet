import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import type { Layer } from "@deck.gl/core";

// ─── Context for child layer registration ──────────────────────────

export interface DeckLayersContextValue {
  registerLayers: (id: string, layers: Layer[], order?: number) => void;
  unregisterLayers: (id: string) => void;
}

export const DeckLayersContext = createContext<DeckLayersContextValue>({
  registerLayers: () => {},
  unregisterLayers: () => {},
});

export function useDeckLayersContext() {
  return useContext(DeckLayersContext);
}

// ─── Hook for the DeckGLMap parent to manage registered layers ─────

/**
 * Orders below this render *under* the road network; everything at or above it
 * renders over it. The road `PathLayer`s are built inside `DeckGLMap` rather
 * than registered here, so without this band nothing could be drawn beneath
 * them — which is what the map ground needs.
 */
export const ROADS_ORDER = 5;

/** Default layer ordering — lower numbers render first (bottom). */
const LAYER_ORDER: Record<string, number> = {
  // The map's own ground: the density bloom and the honeycomb lattice, the one
  // thing that belongs under the roads.
  ground: 1,
  geofences: 10,
  "traffic-overlay": 20,
  breadcrumbs: 30,
  "traffic-zones": 35,
  heatmap: 40,
  // Density plate replaces vehicle sprites at low zoom — above the heatmap,
  // below routes so an inspected route still reads over it.
  "vehicle-density": 45,
  directions: 50,
  "selected-road": 55,
  "pending-dispatch": 60,
  // Job stops sit just under the vehicle sprites: they are static geography the
  // units move against, and must never occlude a unit.
  jobs: 65,
  vehicles: 70,
  // Heatzone editing overlays sit above vehicles so handles/preview stay
  // grabbable; the committed zone fill stays low at "traffic-zones" (35).
  "heatzone-draw": 78,
  "heatzone-handles": 79,
  "geofence-draw": 80,
};

/** Registered layers split around the road network. */
export interface RegisteredBands {
  /** Registered with an order below {@link ROADS_ORDER} — drawn under the roads. */
  under: Layer[];
  /** Everything else, drawn over the roads. */
  over: Layer[];
}

const EMPTY_BANDS: RegisteredBands = { under: [], over: [] };

export function useDeckLayerManager() {
  const registryRef = useRef<Map<string, { layers: Layer[]; order: number }>>(new Map());
  const [registeredLayers, setRegisteredLayers] = useState<RegisteredBands>(EMPTY_BANDS);
  const rebuildScheduled = useRef(false);

  // Batched rebuild: multiple register/unregister calls in the same microtask
  // (e.g. effect cleanup + setup) produce only ONE state update, preventing
  // infinite re-render loops during zoom/pan.
  const scheduleRebuild = useCallback(() => {
    if (rebuildScheduled.current) return;
    rebuildScheduled.current = true;
    queueMicrotask(() => {
      rebuildScheduled.current = false;
      const entries = Array.from(registryRef.current.entries());
      entries.sort((a, b) => a[1].order - b[1].order);
      const under: Layer[] = [];
      const over: Layer[] = [];
      for (const [, { layers, order }] of entries) {
        (order < ROADS_ORDER ? under : over).push(...layers);
      }
      setRegisteredLayers({ under, over });
    });
  }, []);

  const registerLayers = useCallback(
    (id: string, layers: Layer[], order?: number) => {
      registryRef.current.set(id, {
        layers,
        order: order ?? LAYER_ORDER[id] ?? 100,
      });
      scheduleRebuild();
    },
    [scheduleRebuild]
  );

  const unregisterLayers = useCallback(
    (id: string) => {
      registryRef.current.delete(id);
      scheduleRebuild();
    },
    [scheduleRebuild]
  );

  // Stable identity — a fresh object every render would re-render every
  // context consumer (each registered layer component) on every map render.
  const contextValue: DeckLayersContextValue = useMemo(
    () => ({ registerLayers, unregisterLayers }),
    [registerLayers, unregisterLayers]
  );

  return { registeredLayers, contextValue };
}

// ─── Hook for child components to register their layers ────────────

export function useRegisterLayers(id: string, layers: Layer[], order?: number) {
  const { registerLayers, unregisterLayers } = useDeckLayersContext();

  useEffect(() => {
    registerLayers(id, layers, order);
    return () => unregisterLayers(id);
    // We intentionally depend on the layers array reference so re-registration
    // happens when the caller provides new layer instances.
  }, [id, layers, order, registerLayers, unregisterLayers]);
}
