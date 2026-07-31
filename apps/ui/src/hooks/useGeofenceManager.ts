import { useCallback, useEffect, useState } from "react";
import client from "@/utils/client";
import { toast } from "@/lib/toast";
import { useFallingEdge } from "./useFallingEdge";
import type { GeoFence, GeoFenceEvent, CreateGeoFenceRequest } from "@moveet/shared-types";

/** Cap on retained geofence alert events (newest first). */
const MAX_ALERTS = 200;

/**
 * Mode wiring: drawing no longer owns its own on/off boolean — the
 * interaction-mode union (useInteractionMode) is the single owner.
 */
export interface GeofenceManagerOptions {
  /** True while the interaction mode is `draw-geofence`. */
  drawingActive: boolean;
  /** Request entering draw mode (refused during replay by the mode hook). */
  onEnterDrawing: () => void;
  /** Request exiting to browse mode. */
  onExitDrawing: () => void;
}

/**
 * Geofencing domain state: fence CRUD (with optimistic updates), live alert
 * events from the WebSocket, and polygon-drawing UI state.
 */
export function useGeofenceManager({
  drawingActive,
  onEnterDrawing,
  onExitDrawing,
}: GeofenceManagerOptions) {
  const [fences, setFences] = useState<GeoFence[]>([]);
  const [alerts, setAlerts] = useState<GeoFenceEvent[]>([]);
  // Fence selection is deliberately panel-local (NOT part of vehicle/POI
  // selection): it only drives the map outline emphasis.
  const [selectedFenceId, setSelectedFenceId] = useState<string | undefined>(undefined);
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);
  const [drawConfirmId, setDrawConfirmId] = useState(0);
  const [drawUndoId, setDrawUndoId] = useState(0);
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null);

  // ─── Data loading ─────────────────────────────────────────────────
  const fetchFences = useCallback(() => {
    client.getGeofences().then((response) => {
      if (response.data) setFences(response.data);
    });
  }, []);

  useEffect(() => {
    fetchFences();
  }, [fetchFences]);

  // ─── Live alerts ──────────────────────────────────────────────────
  useEffect(() => {
    // Named handler so cleanup removes exactly this handler — offGeofenceEvent
    // without an argument would wipe handlers registered elsewhere.
    const handleGeofenceEvent = (event: GeoFenceEvent) => {
      setAlerts((prev) => {
        const next = [event, ...prev];
        return next.length > MAX_ALERTS ? next.slice(0, MAX_ALERTS) : next;
      });
    };
    client.onGeofenceEvent(handleGeofenceEvent);
    return () => {
      client.offGeofenceEvent(handleGeofenceEvent);
    };
  }, []);

  // ─── Fence CRUD (optimistic) ──────────────────────────────────────
  const onFenceToggle = useCallback(
    async (id: string) => {
      const prev = fences;
      setFences((f) => f.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
      try {
        const res = await client.toggleGeofence(id);
        if (res.error) throw new Error(res.error);
      } catch {
        setFences(prev);
        console.warn("Failed to toggle geofence");
        toast.error("Failed to toggle zone");
      }
    },
    [fences]
  );

  const onFenceDelete = useCallback(
    async (id: string) => {
      const prev = fences;
      setFences((f) => f.filter((x) => x.id !== id));
      setSelectedFenceId((sel) => (sel === id ? undefined : sel));
      try {
        const res = await client.deleteGeofence(id);
        if (res.error) throw new Error(res.error);
      } catch {
        setFences(prev);
        console.warn("Failed to delete geofence");
        toast.error("Failed to delete zone");
      }
    },
    [fences]
  );

  // ─── Selection ────────────────────────────────────────────────────
  /** Toggle map-side fence selection (click the same fence again to clear). */
  const onSelectFence = useCallback((id: string) => {
    setSelectedFenceId((prev) => (prev === id ? undefined : id));
  }, []);

  // ─── Drawing ──────────────────────────────────────────────────────
  const startDrawing = onEnterDrawing;

  const onDrawComplete = useCallback(
    (polygon: [number, number][]) => {
      setDrawingVertexCount(0);
      setPendingPolygon(polygon);
      onExitDrawing();
    },
    [onExitDrawing]
  );

  const onDrawCancel = useCallback(() => {
    setDrawingVertexCount(0);
    setPendingPolygon(null);
    onExitDrawing();
  }, [onExitDrawing]);

  // Draw mode can also end outside this hook (entering dispatch, a replay
  // starting, …) — GeofenceDrawTool discards its vertices when `active`
  // drops, so mirror that by zeroing the reported count on the falling edge.
  useFallingEdge(drawingActive, () => setDrawingVertexCount(0));

  const onConfirmDraw = useCallback(() => {
    setDrawConfirmId((n) => n + 1);
  }, []);

  /**
   * Ask the map tool to drop the last placed vertex. The ring lives in
   * `GeofenceDrawTool`, so this is a request (a bumped nonce), not a mutation —
   * the same shape as confirm.
   */
  const onUndoVertex = useCallback(() => {
    setDrawUndoId((n) => n + 1);
  }, []);

  const onCreateZone = useCallback((req: CreateGeoFenceRequest) => {
    client.createGeofence(req).then((response) => {
      if (response.error) {
        toast.error(`Failed to create zone: ${response.error}`);
      } else if (response.data) {
        setFences((prev) => [...prev, response.data!]);
        toast.success(`Zone "${response.data.name}" created`);
      }
      setPendingPolygon(null);
    });
  }, []);

  const closePendingPolygon = useCallback(() => setPendingPolygon(null), []);

  return {
    fences,
    alerts,
    selectedFenceId,
    onSelectFence,
    /** Pass-through of the mode-derived flag so consumers keep one source. */
    drawingActive,
    drawingVertexCount,
    setDrawingVertexCount,
    drawConfirmId,
    drawUndoId,
    pendingPolygon,
    startDrawing,
    onFenceToggle,
    onFenceDelete,
    onDrawComplete,
    onDrawCancel,
    onConfirmDraw,
    onUndoVertex,
    onCreateZone,
    closePendingPolygon,
  };
}
