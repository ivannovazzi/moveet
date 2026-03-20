import { useState, useEffect } from "react";
import { HttpClient } from "@/utils/httpClient";
import { config } from "@/utils/config";

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
    httpClient
      .get<SpeedLimitSign[]>("/speed-limits")
      .then((res) => {
        if (res.data) setSigns(res.data);
      })
      .catch(() => {});
  }, []);

  return { signs };
}
