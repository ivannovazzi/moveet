import { usePOIContext } from "@/data/useData";
import client from "@/utils/client";
import { fetchUntil } from "@/utils/fetchWithRetry";
import { useEffect } from "react";

export function usePois() {
  const { pois, setPOIs } = usePOIContext();

  useEffect(() => {
    const ac = new AbortController();
    fetchUntil(() => client.getPois().then((r) => r.data ?? null), {
      signal: ac.signal,
      maxRetries: Infinity,
    }).then((data) => {
      if (data) setPOIs(data);
    });
    return () => ac.abort();
  }, [setPOIs]);

  return { pois };
}
