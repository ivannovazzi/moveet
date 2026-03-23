import { useRoadsContext } from "@/data/useData";
import client from "@/utils/client";
import { fetchUntil } from "@/utils/fetchWithRetry";
import { useEffect, useState } from "react";

export function useRoads() {
  const { roads, setRoads } = useRoadsContext();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetchUntil(
      () => client.getRoads().then((r) => r.data?.filter((road) => road.name !== "") ?? null),
      { signal: ac.signal, maxRetries: Infinity }
    ).then((data) => {
      if (data) {
        setRoads(data);
        setLoading(false);
      }
    });
    return () => ac.abort();
  }, [setRoads]);

  return { roads, loading };
}
