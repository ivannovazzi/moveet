import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";
import type { Layer } from "@deck.gl/core";

// ─── Context for child layer registration ──────────────────────────

export interface DeckLayersContextValue {
  registerLayers: (id: string, layers: Layer[]) => void;
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

export function useDeckLayerManager() {
  const registryRef = useRef<Map<string, Layer[]>>(new Map());
  const [registeredLayers, setRegisteredLayers] = useState<Layer[]>([]);

  const rebuild = useCallback(() => {
    const allLayers: Layer[] = [];
    for (const layers of registryRef.current.values()) {
      allLayers.push(...layers);
    }
    setRegisteredLayers(allLayers);
  }, []);

  const registerLayers = useCallback(
    (id: string, layers: Layer[]) => {
      registryRef.current.set(id, layers);
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

export function useRegisterLayers(id: string, layers: Layer[]) {
  const { registerLayers, unregisterLayers } = useDeckLayersContext();

  useEffect(() => {
    registerLayers(id, layers);
    return () => unregisterLayers(id);
    // We intentionally depend on the layers array reference so re-registration
    // happens when the caller provides new layer instances.
  }, [id, layers, registerLayers, unregisterLayers]);
}
