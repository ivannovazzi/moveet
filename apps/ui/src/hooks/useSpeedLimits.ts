import { useState, useEffect } from "react";
import { HttpClient } from "@/utils/httpClient";
import { config } from "@/utils/config";
import { fetchUntil } from "@/utils/fetchWithRetry";

export interface SpeedLimitSign {
  id: string;
  speed: number;
  coordinates: [number, number]; // [lat, lon]
  highway: string;
}

const httpClient = new HttpClient(config.apiUrl);

export function useSpeedLimits() {
  const [signs, setSigns] = useState<SpeedLimitSign[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    fetchUntil(
      () => httpClient.get<SpeedLimitSign[]>("/speed-limits").then((r) => r.data ?? null),
      { signal: ac.signal, maxRetries: Infinity }
    ).then((data) => {
      if (data) setSigns(data);
    });
    return () => ac.abort();
  }, []);

  return { signs };
}
