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
}

export function useFleets(): UseFleets {
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [hiddenFleetIds, setHiddenFleetIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    client.getFleets().then((res) => {
      if (res.data) setFleets(res.data);
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
    await client.createFleet(name);
  }, []);

  const deleteFleet = useCallback(async (id: string) => {
    await client.deleteFleet(id);
  }, []);

  const assignVehicle = useCallback(async (fleetId: string, vehicleId: string) => {
    await client.assignVehicles(fleetId, [vehicleId]);
  }, []);

  const unassignVehicle = useCallback(async (fleetId: string, vehicleId: string) => {
    await client.unassignVehicles(fleetId, [vehicleId]);
  }, []);

  const toggleFleetVisibility = useCallback((fleetId: string) => {
    setHiddenFleetIds((prev) => {
      const next = new Set(prev);
      if (next.has(fleetId)) next.delete(fleetId);
      else next.add(fleetId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (hiddenFleetIds.size === 0) {
      client.subscribe(null);
    } else {
      const visibleFleetIds = fleets.map((f) => f.id).filter((id) => !hiddenFleetIds.has(id));
      client.subscribe({ fleetIds: visibleFleetIds });
    }
  }, [hiddenFleetIds, fleets]);

  return {
    fleets,
    createFleet,
    deleteFleet,
    assignVehicle,
    unassignVehicle,
    hiddenFleetIds,
    toggleFleetVisibility,
  };
}
