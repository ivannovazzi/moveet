import { useCallback, useEffect, useState } from "react";
import client from "../utils/client";
import type { Fleet } from "../types";

export interface UseFleets {
  fleets: Fleet[];
  createFleet: (name: string) => Promise<void>;
  deleteFleet: (id: string) => Promise<void>;
  assignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  unassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  hiddenFleetIds: Set<string>;
  toggleFleetVisibility: (fleetId: string) => void;
  error: string | null;
}

export function useFleets(): UseFleets {
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [hiddenFleetIds, setHiddenFleetIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getFleets()
      .then((res) => {
        if (res.error) {
          setError(res.error);
          console.warn("useFleets: failed to fetch fleets", res.error);
          return;
        }
        if (res.data) setFleets(res.data);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        console.warn("useFleets: failed to fetch fleets", msg);
      });

    client.onFleetCreated((fleet) => {
      setFleets((prev) => [...prev, fleet]);
    });

    client.onFleetDeleted(({ id }) => {
      setFleets((prev) => prev.filter((f) => f.id !== id));
      setHiddenFleetIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });

    client.onFleetAssigned(({ fleetId, vehicleIds }) => {
      setFleets((prev) =>
        prev.map((f) => {
          const filtered = f.vehicleIds.filter((vid) => !vehicleIds.includes(vid));
          if (f.id === fleetId) {
            return { ...f, vehicleIds: [...filtered, ...vehicleIds] };
          }
          return { ...f, vehicleIds: filtered };
        })
      );
    });
  }, []);

  const createFleet = useCallback(async (name: string) => {
    setError(null);
    try {
      const res = await client.createFleet(name);
      if (res.error) {
        setError(res.error);
        console.warn("useFleets: createFleet failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useFleets: createFleet failed", msg);
    }
  }, []);

  const deleteFleet = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await client.deleteFleet(id);
      if (res.error) {
        setError(res.error);
        console.warn("useFleets: deleteFleet failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useFleets: deleteFleet failed", msg);
    }
  }, []);

  const assignVehicle = useCallback(async (fleetId: string, vehicleId: string) => {
    setError(null);
    try {
      const res = await client.assignVehicles(fleetId, [vehicleId]);
      if (res.error) {
        setError(res.error);
        console.warn("useFleets: assignVehicle failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useFleets: assignVehicle failed", msg);
    }
  }, []);

  const unassignVehicle = useCallback(async (fleetId: string, vehicleId: string) => {
    setError(null);
    try {
      const res = await client.unassignVehicles(fleetId, [vehicleId]);
      if (res.error) {
        setError(res.error);
        console.warn("useFleets: unassignVehicle failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useFleets: unassignVehicle failed", msg);
    }
  }, []);

  const toggleFleetVisibility = useCallback((fleetId: string) => {
    setHiddenFleetIds((prev) => {
      const next = new Set(prev);
      if (next.has(fleetId)) next.delete(fleetId);
      else next.add(fleetId);
      return next;
    });
  }, []);

  return {
    fleets,
    createFleet,
    deleteFleet,
    assignVehicle,
    unassignVehicle,
    hiddenFleetIds,
    toggleFleetVisibility,
    error,
  };
}
