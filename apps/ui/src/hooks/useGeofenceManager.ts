import { useCallback, useEffect, useState } from "react";
import client from "@/utils/client";
import { toast } from "@/lib/toast";
import type { GeoFence, GeoFenceEvent, CreateGeoFenceRequest } from "@moveet/shared-types";

/** Cap on retained geofence alert events (newest first). */
const MAX_ALERTS = 200;

/**
 * Geofencing domain state: fence CRUD (with optimistic updates), live alert
 * events from the WebSocket, and polygon-drawing UI state.
 *
 * Extracted from App.tsx — behavior preserved verbatim.
 */
export function useGeofenceManager() {
  const [fences, setFences] = useState<GeoFence[]>([]);
  const [alerts, setAlerts] = useState<GeoFenceEvent[]>([]);
  const [drawingActive, setDrawingActive] = useState(false);
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);
  const [drawConfirmId, setDrawConfirmId] = useState(0);
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

  // ─── Drawing ──────────────────────────────────────────────────────
  const startDrawing = useCallback(() => setDrawingActive(true), []);

  const onDrawComplete = useCallback((polygon: [number, number][]) => {
    setDrawingActive(false);
    setDrawingVertexCount(0);
    setPendingPolygon(polygon);
  }, []);

  const onDrawCancel = useCallback(() => {
    setDrawingActive(false);
    setDrawingVertexCount(0);
    setPendingPolygon(null);
  }, []);

  const onConfirmDraw = useCallback(() => {
    setDrawConfirmId((n) => n + 1);
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
    drawingActive,
    drawingVertexCount,
    setDrawingVertexCount,
    drawConfirmId,
    pendingPolygon,
    startDrawing,
    onFenceToggle,
    onFenceDelete,
    onDrawComplete,
    onDrawCancel,
    onConfirmDraw,
    onCreateZone,
    closePendingPolygon,
  };
}
