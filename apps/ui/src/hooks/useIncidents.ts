import { useCallback, useEffect, useState } from "react";
import client from "@/utils/client";
import type { IncidentDTO } from "@/types";

export interface UseIncidents {
  incidents: IncidentDTO[];
  createRandom: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useIncidents(): UseIncidents {
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);

  useEffect(() => {
    client.getIncidents().then((res) => {
      if (res.data) setIncidents(res.data);
    });

    client.onIncidentCreated((incident) => {
      setIncidents((prev) => [...prev, incident]);
    });

    client.onIncidentCleared(({ id }) => {
      setIncidents((prev) => prev.filter((inc) => inc.id !== id));
    });
  }, []);

  const createRandom = useCallback(async () => {
    await client.createRandomIncident();
  }, []);

  const remove = useCallback(async (id: string) => {
    await client.removeIncident(id);
  }, []);

  return { incidents, createRandom, remove };
}
