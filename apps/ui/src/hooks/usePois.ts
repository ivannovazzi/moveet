import { usePOIContext } from "@/data/useData";
import { useMapRevision } from "@/data/mapRevision";
import client from "@/utils/client";
import { fetchUntil } from "@/utils/fetchWithRetry";
import { useEffect } from "react";

export function usePois() {
  const { pois, setPOIs } = usePOIContext();
  const mapRevision = useMapRevision();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `mapRevision` is the refetch trigger, not an input.
  useEffect(() => {
    const ac = new AbortController();
    fetchUntil(() => client.getPois().then((r) => r.data ?? null), {
      signal: ac.signal,
      maxRetries: Infinity,
    }).then((data) => {
      if (data) setPOIs(data);
    });
    return () => ac.abort();
  }, [setPOIs, mapRevision]);

  return { pois };
}
