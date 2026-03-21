import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";
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

/** Default layer ordering — lower numbers render first (bottom). */
const LAYER_ORDER: Record<string, number> = {
  geofences: 10,
  "traffic-overlay": 20,
  breadcrumbs: 30,
  "traffic-zones": 35,
  heatmap: 40,
  directions: 50,
  "selected-road": 55,
  "pending-dispatch": 60,
  vehicles: 70,
  "vehicle-selection-ring": 65,
  "geofence-draw": 80,
};

export function useDeckLayerManager() {
  const registryRef = useRef<Map<string, { layers: Layer[]; order: number }>>(new Map());
  const [registeredLayers, setRegisteredLayers] = useState<Layer[]>([]);

  const rebuild = useCallback(() => {
    const entries = Array.from(registryRef.current.entries());
    entries.sort((a, b) => a[1].order - b[1].order);
    const allLayers: Layer[] = [];
    for (const [, { layers }] of entries) {
      allLayers.push(...layers);
    }
    setRegisteredLayers(allLayers);
  }, []);

  const registerLayers = useCallback(
    (id: string, layers: Layer[], order?: number) => {
      registryRef.current.set(id, { layers, order: order ?? LAYER_ORDER[id] ?? 100 });
      rebuild();
    },
    [rebuild]
  );

  const unregisterLayers = useCallback(
    (id: string) => {
      registryRef.current.delete(id);
      rebuild();
    },
    [rebuild]
  );

  const contextValue: DeckLayersContextValue = {
    registerLayers,
    unregisterLayers,
  };

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
