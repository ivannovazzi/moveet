import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "@/utils/client";
import { toast, toErrorMessage } from "@/lib/toast";
import { closeRing, ringArea } from "@/utils/geometry/simplify";
import type { Position } from "@/types";
import type { HeatzonePolygon } from "@/utils/client/simulation";

/** Intensity applied to a freshly drawn zone (0–1). */
export const DEFAULT_HEATZONE_INTENSITY = 0.6;

/** Debounce for slider / drag PATCHes so we don't hammer the server mid-gesture. */
const PATCH_DEBOUNCE_MS = 200;

/**
 * Minimum polygon area (in squared degrees) for a lasso to count as a real
 * zone. Filters out accidental taps / hairline strokes. ~1e-8 deg² is roughly
 * a 1m × 1m box near the equator, so anything a user deliberately draws clears
 * it comfortably while a stray click does not.
 */
const MIN_RING_AREA = 1e-8;

export type HeatzoneEditorMode = "idle" | "draw" | "selected";

export interface HeatzoneDraft {
  id: string;
  coordinates: Position[];
}

export interface HeatzoneEditor {
  mode: HeatzoneEditorMode;
  isDrawing: boolean;
  selectedId: string | null;
  /** In-progress local geometry during a reshape/move drag, reconciled on WS echo. */
  draft: HeatzoneDraft | null;

  startDraw: () => void;
  stopDraw: () => void;
  toggleDraw: () => void;
  select: (id: string) => void;
  deselect: () => void;

  createFromLasso: (path: Position[]) => Promise<void>;
  setDraft: (id: string, coordinates: Position[]) => void;
  clearDraft: () => void;
  commitGeometry: (id: string, coordinates: Position[]) => Promise<void>;
  setIntensity: (id: string, intensity: number) => void;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  seed: (count?: number) => Promise<void>;
  /**
   * Increments on each successful seed. A monotonic one-shot signal so the app
   * can flip zone visibility on when zones are seeded from idle (draw/select
   * already force it) without permanently overriding the user's toggle.
   */
  seedNonce: number;
}

function toPolygon(coordinates: Position[]): HeatzonePolygon {
  return { type: "Polygon", coordinates };
}

/**
 * Editor state machine + server mutations for manually drawn heatzones.
 *
 * The server is authoritative: every mutation is a REST round-trip and the
 * updated zone list arrives back over the `heatzones` WS channel (see
 * `useHeatzones`). During a reshape/move drag we keep a local `draft` geometry
 * for smoothness and reconcile it away once the mutation lands.
 */
export function useHeatzoneEditor(): HeatzoneEditor {
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<HeatzoneDraft | null>(null);
  const [seedNonce, setSeedNonce] = useState(0);

  const intensityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingIntensity = useRef<{ id: string; intensity: number } | null>(null);

  const mode: HeatzoneEditorMode = isDrawing ? "draw" : selectedId ? "selected" : "idle";

  const deselect = useCallback(() => {
    setSelectedId(null);
    setDraftState(null);
  }, []);

  const startDraw = useCallback(() => {
    setIsDrawing(true);
    setSelectedId(null);
    setDraftState(null);
  }, []);

  const stopDraw = useCallback(() => setIsDrawing(false), []);

  const toggleDraw = useCallback(() => {
    setIsDrawing((prev) => {
      if (!prev) {
        setSelectedId(null);
        setDraftState(null);
      }
      return !prev;
    });
  }, []);

  const select = useCallback((id: string) => {
    setIsDrawing(false);
    setDraftState(null);
    setSelectedId(id);
  }, []);

  const setDraft = useCallback((id: string, coordinates: Position[]) => {
    setDraftState({ id, coordinates });
  }, []);

  const clearDraft = useCallback(() => setDraftState(null), []);

  const createFromLasso = useCallback(async (path: Position[]) => {
    if (path.length < 3 || ringArea(path) < MIN_RING_AREA) return;
    const coordinates = closeRing(path);
    const res = await client.createHeatzone({
      geometry: toPolygon(coordinates),
      intensity: DEFAULT_HEATZONE_INTENSITY,
    });
    if (res.error) toast.error(toErrorMessage(res.error, "Failed to create zone"));
  }, []);

  const commitGeometry = useCallback(async (id: string, coordinates: Position[]) => {
    const res = await client.updateHeatzone(id, { geometry: toPolygon(coordinates) });
    if (res.error) toast.error(toErrorMessage(res.error, "Failed to reshape zone"));
    setDraftState((d) => (d && d.id === id ? null : d));
  }, []);

  // Send the pending intensity PATCH now (if any) and cancel its debounce timer.
  const flushIntensity = useCallback(() => {
    clearTimeout(intensityTimer.current);
    const pending = pendingIntensity.current;
    pendingIntensity.current = null;
    if (!pending) return;
    client.updateHeatzone(pending.id, { intensity: pending.intensity }).then((res) => {
      if (res.error) toast.error(toErrorMessage(res.error, "Failed to update intensity"));
    });
  }, []);

  const setIntensity = useCallback(
    (id: string, intensity: number) => {
      // Only one zone is edited at a time; if the pending change belongs to a
      // different zone, flush it immediately so switching zones mid-debounce
      // can't drop the first zone's edit (the shared slot/timer would otherwise
      // overwrite it and it would snap back on the next WS broadcast).
      const pending = pendingIntensity.current;
      if (pending && pending.id !== id) flushIntensity();
      pendingIntensity.current = { id, intensity };
      clearTimeout(intensityTimer.current);
      intensityTimer.current = setTimeout(flushIntensity, PATCH_DEBOUNCE_MS);
    },
    [flushIntensity]
  );

  const remove = useCallback(async (id: string) => {
    const res = await client.deleteHeatzone(id);
    if (res.error) {
      toast.error(toErrorMessage(res.error, "Failed to delete zone"));
      return;
    }
    setSelectedId((sel) => (sel === id ? null : sel));
    setDraftState((d) => (d && d.id === id ? null : d));
  }, []);

  const clearAll = useCallback(async () => {
    const res = await client.clearHeatzones();
    if (res.error) {
      toast.error(toErrorMessage(res.error, "Failed to clear zones"));
      return;
    }
    deselect();
    toast.success("Cleared all zones");
  }, [deselect]);

  const seed = useCallback(async (count?: number) => {
    const res = await client.seedHeatzones({ count });
    if (res.error) {
      toast.error(toErrorMessage(res.error, "Failed to seed zones"));
      return;
    }
    const total = res.data?.length ?? 0;
    toast.success(`Seeded random zones (${total} total)`);
    setSeedNonce((n) => n + 1);
  }, []);

  // Flush any pending debounced intensity PATCH on unmount.
  useEffect(() => {
    return () => flushIntensity();
  }, [flushIntensity]);

  return useMemo(
    () => ({
      mode,
      isDrawing,
      selectedId,
      draft,
      startDraw,
      stopDraw,
      toggleDraw,
      select,
      deselect,
      createFromLasso,
      setDraft,
      clearDraft,
      commitGeometry,
      setIntensity,
      remove,
      clearAll,
      seed,
      seedNonce,
    }),
    [
      mode,
      isDrawing,
      selectedId,
      draft,
      seedNonce,
      startDraw,
      stopDraw,
      toggleDraw,
      select,
      deselect,
      createFromLasso,
      setDraft,
      clearDraft,
      commitGeometry,
      setIntensity,
      remove,
      clearAll,
      seed,
    ]
  );
}
