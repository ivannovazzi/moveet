import { useState, useEffect } from "react";
import client from "@/utils/client";
import type { TrafficEdge } from "@/types";

export function useTraffic() {
  const [edges, setEdges] = useState<TrafficEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .getTraffic()
      .then((res) => {
        if (res.error) {
          console.warn("useTraffic: failed to fetch traffic", res.error);
          return;
        }
        if (res.data) setEdges(res.data);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.warn("useTraffic: failed to fetch traffic", msg);
      })
      .finally(() => setLoading(false));
    client.onTraffic((data) => setEdges(data));
  }, []);

  return { edges, loading };
}
