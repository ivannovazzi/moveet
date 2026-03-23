import { useNetworkContext } from "@/data/useData";
import client from "@/utils/client";
import { fetchUntil } from "@/utils/fetchWithRetry";
import { useEffect, useState } from "react";

export function useNetwork() {
  const { network, setNetwork } = useNetworkContext();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetchUntil(() => client.getNetwork().then((r) => r.data ?? null), {
      signal: ac.signal,
      maxRetries: Infinity,
    }).then((data) => {
      if (data) {
        setNetwork(data);
        setLoading(false);
      }
    });
    return () => ac.abort();
  }, [setNetwork]);

  return { network, loading };
}
