import { useState, useEffect } from "react";
import client from "@/utils/client";
import type { TrafficEdge } from "@/types";

export function useTraffic() {
  const [edges, setEdges] = useState<TrafficEdge[]>([]);

  useEffect(() => {
    client.getTraffic().then((res) => {
      if (res.data) setEdges(res.data);
    });
    client.onTraffic((data) => setEdges(data));
  }, []);

  return edges;
}
