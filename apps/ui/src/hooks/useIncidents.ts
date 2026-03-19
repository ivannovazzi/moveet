import { useCallback, useEffect, useState } from "react";
import client from "@/utils/client";
import type { IncidentDTO, IncidentType } from "@/types";

export interface UseIncidents {
  incidents: IncidentDTO[];
  createRandom: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  createAtPosition: (lat: number, lng: number, type: IncidentType) => Promise<void>;
  error: string | null;
}

export function useIncidents(): UseIncidents {
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getIncidents()
      .then((res) => {
        if (res.error) {
          setError(res.error);
          console.warn("useIncidents: failed to fetch incidents", res.error);
          return;
        }
        if (res.data) setIncidents(res.data);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        console.warn("useIncidents: failed to fetch incidents", msg);
      });

    client.onIncidentCreated((incident) => {
      setIncidents((prev) => [...prev, incident]);
    });

    client.onIncidentCleared(({ id }) => {
      setIncidents((prev) => prev.filter((inc) => inc.id !== id));
    });
  }, []);

  const createRandom = useCallback(async () => {
    setError(null);
    try {
      const res = await client.createRandomIncident();
      if (res.error) {
        setError(res.error);
        console.warn("useIncidents: createRandom failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useIncidents: createRandom failed", msg);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await client.removeIncident(id);
      if (res.error) {
        setError(res.error);
        console.warn("useIncidents: remove failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useIncidents: remove failed", msg);
    }
  }, []);

  const createAtPosition = useCallback(async (lat: number, lng: number, type: IncidentType) => {
    setError(null);
    try {
      const res = await client.createIncidentAtPosition(lat, lng, type);
      if (res.error) {
        setError(res.error);
        console.warn("useIncidents: createAtPosition failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useIncidents: createAtPosition failed", msg);
    }
  }, []);

  return { incidents, createRandom, remove, createAtPosition, error };
}
